const db = require("./DatabaseService");
const exchange = require("./ExchangeAdapterService");
const logger = require("./LoggerService");

class RiskManagementService {
  constructor() {
    this.paused = false;
    this.pausedSymbols = new Set();
    logger.info("RiskManagementService initialized", { service: "RiskManagement" });
  }

  validateTrade(symbol, side, notionalValue) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const totalEquity = bal.USDT + Object.entries(bal).filter(([k]) => k !== "USDT").reduce((a, [k, v]) => {
      const ticker = exchange.getTicker(`${k}USDT`);
      return a + (ticker ? v * ticker.price : 0);
    }, 0);

    const riskAmount = totalEquity * (cfg.riskPerTrade / 100);
    const errors = [];

    if (this.paused) errors.push("Engine is paused");
    if (this.pausedSymbols.has(symbol)) errors.push(`${symbol} is paused (Flash Crash Shield)`);
    if (notionalValue > riskAmount * 5) errors.push(`Position size too large. Max: $${(riskAmount * 5).toFixed(2)}`);
    if (bal.USDT < notionalValue * 0.1) errors.push("Insufficient USDT balance");

    return { approved: errors.length === 0, errors, maxPositionSize: riskAmount, totalEquity };
  }

  calculatePositionSize(symbol, price, stopLossPercent) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const totalEquity = bal.USDT + 41500;
    const riskDollar = totalEquity * (cfg.riskPerTrade / 100);
    const stopLossDollar = price * (stopLossPercent / 100);
    const qty = riskDollar / stopLossDollar;
    return { qty: Math.round(qty * 10000) / 10000, riskDollar, stopPrice: price * (1 - stopLossPercent / 100) };
  }

  pauseSymbol(symbol, durationMs = 300000) {
    this.pausedSymbols.add(symbol);
    logger.warn(`${symbol} paused for ${durationMs / 1000}s`, { service: "RiskManagement" });
    setTimeout(() => { this.pausedSymbols.delete(symbol); logger.info(`${symbol} resumed`, { service: "RiskManagement" }); }, durationMs);
  }

  pauseAll() { this.paused = true; logger.warn("All trading paused", { service: "RiskManagement" }); }
  resumeAll() { this.paused = false; logger.info("All trading resumed", { service: "RiskManagement" }); }
  isPaused(symbol) { return this.paused || this.pausedSymbols.has(symbol); }
  getPausedSymbols() { return [...this.pausedSymbols]; }
  getStats() {
    const cfg = db.getConfig();
    return { paused: this.paused, pausedSymbols: this.getPausedSymbols(), riskPerTrade: cfg.riskPerTrade, stopLoss: cfg.stopLoss, takeProfit: cfg.takeProfit };
  }
}

module.exports = new RiskManagementService();
