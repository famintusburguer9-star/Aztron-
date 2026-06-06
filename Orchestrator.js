const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

class Orchestrator {
  constructor() {
    this.running = false;
    this.startTime = null;
    this.services = {};
    this.serviceOrder = [
      // 0. EXCHANGE (BASE - DEVE SER O PRIMEIRO)
      { name: "exchangeAdapter", path: "./ExchangeAdapterService", required: true },
      
      // 1. SERVIÇOS BASE (devem iniciar logo após exchange)
      { name: "capitalDistributor", path: "./CapitalDistributorService", required: true },
      { name: "learningBrain", path: "./LearningBrainService", required: true },
      
      // 2. SERVIÇOS DE MERCADO
      { name: "marketData", path: "./MarketDataService", required: true },
      { name: "marketCondition", path: "./MarketConditionService", required: true },
      
      // 3. SERVIÇOS DE ANÁLISE (ROBÔS DE ANÁLISE)
      { name: "sentiment", path: "./SentimentService", required: true },
      { name: "deepPattern", path: "./DeepPatternRecognitionService", required: true },
      { name: "marketMux", path: "./MarketMultiplexerService", required: false },
      
      // 4. SERVIÇOS DE ESTRATÉGIA
      { name: "strategy", path: "./StrategyService", required: true },
      { name: "multiStrategy", path: "./MultiStrategyService", required: false },
      { name: "rsiStrategy", path: "./RsiStrategy", required: false },
      { name: "macdStrategy", path: "./MacdStrategy", required: false },
      { name: "breakoutStrategy", path: "./BreakoutStrategy", required: false },
      { name: "signalService", path: "./SignalService", required: true },
      
      // 5. SERVIÇOS DE EXECUÇÃO E RISCO
      { name: "riskManagement", path: "./RiskManagementService", required: true },
      { name: "flashCrash", path: "./FlashCrashShieldService", required: false },
      { name: "slippage", path: "./SlippageEstimatorService", required: false },
      { name: "spread", path: "./SpreadAnalyzerService", required: false },
      
      // 6. ROBÔS OPERACIONAIS (OS 5 AGENTES QUE OPERAM)
      // 🔥 TREND (executa trades via TradeExecutor)
      { name: "tradeExecutor", path: "./TradeExecutorService", required: true },
      
      // 🔥 HFT (alta frequência)
      { name: "hft", path: "./HFTService", required: true },
      
      // 🔥 ARBITRAGE (arbitragem)
      { name: "arbitrage", path: "./ArbitrageService", required: true },
      
      // 🔥 SENTIMENT (análise de sentimento) - Já existe, só garantir inicialização
      // { name: "sentimentAnalysis", path: "./SentimentAnalysisService", required: false },
      
      // 🔥 DEEP PATTERN (reconhecimento de padrões) - Já existe
      // { name: "deepPatternRecognition", path: "./DeepPatternRecognitionService", required: false },
      
      // 7. SERVIÇOS DE APRENDIZADO E OTIMIZAÇÃO
      { name: "aiLearning", path: "./AIZtronLearningService", required: true },
      { name: "aiOptimizer", path: "./AIZtronOptimizerService", required: false },
      
      // 8. SERVIÇOS DE PORTFÓLIO
      { name: "portfolio", path: "./PortfolioService", required: true },
      { name: "accountManager", path: "./AccountManagerService", required: false },
      { name: "goalTracker", path: "./GoalTrackerService", required: false },
      
      // 9. SERVIÇOS AVANÇADOS
      { name: "memory", path: "./MemoryService", required: true },
      { name: "marketConsciousness", path: "./MarketConsciousnessService", required: false },
      { name: "tokenomics", path: "./TokenomicsService", required: true },
      { name: "observability", path: "./ObservabilityService", required: false },
      
      // 10. SERVIÇOS DE TESTE
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
    
    // 🔥 ESCUTA APRENDIZADO DOS ROBÔS PARA O LEARNING BRAIN
    // Isso garante que os 5 robôs enviem seus aprendizados
    eventBus.on("learning:trend", (data) => {
      if (this.services.learningBrain) {
        this.services.learningBrain.receiveLearning("trend", data);
      }
    });
    
    eventBus.on("learning:hft", (data) => {
      if (this.services.learningBrain) {
        this.services.learningBrain.receiveLearning("hft", data);
      }
    });
    
    eventBus.on("learning:arbitrage", (data) => {
      if (this.services.learningBrain) {
        this.services.learningBrain.receiveLearning("arbitrage", data);
      }
    });
    
    eventBus.on("learning:sentiment", (data) => {
      if (this.services.learningBrain) {
        this.services.learningBrain.receiveLearning("sentiment", data);
      }
    });
    
    eventBus.on("learning:deep", (data) => {
      if (this.services.learningBrain) {
        this.services.learningBrain.receiveLearning("deep", data);
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
      failed: failedCount,
      total: this.serviceOrder.length
    });
    
    return { success: failedCount === 0, loaded: loadedCount, failed: failedCount };
  }

  async start() {
    if (this.running) return { success: false, reason: "Already running" };
    
    this.running = true;
    this.startTime = Date.now();
    
    const startedServices = [];
    const failedServices = [];
    
    // INICIA SERVIÇOS NA ORDEM CORRETA
    for (const service of this.serviceOrder) {
      const instance = this.services[service.name];
      if (!instance) continue;
      
      try {
        // Verifica se o serviço tem método start
        if (typeof instance.start === 'function') {
          await instance.start();
          startedServices.push(service.name);
          logger.info(`✅ Service started: ${service.name}`, { service: "Orchestrator" });
        } else if (typeof instance.initialize === 'function') {
          await instance.initialize();
          startedServices.push(service.name);
          logger.info(`✅ Service initialized: ${service.name}`, { service: "Orchestrator" });
        } else {
          logger.debug(`Service ${service.name} has no start method, skipping`, { service: "Orchestrator" });
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
    
    // 🔥 VERIFICA ESPECÍFICA DOS 5 ROBÔS
    const agents = [
      { name: "tradeExecutor", instance: this.services.tradeExecutor, runningKey: "running" },
      { name: "hft", instance: this.services.hft, runningKey: "running" },
      { name: "arbitrage", instance: this.services.arbitrage, runningKey: "isRunning" },
      { name: "sentiment", instance: this.services.sentiment, runningKey: "isRunning" },
      { name: "deepPattern", instance: this.services.deepPattern, runningKey: "isRunning" }
    ];
    
    for (const agent of agents) {
      if (agent.instance && !agent.instance[agent.runningKey]) {
        logger.warn(`⚠️ ${agent.name} não está rodando! Tentando iniciar novamente...`, { service: "Orchestrator" });
        try {
          if (typeof agent.instance.start === 'function') {
            await agent.instance.start();
          } else if (typeof agent.instance.initialize === 'function') {
            await agent.instance.initialize();
          }
          if (!startedServices.includes(agent.name)) {
            startedServices.push(agent.name);
          }
          logger.info(`✅ ${agent.name} iniciado com sucesso na segunda tentativa`, { service: "Orchestrator" });
        } catch (err) {
          logger.error(`❌ Falha ao iniciar ${agent.name}: ${err.message}`, { service: "Orchestrator" });
        }
      }
    }
    
    // EMITE EVENTO DE STATUS
    eventBus.emit("engine:status", { 
      running: true, 
      timestamp: new Date().toISOString(),
      servicesStarted: startedServices.length,
      totalServices: this.serviceOrder.length
    });
    
    // 🔥 EMITE EVENTO PARA INFORMAR QUE OS 5 ROBÔS ESTÃO PRONTOS
    eventBus.emit("agents:ready", {
      timestamp: new Date().toISOString(),
      agents: {
        trend: this.services.tradeExecutor?.running || false,
        hft: this.services.hft?.running || false,
        arbitrage: this.services.arbitrage?.isRunning || false,
        sentiment: this.services.sentiment?.isRunning || false,
        deep: this.services.deepPattern?.isRunning || false
      }
    });
    
    logger.info(`🚀 AZTRON Engine STARTED - ${startedServices.length} services online`, { 
      service: "Orchestrator",
      started: startedServices,
      failed: failedServices
    });
    
    // Log específico dos 5 robôs
    logger.info("========== STATUS DOS 5 ROBÔS ==========", { service: "Orchestrator" });
    logger.info(`🎯 TREND (TradeExecutor): ${this.services.tradeExecutor?.running ? "✅ RODANDO" : "❌ PARADO"}`, { service: "Orchestrator" });
    logger.info(`⚡ HFT: ${this.services.hft?.running ? "✅ RODANDO" : "❌ PARADO"}`, { service: "Orchestrator" });
    logger.info(`🔄 ARBITRAGE: ${this.services.arbitrage?.isRunning ? "✅ RODANDO" : "❌ PARADO"}`, { service: "Orchestrator" });
    logger.info(`📊 SENTIMENT: ${this.services.sentiment?.isRunning ? "✅ RODANDO" : "❌ PARADO"}`, { service: "Orchestrator" });
    logger.info(`🧠 DEEP PATTERN: ${this.services.deepPattern?.isRunning ? "✅ RODANDO" : "❌ PARADO"}`, { service: "Orchestrator" });
    logger.info("========================================", { service: "Orchestrator" });
    
    // Adiciona alerta no banco
    db.addAlert({
      id: `al_start_${Date.now()}`,
      severity: "info",
      message: `AZTRON Engine started successfully. ${startedServices.length} services online. 5 agents: Trend, HFT, Arbitrage, Sentiment, Deep Pattern.`,
      timestamp: new Date().toISOString(),
      read: false
    });
    
    return { 
      success: true, 
      startedAt: new Date().toISOString(),
      servicesStarted: startedServices.length,
      servicesFailed: failedServices.length
    };
  }

  async stop() {
    if (!this.running) return { success: false, reason: "Not running" };
    
    this.running = false;
    const stoppedServices = [];
    
    // PARA SERVIÇOS NA ORDEM INVERSA
    for (let i = this.serviceOrder.length - 1; i >= 0; i--) {
      const service = this.serviceOrder[i];
      const instance = this.services[service.name];
      if (!instance) continue;
      
      try {
        if (typeof instance.stop === 'function') {
          await instance.stop();
          stoppedServices.push(service.name);
          logger.debug(`Service stopped: ${service.name}`, { service: "Orchestrator" });
        }
      } catch (error) {
        logger.error(`Error stopping ${service.name}: ${error.message}`, { service: "Orchestrator" });
      }
    }
    
    eventBus.emit("engine:status", { 
      running: false, 
      timestamp: new Date().toISOString() 
    });
    
    logger.info(`🛑 AZTRON Engine STOPPED - ${stoppedServices.length} services stopped`, { 
      service: "Orchestrator" 
    });
    
    return { 
      success: true, 
      stoppedAt: new Date().toISOString(),
      servicesStopped: stoppedServices.length
    };
  }

  getStatus() {
    const metrics = this.services.observability?.getMetrics?.() || {};
    const portfolio = this.services.portfolio?.getSummary?.() || {};
    const capitalStatus = this.services.capitalDistributor?.getStatus?.() || {};
    const learningStatus = this.services.learningBrain?.getStatus?.() || {};
    
    // CONTA SERVIÇOS ATIVOS
    let activeServices = 0;
    for (const service of this.serviceOrder) {
      const instance = this.services[service.name];
      if (instance && (instance.isRunning === true || instance.running === true)) {
        activeServices++;
      }
    }
    
    return {
      running: this.running,
      startedAt: this.startTime ? new Date(this.startTime).toISOString() : null,
      uptime: metrics.uptime || this._calculateUptime(),
      memoryUsage: metrics.memoryUsagePct || 0,
      servicesOnline: activeServices,
      totalServices: this.serviceOrder.length,
      wsConnected: true,
      capital: capitalStatus,
      learning: {
        patternsFound: learningStatus?.totalPatterns || 0,
        insightsCount: learningStatus?.totalInsights || 0
      },
      // 🔥 STATUS DOS 5 ROBÔS
      agents: {
        trend: this.services.tradeExecutor?.running || false,
        hft: this.services.hft?.running || false,
        arbitrage: this.services.arbitrage?.isRunning || false,
        sentiment: this.services.sentiment?.isRunning || false,
        deep: this.services.deepPattern?.isRunning || false
      },
      tradeExecutorRunning: this.services.tradeExecutor?.running || false,
      ...portfolio,
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
  
  getServicesStatus() {
    const servicesStatus = [];
    for (const service of this.serviceOrder) {
      const instance = this.services[service.name];
      servicesStatus.push({
        name: service.name,
        loaded: !!instance,
        running: instance ? (instance.isRunning === true || instance.running === true) : false,
        required: service.required
      });
    }
    return servicesStatus;
  }
  
  getCriticalServicesStatus() {
    const criticalServices = ["exchangeAdapter", "capitalDistributor", "learningBrain", "tradeExecutor", "signalService", "riskManagement"];
    const status = {};
    
    for (const serviceName of criticalServices) {
      const instance = this.services[serviceName];
      status[serviceName] = {
        loaded: !!instance,
        running: instance ? (instance.isRunning === true || instance.running === true) : false,
        required: true
      };
    }
    
    // 🔥 ADICIONA OS OUTROS ROBÔS
    status.hft = {
      loaded: !!this.services.hft,
      running: this.services.hft?.running || false,
      required: true
    };
    
    status.arbitrage = {
      loaded: !!this.services.arbitrage,
      running: this.services.arbitrage?.isRunning || false,
      required: true
    };
    
    return status;
  }
  
  // 🔥 MÉTODO PARA VERIFICAR SAÚDE DOS 5 ROBÔS ESPECIFICAMENTE
  getAgentsStatus() {
    return {
      trend: {
        name: "Trend Aztron",
        running: this.services.tradeExecutor?.running || false,
        capital: this.services.capitalDistributor?.getAgentInfo?.("trend")?.balance || 0
      },
      hft: {
        name: "HFT Service",
        running: this.services.hft?.running || false,
        capital: this.services.hft?.capitalAllocated || 0
      },
      arbitrage: {
        name: "Arbitrage Service",
        running: this.services.arbitrage?.isRunning || false,
        capital: this.services.arbitrage?.capitalAllocated || 0
      },
      sentiment: {
        name: "Sentiment Service",
        running: this.services.sentiment?.isRunning || false,
        capital: this.services.capitalDistributor?.getAgentInfo?.("sentiment")?.balance || 0
      },
      deep: {
        name: "Deep Pattern",
        running: this.services.deepPattern?.isRunning || false,
        capital: this.services.capitalDistributor?.getAgentInfo?.("deep")?.balance || 0
      }
    };
  }
}

module.exports = new Orchestrator();
