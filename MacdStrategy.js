const marketData = require("./MarketDataService");

class MacdStrategy {
  constructor() { this.name = "MACD"; this._lastHist = {}; }

  analyze(symbol) {
    const ind = marketData.getIndicators(symbol);
    const price = ind.price || 0;
    const hist = ind.macdHist || 0;
    const prevHist = this._lastHist[symbol] || 0;
    this._lastHist[symbol] = hist;

    const crossedUp = prevHist < 0 && hist >= 0;
    const crossedDown = prevHist > 0 && hist <= 0;
    const strength = Math.abs(hist);

    if (crossedUp && strength > 0.001) {
      const conf = Math.min(92, 60 + strength * 10000);
      return { signal: "BUY", symbol, strategy: this.name, price, confidence: Math.round(conf), reason: `MACD histogram bullish crossover. Hist: ${hist.toFixed(4)} (prev: ${prevHist.toFixed(4)}).` };
    }
    if (crossedDown && strength > 0.001) {
      const conf = Math.min(92, 60 + strength * 10000);
      return { signal: "SELL", symbol, strategy: this.name, price, confidence: Math.round(conf), reason: `MACD histogram bearish crossover. Hist: ${hist.toFixed(4)} (prev: ${prevHist.toFixed(4)}).` };
    }
    return null;
  }
}

module.exports = new MacdStrategy();
