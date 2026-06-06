const rsiStrategy = require("./RsiStrategy");
const macdStrategy = require("./MacdStrategy");
const breakoutStrategy = require("./BreakoutStrategy");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class StrategyService {
  constructor() {
    this.strategies = { 
      rsi: rsiStrategy, 
      macd: macdStrategy, 
      breakout: breakoutStrategy 
    };
    this.activeStrategies = ["rsi", "macd", "breakout"];
    
    // 🆕 IDENTIFICAÇÃO PARA O LEARNING BRAIN
    this.agentId = "strategy";
    this.isRunning = false;
    this.performanceStats = {
      rsi: { wins: 0, losses: 0, totalTrades: 0, winRate: 0, lastSignal: null },
      macd: { wins: 0, losses: 0, totalTrades: 0, winRate: 0, lastSignal: null },
      breakout: { wins: 0, losses: 0, totalTrades: 0, winRate: 0, lastSignal: null }
    };
    
    // Configurações ajustáveis pelo Learning Brain
    this.config = {
      minConfidence: 50,
      requireConsensus: false,
      signalTTL: 120000, // 2 minutos
      adjustSensitivity: 1.0
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    eventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.strategy) {
        this.learnFromTrade(trade);
      }
    });
    
    logger.info("StrategyService initialized", { 
      service: "Strategy",
      activeStrategies: this.activeStrategies.join(", ")
    });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 StrategyService recebeu melhoria: ${improvement.recommendation}`, { service: "Strategy" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.minConfidence = Math.max(30, this.config.minConfidence - 5);
        this.config.adjustSensitivity = Math.min(1.5, this.config.adjustSensitivity * 1.1);
        logger.info(`⚡ StrategyService aumentou sensibilidade: minConfiança=${this.config.minConfidence}%, sensibilidade=${this.config.adjustSensitivity}x`, { service: "Strategy" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.minConfidence = Math.min(70, this.config.minConfidence + 5);
        this.config.adjustSensitivity = Math.max(0.5, this.config.adjustSensitivity * 0.9);
        logger.info(`📉 StrategyService reduziu risco: minConfiança=${this.config.minConfidence}%, sensibilidade=${this.config.adjustSensitivity}x`, { service: "Strategy" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        this.config.requireConsensus = true;
        logger.info(`⚠️ StrategyService ativou consenso obrigatório`, { service: "Strategy" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "Strategy" });
    }
    
    // Reseta ajustes temporários após 1 hora
    setTimeout(() => {
      this.config.minConfidence = 50;
      this.config.adjustSensitivity = 1.0;
      this.config.requireConsensus = false;
      logger.info(`🔄 StrategyService resetou ajustes temporários`, { service: "Strategy" });
    }, 3600000);
  }

  // 🆕 APRENDE COM RESULTADOS DE TRADES
  learnFromTrade(trade) {
    const { strategy, pnl, result } = trade;
    
    // Identifica qual estratégia foi usada
    let strategyKey = null;
    if (strategy?.toLowerCase().includes("rsi")) strategyKey = "rsi";
    else if (strategy?.toLowerCase().includes("macd")) strategyKey = "macd";
    else if (strategy?.toLowerCase().includes("breakout")) strategyKey = "breakout";
    
    if (!strategyKey || !this.performanceStats[strategyKey]) return;
    
    const stats = this.performanceStats[strategyKey];
    stats.totalTrades++;
    
    if (result === "WIN" || pnl > 0) {
      stats.wins++;
    } else {
      stats.losses++;
    }
    
    stats.winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;
    
    // 🆕 COMPARTILHA APRENDIZADO A CADA 10 TRADES
    if (stats.totalTrades % 10 === 0 && stats.totalTrades > 0) {
      this.shareLearning(strategyKey, stats.winRate, stats.totalTrades);
    }
    
    logger.debug(`Strategy ${strategyKey} performance: ${stats.winRate.toFixed(1)}% (${stats.wins}/${stats.totalTrades})`, { service: "Strategy" });
  }

  // 🆕 COMPARTILHA APRENDIZADO COM LEARNING BRAIN
  shareLearning(strategyKey, winRate, totalTrades) {
    const insight = {
      agentId: this.agentId,
      type: "strategy_performance",
      content: `Estratégia ${strategyKey} tem ${winRate.toFixed(0)}% de acerto após ${totalTrades} trades`,
      confidence: winRate / 100,
      priority: winRate > 65 ? "high" : winRate < 40 ? "high" : "normal",
      data: {
        strategy: strategyKey,
        winRate: winRate,
        totalTrades: totalTrades,
        config: this.config
      }
    };
    
    eventBus.emit(`learning:${this.agentId}`, insight);
    logger.info(`📤 StrategyService compartilhou: ${insight.content}`, { service: "Strategy" });
  }

  // 🆕 ANALISA TODAS AS ESTRATÉGIAS E RETORNA CONSENSO
  analyzeAll(symbol) {
    const results = [];
    
    for (const name of this.activeStrategies) {
      try {
        const strategy = this.strategies[name];
        if (strategy && typeof strategy.analyze === 'function') {
          let result = strategy.analyze(symbol);
          
          if (result && this.config.adjustSensitivity !== 1.0) {
            // Ajusta confiança baseado na sensibilidade
            result.confidence = Math.min(95, result.confidence * this.config.adjustSensitivity);
          }
          
          results.push(result);
        }
      } catch (err) {
        logger.error(`Erro ao analisar estratégia ${name}: ${err.message}`, { service: "Strategy" });
      }
    }
    
    return results.filter(Boolean);
  }

  // 🆕 OBTÉM SINAL DE CONSENSO (se houver)
  getConsensusSignal(symbol) {
    const results = this.analyzeAll(symbol);
    if (results.length === 0) return null;
    
    const buys = results.filter(r => r.signal === "BUY");
    const sells = results.filter(r => r.signal === "SELL");
    
    // Se requer consenso e não há unanimidade, retorna null
    if (this.config.requireConsensus && buys.length > 0 && sells.length > 0) {
      return null;
    }
    
    if (buys.length > sells.length) {
      const avgConfidence = buys.reduce((sum, r) => sum + (r.confidence || 50), 0) / buys.length;
      return {
        signal: "BUY",
        confidence: Math.min(95, Math.round(avgConfidence)),
        strategies: buys.map(r => r.strategy),
        consensusCount: buys.length
      };
    } else if (sells.length > buys.length) {
      const avgConfidence = sells.reduce((sum, r) => sum + (r.confidence || 50), 0) / sells.length;
      return {
        signal: "SELL",
        confidence: Math.min(95, Math.round(avgConfidence)),
        strategies: sells.map(r => r.strategy),
        consensusCount: sells.length
      };
    }
    
    return null;
  }

  getActiveStrategies() { 
    return this.activeStrategies; 
  }
  
  setActiveStrategies(strategies) { 
    this.activeStrategies = strategies; 
    db.updateConfig({ activeStrategies: strategies });
    logger.info(`Active strategies updated: ${strategies.join(", ")}`, { service: "Strategy" });
  }
  
  getConfig() { 
    return { ...db.getConfig(), strategyConfig: this.config }; 
  }

  // 🆕 OBTÉM ESTATÍSTICAS DE PERFORMANCE
  getPerformanceStats() {
    return this.performanceStats;
  }

  // 🆕 OBTÉM STATUS COMPLETO
  getStatus() {
    return {
      running: this.isRunning,
      activeStrategies: this.activeStrategies,
      config: this.config,
      performance: this.performanceStats,
      totalSignalsGenerated: Object.values(this.performanceStats).reduce((sum, s) => sum + s.totalTrades, 0)
    };
  }

  // 🆕 RESETA ESTATÍSTICAS
  resetStats() {
    for (const key of Object.keys(this.performanceStats)) {
      this.performanceStats[key] = { wins: 0, losses: 0, totalTrades: 0, winRate: 0, lastSignal: null };
    }
    logger.info("StrategyService statistics reset", { service: "Strategy" });
    return { success: true };
  }

  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("StrategyService config updated", { service: "Strategy", config: this.config });
    return { success: true, config: this.config };
  }

  start() {
    this.isRunning = true;
    logger.info("StrategyService started", { service: "Strategy" });
    return { success: true };
  }

  stop() {
    this.isRunning = false;
    logger.info("StrategyService stopped", { service: "Strategy" });
    return { success: true };
  }
}

module.exports = new StrategyService();
