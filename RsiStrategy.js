const marketData = require("./MarketDataService");
const db = require("./DatabaseService");

class RsiStrategy {
  constructor() { this.name = "RSI Strategy"; }

  analyze(symbol) {
    const cfg = db.getConfig();
    const ind = marketData.getIndicators(symbol);
    const rsi = ind.rsi || 50;
    const ob = cfg.rsiOB || 70;
    const os = cfg.rsiOS || 30;
    const price = ind.price || 0;

    if (rsi < os) {
      return { signal: "BUY", symbol, strategy: this.name, price, rsi, confidence: Math.round(70 + (os - rsi) * 1.5), reason: `RSI=${rsi.toFixed(1)} oversold (threshold: ${os}). Mean reversion expected.` };
    }
    if (rsi > ob) {
      return { signal: "SELL", symbol, strategy: this.name, price, rsi, confidence: Math.round(70 + (rsi - ob) * 1.5), reason: `RSI=${rsi.toFixed(1)} overbought (threshold: ${ob}). Pullback expected.` };
    }
    return null;
  }
}

module.exports = new RsiStrategy();
