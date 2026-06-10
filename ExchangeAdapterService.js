const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");
const capitalDistributor = require("./CapitalDistributorService");

// Preços iniciais realistas
const INITIAL_PRICES = {
  BTCUSDT: 68000,
  ETHUSDT: 3200,
  BNBUSDT: 580,
  SOLUSDT: 150,
  XRPUSDT: 0.52,
};

// 🔥 VOLATILIDADE DIÁRIA REALISTA (%)
const DAILY_VOLATILITY = {
  BTCUSDT: 2.5,    // 2.5% ao dia
  ETHUSDT: 3.5,    // 3.5% ao dia
  BNBUSDT: 3.0,    // 3.0% ao dia
  SOLUSDT: 5.0,    // 5.0% ao dia
  XRPUSDT: 4.0,    // 4.0% ao dia
};

// Correlação entre pares
const CORRELATION = {
  BTCUSDT: 1.0,
  ETHUSDT: 0.85,
  BNBUSDT: 0.70,
  SOLUSDT: 0.65,
  XRPUSDT: 0.50,
};

class ExchangeAdapterService {
  constructor() {
    this.exchange = db.getConfig().exchange || "BYBIT";
    this.mode = db.getConfig().mode || "PAPER";
    this.connected = true;
    this.prices = {};
    this.tradeHistory = [];
    
    // Controle de oportunidades de arbitragem
    this._lastArbitrageCheck = {};
    this._arbitrageCooldown = 60000; // 1 MINUTO
    
    // 🔥 CONTROLE DE TENDÊNCIA DE MERCADO
    this._marketTrend = "sideways";
    this._trendStrength = 0;
    this._trendUpdateTime = 0;
    
    // Controle de tendência direcional
    this._directionalTrend = 0; // -1 bearish, 0 sideways, 1 bullish
    this._trendMomentum = 0;
    
    // 🆕 SIMULAÇÕES
    this.candles = {};
    this._lastCandleUpdate = {};
    this._sentimentScores = {};
    this._lastSentimentUpdate = {};
    this.multiExchangePrices = {
      binance: {},
      bybit: {},
      okx: {},
      kucoin: {}
    };
    
    // Inicializa preços
    for (const [symbol, price] of Object.entries(INITIAL_PRICES)) {
      this.prices[symbol] = {
        price: price,
        bid: price * 0.999,
        ask: price * 1.001,
        spread: 0.02,
        volume24h: 0,
        high24h: price,
        low24h: price,
        change24h: 0,
        change5m: 0,
        timestamp: Date.now()
      };
      this._lastArbitrageCheck[symbol] = 0;
      this.candles[symbol] = [];
      this._lastCandleUpdate[symbol] = Date.now();
      this._sentimentScores[symbol] = 0;
      this._lastSentimentUpdate[symbol] = Date.now();
      
      // Inicializa preços multi-exchange com spreads realistas
      const spreadBinance = (Math.random() - 0.5) * 0.001; // 0.1% max
      const spreadBybit = (Math.random() - 0.5) * 0.001;
      const spreadOkx = (Math.random() - 0.5) * 0.001;
      const spreadKucoin = (Math.random() - 0.5) * 0.001;
      
      this.multiExchangePrices.binance[symbol] = price * (1 + spreadBinance);
      this.multiExchangePrices.bybit[symbol] = price * (1 + spreadBybit);
      this.multiExchangePrices.okx[symbol] = price * (1 + spreadOkx);
      this.multiExchangePrices.kucoin[symbol] = price * (1 + spreadKucoin);
    }
    
    this._startRealisticSimulation();
    this._startCandleSimulation();
    this._startSentimentSimulation();
    
    logger.info("ExchangeAdapterService initialized with REALISTIC volatility", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      dailyVolatility: DAILY_VOLATILITY
    });
  }

  getAgentBalance(agentId = "trend") {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    const balance = agentInfo ? agentInfo.balance : 0;
    return balance;
  }

  getMarketTrend() {
    return {
      trend: this._marketTrend,
      strength: this._trendStrength,
      directional: this._directionalTrend,
      momentum: this._trendMomentum,
      timestamp: this._trendUpdateTime
    };
  }

  getMultiExchangePrices(symbol) {
    return {
      binance: this.multiExchangePrices.binance[symbol] || this.prices[symbol]?.price || INITIAL_PRICES[symbol],
      bybit: this.multiExchangePrices.bybit[symbol] || this.prices[symbol]?.price || INITIAL_PRICES[symbol],
      okx: this.multiExchangePrices.okx[symbol] || this.prices[symbol]?.price || INITIAL_PRICES[symbol],
      kucoin: this.multiExchangePrices.kucoin[symbol] || this.prices[symbol]?.price || INITIAL_PRICES[symbol]
    };
  }

  getCandles(symbol, interval = "1h", limit = 100) {
    if (!this.candles[symbol] || this.candles[symbol].length === 0) {
      this._generateInitialCandles(symbol, limit);
    }
    return this.candles[symbol].slice(-limit);
  }

  _generateInitialCandles(symbol, count = 100) {
    const basePrice = this.prices[symbol]?.price || INITIAL_PRICES[symbol];
    const candles = [];
    let currentPrice = basePrice;
    const now = Date.now();
    const dailyVol = DAILY_VOLATILITY[symbol] || 2.0;
    
    for (let i = count; i > 0; i--) {
      // Volatilidade por hora (dailyVol / 24)
      const hourlyVol = dailyVol / 24 / 100;
      const change = (Math.random() - 0.5) * hourlyVol * 2;
      const open = currentPrice;
      const close = currentPrice * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * hourlyVol);
      const low = Math.min(open, close) * (1 - Math.random() * hourlyVol);
      
      candles.push({
        timestamp: now - (i * 3600000),
        open, high, low, close,
        volume: Math.random() * 1000000
      });
      
      currentPrice = close;
    }
    
    this.candles[symbol] = candles;
  }

  _startCandleSimulation() {
    setInterval(() => {
      for (const [symbol, data] of Object.entries(this.prices)) {
        const lastCandle = this.candles[symbol]?.[this.candles[symbol].length - 1];
        const now = Date.now();
        const lastUpdate = this._lastCandleUpdate[symbol] || now;
        
        if (now - lastUpdate >= 3600000) {
          const currentPrice = data.price;
          const lastClose = lastCandle?.close || currentPrice;
          const change = (currentPrice - lastClose) / lastClose;
          
          const newCandle = {
            timestamp: now,
            open: lastClose,
            high: Math.max(lastClose, currentPrice) * (1 + Math.random() * 0.002),
            low: Math.min(lastClose, currentPrice) * (1 - Math.random() * 0.002),
            close: currentPrice,
            volume: Math.random() * 1000000
          };
          
          this.candles[symbol].push(newCandle);
          if (this.candles[symbol].length > 500) this.candles[symbol].shift();
          this._lastCandleUpdate[symbol] = now;
          
          eventBus.emit("market:candle", { symbol, candle: newCandle, interval: "1h" });
        }
      }
    }, 60000);
  }

  getMarketSentiment(symbol) {
    const score = this._sentimentScores[symbol] || 0;
    let sentiment = "neutral";
    if (score > 0.3) sentiment = "bullish";
    if (score > 0.6) sentiment = "very_bullish";
    if (score < -0.3) sentiment = "bearish";
    if (score < -0.6) sentiment = "very_bearish";
    
    return { symbol, sentiment, score: score, confidence: Math.abs(score), timestamp: Date.now() };
  }

  _startSentimentSimulation() {
    setInterval(() => {
      for (const symbol of Object.keys(INITIAL_PRICES)) {
        const priceChange = this.prices[symbol]?.change5m || 0;
        
        let baseSentiment = 0;
        if (priceChange > 0.3) baseSentiment = 0.5;
        else if (priceChange > 0.1) baseSentiment = 0.2;
        else if (priceChange < -0.3) baseSentiment = -0.5;
        else if (priceChange < -0.1) baseSentiment = -0.2;
        
        const noise = (Math.random() - 0.5) * 0.2;
        const newSentiment = Math.max(-1, Math.min(1, baseSentiment + noise));
        const oldSentiment = this._sentimentScores[symbol] || 0;
        this._sentimentScores[symbol] = oldSentiment * 0.8 + newSentiment * 0.2;
        
        eventBus.emit("market:sentiment", { symbol, sentiment: this.getMarketSentiment(symbol), timestamp: Date.now() });
      }
    }, 30000);
  }

  async getMultiExchangeArbitrage(symbol = "BTCUSDT") {
    try {
      const now = Date.now();
      const lastCheck = this._lastArbitrageCheck[symbol] || 0;
      
      if (now - lastCheck < 60000) return null;
      this._lastArbitrageCheck[symbol] = now;
      
      const prices = this.getMultiExchangePrices(symbol);
      const exchanges = Object.keys(prices);
      
      let buyExchange = exchanges[0];
      let sellExchange = exchanges[0];
      let lowestPrice = prices[buyExchange];
      let highestPrice = prices[sellExchange];
      
      for (const ex of exchanges) {
        if (prices[ex] < lowestPrice) { lowestPrice = prices[ex]; buyExchange = ex; }
        if (prices[ex] > highestPrice) { highestPrice = prices[ex]; sellExchange = ex; }
      }
      
      const spreadPercent = ((highestPrice - lowestPrice) / lowestPrice) * 100;
      
      // 🔥 SPREAD MÍNIMO REALISTA: 0.05% (arbitrage real)
      if (spreadPercent < 0.08) return null;
      
      // 🔥 LIMITA SPREAD MÁXIMO SIMULADO: 0.3%
      const realisticSpread = Math.min(0.3, spreadPercent);
      
      return {
        symbol,
        buyExchange,
        sellExchange,
        buyPrice: lowestPrice,
        sellPrice: highestPrice,
        spreadPercent: parseFloat(realisticSpread.toFixed(4)),
        netSpread: parseFloat((realisticSpread - 0.06).toFixed(4)),
        isProfitable: realisticSpread > 0.1,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Erro na arbitragem: ${error.message}`);
      return null;
    }
  }

  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    return this.getMultiExchangeArbitrage(symbol);
  }

  _startRealisticSimulation() {
    setInterval(() => {
      const now = new Date();
      const hour = now.getUTCHours();
      
      // 🔥 FATOR DE TEMPO (mais volatilidade em horário de mercado)
      let timeFactor = 0.7;
      if (hour >= 13 && hour <= 17) timeFactor = 1.5;  // NY session
      else if (hour >= 8 && hour <= 12) timeFactor = 1.2; // London session
      else if (hour >= 0 && hour <= 7) timeFactor = 0.6; // Asia session
      
      // 🔥 TENDÊNCIA DIRECIONAL (muda a cada poucos minutos)
      if (Math.random() < 0.02) {
        this._directionalTrend = (Math.random() - 0.5) * 1.5;
        this._trendMomentum = (Math.random() - 0.5) * 0.5;
      }
      
      const marketDrift = (this._directionalTrend * 0.0001) + (this._trendMomentum * 0.00005);
      
      let totalChange = 0;
      let count = 0;
      
      for (const [symbol, data] of Object.entries(this.prices)) {
        const dailyVol = DAILY_VOLATILITY[symbol] / 100;
        const correlation = CORRELATION[symbol] || 0.5;
        
        // 🔥 VOLATILIDADE REALISTA (movimentos de 0.1% a 1% por update)
        const volatilityFactor = dailyVol * timeFactor / Math.sqrt(24 * 60 / 2); // para cada 2 segundos
        const specificNoise = (Math.random() - 0.5) * volatilityFactor;
        const driftComponent = marketDrift * correlation;
        const deltaPercent = driftComponent + specificNoise;
        
        let newPrice = data.price * (1 + deltaPercent);
        
        // Limites realistas
        if (symbol === 'BTCUSDT') newPrice = Math.max(30000, Math.min(150000, newPrice));
        if (symbol === 'ETHUSDT') newPrice = Math.max(1500, Math.min(8000, newPrice));
        if (symbol === 'BNBUSDT') newPrice = Math.max(200, Math.min(1200, newPrice));
        if (symbol === 'SOLUSDT') newPrice = Math.max(20, Math.min(500, newPrice));
        if (symbol === 'XRPUSDT') newPrice = Math.max(0.3, Math.min(3, newPrice));
        
        const priceChange = ((newPrice - data.price) / data.price) * 100;
        totalChange += priceChange;
        count++;
        
        // 🔥 ATUALIZA INDICADORES
        const oldPrice = data.price;
        data.price = newPrice;
        data.bid = newPrice * 0.9995;
        data.ask = newPrice * 1.0005;
        
        if (newPrice > data.high24h) data.high24h = newPrice;
        if (newPrice < data.low24h) data.low24h = newPrice;
        
        // Variação em 5 minutos (12 ticks de 2s = 24s, aproximado)
        if (!data._price5mAgo) data._price5mAgo = newPrice;
        if (Math.random() < 0.05) {
          data.change5m = ((newPrice - data._price5mAgo) / data._price5mAgo) * 100;
          data._price5mAgo = newPrice;
        }
        
        const price24hAgo = data.price24hAgo || newPrice;
        data.change24h = ((newPrice - price24hAgo) / price24hAgo) * 100;
        data.volume24h = Math.floor(Math.random() * 50000000 * timeFactor) + 10000000;
        
        if (!data.lastReset || Date.now() - data.lastReset > 86400000) {
          data.price24hAgo = newPrice;
          data.lastReset = Date.now();
        }
        
        // 🔥 SIMULA PREÇOS MULTI-EXCHANGE (spreads pequenos)
        this.multiExchangePrices.binance[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.0006);
        this.multiExchangePrices.bybit[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.0006);
        this.multiExchangePrices.okx[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.0006);
        this.multiExchangePrices.kucoin[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.0006);
      }
      
      // 🔥 ATUALIZA TENDÊNCIA DO MERCADO
      if (count > 0) {
        const avgMarketChange = totalChange / count;
        this._trendUpdateTime = Date.now();
        
        if (avgMarketChange > 0.03) {
          this._marketTrend = "bullish";
          this._trendStrength = Math.min(100, Math.abs(avgMarketChange) * 200);
        } else if (avgMarketChange < -0.03) {
          this._marketTrend = "bearish";
          this._trendStrength = Math.min(100, Math.abs(avgMarketChange) * 200);
        } else {
          this._marketTrend = "sideways";
          this._trendStrength = Math.abs(avgMarketChange) * 100;
        }
      }
      
      eventBus.emit("tick", this.prices);
      eventBus.emit("market:trend", {
        trend: this._marketTrend,
        strength: this._trendStrength,
        directional: this._directionalTrend,
        timestamp: Date.now()
      });
      
      eventBus.emit("market:multiExchange", { prices: this.multiExchangePrices, timestamp: Date.now() });
      
    }, 2000); // Atualiza a cada 2 segundos
  }

  async getPrice(symbol) {
    const ticker = this.prices[symbol];
    return ticker?.price || INITIAL_PRICES[symbol] || 100;
  }

  getTicker(symbol) { 
    return this.prices[symbol] || null; 
  }
  
  getAllTickers() { 
    return this.prices; 
  }

  getSpread(symbol) {
    const ticker = this.prices[symbol];
    if (!ticker) return null;
    return {
      bid: ticker.bid,
      ask: ticker.ask,
      spread: ticker.ask - ticker.bid,
      spreadPercent: ((ticker.ask - ticker.bid) / ticker.price) * 100
    };
  }

  async placeOrder(symbol, side, qty, price = null, agentId = "trend") {
    if (this.mode === "PAPER") {
      const ticker = this.prices[symbol];
      if (!ticker) throw new Error(`Symbol ${symbol} not found`);
      
      const execPrice = price || ticker.price;
      const cost = execPrice * qty;
      
      const currentBalance = this.getAgentBalance(agentId);
      
      if (side === "BUY" && currentBalance < cost) {
        throw new Error(`Insufficient balance for ${agentId}. Need $${cost.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
      }
      
      const newBalance = currentBalance - cost;
      
      logger.info(`[PAPER] ${side} ${qty.toFixed(6)} ${symbol} @ $${execPrice.toFixed(2)} | Total: $${cost.toFixed(2)} | Agent: ${agentId}`);
      
      const order = { 
        orderId: `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, 
        symbol, side, qty, price: execPrice, total: cost,
        status: "FILLED", timestamp: new Date().toISOString(),
        mode: "PAPER", agent: agentId,
        balanceBefore: currentBalance, balanceAfter: newBalance
      };
      
      this.tradeHistory.unshift(order);
      if (this.tradeHistory.length > 1000) this.tradeHistory.pop();
      
      eventBus.emit("exchange:order", order);
      return order;
    }
    
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  getBalance(agentId) {
    const id = agentId || "trend";
    return { USDT: this.getAgentBalance(id) };
  }

  async getTotalBalance(agentId = "trend") {
    return this.getAgentBalance(agentId);
  }

  isConnected() { return this.connected; }

  setExchange(exchange) { 
    this.exchange = exchange; 
    db.updateConfig({ exchange });
  }

  setMode(mode) { 
    this.mode = mode; 
    db.updateConfig({ mode });
  }

  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(0, limit);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ExchangeAdapterService();
