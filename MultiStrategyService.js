const strategyService = require("./StrategyService");
const logger = require("./LoggerService");

class MultiStrategyService {
  analyzeConsensus(symbol) {
    const results = strategyService.analyzeAll(symbol);
    if (!results.length) return null;
    const buys = results.filter(r => r.signal === "BUY");
    const sells = results.filter(r => r.signal === "SELL");
    if (buys.length > sells.length) {
      const avgConf = Math.round(buys.reduce((a, r) => a + r.confidence, 0) / buys.length);
      return { signal: "BUY", symbol, confidence: avgConf, strategies: buys.map(r => r.strategy), reason: buys.map(r => r.reason).join(" | ") };
    }
    if (sells.length > buys.length) {
      const avgConf = Math.round(sells.reduce((a, r) => a + r.confidence, 0) / sells.length);
      return { signal: "SELL", symbol, confidence: avgConf, strategies: sells.map(r => r.strategy), reason: sells.map(r => r.reason).join(" | ") };
    }
    return null;
  }

  analyzeAll(symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
    return symbols.map(sym => this.analyzeConsensus(sym)).filter(Boolean);
  }
}

module.exports = new MultiStrategyService();
