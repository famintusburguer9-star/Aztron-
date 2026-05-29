const rsiStrategy = require("./RsiStrategy");
const macdStrategy = require("./MacdStrategy");
const breakoutStrategy = require("./BreakoutStrategy");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const marketCondition = require("./MarketConditionService");
const aiLearning = require("./AIZtronLearningService");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

// Fatores que influenciam a confiança do sinal
const CONFIDENCE_WEIGHTS = {
  RSI: 0.25,
  MACD: 0.25,
  BREAKOUT: 0.20,
  VOLUME: 0.15,
  SENTIMENT: 0.15
};

class SignalService {
  constructor() {
    this.activeSignals = [];
    this.running = false;
    this._intervalId = null;
    this.signalHistory = []; // Para aprendizado
    logger.info("SignalService initialized", { service: "SignalService" });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._intervalId = setInterval(() => this._scan(), 15000);
    logger.info("SignalService started", { service: "SignalService" });
  }

  stop() {
    this.running = false;
    if (this._intervalId) { 
      clearInterval(this._intervalId); 
      this._intervalId = null; 
    }
    logger.info("SignalService stopped", { service: "SignalService" });
  }

  // NOVO: Verifica se o mercado está em condição de gerar sinal
  _isMarketConditionValid(symbol) {
    try {
      const condition = marketCondition.getCondition(symbol);
      
      // Se estiver em sideways (mercado lateral), não gera sinal
      if (condition && condition.regime === "ranging") {
        logger.debug(`Market sideways for ${symbol}, skipping signals`, { service: "SignalService" });
        return false;
      }
      
      // Se volatilidade estiver muito baixa (< 0.3%), não gera sinal bom
      if (condition && condition.volatility < 0.3) {
        logger.debug(`Low volatility (${condition.volatility}%) for ${symbol}, skipping`, { service: "SignalService" });
        return false;
      }
      
      return true;
    } catch (error) {
      return true; // Se não consegue verificar, assume válido
    }
  }

  // NOVO: Calcula confiança real baseada em múltiplos fatores
  _calculateRealConfidence(result, symbol) {
    let baseConfidence = result.confidence || 60;
    let adjustments = [];
    
    try {
      // 1. Ajuste por condição de mercado
      const condition = marketCondition.getCondition(symbol);
      if (condition) {
        if (condition.regime === "trending") {
          baseConfidence += 8;
          adjustments.push("+8% (trending market)");
        } else if (condition.regime === "ranging") {
          baseConfidence -= 15;
          adjustments.push("-15% (sideways market)");
        }
        
        // Tendência alinhada com o sinal?
        if (result.signal === "BUY" && condition.trend === "bullish") {
          baseConfidence += 10;
          adjustments.push("+10% (trend aligned)");
        } else if (result.signal === "SELL" && condition.trend === "bearish") {
          baseConfidence += 10;
          adjustments.push("+10% (trend aligned)");
        } else if (result.signal === "BUY" && condition.trend === "bearish") {
          baseConfidence -= 10;
          adjustments.push("-10% (counter-trend)");
        } else if (result.signal === "SELL" && condition.trend === "bullish") {
          baseConfidence -= 10;
          adjustments.push("-10% (counter-trend)");
        }
      }
      
      // 2. Ajuste pelo sentimento de mercado (Fear & Greed)
      try {
        const sentimentService = require("./SentimentService");
        const sentiment = sentimentService.getSentiment();
        
        if (result.signal === "BUY" && sentiment.fearGreedIndex < 30) {
          baseConfidence += 12;
          adjustments.push("+12% (extreme fear = buy opportunity)");
        } else if (result.signal === "BUY" && sentiment.fearGreedIndex > 70) {
          baseConfidence -= 15;
          adjustments.push("-15% (extreme greed = avoid buying)");
        } else if (result.signal === "SELL" && sentiment.fearGreedIndex > 70) {
          baseConfidence += 10;
          adjustments.push("+10% (greed = sell opportunity)");
        } else if (result.signal === "SELL" && sentiment.fearGreedIndex < 30) {
          baseConfidence -= 10;
          adjustments.push("-10% (fear = avoid selling)");
        }
      } catch (e) {
        // SentimentService não disponível, ignora
      }
      
      // 3. Ajuste pela IA (aprendizado de padrões anteriores)
      try {
        const prediction = aiLearning.predictSignal({
          symbol: symbol,
          strategy: result.strategy,
          signal: result.signal,
          confidence: baseConfidence
        });
        
        if (prediction && prediction.recommendation === "FOLLOW") {
          baseConfidence += 5;
          adjustments.push(`+5% (AI pattern match: ${prediction.patternUsed})`);
        } else if (prediction && prediction.recommendation === "SKIP") {
          baseConfidence -= 10;
          adjustments.push("-10% (AI recommends skip)");
        }
      } catch (e) {
        // AI não disponível ainda, ignora
      }
      
    } catch (error) {
      logger.warn(`Confidence calculation error: ${error.message}`, { service: "SignalService" });
    }
    
    // Limita entre 0 e 100
    const finalConfidence = Math.min(95, Math.max(35, Math.round(baseConfidence)));
    
    if (adjustments.length > 0) {
      logger.debug(`Confidence for ${symbol}: ${result.confidence}% → ${finalConfidence}% (${adjustments.join(", ")})`, {
        service: "SignalService"
      });
    }
    
    return finalConfidence;
  }

  // NOVO: Verifica se múltiplas estratégias concordam (consenso)
  _checkConsensus(symbol) {
    try {
      const strategies = [rsiStrategy, macdStrategy, breakoutStrategy];
      const results = [];
      
      for (const strategy of strategies) {
        const result = strategy.analyze(symbol);
        if (result && result.confidence > 50) {
          results.push({
            signal: result.signal,
            confidence: result.confidence,
            strategy: result.strategy
          });
        }
      }
      
      if (results.length === 0) return null;
      
      // Verifica se todas apontam pro mesmo lado
      const allBuy = results.every(r => r.signal === "BUY");
      const allSell = results.every(r => r.signal === "SELL");
      
      if (allBuy || allSell) {
        const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
        const strategiesList = results.map(r => r.strategy).join(", ");
        
        return {
          consensus: true,
          signal: allBuy ? "BUY" : "SELL",
          confidence: Math.min(90, Math.round(avgConfidence + 10)),
          strategies: strategiesList,
          count: results.length
        };
      }
      
      return {
        consensus: false,
        signals: results
      };
      
    } catch (error) {
      return null;
    }
  }

  // NOVO: Gera recomendação de tamanho de posição baseado na confiança
  _getPositionSizeMultiplier(confidence) {
    if (confidence >= 85) return 1.2;      // Alta confiança → posição maior
    if (confidence >= 75) return 1.0;      // Confiança média → posição normal
    if (confidence >= 60) return 0.7;      // Confiança baixa → posição reduzida
    return 0.0;                            // Confiança muito baixa → não opera
  }

  _scan() {
    const strategies = [rsiStrategy, macdStrategy, breakoutStrategy];
    
    for (const sym of SYMBOLS) {
      // Verifica condição de mercado antes de tentar gerar sinal
      if (!this._isMarketConditionValid(sym)) continue;
      
      // Verifica consenso entre estratégias
      const consensus = this._checkConsensus(sym);
      
      // Se tem consenso forte, gera sinal prioritário
      if (consensus && consensus.consensus && consensus.confidence > 70) {
        const finalConfidence = this._calculateRealConfidence(
          { signal: consensus.signal, confidence: consensus.confidence, strategy: "CONSENSUS" },
          sym
        );
        
        const positionMultiplier = this._getPositionSizeMultiplier(finalConfidence);
        
        const signal = {
          id: `sig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          symbol: sym,
          type: consensus.signal,
          price: null, // Será preenchido pelo mercado
          confidence: finalConfidence,
          strategy: `CONSENSUS_${consensus.strategies}`,
          reason: `Consensus signal from ${consensus.count} strategies: ${consensus.strategies}`,
          timestamp: new Date().toISOString(),
          status: "ACTIVE",
          positionSizeMultiplier: positionMultiplier,
          consensusCount: consensus.count
        };
        
        this._emitSignal(signal);
        continue;
      }
      
      // Se não tem consenso, avalia cada estratégia individualmente
      for (const strategy of strategies) {
        try {
          const result = strategy.analyze(sym);
          
          // Confiança mínima mais alta para sinais individuais (65%)
          if (result && result.confidence > 65) {
            
            // Calcula confiança real ajustada
            const finalConfidence = this._calculateRealConfidence(result, sym);
            
            // Confiança final precisa ser > 60
            if (finalConfidence < 60) {
              logger.debug(`Signal ${result.signal} ${sym} rejected: final confidence ${finalConfidence}% < 60%`, {
                service: "SignalService"
              });
              continue;
            }
            
            const positionMultiplier = this._getPositionSizeMultiplier(finalConfidence);
            
            const signal = {
              id: `sig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              symbol: result.symbol,
              type: result.signal,
              price: Math.round(result.price * 100) / 100,
              confidence: finalConfidence,
              strategy: result.strategy,
              reason: result.reason,
              timestamp: new Date().toISOString(),
              status: "ACTIVE",
              positionSizeMultiplier: positionMultiplier,
              originalConfidence: result.confidence,
              adjustments: finalConfidence - result.confidence
            };
            
            this._emitSignal(signal);
          }
        } catch (err) {
          logger.error(`Signal scan error for ${sym}: ${err.message}`, { service: "SignalService" });
        }
      }
    }
    
    // Limpa sinais antigos (mais de 2 horas)
    this.activeSignals = this.activeSignals.filter(s => 
      Date.now() - new Date(s.timestamp).getTime() < 2 * 60 * 60 * 1000
    );
  }

  _emitSignal(signal) {
    this.activeSignals.unshift(signal);
    if (this.activeSignals.length > 50) this.activeSignals.length = 50;
    
    // Salva no banco
    try {
      db.addSignal(signal);
    } catch (e) {
      // Ignora erro de DB
    }
    
    // Emite evento
    eventBus.emit("signal", signal);
    
    // Log com informações adicionais
    const sizeInfo = signal.positionSizeMultiplier !== 1.0 
      ? ` (size: ${signal.positionSizeMultiplier}x)` 
      : "";
    
    logger.info(`Signal: ${signal.type} ${signal.symbol} (${signal.confidence}% conf)${sizeInfo}`, { 
      service: "SignalService",
      strategy: signal.strategy,
      consensusCount: signal.consensusCount
    });
  }

  // NOVO: Registra resultado do sinal para aprendizado futuro
  recordSignalOutcome(signalId, wasSuccessful, actualPnl) {
    const signal = this.activeSignals.find(s => s.id === signalId);
    if (signal) {
      signal.outcome = wasSuccessful ? "WIN" : "LOSS";
      signal.actualPnl = actualPnl;
      signal.closedAt = new Date().toISOString();
      
      // Tenta aprender com o resultado
      try {
        aiLearning.learnFromTrade({
          id: signalId,
          symbol: signal.symbol,
          action: signal.type,
          pnl: actualPnl,
          pnlPercent: (actualPnl / (signal.price || 1)) * 100,
          wasWin: wasSuccessful,
          strategy: signal.strategy,
          status: "CLOSED",
          conditions: {
            confidence: signal.confidence,
            sentiment: signal.sentiment
          }
        });
      } catch (e) {
        // Ignora erro de aprendizado
      }
    }
  }

  getSignals(limit = 20) { 
    return this.activeSignals.slice(0, limit); 
  }
  
  getLatest() { 
    return this.activeSignals[0] || null; 
  }
  
  // NOVO: Retorna estatísticas dos sinais
  getStats() {
    const total = this.activeSignals.length;
    const buys = this.activeSignals.filter(s => s.type === "BUY").length;
    const sells = this.activeSignals.filter(s => s.type === "SELL").length;
    const avgConfidence = total > 0 
      ? Math.round(this.activeSignals.reduce((sum, s) => sum + s.confidence, 0) / total)
      : 0;
    
    return {
      activeSignals: total,
      buySignals: buys,
      sellSignals: sells,
      averageConfidence: avgConfidence,
      highConfidenceSignals: this.activeSignals.filter(s => s.confidence >= 80).length
    };
  }
}

module.exports = new SignalService();
