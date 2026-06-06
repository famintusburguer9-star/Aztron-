const strategyService = require("./StrategyService");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");

class MultiStrategyService {
  constructor() {
    this.consensusHistory = [];
    this.performanceByStrategy = {};
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "multi_strategy";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      minStrategiesForConsensus: 2,
      minConfidenceForSignal: 60,
      weightedByPerformance: true,
      requireMinWinRate: 45,
      shareInsights: true
    };
    
    // 🆕 PESOS DAS ESTRATÉGIAS (aprendidos)
    this.strategyWeights = {
      RSI: 1.0,
      MACD: 1.0,
      Breakout: 1.0,
      CONSENSUS: 1.2
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.strategy) {
        this.learnFromTrade(trade);
      }
    });
    
    logger.info("MultiStrategyService initialized", { service: "MultiStrategy" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 MultiStrategy recebeu melhoria: ${improvement.recommendation}`, { service: "MultiStrategy" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.minStrategiesForConsensus = Math.max(1, this.config.minStrategiesForConsensus - 1);
        this.config.minConfidenceForSignal = Math.max(50, this.config.minConfidenceForSignal - 5);
        logger.info(`⚡ MultiStrategy aumentou sensibilidade: minStrategies=${this.config.minStrategiesForConsensus}, minConf=${this.config.minConfidenceForSignal}%`, { service: "MultiStrategy" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.minStrategiesForConsensus = Math.min(3, this.config.minStrategiesForConsensus + 1);
        this.config.minConfidenceForSignal = Math.min(75, this.config.minConfidenceForSignal + 5);
        logger.info(`📉 MultiStrategy reduziu risco: minStrategies=${this.config.minStrategiesForConsensus}, minConf=${this.config.minConfidenceForSignal}%`, { service: "MultiStrategy" });
        break;
    }
  }

  // 🆕 APRENDE COM RESULTADOS DE TRADES
  learnFromTrade(trade) {
    const { strategy, result, pnl, confidence } = trade;
    
    if (!this.performanceByStrategy[strategy]) {
      this.performanceByStrategy[strategy] = {
        wins: 0,
        losses: 0,
        totalTrades: 0,
        totalPnl: 0,
        winRate: 0,
        avgConfidence: 0
      };
    }
    
    const perf = this.performanceByStrategy[strategy];
    perf.totalTrades++;
    perf.totalPnl += pnl || 0;
    
    if (result === "WIN" || pnl > 0) {
      perf.wins++;
    } else {
      perf.losses++;
    }
    
    perf.winRate = perf.totalTrades > 0 ? (perf.wins / perf.totalTrades) * 100 : 0;
    
    // Ajusta peso baseado na performance
    if (this.config.weightedByPerformance && perf.totalTrades >= 10) {
      const newWeight = Math.min(1.5, Math.max(0.5, perf.winRate / 50));
      this.strategyWeights[strategy] = newWeight;
      logger.debug(`Peso da estratégia ${strategy} ajustado para ${newWeight.toFixed(2)} (WR: ${perf.winRate.toFixed(0)}%)`, { service: "MultiStrategy" });
    }
    
    // Compartilha aprendizado a cada 10 trades
    if (perf.totalTrades % 10 === 0 && perf.totalTrades > 0) {
      this._shareInsight("performance_update",
        `${strategy} tem ${perf.winRate.toFixed(0)}% de acerto após ${perf.totalTrades} trades`,
        perf.winRate / 100,
        { strategy, winRate: perf.winRate, totalTrades: perf.totalTrades, weight: this.strategyWeights[strategy] }
      );
    }
  }

  // 🆕 COMPARTILHA INSIGHT
  _shareInsight(type, content, confidence, data = {}) {
    if (!this.config.shareInsights) return;
    
    eventBus.emit(`learning:${this.agentId}`, {
      type: type,
      content: content,
      confidence: confidence,
      priority: confidence > 0.8 ? "high" : "normal",
      data: data
    });
  }

  analyzeConsensus(symbol) {
    const results = strategyService.analyzeAll(symbol);
    
    if (!results || results.length === 0) {
      return null;
    }
    
    // 🔥 FILTRA ESTRATÉGIAS COM CONFIANÇA MÍNIMA
    const validResults = results.filter(r => r.confidence >= this.config.minConfidenceForSignal);
    
    if (validResults.length < this.config.minStrategiesForConsensus) {
      logger.debug(`Consenso para ${symbol}: apenas ${validResults.length}/${this.config.minStrategiesForConsensus} estratégias válidas`, { service: "MultiStrategy" });
      return null;
    }
    
    // 🔥 CALCULA PONTUAÇÃO PONDERADA
    let buyScore = 0;
    let sellScore = 0;
    let totalWeight = 0;
    const usedStrategies = [];
    
    for (const result of validResults) {
      const strategyName = result.strategy;
      const weight = this.strategyWeights[strategyName] || 1.0;
      const confidenceScore = result.confidence / 100;
      
      if (result.signal === "BUY") {
        buyScore += weight * confidenceScore;
      } else if (result.signal === "SELL") {
        sellScore += weight * confidenceScore;
      }
      
      totalWeight += weight;
      usedStrategies.push(result.strategy);
    }
    
    // Normaliza
    if (totalWeight > 0) {
      buyScore = buyScore / totalWeight;
      sellScore = sellScore / totalWeight;
    }
    
    // Verifica consenso mínimo
    const buyDominance = buyScore - sellScore;
    const sellDominance = sellScore - buyScore;
    const minDominance = 0.15; // 15% de dominância mínima
    
    let signal = null;
    let confidence = 0;
    let strategies = [];
    let reasons = [];
    
    if (buyScore > sellScore && buyDominance > minDominance) {
      signal = "BUY";
      confidence = Math.round(buyScore * 100);
      strategies = validResults.filter(r => r.signal === "BUY").map(r => r.strategy);
      reasons = validResults.filter(r => r.signal === "BUY").map(r => r.reason);
    } else if (sellScore > buyScore && sellDominance > minDominance) {
      signal = "SELL";
      confidence = Math.round(sellScore * 100);
      strategies = validResults.filter(r => r.signal === "SELL").map(r => r.strategy);
      reasons = validResults.filter(r => r.signal === "SELL").map(r => r.reason);
    }
    
    if (!signal) {
      logger.debug(`Consenso para ${symbol}: sem dominância clara (BUY:${buyScore.toFixed(2)}, SELL:${sellScore.toFixed(2)})`, { service: "MultiStrategy" });
      return null;
    }
    
    // Verifica se a estratégia vencedora tem win rate mínimo
    if (this.config.requireMinWinRate && strategies.length > 0) {
      const bestStrategy = strategies[0];
      const perf = this.performanceByStrategy[bestStrategy];
      if (perf && perf.totalTrades >= 5 && perf.winRate < this.config.requireMinWinRate) {
        logger.debug(`Consenso para ${symbol}: estratégia ${bestStrategy} com WR baixo (${perf.winRate.toFixed(0)}% < ${this.config.requireMinWinRate}%)`, { service: "MultiStrategy" });
        return null;
      }
    }
    
    const result = {
      signal: signal,
      symbol: symbol,
      confidence: Math.min(95, Math.max(55, confidence)),
      strategies: strategies,
      reason: reasons.join(" | "),
      consensusCount: strategies.length,
      totalStrategies: validResults.length,
      buyScore: Math.round(buyScore * 100),
      sellScore: Math.round(sellScore * 100),
      weights: strategies.map(s => ({ strategy: s, weight: this.strategyWeights[s] || 1.0 }))
    };
    
    // Registra histórico
    this.consensusHistory.unshift({
      ...result,
      timestamp: new Date().toISOString()
    });
    
    if (this.consensusHistory.length > 200) {
      this.consensusHistory = this.consensusHistory.slice(0, 200);
    }
    
    // Compartilha consenso forte
    if (result.confidence >= 80) {
      this._shareInsight("strong_consensus",
        `Consenso FORTE em ${symbol}: ${result.signal} com ${result.confidence}% de confiança (${result.consensusCount}/${result.totalStrategies} estratégias)`,
        result.confidence / 100,
        result
      );
    }
    
    logger.debug(`Consenso ${symbol}: ${signal} (${confidence}%) - ${strategies.join(", ")}`, { service: "MultiStrategy" });
    
    return result;
  }

  analyzeAll(symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
    return symbols.map(sym => this.analyzeConsensus(sym)).filter(Boolean);
  }
  
  // 🆕 OBTÉM HISTÓRICO DE CONSENSOS
  getConsensusHistory(limit = 20) {
    return this.consensusHistory.slice(0, limit);
  }
  
  // 🆕 OBTÉM PERFORMANCE DAS ESTRATÉGIAS
  getStrategyPerformance() {
    return this.performanceByStrategy;
  }
  
  // 🆕 OBTÉM PESOS ATUAIS
  getStrategyWeights() {
    return this.strategyWeights;
  }
  
  // 🆕 ATUALIZA PESO MANUALMENTE
  updateStrategyWeight(strategy, weight) {
    if (this.strategyWeights[strategy] !== undefined) {
      this.strategyWeights[strategy] = Math.min(1.5, Math.max(0.5, weight));
      logger.info(`Peso da estratégia ${strategy} atualizado para ${weight}`, { service: "MultiStrategy" });
      return { success: true, strategy, weight };
    }
    return { success: false, error: "Strategy not found" };
  }
  
  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      running: this.isRunning,
      config: this.config,
      weights: this.strategyWeights,
      performance: this.performanceByStrategy,
      consensusHistorySize: this.consensusHistory.length,
      agentId: this.agentId
    };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("MultiStrategyService config updated", { service: "MultiStrategy", config: this.config });
    return { success: true, config: this.config };
  }
  
  start() {
    this.isRunning = true;
    logger.info("MultiStrategyService started", { service: "MultiStrategy" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    logger.info("MultiStrategyService stopped", { service: "MultiStrategy" });
    return { success: true };
  }
}

module.exports = new MultiStrategyService();
