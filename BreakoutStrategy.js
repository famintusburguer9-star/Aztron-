const marketData = require("./MarketDataService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class BreakoutStrategy {
  constructor() {
    this.name = "Breakout";
    this.agentId = "breakout";
    this._levels = {};
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    
    // Configurações ajustáveis
    this.config = {
      minConfidence: 55,
      sensitivityMultiplier: 1.0,
      lookbackPeriods: 3,
      requireVolumeConfirm: false
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.strategy?.toLowerCase().includes("breakout")) {
        this.learnFromTrade(trade);
      }
    });
    
    logger.info("BreakoutStrategy initialized", { service: "BreakoutStrategy" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 BreakoutStrategy recebeu melhoria: ${improvement.recommendation}`, { service: "BreakoutStrategy" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.sensitivityMultiplier = Math.min(1.5, this.config.sensitivityMultiplier * 1.15);
        this.config.minConfidence = Math.max(40, this.config.minConfidence - 5);
        logger.info(`⚡ BreakoutStrategy aumentou sensibilidade: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%`, { service: "BreakoutStrategy" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.sensitivityMultiplier = Math.max(0.5, this.config.sensitivityMultiplier * 0.85);
        this.config.minConfidence = Math.min(75, this.config.minConfidence + 5);
        logger.info(`📉 BreakoutStrategy reduziu risco: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%`, { service: "BreakoutStrategy" });
        break;
        
      case "REQUERER_CONFIRMACAO_VOLUME":
        this.config.requireVolumeConfirm = true;
        logger.info(`📊 BreakoutStrategy: confirmação de volume ativada`, { service: "BreakoutStrategy" });
        break;
    }
    
    // Reseta após 1 hora
    setTimeout(() => {
      this.config.sensitivityMultiplier = 1.0;
      this.config.minConfidence = 55;
      logger.info(`🔄 BreakoutStrategy resetou ajustes temporários`, { service: "BreakoutStrategy" });
    }, 3600000);
  }

  // 🆕 APRENDE COM TRADES FECHADOS
  learnFromTrade(trade) {
    this.performance.totalSignals++;
    
    if (trade.result === "WIN" || trade.pnl > 0) {
      this.performance.wins++;
    } else {
      this.performance.losses++;
    }
    
    this.performance.winRate = this.performance.totalSignals > 0 
      ? (this.performance.wins / this.performance.totalSignals) * 100 
      : 0;
    
    // Compartilha aprendizado a cada 10 trades
    if (this.performance.totalSignals % 10 === 0 && this.performance.totalSignals > 0) {
      this.shareLearning();
    }
    
    logger.debug(`BreakoutStrategy performance: ${this.performance.winRate.toFixed(1)}% (${this.performance.wins}/${this.performance.totalSignals})`, { service: "BreakoutStrategy" });
  }

  // 🆕 COMPARTILHA APRENDIZADO
  shareLearning() {
    const insight = {
      agentId: this.agentId,
      type: "strategy_performance",
      content: `BreakoutStrategy tem ${this.performance.winRate.toFixed(0)}% de acerto após ${this.performance.totalSignals} sinais`,
      confidence: this.performance.winRate / 100,
      priority: this.performance.winRate > 65 ? "high" : "normal",
      data: {
        strategy: this.name,
        winRate: this.performance.winRate,
        totalSignals: this.performance.totalSignals,
        config: this.config
      }
    };
    
    eventBus.emit(`learning:${this.agentId}`, insight);
    logger.info(`📤 BreakoutStrategy compartilhou: ${insight.content}`, { service: "BreakoutStrategy" });
  }

  analyze(symbol) {
    const ind = marketData.getIndicators(symbol);
    if (!ind) return null;
    
    const price = ind.price || 0;
    const volume = ind.volume || 0;
    const avgVolume = ind.avgVolume || volume;
    
    // Bollinger Bands
    const bb_upper = ind.bb_upper || price * 1.02;
    const bb_lower = ind.bb_lower || price * 0.98;
    const bb_mid = ind.bb_mid || price;
    
    // Inicializa níveis
    if (!this._levels[symbol]) {
      this._levels[symbol] = { upper: bb_upper, lower: bb_lower, history: [] };
    }
    
    const prev = this._levels[symbol];
    
    // Mantém histórico para confirmação
    prev.history.push({ upper: bb_upper, lower: bb_lower, price, timestamp: Date.now() });
    if (prev.history.length > this.config.lookbackPeriods) prev.history.shift();
    
    // Atualiza níveis atuais
    this._levels[symbol] = { ...prev, upper: bb_upper, lower: bb_lower };
    
    // 🔥 VERIFICA VOLUME (se necessário)
    const volumeConfirmed = !this.config.requireVolumeConfirm || volume > avgVolume * 1.2;
    
    // 🔥 BREAKOUT ACIMA (BUY)
    if (price > prev.upper && prev.upper > 0) {
      // Ajusta confiança com sensibilidade
      let confidence = 65 + ((price - prev.upper) / prev.upper) * 1000;
      confidence = confidence * this.config.sensitivityMultiplier;
      
      if (!volumeConfirmed) confidence *= 0.8;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = volumeConfirmed 
          ? `Breakout above Bollinger upper band ($${prev.upper.toFixed(2)}) with volume confirmation. Strong momentum detected.`
          : `Breakout above Bollinger upper band ($${prev.upper.toFixed(2)}). Volume below average, confirmation needed.`;
        
        return {
          signal: "BUY",
          symbol,
          strategy: this.name,
          price,
          confidence: finalConfidence,
          reason,
          metadata: {
            breakoutLevel: prev.upper,
            volumeConfirmed,
            sensitivityMultiplier: this.config.sensitivityMultiplier
          }
        };
      }
    }
    
    // 🔥 BREAKDOWN ABAIXO (SELL)
    if (price < prev.lower && prev.lower > 0) {
      let confidence = 65 + ((prev.lower - price) / prev.lower) * 1000;
      confidence = confidence * this.config.sensitivityMultiplier;
      
      if (!volumeConfirmed) confidence *= 0.8;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = volumeConfirmed
          ? `Breakdown below Bollinger lower band ($${prev.lower.toFixed(2)}) with volume confirmation. Downward momentum detected.`
          : `Breakdown below Bollinger lower band ($${prev.lower.toFixed(2)}). Volume below average, confirmation needed.`;
        
        return {
          signal: "SELL",
          symbol,
          strategy: this.name,
          price,
          confidence: finalConfidence,
          reason,
          metadata: {
            breakoutLevel: prev.lower,
            volumeConfirmed,
            sensitivityMultiplier: this.config.sensitivityMultiplier
          }
        };
      }
    }
    
    return null;
  }

  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      name: this.name,
      config: this.config,
      performance: this.performance,
      activeLevels: Object.keys(this._levels).length
    };
  }

  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("BreakoutStrategy config updated", { service: "BreakoutStrategy", config: this.config });
    return { success: true, config: this.config };
  }

  // 🆕 RESETA PERFORMANCE
  resetPerformance() {
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    logger.info("BreakoutStrategy performance reset", { service: "BreakoutStrategy" });
    return { success: true };
  }
}

module.exports = new BreakoutStrategy();
