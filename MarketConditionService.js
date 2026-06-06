const marketData = require("./MarketDataService");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");

class MarketConditionService {
  constructor() {
    this.conditions = {};
    this.advancedConditions = {};
    this.historicalConditions = [];
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "market_condition";
    
    // 🆕 CONFIGURAÇÕES AJUSTÁVEIS
    this.config = {
      adxThresholdTrending: 25,
      adxThresholdStrong: 40,
      volatilityThreshold: 1.5,
      rsiOversold: 30,
      rsiOverbought: 70,
      shareInsights: true,
      autoAdjust: true
    };
    
    // 🆕 ESTATÍSTICAS
    this.stats = {
      conditionChanges: 0,
      lastRegimeChange: null,
      regimeHistory: []
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
    
    this._analyze();
    setInterval(() => this._analyze(), 30000);
    logger.info("MarketConditionService initialized", { service: "MarketCondition" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 MarketCondition recebeu melhoria: ${improvement.recommendation}`, { service: "MarketCondition" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.adxThresholdTrending = Math.max(18, this.config.adxThresholdTrending - 3);
        this.config.volatilityThreshold = Math.max(0.8, this.config.volatilityThreshold - 0.3);
        logger.info(`⚡ MarketCondition aumentou sensibilidade: ADX threshold=${this.config.adxThresholdTrending}, volatility=${this.config.volatilityThreshold}`, { service: "MarketCondition" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.adxThresholdTrending = Math.min(35, this.config.adxThresholdTrending + 5);
        this.config.volatilityThreshold = Math.min(2.5, this.config.volatilityThreshold + 0.5);
        logger.info(`📉 MarketCondition reduziu risco: ADX threshold=${this.config.adxThresholdTrending}, volatility=${this.config.volatilityThreshold}`, { service: "MarketCondition" });
        break;
    }
    
    setTimeout(() => {
      this.config.adxThresholdTrending = 25;
      this.config.volatilityThreshold = 1.5;
      logger.info(`🔄 MarketCondition resetou ajustes`, { service: "MarketCondition" });
    }, 3600000);
  }

  // 🆕 COMPARTILHA INSIGHT COM LEARNING BRAIN
  _shareInsight(type, content, confidence, data = {}) {
    if (!this.config.shareInsights) return;
    
    eventBus.emit(`learning:${this.agentId}`, {
      type: type,
      content: content,
      confidence: Math.min(0.95, confidence),
      priority: confidence > 0.8 ? "high" : "normal",
      data: data
    });
  }

  _calculateADX(symbol, rsi, macdHist) {
    let adx = 20;
    
    if (macdHist > 0) adx += 15;
    else if (macdHist < 0) adx += 15;
    else adx += 5;
    
    if (rsi > 60 || rsi < 40) adx += 10;
    
    if (symbol === "BTCUSDT") adx -= 3;
    if (symbol === "ETHUSDT") adx += 2;
    if (symbol === "BNBUSDT") adx += 4;
    
    return Math.min(65, Math.max(12, Math.round(adx)));
  }

  _detectRegime(adx, volatility, rsi) {
    if (adx < this.config.adxThresholdTrending && rsi > 35 && rsi < 65) {
      return "ranging";
    }
    
    if (volatility === "HIGH") {
      return "volatile";
    }
    
    if (adx >= this.config.adxThresholdTrending) {
      return "trending";
    }
    
    return "uncertain";
  }

  _calculateTrendStrength(adx) {
    if (adx >= this.config.adxThresholdStrong) return "strong";
    if (adx >= this.config.adxThresholdTrending) return "moderate";
    return "weak";
  }

  _generateRecommendation(regime, trend, adx, volatility, tradeable) {
    if (!tradeable) {
      return {
        action: "AVOID",
        reason: "Market conditions not favorable for trading.",
        positionSize: 0
      };
    }
    
    if (regime === "ranging") {
      return {
        action: "AVOID",
        reason: `Market sideways (ADX: ${adx}). Avoid trend-following strategies.`,
        positionSize: 0,
        preferredStrategy: "mean_reversion"
      };
    }
    
    if (regime === "volatile") {
      return {
        action: "REDUCE",
        reason: `High volatility. Reduce position sizes.`,
        positionSize: 0.5,
        preferredStrategy: "scalping"
      };
    }
    
    if (regime === "trending") {
      let positionSize = 1.0;
      let action = "FOLLOW";
      
      if (adx >= this.config.adxThresholdStrong) {
        positionSize = 1.2;
        action = "AGGRESSIVE";
        return {
          action: action,
          reason: `Strong ${trend} trend detected (ADX: ${adx}). Good for trend following.`,
          positionSize: positionSize,
          preferredStrategy: "trend_following",
          direction: trend === "BULLISH" ? "LONG" : "SHORT"
        };
      }
      
      return {
        action: action,
        reason: `${trend} trend detected (ADX: ${adx}). Follow the trend.`,
        positionSize: positionSize,
        preferredStrategy: "trend_following",
        direction: trend === "BULLISH" ? "LONG" : "SHORT"
      };
    }
    
    return {
      action: "CAUTIOUS",
      reason: "Uncertain market conditions. Wait for clearer signals.",
      positionSize: 0.3,
      preferredStrategy: "wait"
    };
  }

  _analyze() {
    const prevRegimes = {};
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      if (this.advancedConditions[sym]) {
        prevRegimes[sym] = this.advancedConditions[sym].regime;
      }
    }
    
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      const ind = marketData.getIndicators(sym);
      const rsi = ind.rsi || 50;
      const macdHist = ind.macdHist || 0;
      const spread = ind.spread || 0.1;

      let trend = "SIDEWAYS";
      if (ind.emaSignal === "BUY" && rsi < 65 && macdHist > 0) trend = "BULLISH";
      else if (ind.emaSignal === "SELL" && rsi > 35 && macdHist < 0) trend = "BEARISH";

      const volatility = Math.random() > 0.7 ? "HIGH" : "NORMAL";
      const spreadOk = spread < 0.2;
      const tradeable = spreadOk && volatility !== "HIGH";
      
      const adx = this._calculateADX(sym, rsi, macdHist);
      const trendStrength = this._calculateTrendStrength(adx);
      const regime = this._detectRegime(adx, volatility, rsi);
      const isSideways = regime === "ranging";
      const recommendation = this._generateRecommendation(regime, trend, adx, volatility, tradeable);
      const positionMultiplier = this._getPositionMultiplierFromRecommendation(recommendation);

      this.conditions[sym] = { 
        symbol: sym, 
        trend, 
        volatility, 
        spreadOk, 
        tradeable, 
        rsi, 
        emaSignal: ind.emaSignal, 
        updatedAt: new Date().toISOString() 
      };
      
      this.advancedConditions[sym] = {
        ...this.conditions[sym],
        adx,
        trendStrength,
        regime,
        isSideways,
        recommendation,
        positionMultiplier
      };
      
      // 🆕 DETECTA MUDANÇA DE REGIME
      const prevRegime = prevRegimes[sym];
      if (prevRegime && prevRegime !== regime) {
        this.stats.conditionChanges++;
        this.stats.lastRegimeChange = new Date().toISOString();
        
        this._shareInsight("regime_change",
          `${sym} mudou de ${prevRegime} para ${regime}`,
          0.85,
          { symbol: sym, from: prevRegime, to: regime, adx, trend }
        );
        
        logger.info(`🔄 ${sym} regime change: ${prevRegime} → ${regime}`, { service: "MarketCondition" });
      }
      
      this.stats.regimeHistory.unshift({
        symbol: sym,
        regime,
        adx,
        timestamp: new Date().toISOString()
      });
      if (this.stats.regimeHistory.length > 200) this.stats.regimeHistory.pop();
      
      this.historicalConditions.unshift({
        symbol: sym,
        trend,
        regime,
        adx,
        rsi,
        timestamp: new Date().toISOString()
      });
      
      if (this.historicalConditions.length > 500) {
        this.historicalConditions = this.historicalConditions.slice(0, 500);
      }
    }
    
    // 🆕 COMPARTILHA RESUMO DO MERCADO
    const marketStats = this.getMarketStats();
    if (marketStats && marketStats.totalSymbols > 0) {
      this._shareInsight("market_summary",
        `Mercado: ${marketStats.percentTrending}% em tendência, ${marketStats.tradeableCount}/${marketStats.totalSymbols} negociáveis`,
        marketStats.percentTrending / 100,
        marketStats
      );
    }
    
    logger.debug(`Market conditions updated`, { 
      service: "MarketCondition",
      conditions: Object.keys(this.conditions).map(s => ({
        symbol: s,
        trend: this.conditions[s].trend,
        regime: this.advancedConditions[s]?.regime,
        adx: this.advancedConditions[s]?.adx
      }))
    });
  }

  _getPositionMultiplierFromRecommendation(recommendation) {
    if (!recommendation) return 1.0;
    return recommendation.positionSize !== undefined ? recommendation.positionSize : 1.0;
  }

  // ─── MÉTODOS ORIGINAIS ───
  
  getCondition(symbol) { 
    return this.conditions[symbol] || null; 
  }
  
  getAllConditions() { 
    return this.conditions; 
  }
  
  isTradeable(symbol) { 
    return this.conditions[symbol]?.tradeable ?? false; 
  }
  
  getMarketSentiment() {
    const all = Object.values(this.conditions);
    const bullish = all.filter(c => c.trend === "BULLISH").length;
    const bearish = all.filter(c => c.trend === "BEARISH").length;
    if (bullish > bearish) return { sentiment: "BULLISH", score: 60 + bullish * 10 };
    if (bearish > bullish) return { sentiment: "BEARISH", score: 40 - bearish * 10 };
    return { sentiment: "NEUTRAL", score: 50 };
  }

  // ─── MÉTODOS AVANÇADOS ───
  
  isSideways(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return false;
    return adv.isSideways || false;
  }
  
  isStrongTrend(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return false;
    return adv.regime === "trending" && adv.trendStrength === "strong";
  }
  
  getRecommendedDirection(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return "NEUTRAL";
    if (adv.recommendation?.direction) return adv.recommendation.direction;
    if (adv.trend === "BULLISH") return "LONG";
    if (adv.trend === "BEARISH") return "SHORT";
    return "NEUTRAL";
  }
  
  getPositionMultiplier(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return 1.0;
    return adv.positionMultiplier || 1.0;
  }
  
  getFullAnalysis(symbol) {
    return this.advancedConditions[symbol] || this.conditions[symbol] || null;
  }
  
  getAllAdvancedConditions() {
    return this.advancedConditions;
  }
  
  getHistoricalConditions(symbol, limit = 50) {
    let filtered = this.historicalConditions;
    if (symbol) {
      filtered = filtered.filter(c => c.symbol === symbol);
    }
    return filtered.slice(0, limit);
  }
  
  getMarketStats() {
    const advs = Object.values(this.advancedConditions);
    if (advs.length === 0) return null;
    
    const trending = advs.filter(c => c.regime === "trending").length;
    const ranging = advs.filter(c => c.regime === "ranging").length;
    const volatile = advs.filter(c => c.regime === "volatile").length;
    const tradeable = advs.filter(c => c.tradeable).length;
    
    return {
      totalSymbols: advs.length,
      trendingCount: trending,
      rangingCount: ranging,
      volatileCount: volatile,
      tradeableCount: tradeable,
      percentTrending: Math.round((trending / advs.length) * 100),
      averageADX: Math.round(advs.reduce((sum, c) => sum + (c.adx || 20), 0) / advs.length),
      bestRegime: trending > ranging ? "trending" : "ranging",
      timestamp: new Date().toISOString()
    };
  }
  
  // 🆕 OBTÉM STATUS COMPLETO
  getStatus() {
    return {
      running: this.isRunning,
      config: this.config,
      stats: {
        conditionChanges: this.stats.conditionChanges,
        lastRegimeChange: this.stats.lastRegimeChange,
        regimeHistorySize: this.stats.regimeHistory.length
      },
      historicalSize: this.historicalConditions.length,
      marketStats: this.getMarketStats(),
      agentId: this.agentId
    };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("MarketConditionService config updated", { service: "MarketCondition", config: this.config });
    return { success: true, config: this.config };
  }
  
  start() {
    this.isRunning = true;
    logger.info("MarketConditionService started", { service: "MarketCondition" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    logger.info("MarketConditionService stopped", { service: "MarketCondition" });
    return { success: true };
  }
}

module.exports = new MarketConditionService();
