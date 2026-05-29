const exchange = require("./ExchangeAdapterService");

class SlippageEstimatorService {
  estimate(symbol, side, qty) {
    const ticker = exchange.getTicker(symbol);
    if (!ticker) return { estimated: 0, acceptable: true };
    const spread = ticker.spread || 0.05;
    const price = ticker.price;
    const notional = qty * price;
    let impactBps = 0;
    if (notional > 100000) impactBps = 2;
    else if (notional > 50000) impactBps = 1;
    else impactBps = 0.5;
    const totalBps = spread * 100 + impactBps;
    const slippagePct = totalBps / 100;
    return { estimated: Math.round(slippagePct * 10000) / 10000, acceptable: slippagePct < 0.3, spread, notional };
  }

  getSymbolSlippage(symbol) {
    const ticker = exchange.getTicker(symbol);
    return ticker ? { symbol, spread: ticker.spread, estimatedSlippage: ticker.spread * 0.5 } : null;
  }
}

module.exports = new SlippageEstimatorService();
