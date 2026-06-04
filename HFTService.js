const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

// 🆕 IMPORT PARA CAPITAL ROUTER (fluxo de lucro)
const capitalRouter = require("./CapitalRouterService");

// ─── CONFIGURAÇÕES DO HFT ─────────────────────────────────────────────────────
const HFT_CONFIG = {
  SYMBOLS: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  TIMEFRAMES: ["1m", "5m", "15m", "1h"],
  MAX_POSITION_SIZE: 0.02,        // Máximo 2% do capital por trade
  STOP_LOSS: 0.003,               // 0.3% stop loss
  TAKE_PROFIT: 0.006,             // 0.6% take profit
  MIN_CONFIDENCE: 65,             // Confiança mínima para operar
  MAX_TRADES_PER_HOUR: 10,        // Máximo de trades por hora
  COOLDOWN_SECONDS: 60,           // Cooldown entre trades do mesmo símbolo
};

// ─── ESTRATÉGIAS HFT ─────────────────────────────────────────────────────────
const STRATEGIES = {
  // Estratégia de reversão à média (mean reversion)
  MEAN_REVERSION: (price, indicators) => {
    const recentAvg = indicators?.avgPrice || price;
    const deviation = ((price - recentAvg) / recentAvg) * 100;
    
    if (deviation < -0.2) return { signal: "BUY", confidence: 70 + Math.abs(deviation) * 50 };
    if (deviation > 0.2) return { signal: "SELL", confidence: 70 + deviation * 50 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  // Estratégia de breakout rápido
  BREAKOUT: (price, indicators) => {
    const high = indicators?.high24h || price * 1.01;
    const low = indicators?.low24h || price * 0.99;
    
    if (price > high) return { signal: "BUY", confidence: 75 };
    if (price < low) return { signal: "SELL", confidence: 75 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  // Estratégia de momentum rápido
  MOMENTUM: (price, indicators) => {
    const priceChange = indicators?.change5m || 0;
    
    if (priceChange > 0.15) return { signal: "BUY", confidence: 65 + priceChange * 50 };
    if (priceChange < -0.15) return { signal: "SELL", confidence: 65 + Math.abs(priceChange) * 50 };
    return { signal: "HOLD", confidence: 0 };
  },
};

class HFTService {
  constructor() {
    this.running = false;
    this.activeTrades = [];
    this.tradeHistory = [];
    this.lastTradeTime = {};
    this.tradesPerHour = {};
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this._intervalId = null;
    this._priceHistory = {};
    
    // Inicializa histórico de preços
    HFT_CONFIG.SYMBOLS.forEach(sym => {
      this._priceHistory[sym] = [];
    });
    
    // Escuta ticks de preço
    eventBus.on("tick", (prices) => this._onTick(prices));
    
    logger.info("HFTService initialized", { service: "HFT" });
  }
  
  async initialize() {
    logger.info("HFTService ready", { service: "HFT" });
    return { success: true };
  }
  
  start() {
    if (this.running) return { success: false, reason: "Already running" };
    
    this.running = true;
    this._intervalId = setInterval(() => this._scan(), 5000); // Escaneia a cada 5 segundos
    logger.info("HFTService started", { service: "HFT" });
    return { success: true };
  }
  
  stop() {
    this.running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    logger.info("HFTService stopped", { service: "HFT" });
    return { success: true };
  }
  
  getStatus() {
    const hourKey = `${Object.keys(this.lastTradeTime)[0]}_${Math.floor(Date.now() / 3600000)}`;
    
    return {
      running: this.running,
      activeTrades: this.activeTrades.length,
      totalTradesToday: this.tradeHistory.length,
      dailyProfit: Math.round(this.dailyProfit * 100) / 100,
      dailyLoss: Math.round(this.dailyLoss * 100) / 100,
      netDaily: Math.round((this.dailyProfit - this.dailyLoss) * 100) / 100,
      tradesPerHour: this.tradesPerHour[hourKey] || 0,
      maxTradesPerHour: HFT_CONFIG.MAX_TRADES_PER_HOUR,
      activeStrategy: "Consensus (MeanRev + Breakout + Momentum)",
      activePositions: this.activeTrades.map(t => ({
        symbol: t.symbol,
        side: t.side,
        entryPrice: t.entryPrice,
        pnl: t.pnl,
        pnlPct: t.pnlPct
      }))
    };
  }
  
  async getMetrics() {
    const closedTrades = this.tradeHistory.filter(t => t.status === "CLOSED");
    const wins = closedTrades.filter(t => t.pnl > 0);
    const totalProfit = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    return {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: closedTrades.length - wins.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      totalProfit: totalProfit,
      tradesToday: this.tradeHistory.length,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      sharpeRatio: 1.2 // Placeholder
    };
  }
  
  // ─── Processa tick de preço ─────────────────────────────────────────────────
  _onTick(prices) {
    if (!this.running) return;
    
    for (const [symbol, data] of Object.entries(prices)) {
      if (!HFT_CONFIG.SYMBOLS.includes(symbol)) continue;
      
      // Atualiza histórico de preços
      if (!this._priceHistory[symbol]) this._priceHistory[symbol] = [];
      this._priceHistory[symbol].push({
        price: data.price,
        timestamp: Date.now()
      });
      
      // Mantém apenas últimos 100 ticks (~5 minutos)
      if (this._priceHistory[symbol].length > 100) {
        this._priceHistory[symbol] = this._priceHistory[symbol].slice(-100);
      }
    }
  }
  
  // ─── Calcula indicadores rápidos ───────────────────────────────────────────
  _calculateIndicators(symbol) {
    const history = this._priceHistory[symbol] || [];
    if (history.length < 10) return null;
    
    const prices = history.map(h => h.price);
    const currentPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    // Mudança nos últimos 5 ticks (~25 segundos)
    const recentPrices = prices.slice(-5);
    const change5m = ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]) * 100;
    
    // Volatilidade rápida
    const volatility = this._calculateVolatility(prices.slice(-20));
    
    // Determinar high/low do período
    const high24h = Math.max(...prices);
    const low24h = Math.min(...prices);
    
    return {
      currentPrice,
      avgPrice,
      change5m,
      volatility,
      high24h,
      low24h,
      trend: change5m > 0.1 ? "UP" : change5m < -0.1 ? "DOWN" : "SIDEWAYS"
    };
  }
  
  _calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }
  
  // ─── Verifica limites de taxa ──────────────────────────────────────────────
  _checkRateLimits(symbol) {
    const now = Date.now();
    const hourKey = `${symbol}_${Math.floor(now / 3600000)}`;
    
    // Verifica trades por hora
    this.tradesPerHour[hourKey] = this.tradesPerHour[hourKey] || 0;
    if (this.tradesPerHour[hourKey] >= HFT_CONFIG.MAX_TRADES_PER_HOUR) {
      return false;
    }
    
    // Verifica cooldown do símbolo
    const lastTrade = this.lastTradeTime[symbol];
    if (lastTrade && (now - lastTrade) < HFT_CONFIG.COOLDOWN_SECONDS * 1000) {
      return false;
    }
    
    return true;
  }
  
  // ─── Gera sinal baseado nas estratégias ────────────────────────────────────
  _generateSignal(symbol, indicators) {
    if (!indicators) return null;
    
    const signals = [];
    
    // Executa todas as estratégias
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      const result = strategy(indicators.currentPrice, indicators);
      if (result.confidence >= HFT_CONFIG.MIN_CONFIDENCE) {
        signals.push({
          strategy: name,
          signal: result.signal,
          confidence: result.confidence
        });
      }
    }
    
    if (signals.length === 0) return null;
    
    // Verifica consenso (pelo menos 2 estratégias concordam)
    const buyCount = signals.filter(s => s.signal === "BUY").length;
    const sellCount = signals.filter(s => s.signal === "SELL").length;
    
    if (buyCount >= 2) {
      const avgConfidence = signals.filter(s => s.signal === "BUY").reduce((a, b) => a + b.confidence, 0) / buyCount;
      return { signal: "BUY", confidence: Math.min(95, Math.round(avgConfidence)) };
    }
    
    if (sellCount >= 2) {
      const avgConfidence = signals.filter(s => s.signal === "SELL").reduce((a, b) => a + b.confidence, 0) / sellCount;
      return { signal: "SELL", confidence: Math.min(95, Math.round(avgConfidence)) };
    }
    
    // Se não há consenso, pega o sinal de maior confiança
    const best = signals.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return { signal: best.signal, confidence: best.confidence };
  }
  
  // ─── Calcula tamanho da posição (máximo 2% do capital por trade) ───────────
  _calculatePositionSize(symbol, price, confidence) {
    const bal = exchange.getBalance();
    const totalEquity = bal.USDT + Object.entries(bal).filter(([k]) => k !== "USDT").reduce((a, [k, v]) => {
      const ticker = exchange.getTicker(`${k}USDT`);
      return a + (ticker ? v * ticker.price : 0);
    }, 0);
    
    // Base: 2% do equity
    let qty = (totalEquity * HFT_CONFIG.MAX_POSITION_SIZE) / price;
    
    // Ajusta por confiança (mais confiança = posição maior)
    const confidenceMultiplier = 0.5 + (confidence / 100); // 0.5 a 1.5
    qty = qty * confidenceMultiplier;
    
    // Limita ao máximo de 5% do equity
    const maxQty = (totalEquity * 0.05) / price;
    if (qty > maxQty) qty = maxQty;
    
    // Quantidade mínima
    let minQty = 0;
    if (symbol.includes("BTC")) minQty = 0.0001;
    else if (symbol.includes("ETH")) minQty = 0.001;
    else minQty = 0.01;
    
    if (qty < minQty) qty = minQty;
    
    return Math.round(qty * 10000) / 10000;
  }
  
  // ─── Executa trade ─────────────────────────────────────────────────────────
  async _executeTrade(signal, symbol, price, confidence) {
    const qty = this._calculatePositionSize(symbol, price, confidence);
    if (qty <= 0) return null;
    
    const stopPrice = signal === "BUY" 
      ? price * (1 - HFT_CONFIG.STOP_LOSS)
      : price * (1 + HFT_CONFIG.STOP_LOSS);
    const takeProfitPrice = signal === "BUY"
      ? price * (1 + HFT_CONFIG.TAKE_PROFIT)
      : price * (1 - HFT_CONFIG.TAKE_PROFIT);
    
    try {
      const order = await exchange.placeOrder(symbol, signal, qty, price);
      
      const trade = {
        id: `hft_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        symbol,
        side: signal,
        entryPrice: order.price,
        qty,
        stopLoss: stopPrice,
        takeProfit: takeProfitPrice,
        confidence,
        strategy: "HFT_CONSENSUS",
        status: "OPEN",
        openedAt: new Date().toISOString(),
        closedAt: null,
        pnl: 0,
        pnlPct: 0
      };
      
      this.activeTrades.push(trade);
      this.lastTradeTime[symbol] = Date.now();
      const hourKey = `${symbol}_${Math.floor(Date.now() / 3600000)}`;
      this.tradesPerHour[hourKey] = (this.tradesPerHour[hourKey] || 0) + 1;
      
      db.addTrade({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        status: "OPEN",
        entryPrice: trade.entryPrice,
        qty: trade.qty,
        strategy: trade.strategy,
        timestamp: trade.openedAt
      });
      
      eventBus.emit("hft:trade", { action: "OPEN", trade });
      logger.info(`[HFT] Trade opened: ${signal} ${qty} ${symbol} @ $${price} (conf: ${confidence}%)`, { service: "HFT" });
      
      return trade;
      
    } catch (error) {
      logger.error(`[HFT] Trade execution failed: ${error.message}`, { service: "HFT" });
      return null;
    }
  }
  
  // ─── Monitora trades abertos ───────────────────────────────────────────────
  _monitorTrades() {
    for (const trade of [...this.activeTrades]) {
      const ticker = exchange.getTicker(trade.symbol);
      if (!ticker) continue;
      
      const currentPrice = ticker.price;
      const pnlPct = trade.side === "BUY"
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
      const pnl = (pnlPct / 100) * trade.entryPrice * trade.qty;
      
      trade.pnl = Math.round(pnl * 100) / 100;
      trade.pnlPct = Math.round(pnlPct * 100) / 100;
      
      // Verifica stop loss e take profit
      const hitSL = trade.side === "BUY"
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;
      const hitTP = trade.side === "BUY"
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;
      
      if (hitSL || hitTP) {
        trade.status = "CLOSED";
        trade.closedAt = new Date().toISOString();
        trade.exitPrice = currentPrice;
        trade.result = hitTP ? "WIN" : "LOSS";
        
        this.activeTrades = this.activeTrades.filter(t => t.id !== trade.id);
        this.tradeHistory.unshift(trade);
        if (this.tradeHistory.length > 100) this.tradeHistory.pop();
        
        // Atualiza contadores diários
        if (trade.pnl > 0) this.dailyProfit += trade.pnl;
        else this.dailyLoss += Math.abs(trade.pnl);
        
        // 🆕 ENVIA LUCRO PARA O CAPITAL ROUTER (SE FOR LUCRO)
        if (trade.pnl > 0) {
          logger.info(`[HFT] Lucro de $${trade.pnl} será enviado para o robô SWING via CapitalRouter`, { service: "HFT" });
          // Envia o lucro para o CapitalRouterService (que vai repassar ao robô semanal)
          capitalRouter.routeHFTProfit(trade.pnl, trade.id).catch(err => {
            logger.error(`[HFT] Erro ao enviar lucro para CapitalRouter: ${err.message}`, { service: "HFT" });
          });
        }
        
        // Salva no banco
        db.addTrade({
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          status: "CLOSED",
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          pnl: trade.pnl,
          pnlPct: trade.pnlPct,
          strategy: trade.strategy,
          timestamp: trade.openedAt,
          closedAt: trade.closedAt
        });
        
        // Salva no HFT específico (para métricas)
        if (db.addHFTTrade) {
          db.addHFTTrade(trade);
        }
        
        eventBus.emit("hft:trade", { action: "CLOSE", trade });
        eventBus.emit("hft:profit", { 
          profit: trade.pnl,
          isProfit: trade.pnl > 0,
          tradeId: trade.id,
          symbol: trade.symbol,
          timestamp: trade.closedAt
        });
        
        logger.info(`[HFT] Trade closed (${hitTP ? "TP" : "SL"}): ${trade.symbol} PnL: $${trade.pnl} (${trade.pnlPct}%)`, { service: "HFT" });
      }
    }
  }
  
  // ─── Escaneia oportunidades de trade (CORRIGIDO - AGORA É ASYNC) ────────────
  async _scan() {  // 🔥 ADICIONADO "async" AQUI!
    if (!this.running) return;
    
    // Monitora trades abertos
    this._monitorTrades();
    
    // Busca novas oportunidades
    for (const symbol of HFT_CONFIG.SYMBOLS) {
      // Verifica limites de taxa
      if (!this._checkRateLimits(symbol)) continue;
      
      const indicators = this._calculateIndicators(symbol);
      if (!indicators) continue;
      
      // Verifica volatilidade (não opera em mercado muito calmo)
      if (indicators.volatility < 0.05) continue;
      
      const signal = this._generateSignal(symbol, indicators);
      if (!signal || signal.signal === "HOLD") continue;
      
      // Verifica se já tem trade aberto para este símbolo
      const hasOpenTrade = this.activeTrades.some(t => t.symbol === symbol);
      if (hasOpenTrade) continue;
      
      // 🔥 AGORA O AWAIT FUNCIONA PORQUE O MÉTODO É ASYNC!
      await this._executeTrade(signal.signal, symbol, indicators.currentPrice, signal.confidence);
    }
  }
  
  getTrades(limit = 20) {
    return this.tradeHistory.slice(0, limit);
  }
  
  // ─── Reseta o serviço (para novo dia) ──────────────────────────────────────
  resetDaily() {
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.tradesPerHour = {};
    this.tradeHistory = [];
    logger.info("[HFT] Daily counters reset", { service: "HFT" });
    return { success: true };
  }
}

module.exports = new HFTService();
