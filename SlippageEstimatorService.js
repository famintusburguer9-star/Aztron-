const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class SlippageEstimatorService {
  constructor() {
    this.slippageHistory = [];
    this.avgSlippageBySymbol = {};
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "slippage";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      defaultSpread: 0.05,
      maxAcceptableSlippagePct: 0.3,
      highLiquidityThreshold: 100000,
      mediumLiquidityThreshold: 50000,
      highLiquidityImpactBps: 2,
      mediumLiquidityImpactBps: 1,
      lowLiquidityImpactBps: 5,
      trackHistory: true,
      maxHistorySize: 500
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA EXECUÇÃO DE ORDENS PARA REGISTRAR SLIPPAGE REAL
    eventBus.on("exchange:order", (order) => {
      if (order.status === "FILLED") {
        this.recordActualSlippage(order);
      }
    });
    
    logger.info("SlippageEstimatorService initialized", { service: "SlippageEstimator" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 SlippageEstimator recebeu melhoria: ${improvement.recommendation}`, { service: "SlippageEstimator" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.maxAcceptableSlippagePct = Math.min(0.5, this.config.maxAcceptableSlippagePct + 0.05);
        logger.info(`⚡ SlippageEstimator aumentou tolerância: ${this.config.maxAcceptableSlippagePct}%`, { service: "SlippageEstimator" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.maxAcceptableSlippagePct = Math.max(0.15, this.config.maxAcceptableSlippagePct - 0.05);
        logger.info(`📉 SlippageEstimator reduziu tolerância: ${this.config.maxAcceptableSlippagePct}%`, { service: "SlippageEstimator" });
        break;
    }
  }

  // 🆕 REGISTRA SLIPPAGE REAL
  recordActualSlippage(order) {
    if (!this.config.trackHistory) return;
    
    const { symbol, side, price, qty, expectedPrice } = order;
    const expectedPriceValue = expectedPrice || price;
    const actualPrice = price;
    
    const slippagePct = Math.abs((actualPrice - expectedPriceValue) / expectedPriceValue) * 100;
    
    const record = {
      id: `slip_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      symbol,
      side,
      qty,
      expectedPrice: expectedPriceValue,
      actualPrice,
      slippagePct: Math.round(slippagePct * 10000) / 10000,
      timestamp: new Date().toISOString(),
      notional: qty * actualPrice
    };
    
    this.slippageHistory.unshift(record);
    if (this.slippageHistory.length > this.config.maxHistorySize) {
      this.slippageHistory.pop();
    }
    
    // Atualiza média por símbolo
    if (!this.avgSlippageBySymbol[symbol]) {
      this.avgSlippageBySymbol[symbol] = { total: 0, count: 0, avg: 0 };
    }
    
    const stats = this.avgSlippageBySymbol[symbol];
    stats.total += slippagePct;
    stats.count++;
    stats.avg = stats.total / stats.count;
    
    logger.debug(`Slippage real para ${symbol}: ${slippagePct.toFixed(4)}% (média: ${stats.avg.toFixed(4)}%)`, { service: "SlippageEstimator" });
    
    // 🔥 COMPARTILHA COM LEARNING BRAIN se slippage for alto
    if (slippagePct > this.config.maxAcceptableSlippagePct) {
      eventBus.emit(`learning:${this.agentId}`, {
        type: "high_slippage",
        content: `${symbol} teve slippage de ${slippagePct.toFixed(2)}% (acima do aceitável)`,
        confidence: 0.85,
        priority: "high",
        data: record
      });
    }
  }

  estimate(symbol, side, qty) {
    const ticker = exchange.getTicker(symbol);
    if (!ticker) {
      return { 
        estimated: 0, 
        acceptable: true, 
        warning: "No ticker data available"
      };
    }
    
    const spread = ticker.spread || this.config.defaultSpread;
    const price = ticker.price;
    const notional = qty * price;
    
    // 🔥 CALCULA IMPACTO DE MERCADO BASEADO NO TAMANHO
    let impactBps = 0;
    if (notional > this.config.highLiquidityThreshold) {
      impactBps = this.config.highLiquidityImpactBps;
    } else if (notional > this.config.mediumLiquidityThreshold) {
      impactBps = this.config.mediumLiquidityImpactBps;
    } else {
      impactBps = this.config.lowLiquidityImpactBps;
    }
    
    // 🔥 AJUSTA BASEADO NO HISTÓRICO REAL
    const historicalAvg = this.avgSlippageBySymbol[symbol]?.avg || 0;
    const historicalAdjustment = historicalAvg * 0.5;
    
    const totalBps = (spread * 100) + impactBps + historicalAdjustment;
    const slippagePct = totalBps / 100;
    
    const acceptable = slippagePct < this.config.maxAcceptableSlippagePct;
    
    const result = {
      estimated: Math.round(slippagePct * 10000) / 10000,
      acceptable,
      spread,
      notional,
      impactBps: Math.round(impactBps * 100) / 100,
      historicalAvg: Math.round(historicalAvg * 10000) / 10000,
      warning: acceptable ? null : `Slippage estimado de ${slippagePct.toFixed(2)}% excede o limite de ${this.config.maxAcceptableSlippagePct}%`
    };
    
    return result;
  }

  getSymbolSlippage(symbol) {
    const ticker = exchange.getTicker(symbol);
    if (!ticker) return null;
    
    const historical = this.avgSlippageBySymbol[symbol];
    
    return {
      symbol,
      spread: ticker.spread,
      estimatedSlippage: ticker.spread * 0.5,
      historicalAvgSlippage: historical?.avg || null,
      samplesCount: historical?.count || 0,
      lastUpdated: new Date().toISOString()
    };
  }
  
  // 🆕 OBTÉM HISTÓRICO DE SLIPPAGE
  getSlippageHistory(symbol = null, limit = 50) {
    let history = this.slippageHistory;
    if (symbol) {
      history = history.filter(h => h.symbol === symbol);
    }
    return history.slice(0, limit);
  }
  
  // 🆕 OBTÉM ESTATÍSTICAS DE SLIPPAGE
  getStats() {
    const symbols = Object.keys(this.avgSlippageBySymbol);
    const totalSamples = this.slippageHistory.length;
    const highSlippageEvents = this.slippageHistory.filter(h => h.slippagePct > this.config.maxAcceptableSlippagePct).length;
    
    return {
      totalSamples,
      highSlippageEvents,
      highSlippageRate: totalSamples > 0 ? (highSlippageEvents / totalSamples) * 100 : 0,
      averageBySymbol: this.avgSlippageBySymbol,
      config: this.config,
      symbolsTracked: symbols.length
    };
  }
  
  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      running: this.isRunning,
      config: this.config,
      historySize: this.slippageHistory.length,
      stats: this.getStats(),
      agentId: this.agentId
    };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("SlippageEstimatorService config updated", { service: "SlippageEstimator", config: this.config });
    return { success: true, config: this.config };
  }
  
  // 🆕 RESETA HISTÓRICO
  resetHistory() {
    this.slippageHistory = [];
    this.avgSlippageBySymbol = {};
    logger.info("SlippageEstimatorService history reset", { service: "SlippageEstimator" });
    return { success: true };
  }
  
  start() {
    this.isRunning = true;
    logger.info("SlippageEstimatorService started", { service: "SlippageEstimator" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    logger.info("SlippageEstimatorService stopped", { service: "SlippageEstimator" });
    return { success: true };
  }
}

module.exports = new SlippageEstimatorService();
