const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

// 🆕 IMPORT PARA INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");

// ─── CONFIGURAÇÕES DO HFT ─────────────────────────────────────────────────────
const HFT_CONFIG = {
  SYMBOLS: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  MAX_POSITION_SIZE: 0.02,        // 2% do capital por trade (reduzido de 0.05)
  STOP_LOSS: 0.003,               // 0.3% stop loss
  TAKE_PROFIT: 0.006,             // 0.6% take profit
  MIN_CONFIDENCE: 50,
  MAX_TRADES_PER_HOUR: 20,
  COOLDOWN_SECONDS: 30,
  SCAN_INTERVAL: 5000,            // 5 segundos
};

// ─── ESTRATÉGIAS HFT ─────────────────────────────────────────────────────────
const STRATEGIES = {
  MEAN_REVERSION: (price, indicators) => {
    const recentAvg = indicators?.avgPrice || price;
    const deviation = ((price - recentAvg) / recentAvg) * 100;
    if (deviation < -0.2) return { signal: "BUY", confidence: 70 + Math.abs(deviation) * 50 };
    if (deviation > 0.2) return { signal: "SELL", confidence: 70 + deviation * 50 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  BREAKOUT: (price, indicators) => {
    const high = indicators?.high24h || price * 1.01;
    const low = indicators?.low24h || price * 0.99;
    if (price > high) return { signal: "BUY", confidence: 75 };
    if (price < low) return { signal: "SELL", confidence: 75 };
    return { signal: "HOLD", confidence: 0 };
  },
  
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
    
    // Integração com Capital Distributor
    this.agentId = "hft";
    this.capitalAllocated = 0;
    this.dailyProfitToSend = 0;
    this.initialized = false;
    
    // Inicializa histórico de preços
    HFT_CONFIG.SYMBOLS.forEach(sym => {
      this._priceHistory[sym] = [];
    });
    
    // Escuta ticks de preço
    eventBus.on("tick", (prices) => this._onTick(prices));
    
    // 🔥 ESCUTA ALOCAÇÃO DE CAPITAL - INICIA AUTOMATICAMENTE QUANDO RECEBER
    eventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      logger.info(`💰 HFT recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`, { service: "HFT" });
      
      // 🔥 SE NÃO ESTIVER RODANDO E TEM CAPITAL, INICIA AGORA!
      if (!this.running && this.capitalAllocated > 0) {
        logger.info(`🚀 HFT detectou capital e vai iniciar automaticamente...`, { service: "HFT" });
        this.start();
      }
    });
    
    // 🔥 ESCUTA RETORNO DE CAPITAL (quando trade fecha)
    eventBus.on("capital:return", ({ agentId, amount, reason }) => {
      if (agentId === this.agentId && amount > 0) {
        this.capitalAllocated += amount;
        logger.info(`💰 HFT recebeu retorno de capital: $${amount}. Novo saldo: $${this.capitalAllocated}`, { service: "HFT" });
      }
    });
    
    // Escuta melhorias do Learning Brain
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("HFTService initialized", { service: "HFT" });
  }
  
  // 🔥 MÉTODO DE INICIALIZAÇÃO - CHAME UMA VEZ AO SUBIR O SISTEMA
  async initialize() {
    if (this.initialized) return { success: true, capital: this.capitalAllocated };
    
    logger.info("🔍 HFT: Inicializando e aguardando capital...", { service: "HFT" });
    
    // Aguarda alocação de capital por até 30 segundos
    let attempts = 0;
    while (this.capitalAllocated === 0 && attempts < 60) { // 60 tentativas = 6 segundos
      await this.sleep(100);
      attempts++;
    }
    
    this.initialized = true;
    
    if (this.capitalAllocated > 0) {
      logger.info(`✅ HFTService initialized com capital $${this.capitalAllocated}`, { service: "HFT" });
      // Se tem capital e não está rodando, inicia
      if (!this.running) {
        this.start();
      }
      return { success: true, capital: this.capitalAllocated };
    } else {
      logger.warn("⚠️ HFTService initialized sem capital - aguardando evento de alocação", { service: "HFT" });
      return { success: true, capital: 0, waitingForCapital: true };
    }
  }
  
  applyImprovement(improvement) {
    logger.info(`🧠 HFT recebeu melhoria: ${improvement.recommendation}`, { service: "HFT" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        if (this._intervalId) {
          clearInterval(this._intervalId);
          this._intervalId = setInterval(() => this._scan(), 3000);
          logger.info("⚡ HFT aumentou scan para 3 segundos", { service: "HFT" });
        }
        break;
        
      case "REDUZIR_RISCO":
        HFT_CONFIG.MAX_POSITION_SIZE = Math.max(0.005, HFT_CONFIG.MAX_POSITION_SIZE * 0.7);
        logger.info(`📉 HFT reduziu risco para ${HFT_CONFIG.MAX_POSITION_SIZE * 100}%`, { service: "HFT" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "HFT" });
    }
    
    this.shareLearning();
  }
  
  shareLearning() {
    const recentTrades = this.tradeHistory.filter(t => t.status === "CLOSED").slice(-20);
    const wins = recentTrades.filter(t => t.pnl > 0).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 10 && winRate > 60) {
      const learningData = {
        agentId: this.agentId,
        type: "strategy_performance",
        content: `HFT com ${winRate.toFixed(0)}% de acerto nos últimos ${recentTrades.length} trades`,
        confidence: winRate / 100,
        data: {
          winRate: winRate,
          totalTrades: recentTrades.length,
          avgProfit: recentTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins || 0
        }
      };
      
      eventBus.emit("learning:share", learningData);
      logger.debug(`📤 HFT compartilhou aprendizado: win rate ${winRate.toFixed(0)}%`, { service: "HFT" });
    }
  }
  
  async requestCapital(amount, reason) {
    return new Promise((resolve) => {
      capitalDistributor.handleRequest({
        agentId: this.agentId,
        amount: amount,
        reason: reason,
        callback: resolve
      });
    });
  }
  
  returnCapital(amount, reason) {
    eventBus.emit("capital:return", {
      agentId: this.agentId,
      amount: amount,
      reason: reason
    });
  }
  
  async sendDailyProfitToTrend() {
    if (this.dailyProfitToSend <= 0) {
      logger.info(`📊 Nenhum lucro diário para enviar ao Trend ($${this.dailyProfitToSend})`, { service: "HFT" });
      return;
    }
    
    const amount = this.dailyProfitToSend;
    logger.info(`🔄 HFT enviando lucro diário de $${amount} para o Trend`, { service: "HFT" });
    
    eventBus.emit("capital:hft:dailyProfit", {
      agentId: this.agentId,
      amount: amount,
      destination: "trend",
      timestamp: Date.now()
    });
    
    eventBus.emit("learning:share", {
      agentId: this.agentId,
      type: "daily_settlement",
      content: `HFT enviou $${amount} de lucro diário para o Trend`,
      confidence: 0.9,
      data: { amount }
    });
    
    this.dailyProfitToSend = 0;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  start() {
    if (this.running) return { success: false, reason: "Already running" };
    
    // Verifica se tem capital
    if (this.capitalAllocated <= 0) {
      logger.warn("HFTService: sem capital, vai aguardar alocação...", { service: "HFT" });
      // Não retorna erro - só não inicia ainda, mas vai iniciar quando chegar capital via evento
      return { success: false, reason: "No capital allocated - waiting" };
    }
    
    this.running = true;
    this._intervalId = setInterval(() => this._scan(), HFT_CONFIG.SCAN_INTERVAL);
    this.scheduleDailyTransfer();
    
    logger.info(`🚀 HFTService started com $${this.capitalAllocated}`, { service: "HFT" });
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
  
  scheduleDailyTransfer() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55, 0);
    const msUntilNight = night.getTime() - now.getTime();
    
    setTimeout(() => {
      this.sendDailyProfitToTrend();
      setInterval(() => this.sendDailyProfitToTrend(), 86400000);
    }, msUntilNight > 0 ? msUntilNight : 86400000 + msUntilNight);
  }
  
  getStatus() {
    return {
      running: this.running,
      activeTrades: this.activeTrades.length,
      totalTradesToday: this.tradeHistory.length,
      dailyProfit: Math.round(this.dailyProfit * 100) / 100,
      dailyLoss: Math.round(this.dailyLoss * 100) / 100,
      netDaily: Math.round((this.dailyProfit - this.dailyLoss) * 100) / 100,
      dailyProfitToSend: Math.round(this.dailyProfitToSend * 100) / 100,
      capitalAvailable: this.capitalAllocated,
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
      dailyProfitToSend: this.dailyProfitToSend,
      capital: this.capitalAllocated,
    };
  }
  
  _onTick(prices) {
    if (!this.running) return;
    
    for (const [symbol, data] of Object.entries(prices)) {
      if (!HFT_CONFIG.SYMBOLS.includes(symbol)) continue;
      
      if (!this._priceHistory[symbol]) this._priceHistory[symbol] = [];
      this._priceHistory[symbol].push({
        price: data.price,
        timestamp: Date.now()
      });
      
      if (this._priceHistory[symbol].length > 100) {
        this._priceHistory[symbol] = this._priceHistory[symbol].slice(-100);
      }
    }
  }
  
  _calculateIndicators(symbol) {
    const history = this._priceHistory[symbol] || [];
    if (history.length < 10) return null;
    
    const prices = history.map(h => h.price);
    const currentPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const recentPrices = prices.slice(-5);
    const change5m = ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]) * 100;
    const volatility = this._calculateVolatility(prices.slice(-20));
    const high24h = Math.max(...prices);
    const low24h = Math.min(...prices);
    
    return { currentPrice, avgPrice, change5m, volatility, high24h, low24h };
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
  
  _checkRateLimits(symbol) {
    const now = Date.now();
    const hourKey = `${symbol}_${Math.floor(now / 3600000)}`;
    
    this.tradesPerHour[hourKey] = this.tradesPerHour[hourKey] || 0;
    if (this.tradesPerHour[hourKey] >= HFT_CONFIG.MAX_TRADES_PER_HOUR) {
      return false;
    }
    
    const lastTrade = this.lastTradeTime[symbol];
    if (lastTrade && (now - lastTrade) < HFT_CONFIG.COOLDOWN_SECONDS * 1000) {
      return false;
    }
    
    return true;
  }
  
  _generateSignal(symbol, indicators) {
    if (!indicators) return null;
    
    const signals = [];
    
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      const result = strategy(indicators.currentPrice, indicators);
      if (result.confidence >= HFT_CONFIG.MIN_CONFIDENCE) {
        signals.push({ strategy: name, signal: result.signal, confidence: result.confidence });
      }
    }
    
    if (signals.length === 0) return null;
    
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
    
    const best = signals.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return { signal: best.signal, confidence: best.confidence };
  }
  
  _calculatePositionSize(symbol, price, confidence) {
    const totalEquity = this.capitalAllocated;
    if (totalEquity <= 0) return 0;
    
    let qty = (totalEquity * HFT_CONFIG.MAX_POSITION_SIZE) / price;
    const confidenceMultiplier = 0.5 + (confidence / 100);
    qty = qty * confidenceMultiplier;
    
    const maxQty = (totalEquity * 0.05) / price;
    if (qty > maxQty) qty = maxQty;
    
    let minQty = 0;
    if (symbol.includes("BTC")) minQty = 0.0001;
    else if (symbol.includes("ETH")) minQty = 0.001;
    else minQty = 0.01;
    
    if (qty < minQty) qty = minQty;
    
    return Math.round(qty * 10000) / 10000;
  }
  
  async _executeTrade(signal, symbol, price, confidence) {
    const qty = this._calculatePositionSize(symbol, price, confidence);
    if (qty <= 0) return null;
    
    const estimatedCost = price * qty;
    
    if (estimatedCost > this.capitalAllocated) {
      logger.warn(`HFT: Capital insuficiente. Necessário $${estimatedCost}, disponível $${this.capitalAllocated}`);
      return null;
    }
    
    const stopPrice = signal === "BUY" ? price * (1 - HFT_CONFIG.STOP_LOSS) : price * (1 + HFT_CONFIG.STOP_LOSS);
    const takeProfitPrice = signal === "BUY" ? price * (1 + HFT_CONFIG.TAKE_PROFIT) : price * (1 - HFT_CONFIG.TAKE_PROFIT);
    
    try {
      const capitalRequest = await this.requestCapital(estimatedCost, `Trade: ${signal} ${symbol}`);
      
      if (!capitalRequest.success) {
        logger.warn(`HFT: Trade rejeitado - ${capitalRequest.reason}`);
        return null;
      }
      
      const order = await exchange.placeOrder(symbol, signal, qty, price);
      
      const trade = {
        id: `hft_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        symbol, side: signal, entryPrice: order.price, qty, estimatedCost,
        stopLoss: stopPrice, takeProfit: takeProfitPrice, confidence,
        strategy: "HFT_CONSENSUS", status: "OPEN",
        openedAt: new Date().toISOString(), closedAt: null, pnl: 0, pnlPct: 0
      };
      
      this.activeTrades.push(trade);
      this.lastTradeTime[symbol] = Date.now();
      const hourKey = `${symbol}_${Math.floor(Date.now() / 3600000)}`;
      this.tradesPerHour[hourKey] = (this.tradesPerHour[hourKey] || 0) + 1;
      
      db.addTrade({
        id: trade.id, symbol, side: signal, status: "OPEN",
        entryPrice: order.price, qty, strategy: "HFT_CONSENSUS",
        timestamp: trade.openedAt
      });
      
      eventBus.emit("hft:trade", { action: "OPEN", trade });
      logger.info(`[HFT] Trade opened: ${signal} ${qty} ${symbol} @ $${price} (conf: ${confidence}%)`);
      
      return trade;
      
    } catch (error) {
      logger.error(`[HFT] Trade execution failed: ${error.message}`);
      return null;
    }
  }
  
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
      
      const hitSL = trade.side === "BUY" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;
      const hitTP = trade.side === "BUY" ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit;
      
      if (hitSL || hitTP) {
        trade.status = "CLOSED";
        trade.closedAt = new Date().toISOString();
        trade.exitPrice = currentPrice;
        trade.result = hitTP ? "WIN" : "LOSS";
        
        this.activeTrades = this.activeTrades.filter(t => t.id !== trade.id);
        this.tradeHistory.unshift(trade);
        if (this.tradeHistory.length > 100) this.tradeHistory.pop();
        
        if (trade.pnl > 0) {
          this.dailyProfit += trade.pnl;
          this.dailyProfitToSend += trade.pnl;
          
          eventBus.emit("agent:profit", {
            agentId: this.agentId,
            amount: trade.pnl,
            tradeId: trade.id
          });
          
          logger.info(`[HFT] Lucro: $${trade.pnl} (acumulado para Trend: $${this.dailyProfitToSend})`);
        } else {
          this.dailyLoss += Math.abs(trade.pnl);
          eventBus.emit("trade:closed", {
            agent: this.agentId,
            loss: Math.abs(trade.pnl),
            id: trade.id
          });
        }
        
        // Devolve capital (saldo + lucro/perda)
        if (trade.estimatedCost) {
          const returnedAmount = trade.estimatedCost + (trade.pnl || 0);
          if (returnedAmount > 0) {
            this.returnCapital(returnedAmount, `Trade closed: ${trade.result}`);
          }
        }
        
        db.addTrade({
          id: trade.id, symbol: trade.symbol, side: trade.side, status: "CLOSED",
          entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
          pnl: trade.pnl, pnlPct: trade.pnlPct, strategy: trade.strategy,
          timestamp: trade.openedAt, closedAt: trade.closedAt
        });
        
        if (db.addHFTTrade) db.addHFTTrade(trade);
        
        eventBus.emit("hft:trade", { action: "CLOSE", trade });
        logger.info(`[HFT] Trade closed (${hitTP ? "TP" : "SL"}): ${trade.symbol} PnL: $${trade.pnl} (${trade.pnlPct}%)`);
        
        this.shareLearning();
      }
    }
  }
  
  async _scan() {
    if (!this.running) return;
    
    this._monitorTrades();
    
    if (this.capitalAllocated <= 0) return;
    
    for (const symbol of HFT_CONFIG.SYMBOLS) {
      if (!this._checkRateLimits(symbol)) continue;
      
      const indicators = this._calculateIndicators(symbol);
      if (!indicators || indicators.volatility < 0.05) continue;
      
      const signal = this._generateSignal(symbol, indicators);
      if (!signal || signal.signal === "HOLD") continue;
      
      const hasOpenTrade = this.activeTrades.some(t => t.symbol === symbol);
      if (hasOpenTrade) continue;
      
      await this._executeTrade(signal.signal, symbol, indicators.currentPrice, signal.confidence);
    }
  }
  
  getTrades(limit = 20) {
    return this.tradeHistory.slice(0, limit);
  }
  
  async switchToLiveMode() {
    logger.info("🔄 HFT migrando para LIVE MODE...", { service: "HFT" });
    const result = await capitalDistributor.switchToLiveMode();
    if (result.success) {
      logger.info("✅ HFT agora opera em LIVE MODE", { service: "HFT" });
    } else {
      logger.error("❌ Falha ao migrar HFT para LIVE MODE", { service: "HFT" });
    }
    return result;
  }
  
  resetDaily() {
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.dailyProfitToSend = 0;
    this.tradesPerHour = {};
    this.tradeHistory = [];
    logger.info("[HFT] Daily counters reset", { service: "HFT" });
    return { success: true };
  }
}

module.exports = new HFTService();
