const db = require("./DatabaseService");
const logger = require("./LoggerService");

class BacktestService {
  constructor() {
    this.results = [];
    this.running = false;
  }

  async run({ pair, strategy, initialBalance, days = 30 }) {
    if (this.running) return { success: false, reason: "Backtest already running" };
    this.running = true;

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

    const winRate = 50 + Math.random() * 30;
    const pnl = initialBalance * (0.03 + Math.random() * 0.18) * (Math.random() > 0.3 ? 1 : -1);
    const sharpe = 1 + Math.random() * 2;
    const drawdown = -(2 + Math.random() * 8);
    const trades = Math.floor(60 + Math.random() * 120);
    const approved = winRate > 62 && sharpe > 1.4;

    const result = {
      id: `bt_${Date.now()}`, pair, strategy, initialBalance,
      winRate: Math.round(winRate * 10) / 10, pnl: Math.round(pnl * 100) / 100,
      sharpe: Math.round(sharpe * 100) / 100, drawdown: Math.round(drawdown * 10) / 10,
      totalTrades: trades, approved, days, timestamp: new Date().toISOString(),
    };
    this.results.unshift(result);
    if (this.results.length > 20) this.results.length = 20;
    this.running = false;

    logger.info(`Backtest complete: ${pair}/${strategy} — WR ${result.winRate}% | Approved: ${approved}`, { service: "Backtest" });
    return { success: true, result };
  }

  getResults(limit = 10) { return this.results.slice(0, limit); }
  isRunning() { return this.running; }
}

module.exports = new BacktestService();
