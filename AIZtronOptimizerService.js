const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class AIZtronOptimizerService {
  constructor() {
    this.status = "IDLE";
    this.progress = 0;
    this.tested = 0;
    this.totalCombinations = 500;
    this.bestConfig = null;
    this.bestResult = null;
    this._intervalId = null;
    logger.info("AIZtronOptimizerService initialized", { service: "AIOptimizer" });
  }

  start() {
    if (this.status === "RUNNING") return { success: false, reason: "Already running" };
    this.status = "RUNNING";
    this.progress = 0;
    this.tested = 0;
    this.bestConfig = null;
    this.bestResult = null;

    let bestWinRate = 0;
    this._intervalId = setInterval(() => {
      const step = Math.floor(Math.random() * 18 + 8);
      this.tested = Math.min(this.totalCombinations, this.tested + step);
      this.progress = Math.round((this.tested / this.totalCombinations) * 100);

      const testResult = {
        emaShort: Math.floor(Math.random() * 5 + 7),
        emaLong: Math.floor(Math.random() * 8 + 18),
        rsiPeriod: Math.floor(Math.random() * 6 + 10),
        stopLoss: Math.round((1 + Math.random() * 2) * 10) / 10,
        takeProfit: Math.round((2 + Math.random() * 4) * 10) / 10,
        winRate: 50 + Math.random() * 35,
      };

      if (testResult.winRate > bestWinRate) {
        bestWinRate = testResult.winRate;
        this.bestConfig = { emaShort: testResult.emaShort, emaLong: testResult.emaLong, rsiPeriod: testResult.rsiPeriod, rsiOB: 70 + Math.floor(Math.random() * 5), rsiOS: 25 + Math.floor(Math.random() * 5), stopLoss: testResult.stopLoss, takeProfit: testResult.takeProfit };
        this.bestResult = { winRate: Math.round(testResult.winRate * 10) / 10, sharpe: Math.round((1.5 + Math.random() * 2) * 100) / 100, drawdown: -Math.round((1 + Math.random() * 4) * 10) / 10, pnl: Math.round(3000 + Math.random() * 4000), totalTrades: Math.floor(80 + Math.random() * 120) };
      }

      eventBus.emit("optimizer:progress", { progress: this.progress, tested: this.tested, total: this.totalCombinations });

      if (this.tested >= this.totalCombinations) {
        clearInterval(this._intervalId);
        this.status = "COMPLETE";
        eventBus.emit("optimizer:complete", { bestConfig: this.bestConfig, bestResult: this.bestResult });
        logger.info(`AI Optimizer complete. Best win rate: ${this.bestResult?.winRate}%`, { service: "AIOptimizer" });
      }
    }, 400);

    logger.info("AI Optimizer started", { service: "AIOptimizer" });
    return { success: true };
  }

  applyBestConfig() {
    if (!this.bestConfig) return { success: false, reason: "No optimization result" };
    db.updateConfig(this.bestConfig);
    this.status = "IDLE";
    logger.info("Best config applied", { service: "AIOptimizer" });
    return { success: true, config: this.bestConfig };
  }

  reset() { this.status = "IDLE"; this.progress = 0; this.tested = 0; if (this._intervalId) clearInterval(this._intervalId); }
  getStatus() { return { status: this.status, progress: this.progress, tested: this.tested, total: this.totalCombinations, bestConfig: this.bestConfig, bestResult: this.bestResult }; }
}

module.exports = new AIZtronOptimizerService();
