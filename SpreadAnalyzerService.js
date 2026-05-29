const exchange = require("./ExchangeAdapterService");

class SpreadAnalyzerService {
  analyze(symbol) {
    const ticker = exchange.getTicker(symbol);
    if (!ticker) return null;
    const spread = ticker.spread;
    const isNormal = spread < 0.1;
    const isWide = spread >= 0.1 && spread < 0.3;
    const isAbnormal = spread >= 0.3;
    return {
      symbol, spread, bid: ticker.bid, ask: ticker.ask, price: ticker.price,
      status: isNormal ? "NORMAL" : isWide ? "WIDE" : "ABNORMAL",
      tradeable: !isAbnormal,
    };
  }

  analyzeAll() {
    return ["BTCUSDT", "ETHUSDT", "BNBUSDT"].map(sym => this.analyze(sym)).filter(Boolean);
  }
}

module.exports = new SpreadAnalyzerService();
