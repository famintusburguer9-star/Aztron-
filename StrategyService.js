const rsiStrategy = require("./RsiStrategy");
const macdStrategy = require("./MacdStrategy");
const breakoutStrategy = require("./BreakoutStrategy");
const db = require("./DatabaseService");
const logger = require("./LoggerService");

class StrategyService {
  constructor() {
    this.strategies = { rsi: rsiStrategy, macd: macdStrategy, breakout: breakoutStrategy };
    this.activeStrategies = ["rsi", "macd", "breakout"];
    logger.info("StrategyService initialized", { service: "Strategy" });
  }

  analyzeAll(symbol) {
    return this.activeStrategies
      .map(name => { try { return this.strategies[name]?.analyze(symbol); } catch { return null; } })
      .filter(Boolean);
  }

  getActiveStrategies() { return this.activeStrategies; }
  setActiveStrategies(strategies) { this.activeStrategies = strategies; db.updateConfig({ activeStrategies: strategies }); }
  getConfig() { return db.getConfig(); }
}

module.exports = new StrategyService();
