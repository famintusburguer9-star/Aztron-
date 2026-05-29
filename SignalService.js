const rsiStrategy = require("./RsiStrategy");
const macdStrategy = require("./MacdStrategy");
const breakoutStrategy = require("./BreakoutStrategy");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

class SignalService {
  constructor() {
    this.activeSignals = [];
    this.running = false;
    this._intervalId = null;
    logger.info("SignalService initialized", { service: "SignalService" });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._intervalId = setInterval(() => this._scan(), 15000);
    logger.info("SignalService started", { service: "SignalService" });
  }

  stop() {
    this.running = false;
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    logger.info("SignalService stopped", { service: "SignalService" });
  }

  _scan() {
    const strategies = [rsiStrategy, macdStrategy, breakoutStrategy];
    for (const sym of SYMBOLS) {
      for (const strategy of strategies) {
        try {
          const result = strategy.analyze(sym);
          if (result && result.confidence > 60) {
            const signal = {
              id: `sig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              symbol: result.symbol, type: result.signal, price: Math.round(result.price * 100) / 100,
              confidence: result.confidence, strategy: result.strategy, reason: result.reason,
              timestamp: new Date().toISOString(), status: "ACTIVE",
            };
            this.activeSignals.unshift(signal);
            if (this.activeSignals.length > 50) this.activeSignals.length = 50;
            db.addSignal(signal);
            eventBus.emit("signal", signal);
            logger.info(`Signal: ${signal.type} ${signal.symbol} (${signal.confidence}% conf)`, { service: "SignalService" });
          }
        } catch (err) {
          logger.error(`Signal scan error: ${err.message}`, { service: "SignalService" });
        }
      }
    }
    this.activeSignals = this.activeSignals.filter(s => Date.now() - new Date(s.timestamp).getTime() < 2 * 60 * 60 * 1000);
  }

  getSignals(limit = 20) { return this.activeSignals.slice(0, limit); }
  getLatest() { return this.activeSignals[0] || null; }
}

module.exports = new SignalService();
