const marketData = require("./MarketDataService");
const logger = require("./LoggerService");

class MarketConditionService {
  constructor() {
    this.conditions = {};
    this._analyze();
    setInterval(() => this._analyze(), 30000);
    logger.info("MarketConditionService initialized", { service: "MarketCondition" });
  }

  _analyze() {
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      const ind = marketData.getIndicators(sym);
      const rsi = ind.rsi || 50;
      const macdHist = ind.macdHist || 0;
      const spread = ind.spread || 0.1;

      let trend = "SIDEWAYS";
      if (ind.emaSignal === "BUY" && rsi < 65 && macdHist > 0) trend = "BULLISH";
      else if (ind.emaSignal === "SELL" && rsi > 35 && macdHist < 0) trend = "BEARISH";

      const volatility = Math.random() > 0.7 ? "HIGH" : "NORMAL";
      const spreadOk = spread < 0.2;
      const tradeable = spreadOk && volatility !== "HIGH";

      this.conditions[sym] = { symbol: sym, trend, volatility, spreadOk, tradeable, rsi, emaSignal: ind.emaSignal, updatedAt: new Date().toISOString() };
    }
  }

  getCondition(symbol) { return this.conditions[symbol] || null; }
  getAllConditions() { return this.conditions; }
  isTradeable(symbol) { return this.conditions[symbol]?.tradeable ?? false; }
  getMarketSentiment() {
    const all = Object.values(this.conditions);
    const bullish = all.filter(c => c.trend === "BULLISH").length;
    const bearish = all.filter(c => c.trend === "BEARISH").length;
    if (bullish > bearish) return { sentiment: "BULLISH", score: 60 + bullish * 10 };
    if (bearish > bullish) return { sentiment: "BEARISH", score: 40 - bearish * 10 };
    return { sentiment: "NEUTRAL", score: 50 };
  }
}

module.exports = new MarketConditionService();
