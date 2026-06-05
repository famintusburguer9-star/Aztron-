const EventBus = require("./EventBus");
const db = require("./DatabaseService");
const logger = require("./LoggerService");

class ConsciousnessBridgeService {
  constructor() {
    this.logger = logger;
    this.db = db;
    this.eventMemory = [];
    this.learnings = [];
    this.patterns = [];
  }

  start() {
    this.logger.info("🧠 ConsciousnessBridgeService iniciado - SISTEMA DE APRENDIZADO COLETIVO ATIVO", { service: "ConsciousnessBridge" });
    
    this.listenToAllEvents();
    setInterval(() => this.distributeCollectiveLearning(), 60000);
    setInterval(() => this.generateSynergyReport(), 3600000);
  }

  listenToAllEvents() {
    const eventTypes = [
      "strategy:signal", "strategy:profit", "strategy:loss",
      "risk:alert", "risk:position:adjusted",
      "sentiment:update", "sentiment:extreme",
      "market:condition:change", "market:volatility",
      "arbitrage:opportunity", "arbitrage:executed", "arbitrage:failed",
      "capital:allocated", "capital:total:updated",
      "trade:executed", "trade:profit", "trade:loss"
    ];
    
    eventTypes.forEach(eventType => {
      EventBus.on(eventType, (data) => {
        this.collectEvent(eventType, data);
        this.detectPatterns(eventType, data);
      });
    });
  }

  collectEvent(type, data) {
    this.eventMemory.unshift({ type, data, timestamp: Date.now() });
    if (this.eventMemory.length > 1000) this.eventMemory.pop();
  }

  detectPatterns(eventType, data) {
    if (eventType === "strategy:loss") {
      const recentLosses = this.eventMemory.filter(e => 
        e.type === "strategy:loss" && e.timestamp > Date.now() - 3600000
      ).length;
      
      if (recentLosses >= 3) {
        const sentiment = this.getLatest("sentiment:update");
        if (sentiment && sentiment.fearGreedIndex < 30) {
          this.registerPattern({
            name: "fear_loss_cycle",
            description: "Perdas consecutivas em momento de medo extremo",
            recommendation: "REDUCE_ALL_POSITIONS_BY_50",
            confidence: 85
          });
        }
      }
    }
    
    if (eventType === "arbitrage:opportunity") {
      const sentiment = this.getLatest("sentiment:update");
      if (sentiment && sentiment.fearGreedIndex > 60) {
        this.registerPattern({
          name: "greed_arbitrage",
          description: "Arbitragem disponível em momento de ganância",
          recommendation: "INCREASE_ARBITRAGE_LIMIT_BY_20",
          confidence: 70
        });
      }
    }
  }

  registerPattern(pattern) {
    const exists = this.patterns.some(p => p.name === pattern.name && 
      (Date.now() - p.timestamp) < 3600000);
    
    if (!exists) {
      this.patterns.push({ ...pattern, timestamp: Date.now() });
      this.logger.info(`📐 Novo padrão detectado: ${pattern.name}`);
      
      this.distributeLearning({
        from: "ConsciousnessBridge",
        type: "pattern_discovery",
        message: pattern.description,
        recommendation: pattern.recommendation,
        confidence: pattern.confidence
      });
    }
  }

  distributeCollectiveLearning() {
    const insights = [];
    
    const recentArbitrage = this.getLatest("arbitrage:opportunity", 5);
    const recentSentiment = this.getLatest("sentiment:update");
    
    if (recentArbitrage && recentSentiment && recentSentiment.fearGreedIndex < 35) {
      insights.push({
        to: "ArbitrageService",
        message: "Oportunidade de arbitragem em momento de medo - spreadThreshold pode ser reduzido",
        type: "market_opportunity"
      });
    }
    
    const recentLosses = this.eventMemory.filter(e => 
      (e.type === "strategy:loss" || e.type === "trade:loss") &&
      e.timestamp > Date.now() - 1800000
    ).length;
    
    if (recentLosses >= 5) {
      insights.push({
        to: null,
        message: `ALERTA: ${recentLosses} perdas nos últimos 30 minutos`,
        type: "risk_warning",
        recommendation: "REDUCE_RISK"
      });
    }
    
    const highConfidencePatterns = this.patterns.filter(p => 
      p.confidence > 70 && (Date.now() - p.timestamp) < 7200000
    );
    
    highConfidencePatterns.forEach(pattern => {
      insights.push({
        to: null,
        message: `Padrão ativo: ${pattern.description}`,
        type: "pattern_active",
        recommendation: pattern.recommendation
      });
    });
    
    insights.forEach(insight => {
      this.distributeLearning({
        from: "ConsciousnessBridge",
        to: insight.to,
        type: insight.type,
        message: insight.message,
        recommendation: insight.recommendation
      });
    });
  }

  distributeLearning(learning) {
    EventBus.emit("consciousness:learning", learning);
    if (learning.to) {
      EventBus.emit(`${learning.to.toLowerCase()}:learning`, learning);
    }
    this.learnings.push(learning);
    if (this.learnings.length > 500) this.learnings.shift();
  }

  generateSynergyReport() {
    const report = {
      timestamp: Date.now(),
      patternsFound: this.patterns.length,
      totalLearnings: this.learnings.length,
      recommendations: this.generateRecommendations()
    };
    EventBus.emit("consciousness:report", report);
    this.logger.info(`📊 Relatório de sinergia gerado: ${report.patternsFound} padrões ativos`);
  }

  getLatest(eventType, maxAge = 60000) {
    const found = this.eventMemory.find(e => 
      e.type === eventType && (Date.now() - e.timestamp) < maxAge
    );
    return found ? found.data : null;
  }

  generateRecommendations() {
    const recommendations = [];
    const recentPatterns = this.patterns.filter(p => 
      (Date.now() - p.timestamp) < 3600000
    );
    if (recentPatterns.length > 0) {
      recommendations.push({
        priority: "HIGH",
        action: recentPatterns[0].recommendation,
        reason: recentPatterns[0].description
      });
    }
    return recommendations;
  }

  stop() { this.logger.info("ConsciousnessBridgeService parado"); }
}

module.exports = new ConsciousnessBridgeService();
