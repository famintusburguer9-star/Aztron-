const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class MarketDataService {
  constructor() {
    this.candles = {};
    this.indicators = {};
    this._initIndicators();
    eventBus.on("tick", (prices) => this._updateIndicators(prices));
    logger.info("MarketDataService initialized", { service: "MarketData" });
  }

  _initIndicators() {
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      this.indicators[sym] = {
        rsi: 50 + (Math.random() - 0.5) * 30,
        ema9: 0, ema21: 0, macd: 0, macdSignal: 0, macdHist: 0,
        atr: 0, bb_upper: 0, bb_lower: 0, bb_mid: 0,
        emaSignal: "NEUTRAL",
        change24h: (Math.random() - 0.45) * 5,
      };
    }
  }

  _updateIndicators(prices) {
    for (const [sym, ticker] of Object.entries(prices)) {
      const ind = this.indicators[sym];
      if (!ind) continue;
      const price = ticker.price;
      ind.rsi = Math.min(80, Math.max(20, ind.rsi + (Math.random() - 0.5) * 2));
      ind.ema9 = price * 0.9985 + (ind.ema9 || price) * 0.0015;
      ind.ema21 = price * 0.9993 + (ind.ema21 || price) * 0.0007;
      ind.macd = ind.ema9 - ind.ema21;
      ind.macdSignal = ind.macd * 0.85;
      ind.macdHist = ind.macd - ind.macdSignal;
      ind.atr = price * 0.012;
      ind.bb_mid = price;
      ind.bb_upper = price * 1.02;
      ind.bb_lower = price * 0.98;
      ind.emaSignal = ind.ema9 > ind.ema21 ? "BUY" : ind.ema9 < ind.ema21 ? "SELL" : "NEUTRAL";
    }
  }

  getIndicators(symbol) {
    return { ...exchange.getTicker(symbol), ...(this.indicators[symbol] || {}), symbol };
  }

  getAllIndicators() {
    return Object.keys(this.indicators).reduce((acc, sym) => {
      acc[sym] = this.getIndicators(sym);
      return acc;
    }, {});
  }

  getRsi(symbol) { return this.indicators[symbol]?.rsi || 50; }
  getMacd(symbol) { return { macd: this.indicators[symbol]?.macd || 0, signal: this.indicators[symbol]?.macdSignal || 0, hist: this.indicators[symbol]?.macdHist || 0 }; }
  getEmaSignal(symbol) { return this.indicators[symbol]?.emaSignal || "NEUTRAL"; }
}

module.exports = new MarketDataService();
