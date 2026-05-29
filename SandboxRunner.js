const logger = require("./LoggerService");

class SandboxRunner {
  constructor() { this.results = []; this.running = false; }

  async run({ pair, strategy, duration, testType }) {
    if (this.running) return { success: false, reason: "Sandbox already running" };
    this.running = true;

    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

    const score = 40 + Math.floor(Math.random() * 60);
    const pnl = (Math.random() - 0.35) * 900;
    const winRate = 40 + Math.random() * 45;
    const approved = score >= 70;

    const result = {
      id: `sb_${Date.now()}`, pair, strategy, testType, duration,
      score, pnl: Math.round(pnl * 100) / 100, winRate: Math.round(winRate * 10) / 10,
      approved, timestamp: new Date().toISOString(),
    };
    this.results.unshift(result);
    if (this.results.length > 20) this.results.length = 20;
    this.running = false;

    logger.info(`Sandbox run complete: ${pair}/${testType} — Score: ${score}/100`, { service: "Sandbox" });
    return { success: true, result };
  }

  getResults(limit = 10) { return this.results.slice(0, limit); }
}

module.exports = new SandboxRunner();
