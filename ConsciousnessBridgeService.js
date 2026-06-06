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
    this.isRunning = false;
    this.agentId = "consciousness";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      memorySize: 1000,
      patternDetectionInterval: 60000,  // 1 minuto
      synergyReportInterval: 3600000,   // 1 hora
      minPatternConfidence: 65,
      enableAutoAdjust: true
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("ConsciousnessBridgeService initialized", { service: "ConsciousnessBridge" });
  }

  // 🆕 APLICA MELHORIAS
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 ConsciousnessBridge recebeu melhoria: ${improvement.recommendation}`, { service: "ConsciousnessBridge" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.minPatternConfidence = Math.max(50, this.config.minPatternConfidence - 10);
        logger.info(`⚡ ConsciousnessBridge aumentou sensibilidade: minConfiança=${this.config.minPatternConfidence}%`, { service: "ConsciousnessBridge" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.minPatternConfidence = Math.min(80, this.config.minPatternConfidence + 10);
        logger.info(`📉 ConsciousnessBridge reduziu sensibilidade: minConfiança=${this.config.minPatternConfidence}%`, { service: "ConsciousnessBridge" });
        break;
    }
    
    setTimeout(() => {
      this.config.minPatternConfidence = 65;
      logger.info(`🔄 ConsciousnessBridge resetou ajustes`, { service: "ConsciousnessBridge" });
    }, 3600000);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.logger.info("🧠 ConsciousnessBridgeService iniciado - SISTEMA DE APRENDIZADO COLETIVO ATIVO", { service: "ConsciousnessBridge" });
    
    this.listenToAllEvents();
    setInterval(() => this.distributeCollectiveLearning(), this.config.patternDetectionInterval);
    setInterval(() => this.generateSynergyReport(), this.config.synergyReportInterval);
  }

  listenToAllEvents() {
    const eventTypes = [
      "strategy:signal", "strategy:profit", "strategy:loss",
      "risk:alert", "risk:position:adjusted",
      "sentiment:update", "sentiment:extreme",
      "market:condition:change", "market:volatility",
      "arbitrage:opportunity", "arbitrage:executed", "arbitrage:failed",
      "capital:allocated", "capital:total:updated",
      "trade:executed", "trade:profit", "trade:loss",
      "learning:trend", "learning:hft", "learning:arbitrage", "learning:sentiment", "learning:deep"
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
    if (this.eventMemory.length > this.config.memorySize) this.eventMemory.pop();
  }

  detectPatterns(eventType, data) {
    // 🔥 PADRÃO 1: Perdas consecutivas + Medo extremo
    if (eventType === "strategy:loss" || eventType === "trade:loss") {
      const recentLosses = this.eventMemory.filter(e => 
        (e.type === "strategy:loss" || e.type === "trade:loss") && 
        e.timestamp > Date.now() - 3600000
      ).length;
      
      if (recentLosses >= 3) {
        const sentiment = this.getLatest("sentiment:update");
        if (sentiment && sentiment.fearGreedIndex < 35) {
          this.registerPattern({
            name: "FEAR_LOSS_CYCLE",
            description: `${recentLosses} perdas consecutivas em momento de medo extremo (${sentiment.fearGreedIndex})`,
            recommendation: "REDUZIR_RISCO",
            confidence: Math.min(95, 70 + recentLosses * 5),
            severity: "high"
          });
        }
      }
    }
    
    // 🔥 PADRÃO 2: Arbitragem + Ganância
    if (eventType === "arbitrage:opportunity") {
      const sentiment = this.getLatest("sentiment:update");
      if (sentiment && sentiment.fearGreedIndex > 65) {
        this.registerPattern({
          name: "GREED_ARBITRAGE",
          description: "Arbitragem disponível em momento de ganância",
          recommendation: "AUMENTAR_SENSIBILIDADE",
          confidence: 70,
          severity: "medium"
        });
      }
    }
    
    // 🔥 PADRÃO 3: Alta volatilidade + Sentimento extremo
    if (eventType === "market:volatility") {
      const sentiment = this.getLatest("sentiment:update");
      const volatility = data.volatility || 0;
      
      if (volatility > 2.0 && sentiment && Math.abs(sentiment.fearGreedIndex - 50) > 30) {
        this.registerPattern({
          name: "EXTREME_VOLATILITY_SENTIMENT",
          description: `Alta volatilidade (${volatility}%) combinada com sentimento extremo (${sentiment.fearGreedIndex})`,
          recommendation: "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND",
          confidence: 80,
          severity: "high"
        });
      }
    }
    
    // 🔥 PADRÃO 4: Múltiplos sinais de compra + Tendência de alta
    if (eventType === "strategy:signal" && data.signal === "BUY") {
      const buySignals = this.eventMemory.filter(e => 
        e.type === "strategy:signal" && 
        e.data?.signal === "BUY" &&
        e.timestamp > Date.now() - 300000 // últimos 5 minutos
      ).length;
      
      if (buySignals >= 2) {
        const marketCondition = this.getLatest("market:condition:change");
        if (marketCondition?.trend === "bullish") {
          this.registerPattern({
            name: "MULTIPLE_BUY_CONSENSUS",
            description: `${buySignals} sinais de compra em tendência de alta`,
            recommendation: "AUMENTAR_TAMANHO_POSICAO",
            confidence: Math.min(90, 70 + buySignals * 5),
            severity: "medium"
          });
        }
      }
    }
  }

  registerPattern(pattern) {
    // Verifica se padrão já existe recentemente
    const exists = this.patterns.some(p => 
      p.name === pattern.name && 
      (Date.now() - p.timestamp) < 3600000
    );
    
    if (!exists && pattern.confidence >= this.config.minPatternConfidence) {
      this.patterns.push({ ...pattern, timestamp: Date.now() });
      
      // Mantém apenas últimos 50 padrões
      if (this.patterns.length > 50) this.patterns.shift();
      
      this.logger.info(`📐 NOVO PADRÃO: ${pattern.name} (confiança: ${pattern.confidence}%)`, { service: "ConsciousnessBridge" });
      
      // 🆕 COMPARTILHA COM LEARNING BRAIN
      EventBus.emit(`learning:${this.agentId}`, {
        type: "pattern_discovery",
        content: pattern.description,
        confidence: pattern.confidence / 100,
        priority: pattern.severity === "high" ? "high" : "normal",
        data: pattern
      });
      
      this.distributeLearning({
        from: this.agentId,
        to: null,
        type: "pattern_discovery",
        message: pattern.description,
        recommendation: pattern.recommendation,
        confidence: pattern.confidence
      });
    }
  }

  distributeCollectiveLearning() {
    const insights = [];
    
    // Análise de arbitragem + sentimento
    const recentArbitrage = this.getLatest("arbitrage:opportunity", 5);
    const recentSentiment = this.getLatest("sentiment:update");
    
    if (recentArbitrage && recentSentiment && recentSentiment.fearGreedIndex < 35) {
      insights.push({
        to: "arbitrage",
        type: "market_opportunity",
        message: "Oportunidade de arbitragem em momento de medo - spreadThreshold pode ser reduzido",
        recommendation: "AUMENTAR_SENSIBILIDADE"
      });
    }
    
    // Alerta de perdas excessivas
    const recentLosses = this.eventMemory.filter(e => 
      (e.type === "strategy:loss" || e.type === "trade:loss") &&
      e.timestamp > Date.now() - 1800000
    ).length;
    
    if (recentLosses >= 5) {
      insights.push({
        to: null, // broadcast
        type: "risk_warning",
        message: `ALERTA: ${recentLosses} perdas nos últimos 30 minutos`,
        recommendation: "REDUZIR_RISCO",
        confidence: 85
      });
    }
    
    // Padrões ativos de alta confiança
    const highConfidencePatterns = this.patterns.filter(p => 
      p.confidence > 75 && (Date.now() - p.timestamp) < 7200000
    );
    
    highConfidencePatterns.forEach(pattern => {
      insights.push({
        to: null,
        type: "pattern_active",
        message: `Padrão ativo: ${pattern.description}`,
        recommendation: pattern.recommendation,
        confidence: pattern.confidence
      });
    });
    
    // Distribui insights
    insights.forEach(insight => {
      this.distributeLearning({
        from: this.agentId,
        to: insight.to,
        type: insight.type,
        message: insight.message,
        recommendation: insight.recommendation,
        confidence: insight.confidence || 70
      });
    });
  }

  distributeLearning(learning) {
    // Emite para o Learning Brain
    EventBus.emit("consciousness:learning", learning);
    
    // Se tem destino específico, emite direto
    if (learning.to) {
      EventBus.emit(`improvement:${learning.to}`, {
        recommendation: learning.recommendation,
        source: learning.from,
        confidence: learning.confidence,
        timestamp: Date.now()
      });
    } else {
      // Broadcast para todos
      EventBus.emit("improvement:broadcast", {
        recommendation: learning.recommendation,
        source: learning.from,
        confidence: learning.confidence,
        affectedAgents: ["trend", "hft", "arbitrage", "sentiment", "deep"],
        timestamp: Date.now()
      });
    }
    
    this.learnings.push(learning);
    if (this.learnings.length > 500) this.learnings.shift();
    
    logger.debug(`📤 Insight distribuído: ${learning.message.substring(0, 80)}`, { service: "ConsciousnessBridge" });
  }

  generateSynergyReport() {
    const activePatterns = this.patterns.filter(p => 
      (Date.now() - p.timestamp) < 3600000
    );
    
    const report = {
      timestamp: Date.now(),
      patternsFound: this.patterns.length,
      activePatterns: activePatterns.length,
      totalLearnings: this.learnings.length,
      topPattern: activePatterns[0] || null,
      recommendations: this.generateRecommendations()
    };
    
    EventBus.emit("consciousness:report", report);
    EventBus.emit(`learning:${this.agentId}`, {
      type: "synergy_report",
      content: `${activePatterns.length} padrões ativos, ${this.learnings.length} aprendizados coletivos`,
      confidence: 0.9,
      data: report
    });
    
    this.logger.info(`📊 Relatório de sinergia: ${activePatterns.length} padrões ativos`, { service: "ConsciousnessBridge" });
  }

  getLatest(eventType, maxAge = 60000) {
    const found = this.eventMemory.find(e => 
      e.type === eventType && (Date.now() - e.timestamp) < maxAge
    );
    return found ? found.data : null;
  }

  generateRecommendations() {
    const recommendations = [];
    const activePatterns = this.patterns.filter(p => 
      (Date.now() - p.timestamp) < 3600000 && p.confidence > 75
    );
    
    if (activePatterns.length > 0) {
      recommendations.push({
        priority: "HIGH",
        action: activePatterns[0].recommendation,
        reason: activePatterns[0].description,
        confidence: activePatterns[0].confidence
      });
    }
    
    const recentLosses = this.eventMemory.filter(e => 
      (e.type === "strategy:loss" || e.type === "trade:loss") &&
      e.timestamp > Date.now() - 3600000
    ).length;
    
    if (recentLosses >= 5) {
      recommendations.push({
        priority: "URGENT",
        action: "REDUZIR_RISCO",
        reason: `${recentLosses} perdas na última hora`,
        confidence: 85
      });
    }
    
    return recommendations;
  }

  getStatus() {
    return {
      running: this.isRunning,
      eventMemorySize: this.eventMemory.length,
      patternsCount: this.patterns.length,
      learningsCount: this.learnings.length,
      config: this.config,
      activePatterns: this.patterns.filter(p => (Date.now() - p.timestamp) < 3600000).length
    };
  }

  stop() {
    this.isRunning = false;
    this.logger.info("ConsciousnessBridgeService parado", { service: "ConsciousnessBridge" });
  }
}

module.exports = new ConsciousnessBridgeService();
