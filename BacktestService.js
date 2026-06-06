const db = require("./DatabaseService");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const marketData = require("./MarketDataService");

class BacktestService {
  constructor() {
    this.results = [];
    this.running = false;
    this.agentId = "backtest";
    
    // 🆕 ESCUTA MELHORIAS
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("BacktestService initialized", { service: "Backtest" });
  }

  applyImprovement(improvement) {
    logger.info(`🧠 Backtest recebeu melhoria: ${improvement.recommendation}`, { service: "Backtest" });
  }

  async run({ pair, strategy, initialBalance, days = 30, useRealData = false }) {
    if (this.running) return { success: false, reason: "Backtest already running" };
    this.running = true;

    const startTime = Date.now();
    
    let result;
    if (useRealData) {
      result = await this._runWithRealData(pair, strategy, initialBalance, days);
    } else {
      result = this._runSimulated(pair, strategy, initialBalance, days);
    }
    
    result.duration = Date.now() - startTime;
    result.timestamp = new Date().toISOString();
    
    this.results.unshift(result);
    if (this.results.length > 50) this.results.length = 50;
    this.running = false;

    // 🆕 COMPARTILHA RESULTADO
    eventBus.emit(`learning:${this.agentId}`, {
      type: "backtest_complete",
      content: `${pair}/${strategy} - WR ${result.winRate}%`,
      confidence: result.winRate / 100,
      data: result
    });

    logger.info(`Backtest complete: ${pair}/${strategy} — WR ${result.winRate}% | Approved: ${result.approved}`, { service: "Backtest" });
    return { success: true, result };
  }

  _runSimulated(pair, strategy, initialBalance, days) {
    // Simulação mais realista baseada em volatilidade do mercado
    const volatility = this._getVolatilityForPair(pair);
    const trendBias = Math.random() > 0.5 ? 0.02 : -0.01;
    
    let winRate = 45 + (Math.random() * 40);
    let pnlPercent = (Math.random() - 0.45) * 0.25 * volatility;
    let pnl = initialBalance * pnlPercent;
    let sharpe = 0.8 + Math.random() * 2;
    let drawdown = -(2 + Math.random() * 10);
    let trades = Math.floor(20 + Math.random() * 180);
    
    // Ajustes baseados na estratégia
    if (strategy === "RSI") {
      winRate = Math.min(85, winRate + 5);
      trades = Math.floor(trades * 0.8);
    } else if (strategy === "MACD") {
      winRate = Math.min(80, winRate + 3);
      trades = Math.floor(trades * 0.9);
    } else if (strategy === "BREAKOUT") {
      winRate = winRate - 5;
      trades = Math.floor(trades * 1.2);
      pnl = pnl * 1.3;
    }
    
    winRate = Math.min(95, Math.max(25, winRate));
    const approved = winRate > 58 && sharpe > 1.1 && drawdown > -8;

    return {
      id: `bt_${Date.now()}`,
      pair, strategy, initialBalance,
      winRate: Math.round(winRate * 10) / 10,
      pnl: Math.round(pnl * 100) / 100,
      sharpe: Math.round(sharpe * 100) / 100,
      drawdown: Math.round(drawdown * 10) / 10,
      totalTrades: trades,
      approved,
      days,
      type: "simulated",
      volatility: volatility
    };
  }

  async _runWithRealData(pair, strategy, initialBalance, days) {
    // Usa dados reais do MarketDataService
    const indicators = marketData.getIndicators(pair);
    if (!indicators) {
      return this._runSimulated(pair, strategy, initialBalance, days);
    }
    
    // Simula baseado em dados reais
    const volatility = indicators.volatility || 1;
    const trend = indicators.trend || "sideways";
    
    let winRate = 50;
    if (trend === "bullish") winRate += 10;
    else if (trend === "bearish") winRate -= 5;
    
    winRate = winRate + (Math.random() * 20) - 10;
    winRate = Math.min(90, Math.max(30, winRate));
    
    const pnlPercent = (winRate - 50) / 100 * volatility;
    const pnl = initialBalance * pnlPercent;
    
    return {
      id: `bt_${Date.now()}`,
      pair, strategy, initialBalance,
      winRate: Math.round(winRate * 10) / 10,
      pnl: Math.round(pnl * 100) / 100,
      sharpe: Math.round((1 + Math.random() * 2) * 100) / 100,
      drawdown: Math.round(-(2 + Math.random() * 8) * 10) / 10,
      totalTrades: Math.floor(50 + Math.random() * 150),
      approved: winRate > 60,
      days,
      type: "real_data",
      marketTrend: trend,
      volatility: volatility
    };
  }

  _getVolatilityForPair(pair) {
    const volatilities = {
      BTCUSDT: 0.6,
      ETHUSDT: 0.7,
      BNBUSDT: 0.65,
      SOLUSDT: 0.9,
      XRPUSDT: 0.8
    };
    return volatilities[pair] || 0.5;
  }

  getResults(limit = 10) { 
    return this.results.slice(0, limit); 
  }
  
  isRunning() { 
    return this.running; 
  }
  
  getStats() {
    const approved = this.results.filter(r => r.approved).length;
    return {
      totalRuns: this.results.length,
      approved: approved,
      approvalRate: this.results.length > 0 ? (approved / this.results.length) * 100 : 0,
      lastRun: this.results[0] || null
    };
  }
  
  clearResults() {
    this.results = [];
    logger.info("Backtest results cleared", { service: "Backtest" });
    return { success: true };
  }
}

module.exports = new BacktestService();
