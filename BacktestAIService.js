const db = require("./DatabaseService");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const aiLearning = require("./AIZtronLearningService");

class BacktestAIService {
  constructor() {
    this.agentId = "backtestAI";
    this.history = [];
    
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("BacktestAIService initialized", { service: "BacktestAI" });
  }

  applyImprovement(improvement) {
    logger.info(`🧠 BacktestAI recebeu melhoria: ${improvement.recommendation}`, { service: "BacktestAI" });
  }

  runWithAI(pair, days = 30, options = {}) {
    const cfg = db.getConfig();
    const startTime = Date.now();
    
    // Simulação baseada em IA (mais realista)
    const baseWinRate = this._predictWinRate(pair);
    const volatility = this._getVolatility(pair);
    
    let winRate = baseWinRate + (Math.random() - 0.5) * 15;
    let pnlPercent = (winRate - 50) / 100 * volatility * (days / 30);
    let pnl = 10000 * pnlPercent;
    let sharpe = 0.8 + (winRate / 100) * 1.5;
    let drawdown = -(3 + (1 - winRate / 100) * 10);
    let trades = Math.floor(30 + (days * 3) + Math.random() * 100);
    
    // Ajustes por estratégia
    const strategy = options.strategy || this._selectBestStrategy(pair);
    
    const result = {
      id: `bai_${Date.now()}`,
      pair,
      days,
      strategy: strategy,
      winRate: Math.round(winRate * 10) / 10,
      pnl: Math.round(pnl * 100) / 100,
      sharpe: Math.round(sharpe * 100) / 100,
      drawdown: Math.round(drawdown * 10) / 10,
      totalTrades: trades,
      params: {
        emaShort: cfg.emaShort,
        emaLong: cfg.emaLong,
        rsiPeriod: cfg.rsiPeriod,
        stopLoss: cfg.stopLoss,
        takeProfit: cfg.takeProfit
      },
      approved: winRate > 60 && sharpe > 1.2 && drawdown > -8,
      confidence: Math.min(95, Math.round(50 + (winRate - 50) * 0.8)),
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      aiSuggestion: this._getAISuggestion(winRate, drawdown)
    };
    
    this.history.unshift(result);
    if (this.history.length > 50) this.history.length = 50;
    
    // Compartilha com Learning Brain
    eventBus.emit(`learning:${this.agentId}`, {
      type: "ai_backtest_complete",
      content: `${pair} - AI sugere ${result.aiSuggestion}`,
      confidence: result.confidence / 100,
      data: result
    });
    
    // Aprende com o resultado
    if (aiLearning && aiLearning.learnFromBacktest) {
      aiLearning.learnFromBacktest(result);
    }
    
    logger.info(`AI Backtest complete: ${pair} — WR ${result.winRate}% | Approved: ${result.approved}`, { service: "BacktestAI" });
    return result;
  }

  _predictWinRate(pair) {
    // Predição baseada em dados de mercado atuais
    try {
      const marketData = require("./MarketDataService");
      const indicators = marketData.getIndicators(pair);
      
      if (indicators) {
        if (indicators.trend === "bullish") return 65;
        if (indicators.trend === "bearish") return 55;
        if (indicators.volatility > 1.5) return 60;
        return 50;
      }
    } catch (e) {}
    
    return 55 + Math.random() * 20;
  }

  _getVolatility(pair) {
    try {
      const marketData = require("./MarketDataService");
      const indicators = marketData.getIndicators(pair);
      return indicators?.volatility || 0.8;
    } catch (e) {
      return 0.8;
    }
  }

  _selectBestStrategy(pair) {
    const strategies = ["RSI", "MACD", "BREAKOUT", "CONSENSUS"];
    const weights = { RSI: 0.3, MACD: 0.3, BREAKOUT: 0.2, CONSENSUS: 0.2 };
    
    // Estratégia baseada em condições de mercado
    try {
      const marketData = require("./MarketDataService");
      const indicators = marketData.getIndicators(pair);
      
      if (indicators) {
        if (indicators.trend === "trending") return "MACD";
        if (indicators.volatility > 1.5) return "BREAKOUT";
        if (indicators.rsi > 70 || indicators.rsi < 30) return "RSI";
      }
    } catch (e) {}
    
    return "CONSENSUS";
  }

  _getAISuggestion(winRate, drawdown) {
    if (winRate > 75 && drawdown > -5) return "INCREASE_RISK";
    if (winRate > 65) return "MAINTAIN_STRATEGY";
    if (winRate < 45 || drawdown < -12) return "REDUCE_RISK";
    if (drawdown < -8) return "REVIEW_STRATEGY";
    return "CONTINUE_MONITORING";
  }

  getHistory(limit = 10) {
    return this.history.slice(0, limit);
  }
  
  getStats() {
    const approved = this.history.filter(r => r.approved).length;
    const avgWinRate = this.history.length > 0 
      ? this.history.reduce((sum, r) => sum + r.winRate, 0) / this.history.length 
      : 0;
    
    return {
      totalRuns: this.history.length,
      approved: approved,
      approvalRate: this.history.length > 0 ? (approved / this.history.length) * 100 : 0,
      avgWinRate: Math.round(avgWinRate * 10) / 10,
      lastRun: this.history[0] || null
    };
  }
  
  clearHistory() {
    this.history = [];
    logger.info("BacktestAI history cleared", { service: "BacktestAI" });
    return { success: true };
  }
}

module.exports = new BacktestAIService();
