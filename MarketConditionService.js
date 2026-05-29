const marketData = require("./MarketDataService");
const logger = require("./LoggerService");

class MarketConditionService {
  constructor() {
    this.conditions = {};
    this.advancedConditions = {}; // NOVO: para dados avançados
    this.historicalConditions = []; // NOVO: histórico
    this._analyze();
    setInterval(() => this._analyze(), 30000);
    logger.info("MarketConditionService initialized", { service: "MarketCondition" });
  }

  // NOVO: Calcula ADX simulado (força da tendência)
  _calculateADX(symbol, rsi, macdHist) {
    // Baseado em RSI e MACD para simular força da tendência
    let adx = 20; // neutro
    
    if (macdHist > 0) adx += 15;
    else if (macdHist < 0) adx += 15;
    else adx += 5;
    
    if (rsi > 60 || rsi < 40) adx += 10;
    
    // Variação por símbolo
    if (symbol === "BTCUSDT") adx -= 3;
    if (symbol === "ETHUSDT") adx += 2;
    if (symbol === "BNBUSDT") adx += 4;
    
    return Math.min(65, Math.max(12, Math.round(adx)));
  }

  // NOVO: Detecta regime de mercado (trending, ranging, volatile)
  _detectRegime(adx, volatility, rsi) {
    // Ranging (sideways) - mercado lateral
    if (adx < 22 && rsi > 35 && rsi < 65) {
      return "ranging";
    }
    
    // Volatile - mercado volátil
    if (volatility === "HIGH") {
      return "volatile";
    }
    
    // Trending - mercado em tendência
    if (adx >= 25) {
      return "trending";
    }
    
    return "uncertain";
  }

  // NOVO: Calcula força da tendência
  _calculateTrendStrength(adx) {
    if (adx >= 40) return "strong";
    if (adx >= 25) return "moderate";
    return "weak";
  }

  // NOVO: Gera recomendação baseada nas condições
  _generateRecommendation(regime, trend, adx, volatility, tradeable) {
    if (!tradeable) {
      return {
        action: "AVOID",
        reason: "Market conditions not favorable for trading (spread or volatility issues).",
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
        reason: `High volatility (${volatility}). Reduce position sizes.`,
        positionSize: 0.5,
        preferredStrategy: "scalping"
      };
    }
    
    if (regime === "trending") {
      let positionSize = 1.0;
      let action = "FOLLOW";
      
      if (adx >= 40) {
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
    for (const sym of ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
      const ind = marketData.getIndicators(sym);
      const rsi = ind.rsi || 50;
      const macdHist = ind.macdHist || 0;
      const spread = ind.spread || 0.1;

      // Trend original (mantido igual)
      let trend = "SIDEWAYS";
      if (ind.emaSignal === "BUY" && rsi < 65 && macdHist > 0) trend = "BULLISH";
      else if (ind.emaSignal === "SELL" && rsi > 35 && macdHist < 0) trend = "BEARISH";

      const volatility = Math.random() > 0.7 ? "HIGH" : "NORMAL";
      const spreadOk = spread < 0.2;
      const tradeable = spreadOk && volatility !== "HIGH";
      
      // NOVO: Métricas avançadas
      const adx = this._calculateADX(sym, rsi, macdHist);
      const trendStrength = this._calculateTrendStrength(adx);
      const regime = this._detectRegime(adx, volatility, rsi);
      const isSideways = regime === "ranging";
      const recommendation = this._generateRecommendation(regime, trend, adx, volatility, tradeable);
      const positionMultiplier = this._getPositionMultiplierFromRecommendation(recommendation);

      // Mantém o objeto original (para compatibilidade)
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
      
      // NOVO: Dados avançados (não quebra frontend)
      this.advancedConditions[sym] = {
        ...this.conditions[sym],
        adx,
        trendStrength,
        regime,
        isSideways,
        recommendation,
        positionMultiplier
      };
      
      // Guarda histórico
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

  // NOVO: Multiplicador de posição baseado na recomendação
  _getPositionMultiplierFromRecommendation(recommendation) {
    if (!recommendation) return 1.0;
    return recommendation.positionSize !== undefined ? recommendation.positionSize : 1.0;
  }

  // ─── MÉTODOS ORIGINAIS (mantidos para compatibilidade) ───
  
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

  // ─── NOVOS MÉTODOS (para uso futuro) ───
  
  // Verifica se mercado está lateral (sideways)
  isSideways(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return false;
    return adv.isSideways || false;
  }
  
  // Verifica se está em tendência forte
  isStrongTrend(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return false;
    return adv.regime === "trending" && adv.trendStrength === "strong";
  }
  
  // Retorna direção recomendada (LONG/SHORT/NEUTRAL)
  getRecommendedDirection(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return "NEUTRAL";
    if (adv.recommendation?.direction) return adv.recommendation.direction;
    if (adv.trend === "BULLISH") return "LONG";
    if (adv.trend === "BEARISH") return "SHORT";
    return "NEUTRAL";
  }
  
  // Retorna multiplicador de posição baseado nas condições
  getPositionMultiplier(symbol) {
    const adv = this.advancedConditions[symbol];
    if (!adv) return 1.0;
    return adv.positionMultiplier || 1.0;
  }
  
  // Retorna análise completa (incluindo dados avançados)
  getFullAnalysis(symbol) {
    return this.advancedConditions[symbol] || this.conditions[symbol] || null;
  }
  
  // Retorna todas as análises avançadas
  getAllAdvancedConditions() {
    return this.advancedConditions;
  }
  
  // Retorna histórico de condições
  getHistoricalConditions(symbol, limit = 50) {
    let filtered = this.historicalConditions;
    if (symbol) {
      filtered = filtered.filter(c => c.symbol === symbol);
    }
    return filtered.slice(0, limit);
  }
  
  // Retorna estatísticas gerais do mercado
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
}

module.exports = new MarketConditionService();
