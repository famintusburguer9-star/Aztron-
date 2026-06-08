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

// Volatilidade anual aproximada por par (%)
const VOLATILITY = {
  BTCUSDT: 0.45,
  ETHUSDT: 0.55,
  BNBUSDT: 0.50,
  SOLUSDT: 0.70,
  XRPUSDT: 0.60,
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
    
    // Controle de oportunidades de arbitragem (MAIS LENTO)
    this._lastArbitrageCheck = {};
    this._arbitrageCooldown = 120000; // 2 MINUTOS
    
    // 🔥 CONTROLE DE TENDÊNCIA DE MERCADO (para o Trend)
    this._marketTrend = "sideways"; // bullish, bearish, sideways
    this._trendStrength = 0; // 0 a 100
    this._trendUpdateTime = 0;
    
    // 🆕 SIMULAÇÃO PARA DEEP PATTERN (Candles/velas)
    this.candles = {}; // Armazena velas por símbolo
    this._lastCandleUpdate = {};
    
    // 🆕 SIMULAÇÃO PARA SENTIMENT (Notícias/humor)
    this._sentimentScores = {}; // -1 a 1
    this._lastSentimentUpdate = {};
    
    // 🆕 SIMULAÇÃO PARA ARBITRAGEM (Múltiplas exchanges)
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
        timestamp: Date.now()
      };
      this._lastArbitrageCheck[symbol] = 0;
      
      // Inicializa candles vazios
      this.candles[symbol] = [];
      this._lastCandleUpdate[symbol] = Date.now();
      
      // Inicializa sentiment
      this._sentimentScores[symbol] = 0;
      this._lastSentimentUpdate[symbol] = Date.now();
      
      // Inicializa preços multi-exchange
      this.multiExchangePrices.binance[symbol] = price;
      this.multiExchangePrices.bybit[symbol] = price;
      this.multiExchangePrices.okx[symbol] = price;
      this.multiExchangePrices.kucoin[symbol] = price;
    }
    
    this._startRealisticSimulation();
    this._startCandleSimulation();    // 🆕 Para Deep Pattern
    this._startSentimentSimulation(); // 🆕 Para Sentiment Agent
    
    logger.info("ExchangeAdapterService initialized", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      status: "Com simulações para Arbitrage, Deep Pattern e Sentiment"
    });
  }

  getAgentBalance(agentId = "trend") {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    const balance = agentInfo ? agentInfo.balance : 0;
    return balance;
  }

  // 🔥 Obtém tendência atual do mercado
  getMarketTrend() {
    return {
      trend: this._marketTrend,
      strength: this._trendStrength,
      timestamp: this._trendUpdateTime
    };
  }

  // 🆕 PARA ARBITRAGE: Obtém preços de múltiplas exchanges
  getMultiExchangePrices(symbol) {
    const basePrice = this.prices[symbol]?.price || INITIAL_PRICES[symbol];
    
    // Simula spreads realísticos entre exchanges (0.05% a 0.5%)
    const spreadBinance = (Math.random() - 0.5) * 0.005;
    const spreadBybit = (Math.random() - 0.5) * 0.005;
    const spreadOkx = (Math.random() - 0.5) * 0.005;
    const spreadKucoin = (Math.random() - 0.5) * 0.005;
    
    return {
      binance: basePrice * (1 + spreadBinance),
      bybit: basePrice * (1 + spreadBybit),
      okx: basePrice * (1 + spreadOkx),
      kucoin: basePrice * (1 + spreadKucoin)
    };
  }

  // 🆕 PARA DEEP PATTERN: Obtém candles/velas históricas
  getCandles(symbol, interval = "1h", limit = 100) {
    if (!this.candles[symbol] || this.candles[symbol].length === 0) {
      this._generateInitialCandles(symbol, limit);
    }
    
    // Retorna as últimas 'limit' candles
    return this.candles[symbol].slice(-limit);
  }

  _generateInitialCandles(symbol, count = 100) {
    const basePrice = this.prices[symbol]?.price || INITIAL_PRICES[symbol];
    const candles = [];
    let currentPrice = basePrice;
    const now = Date.now();
    
    for (let i = count; i > 0; i--) {
      const volatility = VOLATILITY[symbol] || 0.5;
      const change = (Math.random() - 0.5) * (volatility / 10);
      const open = currentPrice;
      const close = currentPrice * (1 + change);
      const high = Math.max(open, close) * (1 + Math.random() * 0.005);
      const low = Math.min(open, close) * (1 - Math.random() * 0.005);
      
      candles.push({
        timestamp: now - (i * 3600000), // 1 hora cada
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000
      });
      
      currentPrice = close;
    }
    
    this.candles[symbol] = candles;
  }

  _startCandleSimulation() {
    // Atualiza candles a cada minuto (para Deep Pattern ter dados frescos)
    setInterval(() => {
      for (const [symbol, data] of Object.entries(this.prices)) {
        const lastCandle = this.candles[symbol]?.[this.candles[symbol].length - 1];
        const now = Date.now();
        const lastUpdate = this._lastCandleUpdate[symbol] || now;
        
        // Se passou 1 hora, cria nova candle
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
          
          // Emite evento para Deep Pattern
          eventBus.emit("market:candle", {
            symbol,
            candle: newCandle,
            interval: "1h"
          });
        }
      }
    }, 60000); // Verifica a cada minuto
  }

  // 🆕 PARA SENTIMENT: Obtém sentimento do mercado
  getMarketSentiment(symbol) {
    const score = this._sentimentScores[symbol] || 0;
    
    // Determina sentimento baseado no score (-1 a 1)
    let sentiment = "neutral";
    if (score > 0.3) sentiment = "bullish";
    if (score > 0.6) sentiment = "very_bullish";
    if (score < -0.3) sentiment = "bearish";
    if (score < -0.6) sentiment = "very_bearish";
    
    return {
      symbol,
      sentiment,
      score: score,
      confidence: Math.abs(score),
      sources: {
        news: score * (0.3 + Math.random() * 0.3),
        social: score * (0.2 + Math.random() * 0.3),
        technical: score * (0.4 + Math.random() * 0.2)
      },
      timestamp: Date.now()
    };
  }

  _startSentimentSimulation() {
    // Atualiza sentimento a cada 30 segundos
    setInterval(() => {
      for (const symbol of Object.keys(INITIAL_PRICES)) {
        const priceChange = this.prices[symbol]?.change24h || 0;
        
        // Sentimento baseado no movimento de preço
        let baseSentiment = 0;
        if (priceChange > 1) baseSentiment = 0.4;
        else if (priceChange > 0.5) baseSentiment = 0.2;
        else if (priceChange < -1) baseSentiment = -0.4;
        else if (priceChange < -0.5) baseSentiment = -0.2;
        
        // Adiciona ruído aleatório
        const noise = (Math.random() - 0.5) * 0.3;
        const newSentiment = Math.max(-1, Math.min(1, baseSentiment + noise));
        
        // Suaviza a mudança (não muda muito rápido)
        const oldSentiment = this._sentimentScores[symbol] || 0;
        this._sentimentScores[symbol] = oldSentiment * 0.7 + newSentiment * 0.3;
        
        // Emite evento para Sentiment Agent
        eventBus.emit("market:sentiment", {
          symbol,
          sentiment: this.getMarketSentiment(symbol),
          timestamp: Date.now()
        });
      }
    }, 30000);
  }

  // 🆕 PARA ARBITRAGE: Obtém oportunidade com múltiplas exchanges
  async getMultiExchangeArbitrage(symbol = "BTCUSDT") {
    try {
      const now = Date.now();
      const lastCheck = this._lastArbitrageCheck[symbol] || 0;
      
      // Arbitrage mais frequente agora (30 segundos)
      if (now - lastCheck < 30000) return null;
      this._lastArbitrageCheck[symbol] = now;
      
      const prices = this.getMultiExchangePrices(symbol);
      const exchanges = Object.keys(prices);
      
      // Encontra menor preço (compra) e maior preço (venda)
      let buyExchange = exchanges[0];
      let sellExchange = exchanges[0];
      let lowestPrice = prices[buyExchange];
      let highestPrice = prices[sellExchange];
      
      for (const ex of exchanges) {
        if (prices[ex] < lowestPrice) {
          lowestPrice = prices[ex];
          buyExchange = ex;
        }
        if (prices[ex] > highestPrice) {
          highestPrice = prices[ex];
          sellExchange = ex;
        }
      }
      
      const spreadPercent = ((highestPrice - lowestPrice) / lowestPrice) * 100;
      
      // Só retorna oportunidade se spread for significativo (> 0.15%)
      if (spreadPercent < 0.15) return null;
      
      // 70% de chance de ser oportunidade realista
      const isValid = Math.random() < 0.7;
      if (!isValid) return null;
      
      logger.info(`💰 Oportunidade de arbitragem multi-exchange em ${symbol}: spread ${spreadPercent.toFixed(3)}% (comprar ${buyExchange} @ $${lowestPrice.toFixed(2)} | vender ${sellExchange} @ $${highestPrice.toFixed(2)})`);
      
      return {
        symbol,
        buyExchange,
        sellExchange,
        buyPrice: lowestPrice,
        sellPrice: highestPrice,
        spreadPercent: parseFloat(spreadPercent.toFixed(4)),
        netSpread: parseFloat((spreadPercent - 0.05).toFixed(4)), // depois de taxas
        isProfitable: spreadPercent > 0.2,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Erro na análise de arbitragem multi-exchange: ${error.message}`);
      return null;
    }
  }

  // Mantém método antigo para compatibilidade
  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    return this.getMultiExchangeArbitrage(symbol);
  }

  _startRealisticSimulation() {
    setInterval(() => {
      const now = new Date();
      const hour = now.getUTCHours();
      
      let timeFactor = 0.5;
      if (hour >= 13 && hour <= 22) timeFactor = 1.5;
      else if (hour >= 8 && hour <= 17) timeFactor = 1.2;
      else if (hour >= 0 && hour <= 8) timeFactor = 0.8;
      
      const marketTrend = (Math.random() - 0.5) * 0.0003 * timeFactor;
      
      let avgChange = 0;
      let count = 0;
      
      for (const [symbol, data] of Object.entries(this.prices)) {
        const vol = VOLATILITY[symbol] || 0.5;
        const correlation = CORRELATION[symbol] || 0.5;
        
        const specificNoise = (Math.random() - 0.5) * 0.0004 * timeFactor * (1 - correlation);
        const deltaPercent = (marketTrend * correlation) + specificNoise;
        const dailyVol = vol / Math.sqrt(365);
        const finalDelta = deltaPercent * dailyVol * timeFactor;
        
        let newPrice = data.price * (1 + finalDelta);
        
        if (symbol === 'BTCUSDT') newPrice = Math.max(30000, Math.min(150000, newPrice));
        if (symbol === 'ETHUSDT') newPrice = Math.max(1500, Math.min(8000, newPrice));
        if (symbol === 'BNBUSDT') newPrice = Math.max(200, Math.min(1200, newPrice));
        if (symbol === 'SOLUSDT') newPrice = Math.max(20, Math.min(500, newPrice));
        if (symbol === 'XRPUSDT') newPrice = Math.max(0.3, Math.min(3, newPrice));
        
        const priceChange = ((newPrice - data.price) / data.price) * 100;
        avgChange += priceChange;
        count++;
        
        data.price = newPrice;
        data.bid = newPrice * 0.999;
        data.ask = newPrice * 1.001;
        
        if (newPrice > data.high24h) data.high24h = newPrice;
        if (newPrice < data.low24h) data.low24h = newPrice;
        
        const price24hAgo = data.price24hAgo || newPrice;
        data.change24h = ((newPrice - price24hAgo) / price24hAgo) * 100;
        data.volume24h = Math.floor(Math.random() * 50000000 * timeFactor) + 10000000;
        
        if (!data.lastReset || Date.now() - data.lastReset > 86400000) {
          data.price24hAgo = newPrice;
          data.lastReset = Date.now();
        }
        
        // 🆕 Atualiza preços multi-exchange
        const multiSpread = (Math.random() - 0.5) * 0.003;
        this.multiExchangePrices.binance[symbol] = newPrice * (1 + multiSpread);
        this.multiExchangePrices.bybit[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.003);
        this.multiExchangePrices.okx[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.003);
        this.multiExchangePrices.kucoin[symbol] = newPrice * (1 + (Math.random() - 0.5) * 0.003);
      }
      
      if (count > 0) {
        const avgMarketChange = avgChange / count;
        this._trendUpdateTime = Date.now();
        
        if (avgMarketChange > 0.05) {
          this._marketTrend = "bullish";
          this._trendStrength = Math.min(100, Math.abs(avgMarketChange) * 100);
        } else if (avgMarketChange < -0.05) {
          this._marketTrend = "bearish";
          this._trendStrength = Math.min(100, Math.abs(avgMarketChange) * 100);
        } else {
          this._marketTrend = "sideways";
          this._trendStrength = Math.abs(avgMarketChange) * 100;
        }
      }
      
      eventBus.emit("tick", this.prices);
      eventBus.emit("market:trend", {
        trend: this._marketTrend,
        strength: this._trendStrength,
        timestamp: Date.now()
      });
      
      // 🆕 Emite evento de preços multi-exchange para Arbitrage
      eventBus.emit("market:multiExchange", {
        prices: this.multiExchangePrices,
        timestamp: Date.now()
      });
      
    }, 2000);
  }

  async getPrice(symbol) {
    const ticker = this.prices[symbol];
    if (ticker && ticker.price) {
      return ticker.price;
    }
    return INITIAL_PRICES[symbol] || 100;
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
      
      if (side === "BUY") {
        if (currentBalance < cost) {
          throw new Error(`Insufficient balance for ${agentId}. Need $${cost.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
        }
      }
      
      const newBalance = currentBalance - cost;
      
      logger.info(`[PAPER] ${side} ${qty.toFixed(6)} ${symbol} @ $${execPrice.toFixed(2)} | Total: $${cost.toFixed(2)} | Agent: ${agentId} | Balance: $${currentBalance.toFixed(2)} → $${newBalance.toFixed(2)}`);
      
      const order = { 
        orderId: `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, 
        symbol, 
        side, 
        qty, 
        price: execPrice,
        total: cost,
        status: "FILLED", 
        timestamp: new Date().toISOString(),
        mode: "PAPER",
        agent: agentId,
        balanceBefore: currentBalance,
        balanceAfter: newBalance
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

  isConnected() { 
    return this.connected; 
  }

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
