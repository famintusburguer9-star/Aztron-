const marketData = require("./MarketDataService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class MacdStrategy {
  constructor() {
    this.name = "MACD";
    this.agentId = "macd";
    this._lastHist = {};
    this._lastSignal = {};
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    
    // Configurações ajustáveis
    this.config = {
      minConfidence: 55,
      sensitivityMultiplier: 1.0,
      minHistogramStrength: 0.0005,
      requireConfirmation: false,
      confirmationBars: 2
    };
    
    // Histórico de sinais para confirmação
    this._signalHistory = {};
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.strategy?.toLowerCase().includes("macd")) {
        this.learnFromTrade(trade);
      }
    });
    
    logger.info("MacdStrategy initialized", { service: "MacdStrategy" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 MacdStrategy recebeu melhoria: ${improvement.recommendation}`, { service: "MacdStrategy" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.sensitivityMultiplier = Math.min(1.5, this.config.sensitivityMultiplier * 1.15);
        this.config.minConfidence = Math.max(40, this.config.minConfidence - 5);
        this.config.minHistogramStrength = Math.max(0.0001, this.config.minHistogramStrength * 0.8);
        logger.info(`⚡ MacdStrategy aumentou sensibilidade: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%, minHist=${this.config.minHistogramStrength}`, { service: "MacdStrategy" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.sensitivityMultiplier = Math.max(0.5, this.config.sensitivityMultiplier * 0.85);
        this.config.minConfidence = Math.min(75, this.config.minConfidence + 5);
        this.config.minHistogramStrength = Math.min(0.002, this.config.minHistogramStrength * 1.2);
        logger.info(`📉 MacdStrategy reduziu risco: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%, minHist=${this.config.minHistogramStrength}`, { service: "MacdStrategy" });
        break;
        
      case "REQUERER_CONFIRMACAO":
        this.config.requireConfirmation = true;
        this.config.confirmationBars = 3;
        logger.info(`📊 MacdStrategy: confirmação de ${this.config.confirmationBars} candles ativada`, { service: "MacdStrategy" });
        break;
    }
    
    // Reseta após 1 hora
    setTimeout(() => {
      this.config.sensitivityMultiplier = 1.0;
      this.config.minConfidence = 55;
      this.config.minHistogramStrength = 0.0005;
      this.config.requireConfirmation = false;
      logger.info(`🔄 MacdStrategy resetou ajustes temporários`, { service: "MacdStrategy" });
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
    
    logger.debug(`MacdStrategy performance: ${this.performance.winRate.toFixed(1)}% (${this.performance.wins}/${this.performance.totalSignals})`, { service: "MacdStrategy" });
  }

  // 🆕 COMPARTILHA APRENDIZADO
  shareLearning() {
    const insight = {
      agentId: this.agentId,
      type: "strategy_performance",
      content: `MacdStrategy tem ${this.performance.winRate.toFixed(0)}% de acerto após ${this.performance.totalSignals} sinais`,
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
    logger.info(`📤 MacdStrategy compartilhou: ${insight.content}`, { service: "MacdStrategy" });
  }

  analyze(symbol) {
    const ind = marketData.getIndicators(symbol);
    if (!ind) return null;
    
    const price = ind.price || 0;
    const hist = ind.macdHist || 0;
    const macdLine = ind.macdLine || 0;
    const signalLine = ind.signalLine || 0;
    
    const prevHist = this._lastHist[symbol] || 0;
    this._lastHist[symbol] = hist;
    
    // Calcula força do sinal ajustada pela sensibilidade
    const strength = Math.abs(hist) * (1 / this.config.minHistogramStrength) * this.config.sensitivityMultiplier;
    
    // Detecção de cruzamentos
    const crossedUp = prevHist < 0 && hist >= 0;
    const crossedDown = prevHist > 0 && hist <= 0;
    
    // 🔥 VERIFICA CONFIRMAÇÃO (se necessário)
    let isConfirmed = true;
    if (this.config.requireConfirmation && (crossedUp || crossedDown)) {
      if (!this._signalHistory[symbol]) {
        this._signalHistory[symbol] = [];
      }
      
      this._signalHistory[symbol].push({ 
        hist, 
        crossedUp, 
        crossedDown, 
        timestamp: Date.now() 
      });
      
      // Mantém apenas últimos N candles
      if (this._signalHistory[symbol].length > this.config.confirmationBars) {
        this._signalHistory[symbol].shift();
      }
      
      // Verifica se o sinal se manteve
      const recentSignals = this._signalHistory[symbol];
      if (crossedUp) {
        const allBullish = recentSignals.every(s => s.hist >= 0);
        isConfirmed = allBullish && recentSignals.length >= this.config.confirmationBars;
      } else if (crossedDown) {
        const allBearish = recentSignals.every(s => s.hist <= 0);
        isConfirmed = allBearish && recentSignals.length >= this.config.confirmationBars;
      }
    }
    
    // 🔥 CRUZAMENTO DE ALTA (BUY)
    if (crossedUp && strength >= this.config.minHistogramStrength && isConfirmed) {
      let confidence = 60 + (strength * 50);
      confidence = confidence * this.config.sensitivityMultiplier;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = this.config.requireConfirmation
          ? `MACD histogram bullish crossover confirmed over ${this.config.confirmationBars} candles. Hist: ${hist.toFixed(6)}`
          : `MACD histogram bullish crossover. Hist: ${hist.toFixed(6)} (prev: ${prevHist.toFixed(6)}).`;
        
        return {
          signal: "BUY",
          symbol,
          strategy: this.name,
          price,
          confidence: finalConfidence,
          reason,
          metadata: {
            hist,
            prevHist,
            strength: strength.toFixed(4),
            sensitivityMultiplier: this.config.sensitivityMultiplier,
            confirmed: this.config.requireConfirmation
          }
        };
      }
    }
    
    // 🔥 CRUZAMENTO DE BAIXA (SELL)
    if (crossedDown && strength >= this.config.minHistogramStrength && isConfirmed) {
      let confidence = 60 + (strength * 50);
      confidence = confidence * this.config.sensitivityMultiplier;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = this.config.requireConfirmation
          ? `MACD histogram bearish crossover confirmed over ${this.config.confirmationBars} candles. Hist: ${hist.toFixed(6)}`
          : `MACD histogram bearish crossover. Hist: ${hist.toFixed(6)} (prev: ${prevHist.toFixed(6)}).`;
        
        return {
          signal: "SELL",
          symbol,
          strategy: this.name,
          price,
          confidence: finalConfidence,
          reason,
          metadata: {
            hist,
            prevHist,
            strength: strength.toFixed(4),
            sensitivityMultiplier: this.config.sensitivityMultiplier,
            confirmed: this.config.requireConfirmation
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
      activeSymbols: Object.keys(this._lastHist).length
    };
  }

  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("MacdStrategy config updated", { service: "MacdStrategy", config: this.config });
    return { success: true, config: this.config };
  }

  // 🆕 RESETA PERFORMANCE
  resetPerformance() {
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    this._signalHistory = {};
    logger.info("MacdStrategy performance reset", { service: "MacdStrategy" });
    return { success: true };
  }
}

module.exports = new MacdStrategy();
