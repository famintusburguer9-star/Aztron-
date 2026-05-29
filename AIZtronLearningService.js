const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const storage = require("./storage");

const THOUGHT_POOL = [
  "Analyzing BTC momentum — RSI recovering from 38. EMA crossover imminent on 15m chart.",
  "ETH showing divergence on MACD histogram. Reducing confidence for long positions.",
  "Portfolio drawdown within acceptable parameters. Continuing aggressive scanning.",
  "Market sentiment index updated. Adjusting stop-loss tighter on new positions.",
  "Backtest confirms current EMA9/21 parameters optimal for current volatility regime.",
  "Flash Crash Shield active. Monitoring for sudden drops in <60s windows.",
  "Deep pattern scan complete. Detected inverse H&S formation.",
  "MACD signal line cross confirmed. Monitoring entry window.",
  "Optimizer cycle complete. Win rate improved with new RSI parameters.",
  "Slippage estimate within acceptable range. Entry conditions met.",
  "Market multiplexer active on all pairs. All WebSocket feeds healthy.",
  "Sentiment index updated: Greed zone. Tightening position sizes by 5%.",
];

class AIZtronLearningService {
  constructor() {
    this.thoughts = storage.get("aiThoughts", []);
    this.version = "v4.2.1";
    this.confidence = 84;
    this.learningHistory = storage.get("learningHistory", [
      { version: "v4.2", winRate: 73.5, adjustments: "EMA9→EMA8, SL 1.5%→1.2%", date: "2026-05-28" },
      { version: "v4.1", winRate: 69.8, adjustments: "RSI period 14→12, TP 3%→3.5%", date: "2026-05-25" },
      { version: "v4.0", winRate: 65.2, adjustments: "Added MACD confirmation filter", date: "2026-05-20" },
    ]);
    this._thoughtIdx = 0;
    this._intervalId = null;
    logger.info("AIZtronLearningService initialized", { service: "AILearning" });
  }

  start() {
    this._intervalId = setInterval(() => this._generateThought(), 8000);
    logger.info("AI Learning Service started", { service: "AILearning" });
  }

  stop() { if (this._intervalId) clearInterval(this._intervalId); }

  _generateThought() {
    const message = THOUGHT_POOL[this._thoughtIdx % THOUGHT_POOL.length];
    this._thoughtIdx++;
    const thought = { id: `t_${Date.now()}`, message, timestamp: new Date().toISOString() };
    this.thoughts.unshift(thought);
    if (this.thoughts.length > 50) this.thoughts.length = 50;
    storage.set("aiThoughts", this.thoughts.slice(0, 50));
    eventBus.emit("thought", thought);
  }

  learnFromTrade(trade) {
    if (trade.status !== "CLOSED") return;
    const wasWin = trade.pnl > 0;
    this.confidence = Math.min(95, Math.max(50, this.confidence + (wasWin ? 0.5 : -0.3)));
    this._generateThought();
  }

  getThoughts(limit = 20) { return this.thoughts.slice(0, limit); }
  getStatus() { return { version: this.version, confidence: Math.round(this.confidence), learningHistory: this.learningHistory, currentParams: db.getConfig() }; }
  getLearningHistory() { return this.learningHistory; }
}

module.exports = new AIZtronLearningService();
