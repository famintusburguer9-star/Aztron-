const marketData = require("./MarketDataService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class RsiStrategy {
  constructor() {
    this.name = "RSI Strategy";
    this.agentId = "rsi";
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    this._lastRsi = {};
    this._signalHistory = {};
    
    // 🆕 CONFIGURAÇÕES AJUSTÁVEIS
    this.config = {
      minConfidence: 55,
      sensitivityMultiplier: 1.0,
      obLevel: 70,
      osLevel: 30,
      extremeObLevel: 85,
      extremeOsLevel: 15,
      requireConfirmation: false,
      confirmationBars: 2
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.strategy?.toLowerCase().includes("rsi")) {
        this.learnFromTrade(trade);
      }
    });
    
    logger.info("RsiStrategy initialized", { service: "RsiStrategy" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 RsiStrategy recebeu melhoria: ${improvement.recommendation}`, { service: "RsiStrategy" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.sensitivityMultiplier = Math.min(1.5, this.config.sensitivityMultiplier * 1.15);
        this.config.minConfidence = Math.max(40, this.config.minConfidence - 5);
        this.config.osLevel = Math.max(20, this.config.osLevel - 3);
        this.config.obLevel = Math.min(80, this.config.obLevel + 3);
        logger.info(`⚡ RsiStrategy aumentou sensibilidade: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%, OS=${this.config.osLevel}, OB=${this.config.obLevel}`, { service: "RsiStrategy" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.sensitivityMultiplier = Math.max(0.5, this.config.sensitivityMultiplier * 0.85);
        this.config.minConfidence = Math.min(75, this.config.minConfidence + 5);
        this.config.osLevel = Math.min(35, this.config.osLevel + 3);
        this.config.obLevel = Math.max(65, this.config.obLevel - 3);
        logger.info(`📉 RsiStrategy reduziu risco: ${this.config.sensitivityMultiplier}x, minConf=${this.config.minConfidence}%, OS=${this.config.osLevel}, OB=${this.config.obLevel}`, { service: "RsiStrategy" });
        break;
        
      case "REQUERER_CONFIRMACAO":
        this.config.requireConfirmation = true;
        this.config.confirmationBars = 2;
        logger.info(`📊 RsiStrategy: confirmação de ${this.config.confirmationBars} candles ativada`, { service: "RsiStrategy" });
        break;
    }
    
    // Reseta após 1 hora
    setTimeout(() => {
      this.config.sensitivityMultiplier = 1.0;
      this.config.minConfidence = 55;
      this.config.osLevel = 30;
      this.config.obLevel = 70;
      this.config.requireConfirmation = false;
      logger.info(`🔄 RsiStrategy resetou ajustes temporários`, { service: "RsiStrategy" });
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
    
    logger.debug(`RsiStrategy performance: ${this.performance.winRate.toFixed(1)}% (${this.performance.wins}/${this.performance.totalSignals})`, { service: "RsiStrategy" });
  }

  // 🆕 COMPARTILHA APRENDIZADO
  shareLearning() {
    const insight = {
      agentId: this.agentId,
      type: "strategy_performance",
      content: `RsiStrategy tem ${this.performance.winRate.toFixed(0)}% de acerto após ${this.performance.totalSignals} sinais`,
      confidence: this.performance.winRate / 100,
      priority: this.performance.winRate > 65 ? "high" : "normal",
      data: {
        strategy: this.name,
        winRate: this.performance.winRate,
        totalSignals: this.performance.totalSignals,
        config: {
          obLevel: this.config.obLevel,
          osLevel: this.config.osLevel,
          sensitivityMultiplier: this.config.sensitivityMultiplier
        }
      }
    };
    
    eventBus.emit(`learning:${this.agentId}`, insight);
    logger.info(`📤 RsiStrategy compartilhou: ${insight.content}`, { service: "RsiStrategy" });
  }

  // 🆕 VERIFICA CONFIRMAÇÃO (RSI permanece na zona)
  _isConfirmed(symbol, rsi, isOversold, isOverbought) {
    if (!this.config.requireConfirmation) return true;
    
    if (!this._signalHistory[symbol]) {
      this._signalHistory[symbol] = [];
    }
    
    this._signalHistory[symbol].push({ rsi, isOversold, isOverbought, timestamp: Date.now() });
    
    // Mantém apenas últimos N registros
    if (this._signalHistory[symbol].length > this.config.confirmationBars + 2) {
      this._signalHistory[symbol].shift();
    }
    
    if (isOversold) {
      // Verifica se RSI continuou baixo nas últimas candles
      const recent = this._signalHistory[symbol].slice(-this.config.confirmationBars);
      const allOversold = recent.every(s => s.isOversold);
      return allOversold && recent.length >= this.config.confirmationBars;
    }
    
    if (isOverbought) {
      const recent = this._signalHistory[symbol].slice(-this.config.confirmationBars);
      const allOverbought = recent.every(s => s.isOverbought);
      return allOverbought && recent.length >= this.config.confirmationBars;
    }
    
    return true;
  }

  analyze(symbol) {
    const cfg = db.getConfig();
    const ind = marketData.getIndicators(symbol);
    if (!ind) return null;
    
    const rsi = ind.rsi || 50;
    const price = ind.price || 0;
    
    // Usa configurações locais ou do banco
    const ob = this.config.obLevel;
    const os = this.config.osLevel;
    const extremeOb = this.config.extremeObLevel;
    const extremeOs = this.config.extremeOsLevel;
    
    const isOversold = rsi < os;
    const isExtremeOversold = rsi < extremeOs;
    const isOverbought = rsi > ob;
    const isExtremeOverbought = rsi > extremeOb;
    
    // Verifica confirmação
    const confirmed = this._isConfirmed(symbol, rsi, isOversold, isOverbought);
    
    // 🔥 SINAL DE COMPRA (OVERSOLD)
    if (isOversold && confirmed) {
      // Quanto mais oversold, maior a confiança
      let confidence = 65 + (os - rsi) * 1.2;
      
      if (isExtremeOversold) {
        confidence += 15;
      }
      
      // Aplica sensibilidade
      confidence = confidence * this.config.sensitivityMultiplier;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = isExtremeOversold
          ? `RSI=${rsi.toFixed(1)} EXTREME OVERSOLD (threshold: ${os}). Strong mean reversion expected.`
          : `RSI=${rsi.toFixed(1)} oversold (threshold: ${os}). Mean reversion expected.`;
        
        return {
          signal: "BUY",
          symbol,
          strategy: this.name,
          price,
          rsi: Math.round(rsi),
          confidence: finalConfidence,
          reason,
          metadata: {
            rsi,
            osThreshold: os,
            extremeOsThreshold: extremeOs,
            isExtreme: isExtremeOversold,
            confirmed: this.config.requireConfirmation,
            sensitivityMultiplier: this.config.sensitivityMultiplier
          }
        };
      }
    }
    
    // 🔥 SINAL DE VENDA (OVERBOUGHT)
    if (isOverbought && confirmed) {
      let confidence = 65 + (rsi - ob) * 1.2;
      
      if (isExtremeOverbought) {
        confidence += 15;
      }
      
      confidence = confidence * this.config.sensitivityMultiplier;
      
      const finalConfidence = Math.min(92, Math.max(35, Math.round(confidence)));
      
      if (finalConfidence >= this.config.minConfidence) {
        const reason = isExtremeOverbought
          ? `RSI=${rsi.toFixed(1)} EXTREME OVERBOUGHT (threshold: ${ob}). Strong pullback expected.`
          : `RSI=${rsi.toFixed(1)} overbought (threshold: ${ob}). Pullback expected.`;
        
        return {
          signal: "SELL",
          symbol,
          strategy: this.name,
          price,
          rsi: Math.round(rsi),
          confidence: finalConfidence,
          reason,
          metadata: {
            rsi,
            obThreshold: ob,
            extremeObThreshold: extremeOb,
            isExtreme: isExtremeOverbought,
            confirmed: this.config.requireConfirmation,
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
      activeSymbols: Object.keys(this._lastRsi).length
    };
  }

  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("RsiStrategy config updated", { service: "RsiStrategy", config: this.config });
    return { success: true, config: this.config };
  }

  // 🆕 RESETA PERFORMANCE
  resetPerformance() {
    this.performance = { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    this._signalHistory = {};
    logger.info("RsiStrategy performance reset", { service: "RsiStrategy" });
    return { success: true };
  }
}

module.exports = new RsiStrategy();
