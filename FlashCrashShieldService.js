const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class FlashCrashShieldService {
  constructor() {
    this.active = true;
    this.events = [];
    this._priceHistory = {};
    this._monitoring = false;
    logger.info("FlashCrashShieldService initialized", { service: "FlashCrashShield" });
  }

  start() {
    if (this._monitoring) return;
    this._monitoring = true;
    this._intervalId = setInterval(() => this._check(), 1000);
    logger.info("Flash Crash Shield monitoring started", { service: "FlashCrashShield" });
  }

  stop() {
    this._monitoring = false;
    if (this._intervalId) clearInterval(this._intervalId);
  }

  _check() {
    if (!this.active) return;
    const cfg = db.getConfig();
    const tickers = exchange.getAllTickers();
    const now = Date.now();

    for (const [sym, ticker] of Object.entries(tickers)) {
      if (!this._priceHistory[sym]) this._priceHistory[sym] = [];
      this._priceHistory[sym].push({ price: ticker.price, ts: now });
      this._priceHistory[sym] = this._priceHistory[sym].filter(p => now - p.ts < 60000);

      const oldest1s = this._priceHistory[sym].find(p => now - p.ts <= 1000);
      const oldest5s = this._priceHistory[sym].find(p => now - p.ts <= 5000);
      const oldest15s = this._priceHistory[sym].find(p => now - p.ts <= 15000);

      const check = (ref, thresholdPct, window) => {
        if (!ref) return;
        const drop = ((ref.price - ticker.price) / ref.price) * 100;
        if (drop >= thresholdPct) {
          const event = { id: `fc_${Date.now()}`, pair: sym, triggerType: `${window}s drop`, priceChange: -Math.round(drop * 10) / 10, action: "Paused positions", timestamp: new Date().toISOString() };
          this.events.unshift(event);
          risk.pauseSymbol(sym, cfg.flashCrashPauseDuration * 1000 || 300000);
          db.addAlert({ id: `al_fc_${Date.now()}`, severity: "critical", message: `Flash Crash Shield: ${sym} dropped ${drop.toFixed(2)}% in ${window}s. Positions paused.`, timestamp: new Date().toISOString(), read: false });
          eventBus.emit("alert", { severity: "critical", message: `Flash Crash Shield triggered: ${sym}` });
          logger.warn(`Flash crash on ${sym}: ${drop.toFixed(2)}% in ${window}s`, { service: "FlashCrashShield" });
        }
      };
      check(oldest1s, cfg.flashCrashThreshold1s || 2.0, "1");
      check(oldest5s, cfg.flashCrashThreshold5s || 3.0, "5");
      check(oldest15s, cfg.flashCrashThreshold15s || 5.0, "15");
    }
  }

  getStatus() {
    return { active: this.active, pausedSymbols: risk.getPausedSymbols(), events: this.events.slice(0, 10), config: { threshold1s: db.getConfig().flashCrashThreshold1s, threshold5s: db.getConfig().flashCrashThreshold5s, threshold15s: db.getConfig().flashCrashThreshold15s } };
  }

  setActive(active) { this.active = active; }
  updateConfig(patch) { db.updateConfig(patch); }
  getEvents() { return this.events; }
}

module.exports = new FlashCrashShieldService();
