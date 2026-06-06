const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class SpreadAnalyzerService {
  constructor() {
    this.spreadHistory = {};
    this.spreadAlerts = [];
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "spread_analyzer";
    
    // 🆕 CONFIGURAÇÕES AJUSTÁVEIS
    this.config = {
      normalThreshold: 0.1,      // 0.1% - spread normal
      wideThreshold: 0.3,        // 0.3% - spread largo
      abnormalThreshold: 0.5,    // 0.5% - spread anormal
      alertCooldownMs: 300000,   // 5 minutos entre alertas do mesmo símbolo
      trackHistory: true,
      maxHistorySize: 500
    };
    
    // 🆕 ÚLTIMO ALERTA POR SÍMBOLO (para cooldown)
    this._lastAlert = {};
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA TICKS PARA ATUALIZAR HISTÓRICO
    eventBus.on("tick", (prices) => {
      for (const [sym, data] of Object.entries(prices)) {
        this._updateHistory(sym, data);
      }
    });
    
    logger.info("SpreadAnalyzerService initialized", { service: "SpreadAnalyzer" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 SpreadAnalyzer recebeu melhoria: ${improvement.recommendation}`, { service: "SpreadAnalyzer" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.normalThreshold = Math.max(0.05, this.config.normalThreshold - 0.03);
        this.config.wideThreshold = Math.max(0.15, this.config.wideThreshold - 0.05);
        this.config.abnormalThreshold = Math.max(0.3, this.config.abnormalThreshold - 0.1);
        logger.info(`⚡ SpreadAnalyzer aumentou sensibilidade: normal=${this.config.normalThreshold}%, wide=${this.config.wideThreshold}%, abnormal=${this.config.abnormalThreshold}%`, { service: "SpreadAnalyzer" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.normalThreshold = Math.min(0.2, this.config.normalThreshold + 0.05);
        this.config.wideThreshold = Math.min(0.5, this.config.wideThreshold + 0.1);
        this.config.abnormalThreshold = Math.min(1.0, this.config.abnormalThreshold + 0.2);
        logger.info(`📉 SpreadAnalyzer reduziu sensibilidade: normal=${this.config.normalThreshold}%, wide=${this.config.wideThreshold}%, abnormal=${this.config.abnormalThreshold}%`, { service: "SpreadAnalyzer" });
        break;
    }
  }

  // 🆕 ATUALIZA HISTÓRICO DE SPREADS
  _updateHistory(symbol, ticker) {
    if (!this.config.trackHistory) return;
    
    const spread = ticker.spread || 0;
    
    if (!this.spreadHistory[symbol]) {
      this.spreadHistory[symbol] = [];
    }
    
    this.spreadHistory[symbol].unshift({
      spread,
      timestamp: Date.now(),
      price: ticker.price,
      bid: ticker.bid,
      ask: ticker.ask
    });
    
    if (this.spreadHistory[symbol].length > this.config.maxHistorySize) {
      this.spreadHistory[symbol] = this.spreadHistory[symbol].slice(0, this.config.maxHistorySize);
    }
    
    // 🔥 VERIFICA ALERTA
    this._checkAlert(symbol, spread);
  }

  // 🆕 VERIFICA SE DEVE GERAR ALERTA
  _checkAlert(symbol, spread) {
    const now = Date.now();
    const lastAlert = this._lastAlert[symbol] || 0;
    
    // Cooldown para não spamar
    if (now - lastAlert < this.config.alertCooldownMs) return;
    
    let alertType = null;
    let message = null;
    
    if (spread >= this.config.abnormalThreshold) {
      alertType = "ABNORMAL";
      message = `Spread ANORMAL em ${symbol}: ${spread.toFixed(3)}% (acima de ${this.config.abnormalThreshold}%) - Trading pode ser prejudicado`;
    } else if (spread >= this.config.wideThreshold) {
      alertType = "WIDE";
      message = `Spread LARGO em ${symbol}: ${spread.toFixed(3)}% (acima de ${this.config.wideThreshold}%) - Cuidado ao operar`;
    }
    
    if (alertType && message) {
      this._lastAlert[symbol] = now;
      
      const alert = {
        id: `spread_alert_${symbol}_${Date.now()}`,
        symbol,
        spread: Math.round(spread * 10000) / 10000,
        type: alertType,
        message,
        timestamp: new Date().toISOString()
      };
      
      this.spreadAlerts.unshift(alert);
      if (this.spreadAlerts.length > 100) this.spreadAlerts.pop();
      
      eventBus.emit("alert", {
        severity: alertType === "ABNORMAL" ? "WARNING" : "INFO",
        message,
        timestamp: alert.timestamp
      });
      
      // 🆕 COMPARTILHA COM LEARNING BRAIN
      eventBus.emit(`learning:${this.agentId}`, {
        type: "spread_alert",
        content: message,
        confidence: 0.85,
        priority: alertType === "ABNORMAL" ? "high" : "normal",
        data: alert
      });
      
      logger.warn(message, { service: "SpreadAnalyzer" });
    }
  }

  analyze(symbol) {
    const ticker = exchange.getTicker(symbol);
    if (!ticker) return null;
    
    const spread = ticker.spread || 0;
    
    let status = "NORMAL";
    let tradeable = true;
    
    if (spread >= this.config.abnormalThreshold) {
      status = "ABNORMAL";
      tradeable = false;
    } else if (spread >= this.config.wideThreshold) {
      status = "WIDE";
      tradeable = true;
    }
    
    // 🆕 ADICIONA MÉDIA HISTÓRICA
    const history = this.spreadHistory[symbol];
    let avgSpread = null;
    let spreadVolatility = null;
    
    if (history && history.length > 0) {
      const recentSpreads = history.slice(0, 20).map(h => h.spread);
      avgSpread = recentSpreads.reduce((a, b) => a + b, 0) / recentSpreads.length;
      
      if (recentSpreads.length > 1) {
        const variance = recentSpreads.reduce((sum, s) => sum + Math.pow(s - avgSpread, 2), 0) / recentSpreads.length;
        spreadVolatility = Math.sqrt(variance);
      }
    }
    
    const result = {
      symbol,
      spread: Math.round(spread * 10000) / 10000,
      spreadPercent: Math.round(spread * 100) / 100,
      bid: ticker.bid,
      ask: ticker.ask,
      price: ticker.price,
      status,
      tradeable,
      avgSpread: avgSpread ? Math.round(avgSpread * 10000) / 10000 : null,
      spreadVsAvg: avgSpread ? Math.round((spread - avgSpread) / avgSpread * 100) : null,
      spreadVolatility: spreadVolatility ? Math.round(spreadVolatility * 10000) / 10000 : null,
      updatedAt: new Date().toISOString()
    };
    
    return result;
  }

  analyzeAll() {
    return ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"].map(sym => this.analyze(sym)).filter(Boolean);
  }
  
  // 🆕 OBTÉM HISTÓRICO DE SPREADS DE UM SÍMBOLO
  getSpreadHistory(symbol, limit = 50) {
    if (!this.spreadHistory[symbol]) return [];
    return this.spreadHistory[symbol].slice(0, limit);
  }
  
  // 🆕 OBTÉM ALERTAS DE SPREAD
  getAlerts(limit = 20) {
    return this.spreadAlerts.slice(0, limit);
  }
  
  // 🆕 OBTÉM ESTATÍSTICAS
  getStats() {
    const symbols = Object.keys(this.spreadHistory);
    const avgSpreads = {};
    
    for (const sym of symbols) {
      const history = this.spreadHistory[sym];
      if (history && history.length > 0) {
        const avg = history.slice(0, 20).reduce((a, b) => a + b.spread, 0) / Math.min(20, history.length);
        avgSpreads[sym] = Math.round(avg * 10000) / 10000;
      }
    }
    
    return {
      symbolsTracked: symbols.length,
      totalHistoryPoints: Object.values(this.spreadHistory).reduce((sum, arr) => sum + arr.length, 0),
      alertsCount: this.spreadAlerts.length,
      avgSpreads,
      config: this.config
    };
  }
  
  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      running: this.isRunning,
      config: this.config,
      stats: this.getStats(),
      recentAlerts: this.spreadAlerts.slice(0, 5),
      agentId: this.agentId
    };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("SpreadAnalyzerService config updated", { service: "SpreadAnalyzer", config: this.config });
    return { success: true, config: this.config };
  }
  
  // 🆕 LIMPA HISTÓRICO
  clearHistory() {
    this.spreadHistory = {};
    this.spreadAlerts = [];
    this._lastAlert = {};
    logger.info("SpreadAnalyzerService history cleared", { service: "SpreadAnalyzer" });
    return { success: true };
  }
  
  start() {
    this.isRunning = true;
    logger.info("SpreadAnalyzerService started", { service: "SpreadAnalyzer" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    logger.info("SpreadAnalyzerService stopped", { service: "SpreadAnalyzer" });
    return { success: true };
  }
}

module.exports = new SpreadAnalyzerService();
