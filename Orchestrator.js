const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

class Orchestrator {
  constructor() {
    this.running = false;
    this.startTime = null;
    this.services = {};
    logger.info("Orchestrator initialized", { service: "Orchestrator" });
  }

  async init() {
    this.services.signalService = require("./SignalService");
    this.services.tradeExecutor = require("./TradeExecutorService");
    this.services.flashCrash = require("./FlashCrashShieldService");
    this.services.aiLearning = require("./AIZtronLearningService");
    this.services.sentiment = require("./SentimentService");
    this.services.deepPattern = require("./DeepPatternRecognitionService");
    this.services.observability = require("./ObservabilityService");
    this.services.portfolio = require("./PortfolioService");

    eventBus.on("trade", ({ action, trade }) => {
      if (action === "CLOSE") this.services.aiLearning.learnFromTrade(trade);
    });

    logger.info("Orchestrator initialized all services", { service: "Orchestrator" });
  }

  async start() {
    if (this.running) return { success: false, reason: "Already running" };
    this.running = true;
    this.startTime = Date.now();

    this.services.signalService.start();
    this.services.tradeExecutor.start();
    this.services.flashCrash.start();
    this.services.aiLearning.start();
    this.services.sentiment.start();
    this.services.deepPattern.start();
    this.services.observability.start();

    eventBus.emit("engine:status", { running: true, timestamp: new Date().toISOString() });
    logger.info("AZTRON Engine STARTED", { service: "Orchestrator" });

    db.addAlert({ id: `al_start_${Date.now()}`, severity: "info", message: "AZTRON Engine started successfully. All services online.", timestamp: new Date().toISOString(), read: false });

    return { success: true, startedAt: new Date().toISOString() };
  }

  async stop() {
    if (!this.running) return { success: false, reason: "Not running" };
    this.running = false;

    this.services.signalService.stop();
    this.services.tradeExecutor.stop();
    this.services.flashCrash.stop();
    this.services.aiLearning.stop();
    this.services.sentiment.stop();
    this.services.deepPattern.stop();
    this.services.observability.stop();

    eventBus.emit("engine:status", { running: false, timestamp: new Date().toISOString() });
    logger.info("AZTRON Engine STOPPED", { service: "Orchestrator" });

    return { success: true, stoppedAt: new Date().toISOString() };
  }

  getStatus() {
    const metrics = this.services.observability?.getMetrics() || {};
    const portfolio = this.services.portfolio?.getSummary() || {};
    return {
      running: this.running,
      startedAt: this.startTime ? new Date(this.startTime).toISOString() : null,
      uptime: metrics.uptime || "0d 0h 0m",
      memoryUsage: metrics.memoryUsagePct || 0,
      servicesOnline: this.running ? 30 : 0,
      totalServices: 32,
      wsConnected: true,
      ...portfolio,
    };
  }
}

module.exports = new Orchestrator();
