const storage = require("./storage");
const logger = require("./LoggerService");

class DatabaseService {
  constructor() {
    this.trades = storage.get("trades", []);
    this.signals = storage.get("signals", []);
    this.alerts = storage.get("alerts", []);
    this.config = storage.get("config", this._defaultConfig());
    this.deployHistory = storage.get("deployHistory", this._defaultDeploys());
    this.memory = storage.get("memory", { patterns: [], strategies: [], tradeMemory: [] });
    this.savings = storage.get("savings", { savingsBalance: 0, workingCapital: 0, totalWithdrawn: 0, lastUpdated: null }); // 🆕 Savings/Cofre
    logger.info("DatabaseService initialized", { service: "DatabaseService" });
  }

  _defaultConfig() {
    return {
      mode: "PAPER", exchange: "BYBIT",
      riskPerTrade: 2.5, stopLoss: 1.5, takeProfit: 3.0,
      emaShort: 9, emaLong: 21, rsiPeriod: 14, rsiOB: 70, rsiOS: 30,
      aiOptimizer: true, patternRecognition: true, sentimentAnalysis: false,
      flashCrashThreshold1s: 2.0, flashCrashThreshold5s: 3.0, flashCrashThreshold15s: 5.0,
      flashCrashPauseDuration: 300,
      bybitApiKey: "", bybitApiSecret: "", binanceApiKey: "", binanceApiSecret: "",
    };
  }

  _defaultDeploys() {
    return [
      { id: "d1", version: "v4.2.1", status: "Success", date: new Date().toISOString(), deployedBy: "AIZtronOptimizer", notes: "Win rate optimization +3.7%" },
      { id: "d2", version: "v4.2.0", status: "Success", date: new Date(Date.now() - 4 * 86400000).toISOString(), deployedBy: "admin", notes: "Flash Crash Shield v2" },
      { id: "d3", version: "v4.1.9", status: "Rollback", date: new Date(Date.now() - 7 * 86400000).toISOString(), deployedBy: "AIZtronOptimizer", notes: "Rolled back: drawdown exceeded 5%" },
    ];
  }

  saveTrades() { storage.set("trades", this.trades); }
  saveSignals() { storage.set("signals", this.signals); }
  saveAlerts() { storage.set("alerts", this.alerts); }
  saveConfig() { storage.set("config", this.config); }
  saveDeployHistory() { storage.set("deployHistory", this.deployHistory); }
  saveMemory() { storage.set("memory", this.memory); }
  saveSavings() { storage.set("savings", this.savings); } // 🆕 Salva dados do cofre
  
  getMemory() { return this.memory; }
  getSavings() { return this.savings; } // 🆕 Recupera dados do cofre
  
  updateMemory(data) {
    this.memory = { ...this.memory, ...data };
    this.saveMemory();
    return this.memory;
  }
  
  // 🆕 Atualiza dados do cofre
  updateSavings(data) {
    this.savings = { ...this.savings, ...data, lastUpdated: new Date().toISOString() };
    this.saveSavings();
    return this.savings;
  }

  addTrade(trade) { this.trades.unshift(trade); if (this.trades.length > 500) this.trades.length = 500; this.saveTrades(); }
  addSignal(signal) { this.signals.unshift(signal); if (this.signals.length > 200) this.signals.length = 200; this.saveSignals(); }
  addAlert(alert) { this.alerts.unshift(alert); if (this.alerts.length > 100) this.alerts.length = 100; this.saveAlerts(); }

  getTrades(filter = {}) {
    let result = [...this.trades];
    if (filter.status) result = result.filter(t => t.status === filter.status);
    if (filter.side) result = result.filter(t => t.side === filter.side);
    if (filter.symbol) result = result.filter(t => t.symbol === filter.symbol);
    return result.slice(0, filter.limit || 100);
  }

  updateConfig(patch) { Object.assign(this.config, patch); this.saveConfig(); return this.config; }
  getConfig() { return this.config; }
  getDeployHistory() { return this.deployHistory; }

  addDeploy(deploy) {
    this.deployHistory.unshift(deploy);
    storage.set("deployHistory", this.deployHistory);
  }

  stats() {
    const closed = this.trades.filter(t => t.status === "CLOSED");
    const wins = closed.filter(t => t.pnl > 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const totalPnl = closed.reduce((a, t) => a + (t.pnl || 0), 0);
    return { totalTrades: this.trades.length, winRate: Math.round(winRate * 10) / 10, totalPnl: Math.round(totalPnl * 100) / 100 };
  }
}

module.exports = new DatabaseService();
