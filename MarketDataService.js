const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class MarketDataService {
  constructor() {
    this.candles = {};
    this.indicators = {};
    this.indicatorHistory = {};
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "market_data";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      rsiPeriod: 14,
      emaShortPeriod: 9,
      emaLongPeriod: 21,
      bbPeriod: 20,
      bbStdDev: 2,
      atrPeriod: 14,
      updateInterval: 2000
    };
    
    this._initIndicators();
    eventBus.on("tick", (prices) => this._updateIndicators(prices));
    logger.info("MarketDataService initialized", { service: "MarketData" });
  }

  _initIndicators() {
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      this.indicators[sym] = {
        rsi: 50,
        ema9: 0, ema21: 0, 
        macd: 0, macdSignal: 0, macdHist: 0,
        atr: 0, 
        bb_upper: 0, bb_lower: 0, bb_mid: 0,
        emaSignal: "NEUTRAL",
        change24h: 0,
        priceHistory: [],
        volumeHistory: [],
        lastPrice: 0
      };
      
      this.indicatorHistory[sym] = [];
    }
  }

  // 🆕 CALCULA RSI REAL
  _calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.min(95, Math.max(5, Math.round(rsi)));
  }

  // 🆕 CALCULA EMA
  _calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  // 🆕 CALCULA MACD
  _calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod) return { macd: 0, signal: 0, hist: 0 };
    
    const emaFast = this._calculateEMA(prices, fastPeriod);
    const emaSlow = this._calculateEMA(prices, slowPeriod);
    const macd = emaFast - emaSlow;
    
    // Para o sinal, precisamos de um array de MACDs
    const macdLine = macd;
    const signal = macdLine * 0.85; // Simplificado
    const hist = macdLine - signal;
    
    return { macd: macdLine, signal, hist };
  }

  // 🆕 CALCULA BOLLINGER BANDS
  _calculateBB(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      const price = prices[prices.length - 1] || 0;
      return { upper: price * 1.02, middle: price, lower: price * 0.98 };
    }
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    const upper = sma + (stdDev * std);
    const lower = sma - (stdDev * std);
    
    return { upper, middle: sma, lower };
  }

  // 🆕 CALCULA ATR
  _calculateATR(prices, period = 14) {
    if (prices.length < period + 1) return 0;
    
    const high = Math.max(...prices.slice(-period));
    const low = Math.min(...prices.slice(-period));
    const close = prices[prices.length - 1];
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - close);
    const tr3 = Math.abs(low - close);
    const tr = Math.max(tr1, tr2, tr3);
    
    return tr;
  }

  _updateIndicators(prices) {
    for (const [sym, ticker] of Object.entries(prices)) {
      const ind = this.indicators[sym];
      if (!ind) continue;
      
      const price = ticker.price;
      const timestamp = Date.now();
      
      // Atualiza histórico de preços
      if (!ind.priceHistory) ind.priceHistory = [];
      ind.priceHistory.push({ price, timestamp });
      ind.priceHistory = ind.priceHistory.filter(p => timestamp - p.timestamp < 86400000);
      
      const priceArray = ind.priceHistory.map(p => p.price);
      
      // 🔥 CALCULA INDICADORES REAIS
      ind.rsi = this._calculateRSI(priceArray, this.config.rsiPeriod);
      ind.ema9 = this._calculateEMA(priceArray, this.config.emaShortPeriod);
      ind.ema21 = this._calculateEMA(priceArray, this.config.emaLongPeriod);
      
      const macd = this._calculateMACD(priceArray);
      ind.macd = macd.macd;
      ind.macdSignal = macd.signal;
      ind.macdHist = macd.hist;
      
      const bb = this._calculateBB(priceArray, this.config.bbPeriod, this.config.bbStdDev);
      ind.bb_upper = bb.upper;
      ind.bb_lower = bb.lower;
      ind.bb_mid = bb.middle;
      
      ind.atr = this._calculateATR(priceArray, this.config.atrPeriod);
      
      // Sinal EMA
      if (ind.ema9 > ind.ema21 && ind.ema9 > 0 && ind.ema21 > 0) {
        ind.emaSignal = "BUY";
      } else if (ind.ema9 < ind.ema21 && ind.ema9 > 0 && ind.ema21 > 0) {
        ind.emaSignal = "SELL";
      } else {
        ind.emaSignal = "NEUTRAL";
      }
      
      // Variação 24h
      if (ind.priceHistory.length > 0) {
        const price24hAgo = ind.priceHistory[0]?.price || price;
        ind.change24h = ((price - price24hAgo) / price24hAgo) * 100;
      }
      
      ind.lastPrice = price;
      ind.lastUpdate = timestamp;
      
      // 🆕 SALVA HISTÓRICO
      this.indicatorHistory[sym].unshift({
        timestamp,
        price,
        rsi: ind.rsi,
        emaSignal: ind.emaSignal,
        macdHist: ind.macdHist
      });
      
      if (this.indicatorHistory[sym].length > 500) {
        this.indicatorHistory[sym] = this.indicatorHistory[sym].slice(0, 500);
      }
    }
    
    // 🆕 COMPARTILHA INDICADORES PRINCIPAIS COM LEARNING BRAIN
    this._shareKeyIndicators();
  }

  // 🆕 COMPARTILHA INDICADORES COM LEARNING BRAIN
  _shareKeyIndicators() {
    for (const [sym, ind] of Object.entries(this.indicators)) {
      if (ind.lastUpdate && Date.now() - ind.lastUpdate < 10000) {
        eventBus.emit(`learning:${this.agentId}`, {
          type: "indicators_update",
          content: `${sym}: RSI=${ind.rsi}, Signal=${ind.emaSignal}, MACD=${ind.macdHist?.toFixed(4)}`,
          confidence: 0.7,
          priority: "normal",
          data: {
            symbol: sym,
            rsi: ind.rsi,
            emaSignal: ind.emaSignal,
            macdHist: ind.macdHist,
            price: ind.lastPrice
          }
        });
        break; // Emite apenas um por ciclo para não spam
      }
    }
  }

  getIndicators(symbol) {
    return { 
      ...exchange.getTicker(symbol), 
      ...(this.indicators[symbol] || {}), 
      symbol,
      price: this.indicators[symbol]?.lastPrice || exchange.getTicker(symbol)?.price || 0
    };
  }

  getAllIndicators() {
    return Object.keys(this.indicators).reduce((acc, sym) => {
      acc[sym] = this.getIndicators(sym);
      return acc;
    }, {});
  }

  getRsi(symbol) { 
    return this.indicators[symbol]?.rsi || 50; 
  }
  
  getMacd(symbol) { 
    return { 
      macd: this.indicators[symbol]?.macd || 0, 
      signal: this.indicators[symbol]?.macdSignal || 0, 
      hist: this.indicators[symbol]?.macdHist || 0 
    }; 
  }
  
  getEmaSignal(symbol) { 
    return this.indicators[symbol]?.emaSignal || "NEUTRAL"; 
  }
  
  // 🆕 OBTÉM HISTÓRICO DE INDICADORES
  getIndicatorHistory(symbol, limit = 50) {
    return this.indicatorHistory[symbol]?.slice(0, limit) || [];
  }
  
  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      running: this.isRunning,
      config: this.config,
      symbolsTracked: Object.keys(this.indicators).length,
      historySizes: Object.keys(this.indicatorHistory).reduce((acc, sym) => {
        acc[sym] = this.indicatorHistory[sym]?.length || 0;
        return acc;
      }, {})
    };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("MarketDataService config updated", { service: "MarketData", config: this.config });
    return { success: true, config: this.config };
  }
  
  start() {
    this.isRunning = true;
    logger.info("MarketDataService started", { service: "MarketData" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    logger.info("MarketDataService stopped", { service: "MarketData" });
    return { success: true };
  }
}

module.exports = new MarketDataService();
