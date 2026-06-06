const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

class Orchestrator {
  constructor() {
    this.running = false;
    this.startTime = null;
    this.services = {};
    this.serviceOrder = [
      { name: "exchangeAdapter", path: "./ExchangeAdapterService", required: true },
      { name: "capitalDistributor", path: "./CapitalDistributorService", required: true },
      { name: "learningBrain", path: "./LearningBrainService", required: true },
      { name: "marketData", path: "./MarketDataService", required: true },
      { name: "marketCondition", path: "./MarketConditionService", required: true },
      { name: "sentiment", path: "./SentimentService", required: true },
      { name: "deepPattern", path: "./DeepPatternRecognitionService", required: true },
      { name: "marketMux", path: "./MarketMultiplexerService", required: false },
      { name: "strategy", path: "./StrategyService", required: true },
      { name: "multiStrategy", path: "./MultiStrategyService", required: false },
      { name: "rsiStrategy", path: "./RsiStrategy", required: false },
      { name: "macdStrategy", path: "./MacdStrategy", required: false },
      { name: "breakoutStrategy", path: "./BreakoutStrategy", required: false },
      { name: "signalService", path: "./SignalService", required: true },
      { name: "riskManagement", path: "./RiskManagementService", required: true },
      { name: "flashCrash", path: "./FlashCrashShieldService", required: false },
      { name: "slippage", path: "./SlippageEstimatorService", required: false },
      { name: "spread", path: "./SpreadAnalyzerService", required: false },
      { name: "tradeExecutor", path: "./TradeExecutorService", required: true },
      { name: "hft", path: "./HFTService", required: true },
      { name: "arbitrage", path: "./ArbitrageService", required: true },
      { name: "aiLearning", path: "./AIZtronLearningService", required: true },
      { name: "aiOptimizer", path: "./AIZtronOptimizerService", required: false },
      { name: "portfolio", path: "./PortfolioService", required: true },
      { name: "accountManager", path: "./AccountManagerService", required: false },
      { name: "goalTracker", path: "./GoalTrackerService", required: false },
      { name: "memory", path: "./MemoryService", required: true },
      { name: "marketConsciousness", path: "./MarketConsciousnessService", required: false },
      { name: "tokenomics", path: "./TokenomicsService", required: true },
      { name: "observability", path: "./ObservabilityService", required: false },
      { name: "backtest", path: "./BacktestService", required: false },
      { name: "backtestAI", path: "./BacktestAIService", required: false },
      { name: "sandbox", path: "./SandboxRunner", required: false },
      { name: "deployManager", path: "./DeployManagerService", required: false }
    ];
    
    logger.info("Orchestrator initialized", { service: "Orchestrator", totalServices: this.serviceOrder.length });
  }

  async init() {
    let loadedCount = 0;
    let failedCount = 0;
    
    for (const service of this.serviceOrder) {
      try {
        const serviceInstance = require(service.path);
        this.services[service.name] = serviceInstance;
        loadedCount++;
        logger.debug(`✅ Service loaded: ${service.name}`, { service: "Orchestrator" });
      } catch (error) {
        if (service.required) {
          logger.error(`❌ Required service failed to load: ${service.name} - ${error.message}`, { service: "Orchestrator" });
          failedCount++;
        } else {
          logger.warn(`⚠️ Optional service not loaded: ${service.name}`, { service: "Orchestrator" });
        }
      }
    }
    
    // ESCUTA TRADES PARA APRENDIZADO
    eventBus.on("trade", ({ action, trade }) => {
      if (action === "CLOSE" && this.services.aiLearning) {
        this.services.aiLearning.learnFromTrade(trade);
      }
    });
    
    // ESCUTA EVENTOS DE LUCRO PARA TOKENOMICS
    eventBus.on("agent:profit", (profitData) => {
      if (this.services.tokenomics && this.services.tokenomics.processProfit) {
        this.services.tokenomics.processProfit(profitData.amount, profitData.agentId);
      }
    });
    
    // 🔥 ESCUTA TICKS PARA EXCHANGE
    eventBus.on("tick", (prices) => {
      if (this.services.exchangeAdapter && this.services.exchangeAdapter.updatePrices) {
        this.services.exchangeAdapter.updatePrices?.(prices);
      }
    });
    
    logger.info(`Orchestrator initialized: ${loadedCount} services loaded, ${failedCount} failed`, { 
      service: "Orchestrator",
      loaded: loadedCount,
      failed: failedCount
    });
    
    return { success: failedCount === 0, loaded: loadedCount, failed: failedCount };
  }

  async start() {
    if (this.running) return { success: false, reason: "Already running" };
    
    this.running = true;
    this.startTime = Date.now();
    
    const startedServices = [];
    const failedServices = [];
    
    for (const service of this.serviceOrder) {
      const instance = this.services[service.name];
      if (!instance) continue;
      
      try {
        if (typeof instance.start === 'function') {
          await instance.start();
          startedServices.push(service.name);
          logger.info(`✅ Service started: ${service.name}`, { service: "Orchestrator" });
        } else if (typeof instance.initialize === 'function') {
          await instance.initialize();
          startedServices.push(service.name);
          logger.info(`✅ Service initialized: ${service.name}`, { service: "Orchestrator" });
        }
      } catch (error) {
        failedServices.push({ name: service.name, error: error.message });
        logger.error(`❌ Failed to start ${service.name}: ${error.message}`, { service: "Orchestrator" });
        
        if (service.required) {
          logger.error(`Required service ${service.name} failed to start. Stopping orchestra.`, { service: "Orchestrator" });
          this.running = false;
          return { success: false, reason: `Required service ${service.name} failed to start`, error: error.message };
        }
      }
    }
    
    eventBus.emit("engine:status", { 
      running: true, 
      timestamp: new Date().toISOString(),
      servicesStarted: startedServices.length
    });
    
    logger.info(`🚀 AZTRON Engine STARTED - ${startedServices.length} services online`, { 
      service: "Orchestrator",
      started: startedServices,
      failed: failedServices
    });
    
    logger.info("========== STATUS DOS 5 ROBÔS ==========", { service: "Orchestrator" });
    logger.info(`🎯 TREND: ${this.services.tradeExecutor?.running ? "✅" : "❌"}`, { service: "Orchestrator" });
    logger.info(`⚡ HFT: ${this.services.hft?.running ? "✅" : "❌"}`, { service: "Orchestrator" });
    logger.info(`🔄 ARBITRAGE: ${this.services.arbitrage?.isRunning ? "✅" : "❌"}`, { service: "Orchestrator" });
    logger.info(`📊 SENTIMENT: ${this.services.sentiment?.isRunning ? "✅" : "❌"}`, { service: "Orchestrator" });
    logger.info(`🧠 DEEP: ${this.services.deepPattern?.isRunning ? "✅" : "❌"}`, { service: "Orchestrator" });
    logger.info("========================================", { service: "Orchestrator" });
    
    db.addAlert({
      id: `al_start_${Date.now()}`,
      severity: "info",
      message: `AZTRON Engine started. ${startedServices.length} services online.`,
      timestamp: new Date().toISOString(),
      read: false
    });
    
    return { success: true, startedAt: new Date().toISOString() };
  }

  async stop() {
    if (!this.running) return { success: false, reason: "Not running" };
    
    this.running = false;
    const stoppedServices = [];
    
    for (let i = this.serviceOrder.length - 1; i >= 0; i--) {
      const service = this.serviceOrder[i];
      const instance = this.services[service.name];
      if (!instance) continue;
      
      try {
        if (typeof instance.stop === 'function') {
          await instance.stop();
          stoppedServices.push(service.name);
        }
      } catch (error) {
        logger.error(`Error stopping ${service.name}: ${error.message}`, { service: "Orchestrator" });
      }
    }
    
    eventBus.emit("engine:status", { running: false, timestamp: new Date().toISOString() });
    logger.info(`🛑 AZTRON Engine STOPPED`, { service: "Orchestrator" });
    
    return { success: true, stoppedAt: new Date().toISOString() };
  }

  getStatus() {
    const capitalStatus = this.services.capitalDistributor?.getStatus?.() || {};
    const learningStatus = this.services.learningBrain?.getStatus?.() || {};
    
    return {
      running: this.running,
      startedAt: this.startTime ? new Date(this.startTime).toISOString() : null,
      uptime: this._calculateUptime(),
      agents: {
        trend: this.services.tradeExecutor?.running || false,
        hft: this.services.hft?.running || false,
        arbitrage: this.services.arbitrage?.isRunning || false,
        sentiment: this.services.sentiment?.isRunning || false,
        deep: this.services.deepPattern?.isRunning || false
      },
      capital: capitalStatus,
      learning: learningStatus
    };
  }
  
  _calculateUptime() {
    if (!this.startTime) return "0d 0h 0m";
    const diff = Date.now() - this.startTime;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${days}d ${hours}h ${minutes}m`;
  }
  
  getAgentsStatus() {
    return {
      trend: { running: this.services.tradeExecutor?.running || false },
      hft: { running: this.services.hft?.running || false },
      arbitrage: { running: this.services.arbitrage?.isRunning || false },
      sentiment: { running: this.services.sentiment?.isRunning || false },
      deep: { running: this.services.deepPattern?.isRunning || false }
    };
  }
}

module.exports = new Orchestrator();
