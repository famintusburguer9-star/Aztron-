const marketData = require("./MarketDataService");

class BreakoutStrategy {
  constructor() { this.name = "Breakout"; this._levels = {}; }

  analyze(symbol) {
    const ind = marketData.getIndicators(symbol);
    const price = ind.price || 0;
    const bb_upper = ind.bb_upper || price * 1.02;
    const bb_lower = ind.bb_lower || price * 0.98;
    const bb_mid = ind.bb_mid || price;

    if (!this._levels[symbol]) this._levels[symbol] = { upper: bb_upper, lower: bb_lower };
    const prev = this._levels[symbol];
    this._levels[symbol] = { upper: bb_upper, lower: bb_lower };

    if (price > prev.upper && prev.upper > 0) {
      const conf = Math.min(88, 65 + ((price - prev.upper) / prev.upper) * 1000);
      return { signal: "BUY", symbol, strategy: this.name, price, confidence: Math.round(conf), reason: `Breakout above Bollinger upper band ($${prev.upper.toFixed(2)}). Strong momentum detected.` };
    }
    if (price < prev.lower && prev.lower > 0) {
      const conf = Math.min(88, 65 + ((prev.lower - price) / prev.lower) * 1000);
      return { signal: "SELL", symbol, strategy: this.name, price, confidence: Math.round(conf), reason: `Breakdown below Bollinger lower band ($${prev.lower.toFixed(2)}). Downward momentum detected.` };
    }
    return null;
  }
}

module.exports = new BreakoutStrategy();
