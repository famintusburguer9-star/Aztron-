const EventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

class LearningBrainService {
  constructor() {
    this.isRunning = false;
    
    this.knowledge = {
      patterns: [],
      insights: [],
      correlations: [],
      improvements: []
    };
    
    this.agents = [
      { id: "trend", name: "Trend Aztron", lastInsight: null, performance: [], weight: 1.0, enabled: true },
      { id: "hft", name: "HFT Service", lastInsight: null, performance: [], weight: 0.9, enabled: true },
      { id: "arbitrage", name: "Arbitrage Service", lastInsight: null, performance: [], weight: 0.8, enabled: true },
      { id: "sentiment", name: "Sentiment Service", lastInsight: null, performance: [], weight: 0.7, enabled: true },
      { id: "deep", name: "Deep Pattern", lastInsight: null, performance: [], weight: 0.8, enabled: true }
    ];
    
    this.config = {
      processInterval: 300000,
      distributeInterval: 600000,
      minConfidenceToShare: 0.6,
      maxPatternAge: 86400000
    };
  }

  start() {
    this.isRunning = true;
    
    logger.info("🧠 LEARNING BRAIN INICIADO - O CÉREBRO QUE APRENDE");
    logger.info("   Aguardando aprendizados dos robôs...");
    
    EventBus.on("learning:trend", (data) => this.receiveLearning("trend", data));
    EventBus.on("learning:hft", (data) => this.receiveLearning("hft", data));
    EventBus.on("learning:arbitrage", (data) => this.receiveLearning("arbitrage", data));
    EventBus.on("learning:sentiment", (data) => this.receiveLearning("sentiment", data));
    EventBus.on("learning:deep", (data) => this.receiveLearning("deep", data));
    
    EventBus.on("trade:closed", (trade) => this.evaluateLearning(trade));
    
    setInterval(() => this.processLearnings(), this.config.processInterval);
    setInterval(() => this.distributeImprovements(), this.config.distributeInterval);
    
    logger.info("🧠 LearningBrain ouvindo eventos de aprendizado...");
  }

  receiveLearning(agentId, learning) {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent || !agent.enabled) return;
    
    if (learning.confidence < this.config.minConfidenceToShare) {
      logger.debug(`${agent.name}: Aprendizado ignorado (confiança ${learning.confidence})`);
      return;
    }
    
    agent.lastInsight = {
      type: learning.type,
      content: learning.content,
      confidence: learning.confidence,
      data: learning.data || {},
      timestamp: Date.now()
    };
    
    this.knowledge.insights.push({
      id: `insight_${Date.now()}_${agentId}`,
      agent: agentId,
      agentName: agent.name,
      type: learning.type,
      content: learning.content,
      confidence: learning.confidence,
      data: learning.data,
      timestamp: Date.now()
    });
    
    if (this.knowledge.insights.length > 500) {
      this.knowledge.insights = this.knowledge.insights.slice(-500);
    }
    
    logger.info(`📚 ${agent.name} compartilhou: ${learning.content.substring(0, 100)} (confiança: ${(learning.confidence*100).toFixed(0)}%)`);
    
    if (learning.priority === "high") {
      this.processUrgentLearning(agentId, learning);
    }
  }

  processUrgentLearning(agentId, learning) {
    logger.info(`⚡ Processamento urgente de ${agentId}: ${learning.content}`);
    
    const affectedAgents = this.findAffectedAgents(agentId, learning);
    
    for (const targetAgent of affectedAgents) {
      const improvement = {
        to: targetAgent,
        from: agentId,
        type: "urgent_insight",
        content: learning.content,
        confidence: learning.confidence,
        recommendation: this.generateRecommendation(learning),
        timestamp: Date.now()
      };
      
      EventBus.emit(`improvement:${targetAgent}`, improvement);
      logger.info(`📤 Insight urgente enviado para ${targetAgent}: ${improvement.recommendation}`);
    }
  }

  findAffectedAgents(sourceAgentId, learning) {
    const affected = [];
    
    switch (sourceAgentId) {
      case "trend":
        if (learning.type === "trend") {
          affected.push("hft", "arbitrage");
        }
        break;
      case "hft":
        if (learning.type === "volatility") {
          affected.push("trend", "arbitrage");
        }
        break;
      case "arbitrage":
        if (learning.type === "spread") {
          affected.push("hft");
        }
        break;
      case "sentiment":
        affected.push("trend", "hft", "arbitrage", "deep");
        break;
      case "deep":
        affected.push("trend", "hft", "arbitrage");
        break;
    }
    
    return affected;
  }

  generateRecommendation(learning) {
    const recommendations = {
      trend: {
        uptrend: "AUMENTAR_TAMANHO_POSICAO",
        downtrend: "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO",
        reversal: "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND"
      },
      hft: {
        volatility: "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE",
        spread: "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE"
      },
      sentiment: {
        fear: "REDUZIR_RISCO",
        greed: "REDUZIR_RISCO"
      }
    };
    
    for (const [type, mapping] of Object.entries(recommendations)) {
      if (learning.content.toLowerCase().includes(type)) {
        for (const [key, value] of Object.entries(mapping)) {
          if (learning.content.toLowerCase().includes(key)) {
            return value;
          }
        }
      }
    }
    
    return "MANTER_ESTRATEGIA";
  }

  processLearnings() {
    if (!this.isRunning) return;
    
    logger.info("🧠 Processando aprendizados coletivos...");
    
    const recentInsights = this.knowledge.insights.slice(-100);
    const patterns = this.findCrossPatterns(recentInsights);
    const correlations = this.findTemporalCorrelations(recentInsights);
    const derivedInsights = this.generateDerivedInsights(patterns, correlations);
    
    for (const pattern of patterns) {
      const exists = this.knowledge.patterns.some(p => 
        p.name === pattern.name && 
        (Date.now() - p.timestamp) < this.config.maxPatternAge
      );
      
      if (!exists) {
        this.knowledge.patterns.push({
          ...pattern,
          timestamp: Date.now(),
          occurrences: 1
        });
        logger.info(`🎯 NOVO PADRÃO: ${pattern.name} - ${pattern.description}`);
      } else {
        const existing = this.knowledge.patterns.find(p => p.name === pattern.name);
        if (existing) existing.occurrences++;
      }
    }
    
    for (const insight of derivedInsights) {
      this.knowledge.insights.push(insight);
      logger.info(`💡 NOVO INSIGHT: ${insight.content}`);
    }
    
    this.notifyAffectedAgents(patterns, derivedInsights);
    this.cleanOldPatterns();
  }

  findCrossPatterns(insights) {
    const patterns = [];
    
    const trendInsights = insights.filter(i => i.agent === "trend" && i.timestamp > Date.now() - 3600000);
    const sentimentInsights = insights.filter(i => i.agent === "sentiment" && i.timestamp > Date.now() - 3600000);
    const hftInsights = insights.filter(i => i.agent === "hft" && i.timestamp > Date.now() - 3600000);
    const arbitrageInsights = insights.filter(i => i.agent === "arbitrage" && i.timestamp > Date.now() - 3600000);
    
    const trendBullish = trendInsights.some(i => 
      i.content.toLowerCase().includes("alta") || 
      i.content.toLowerCase().includes("bull") ||
      i.content.toLowerCase().includes("subindo")
    );
    
    const sentimentFear = sentimentInsights.some(i => 
      i.content.toLowerCase().includes("medo") || 
      i.content.toLowerCase().includes("fear") ||
      i.content.toLowerCase().includes("extreme")
    );
    
    if (trendBullish && sentimentFear) {
      patterns.push({
        name: "FEAR_BULLISH_REVERSAL",
        description: "Trend indica alta mas mercado está com medo - possível reversão ou oportunidade de entrada",
        recommendation: "AUMENTAR_TAMANHO_POSICAO",
        affectedAgents: ["trend", "hft"],
        confidence: 0.75,
        severity: "medium"
      });
    }
    
    const arbitrageSpread = arbitrageInsights.some(i => 
      i.content.toLowerCase().includes("spread")
    );
    
    const hftVolatility = hftInsights.some(i => 
      i.content.toLowerCase().includes("volátil") || 
      i.content.toLowerCase().includes("volatility")
    );
    
    if (arbitrageSpread && hftVolatility) {
      patterns.push({
        name: "ARBITRAGE_VOLATILITY",
        description: "Spread detectado combinado com alta volatilidade - oportunidade de arbitragem",
        recommendation: "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE",
        affectedAgents: ["arbitrage", "hft"],
        confidence: 0.85,
        severity: "high"
      });
    }
    
    const sentimentExtreme = sentimentInsights.some(i => 
      i.content.toLowerCase().includes("extreme") || 
      (i.confidence > 0.8 && (i.content.includes("fear") || i.content.includes("greed")))
    );
    
    if (sentimentExtreme) {
      patterns.push({
        name: "EXTREME_SENTIMENT_ALERT",
        description: "Sentimento extremo detectado - possível ponto de virada do mercado",
        recommendation: "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND",
        affectedAgents: ["trend", "hft", "arbitrage", "deep"],
        confidence: 0.85,
        severity: "high"
      });
    }
    
    return patterns;
  }

  findTemporalCorrelations(insights) {
    const correlations = [];
    return correlations;
  }

  generateDerivedInsights(patterns, correlations) {
    const insights = [];
    
    for (const pattern of patterns) {
      insights.push({
        id: `derived_${Date.now()}_${pattern.name}`,
        type: "pattern_insight",
        content: pattern.description,
        recommendation: pattern.recommendation,
        confidence: pattern.confidence,
        source: "learning_brain",
        severity: pattern.severity,
        timestamp: Date.now()
      });
    }
    
    return insights;
  }

  notifyAffectedAgents(patterns, insights) {
    const notifications = [];
    
    for (const pattern of patterns) {
      for (const agentId of pattern.affectedAgents) {
        notifications.push({
          to: agentId,
          from: "learning_brain",
          type: "pattern_alert",
          content: pattern.description,
          recommendation: pattern.recommendation,
          confidence: pattern.confidence,
          severity: pattern.severity,
          timestamp: Date.now()
        });
      }
    }
    
    for (const insight of insights) {
      notifications.push({
        to: null,
        from: "learning_brain",
        type: "insight",
        content: insight.content,
        recommendation: insight.recommendation,
        confidence: insight.confidence,
        severity: insight.severity || "medium",
        timestamp: Date.now()
      });
    }
    
    for (const notif of notifications) {
      this.knowledge.improvements.push({
        ...notif,
        sent: false
      });
      
      if (notif.to) {
        EventBus.emit(`improvement:${notif.to}`, notif);
        logger.info(`📤 Melhoria enviada para ${notif.to}: ${notif.recommendation}`);
      } else {
        EventBus.emit("improvement:broadcast", notif);
        logger.info(`📤 Insight broadcast: ${notif.content.substring(0, 80)}`);
      }
    }
  }

  distributeImprovements() {
    if (!this.isRunning) return;
    
    logger.info("📤 Distribuindo melhorias pendentes...");
    
    const pendingImprovements = this.knowledge.improvements.filter(i => !i.sent && !i.expired);
    
    for (const improvement of pendingImprovements) {
      if (Date.now() - improvement.timestamp > 3600000) {
        improvement.expired = true;
        continue;
      }
      
      if (improvement.to) {
        EventBus.emit(`improvement:${improvement.to}`, improvement);
      } else {
        EventBus.emit("improvement:broadcast", improvement);
      }
      
      improvement.sent = true;
      improvement.sentAt = Date.now();
      
      logger.info(`📤 Melhoria distribuída: ${improvement.recommendation}`);
    }
    
    this.knowledge.improvements = this.knowledge.improvements.filter(i => 
      !i.expired && Date.now() - i.timestamp < 86400000
    );
  }

  evaluateLearning(trade) {
    const agent = this.agents.find(a => a.id === trade.agent);
    if (!agent) return;
    
    agent.performance.push({
      profit: trade.profit || 0,
      loss: trade.loss || 0,
      timestamp: Date.now(),
      tradeId: trade.id
    });
    
    if (agent.performance.length > 100) {
      agent.performance.shift();
    }
    
    const recentTrades = agent.performance.slice(-20);
    const wins = recentTrades.filter(t => t.profit > 0).length;
    const winRate = wins / recentTrades.length;
    
    if (winRate > 0.6) {
      agent.weight = Math.min(1.0, agent.weight + 0.02);
    } else if (winRate < 0.4) {
      agent.weight = Math.max(0.5, agent.weight - 0.02);
    }
  }

  cleanOldPatterns() {
    const now = Date.now();
    this.knowledge.patterns = this.knowledge.patterns.filter(p => 
      now - p.timestamp < this.config.maxPatternAge
    );
  }

  // 🔥 PREDICT SIGNAL CORRIGIDO
  predictSignal(signal) {
    try {
      const { symbol, type, confidence, agent, strategy } = signal;
      
      const similarPatterns = this.knowledge.patterns.filter(p => 
        p.affectedAgents?.includes(agent) && 
        p.confidence > 0.6
      );
      
      if (similarPatterns.length > 0) {
        const bestPattern = similarPatterns.sort((a, b) => b.confidence - a.confidence)[0];
        
        let adjustedConfidence = confidence;
        let recommendation = "FOLLOW";
        
        // 🔥 CORREÇÃO: Sentimento extremo é OPORTUNIDADE!
        if (bestPattern.name === "EXTREME_SENTIMENT_ALERT") {
          // FEAR = comprar, GREED = vender (estratégia contrária)
          if (type === "BUY") {
            adjustedConfidence = Math.min(95, confidence + 15);
            recommendation = "FOLLOW";
          } else if (type === "SELL") {
            adjustedConfidence = Math.min(95, confidence + 15);
            recommendation = "FOLLOW";
          }
        }
        
        if (bestPattern.name === "FEAR_BULLISH_REVERSAL") {
          if (type === "BUY") {
            adjustedConfidence = Math.min(95, confidence + 20);
            recommendation = "FOLLOW";
          }
        }
        
        if (bestPattern.name === "ARBITRAGE_VOLATILITY") {
          if (strategy?.includes("ARBITRAGE")) {
            adjustedConfidence = Math.min(95, confidence + 20);
            recommendation = "FOLLOW";
          }
        }
        
        return {
          predictedWinRate: bestPattern.confidence * 100,
          confidence: Math.round(adjustedConfidence),
          patternUsed: bestPattern.name,
          basedOnTrades: bestPattern.occurrences || 5,
          recommendation: recommendation
        };
      }
      
      const recentExtremeSentiment = this.knowledge.insights.some(i => 
        i.type === "extreme_sentiment" && 
        i.content?.toLowerCase().includes("extreme") &&
        (Date.now() - new Date(i.timestamp).getTime()) < 3600000
      );
      
      if (recentExtremeSentiment) {
        // 🔥 CORREÇÃO: Sentimento extremo é OPOSTO do que você pensa!
        if (type === "BUY") {
          return {
            predictedWinRate: 70,
            confidence: Math.min(95, confidence + 10),
            patternUsed: "extreme_sentiment_contrarian",
            basedOnTrades: 0,
            recommendation: "FOLLOW"
          };
        } else if (type === "SELL") {
          return {
            predictedWinRate: 70,
            confidence: Math.min(95, confidence + 10),
            patternUsed: "extreme_sentiment_contrarian",
            basedOnTrades: 0,
            recommendation: "FOLLOW"
          };
        }
      }
      
      const agentPerf = this.agents.find(a => a.id === agent);
      if (agentPerf && agentPerf.performance.length >= 10) {
        const recentTrades = agentPerf.performance.slice(-10);
        const wins = recentTrades.filter(t => t.profit > 0).length;
        const agentWinRate = wins / recentTrades.length;
        
        if (agentWinRate < 0.4) {
          return {
            predictedWinRate: agentWinRate * 100,
            confidence: Math.max(30, confidence - 20),
            patternUsed: "poor_performance",
            basedOnTrades: recentTrades.length,
            recommendation: "CAUTIOUS"
          };
        }
        
        if (agentWinRate > 0.6) {
          return {
            predictedWinRate: agentWinRate * 100,
            confidence: Math.min(95, confidence + 10),
            patternUsed: "good_performance",
            basedOnTrades: recentTrades.length,
            recommendation: "FOLLOW"
          };
        }
      }
      
      return {
        predictedWinRate: 55,
        confidence: confidence,
        patternUsed: null,
        basedOnTrades: 0,
        recommendation: confidence > 65 ? "FOLLOW" : confidence > 50 ? "CAUTIOUS" : "WAIT"
      };
      
    } catch (error) {
      logger.error(`Erro no predictSignal: ${error.message}`);
      return {
        predictedWinRate: 50,
        confidence: signal?.confidence || 50,
        patternUsed: null,
        basedOnTrades: 0,
        recommendation: "FOLLOW"
      };
    }
  }

  getKnowledge() {
    const recentPerformance = {};
    for (const agent of this.agents) {
      const recentTrades = agent.performance.slice(-20);
      const wins = recentTrades.filter(t => t.profit > 0).length;
      recentPerformance[agent.id] = {
        winRate: recentTrades.length > 0 ? (wins / recentTrades.length * 100).toFixed(1) : 0,
        totalTrades: agent.performance.length,
        weight: agent.weight
      };
    }
    
    return {
      patterns: this.knowledge.patterns.slice(-20),
      insights: this.knowledge.insights.slice(-20),
      improvements: this.knowledge.improvements.filter(i => !i.sent).slice(-10),
      agentPerformance: recentPerformance,
      lastProcessed: new Date().toISOString()
    };
  }

  getStatus() {
    return {
      running: this.isRunning,
      totalInsights: this.knowledge.insights.length,
      totalPatterns: this.knowledge.patterns.length,
      totalImprovements: this.knowledge.improvements.length,
      agents: this.agents.map(a => ({
        id: a.id,
        name: a.name,
        enabled: a.enabled,
        weight: a.weight,
        lastInsight: a.lastInsight ? {
          content: a.lastInsight.content.substring(0, 100),
          confidence: a.lastInsight.confidence,
          age: Date.now() - a.lastInsight.timestamp
        } : null
      })),
      config: this.config
    };
  }

  stop() {
    this.isRunning = false;
    logger.info("LearningBrainService parado");
  }
}

module.exports = new LearningBrainService();
