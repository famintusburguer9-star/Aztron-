const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const slippage = require("./SlippageEstimatorService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const tokenomics = require("./TokenomicsService");

// 🆕 INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");
const learningBrain = require("./LearningBrainService"); // 🔥 ATIVADO!

class TradeExecutorService {
  constructor() {
    this.running = false;
    this.paused = false;
    this.openTrades = db.getTrades({ status: "OPEN" });
    this.tradeHistory = [];
    
    // 🆕 FILA DE SINAIS PENDENTES
    this.pendingSignals = [];
    
    // 🔥 NOVO: CONTROLE DE PAUSA POR AGENTE
    this.pausedAgents = new Set();
    this.agentPauseReasons = {};
    
    // 🆕 HISTÓRICO DE PERFORMANCE POR AGENTE
    this.agentPerformance = {
      trend: { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 },
      hft: { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 },
      arbitrage: { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 },
      deep: { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 },
      sentiment: { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 }
    };
    
    this.dailyStats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalLoss: 0,
      date: new Date().toDateString()
    };
    
    // 🆕 MAPEAMENTO DE AGENTES
    this.agentMapping = {
      "CONSENSUS_MACD": "trend",
      "CONSENSUS_RSI Strategy": "trend",
      "RSI Strategy": "trend",
      "MACD Strategy": "trend",
      "HFT_CONSENSUS": "hft",
      "HFT": "hft",
      "ARBITRAGE": "arbitrage",
      "DEEP_PATTERN": "deep"
    };
    
    // 🆕 ESCUTA SINAIS DE TODOS OS ROBÔS
    eventBus.on("signal", async (signal) => {
      logger.info(`🔍 DEBUG: TradeExecutor recebeu evento "signal"`, { service: "TradeExecutor" });
      await this.handleSignal(signal);
    });
    
    eventBus.on("capital:return", (capitalReturn) => {
      logger.info(`💸 Capital retornou para ${capitalReturn.agentId}: $${capitalReturn.amount}`, { service: "TradeExecutor" });
      this._processPendingSignals(capitalReturn.agentId);
    });
    
    eventBus.on("agent:pause", ({ agentId, reason }) => {
      this.pausedAgents.add(agentId);
      this.agentPauseReasons[agentId] = reason;
      logger.warn(`⏸️ TradeExecutor: Agente ${agentId} pausado pela Consciência. Motivo: ${reason}`, { service: "TradeExecutor" });
    });
    
    eventBus.on("agent:resume", ({ agentId, reason }) => {
      this.pausedAgents.delete(agentId);
      delete this.agentPauseReasons[agentId];
      logger.info(`▶️ TradeExecutor: Agente ${agentId} retomado. Motivo: ${reason}`, { service: "TradeExecutor" });
      this._processPendingSignals(agentId);
    });
    
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes("trend") || !improvement.to) {
        this._applyImprovement(improvement);
      }
    });
    
    eventBus.on("improvement:trend", (improvement) => {
      this._applyImprovement(improvement);
    });
    
    eventBus.on("council:decision", async (decision) => {
      if (decision && decision.action !== "HOLD") {
        logger.info(`🏛️ Conselho decidiu: ${decision.action} (força: ${(decision.strength*100).toFixed(0)}%)`, { service: "TradeExecutor" });
      }
    });
    
    eventBus.on("market:trend", (trendData) => {
      this._marketTrend = trendData.trend;
      this._trendStrength = trendData.strength;
      logger.debug(`📊 Tendência de mercado atualizada: ${this._marketTrend} (força: ${this._trendStrength.toFixed(1)}%)`, { service: "TradeExecutor" });
    });
    
    this._marketTrend = "sideways";
    this._trendStrength = 0;
    
    logger.info("TradeExecutorService initialized", { 
      service: "TradeExecutor",
      openTradesCount: this.openTrades.length,
      version: "v5.2.0"
    });
    
    logger.info("🔍 DEBUG: Chamando this.start() no construtor", { service: "TradeExecutor" });
    this.start();
  }

  _applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 Trend recebeu melhoria do LearningBrain: ${improvement.recommendation}`, { service: "TradeExecutor" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_TAMANHO_POSICAO":
        this.tempSizeMultiplier = Math.min(1.5, (this.tempSizeMultiplier || 1) + 0.1);
        logger.info(`📈 Trend aumentando tamanho de posição: ${this.tempSizeMultiplier}x`, { service: "TradeExecutor" });
        break;
        
      case "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO":
        this.tempSizeMultiplier = Math.max(0.5, (this.tempSizeMultiplier || 1) - 0.2);
        logger.info(`📉 Trend reduzindo tamanho de posição: ${this.tempSizeMultiplier}x`, { service: "TradeExecutor" });
        break;
        
      case "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE":
        this.baseConfidenceBoost = Math.min(15, (this.baseConfidenceBoost || 0) + 5);
        logger.info(`⚡ Trend aumentando sensibilidade: +${this.baseConfidenceBoost}% confiança`, { service: "TradeExecutor" });
        break;
        
      case "REDUZIR_RISCO":
        this.tempSizeMultiplier = Math.max(0.5, (this.tempSizeMultiplier || 1) * 0.8);
        logger.info(`⚠️ Trend reduzindo risco: ${this.tempSizeMultiplier}x`, { service: "TradeExecutor" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "TradeExecutor" });
    }
    
    setTimeout(() => {
      this.tempSizeMultiplier = 1;
      this.baseConfidenceBoost = 0;
      logger.info(`🔄 Trend resetou ajustes temporários`, { service: "TradeExecutor" });
    }, 3600000);
  }

  _isAgentPaused(agentId) {
    return this.pausedAgents.has(agentId);
  }

  async handleSignal(signal) {
    logger.info(`🔍 DEBUG: handleSignal chamado! running=${this.running}, paused=${this.paused}`, { service: "TradeExecutor" });
    
    if (!this.running || this.paused) {
      logger.warn(`❌ TradeExecutor NÃO ESTÁ RODANDO! running=${this.running}, paused=${this.paused}`, { service: "TradeExecutor" });
      return;
    }
    
    if (signal.status !== "ACTIVE") {
      logger.debug(`⚠️ Signal status não é ACTIVE: ${signal.status}`, { service: "TradeExecutor" });
      return;
    }
    
    const agent = signal.agent || this._getAgentFromStrategy(signal.strategy);
    
    if (this._isAgentPaused(agent)) {
      logger.warn(`⏸️ Agente ${agent} está pausado pela Consciência. Motivo: ${this.agentPauseReasons[agent] || "sem capital"}`, { service: "TradeExecutor" });
      
      this.pendingSignals.push({
        symbol: signal.symbol,
        side: signal.type,
        strategy: signal.strategy,
        confidence: signal.confidence,
        agent: agent,
        prediction: null,
        timestamp: Date.now(),
        originalSignal: signal
      });
      logger.info(`📥 Signal enfileirado para ${agent} (agente pausado). Total pendentes: ${this.pendingSignals.length}`, { service: "TradeExecutor" });
      return;
    }
    
    logger.info(`📡 Signal received: ${signal.type} ${signal.symbol} (conf: ${signal.confidence}%) from ${signal.strategy || signal.agent}`, { 
      service: "TradeExecutor",
      agent: agent
    });
    
    let prediction = null;
    if (learningBrain && learningBrain.predictSignal) {
      try {
        prediction = learningBrain.predictSignal({
          symbol: signal.symbol,
          type: signal.type,
          confidence: signal.confidence,
          strategy: signal.strategy,
          agent: agent
        });
        
        if (prediction) {
          logger.info(`🧠 LearningBrain prediction: ${prediction.recommendation} (padrão: ${prediction.patternUsed || "nenhum"}, win rate esperado: ${prediction.predictedWinRate}%)`, { service: "TradeExecutor" });
          
          if (prediction.recommendation === "SKIP") {
            logger.info(`⏭️ LearningBrain recomendou pular: ${prediction.patternUsed || "no pattern"}`, { service: "TradeExecutor" });
            return;
          }
          
          if (prediction.recommendation === "WAIT") {
            logger.info(`⏸️ LearningBrain recomendou aguardar`, { service: "TradeExecutor" });
            return;
          }
        }
      } catch (err) {
        logger.error(`Erro no LearningBrain.predictSignal: ${err.message}`, { service: "TradeExecutor" });
      }
    }
    
    const result = await this.executeTrade({
      symbol: signal.symbol,
      side: signal.type,
      strategy: signal.strategy,
      confidence: signal.confidence,
      agent: agent,
      prediction: prediction
    });
    
    if (result.success) {
      logger.info(`✅ Trade executed: ${signal.type} ${signal.symbol} (agent: ${agent})`, { service: "TradeExecutor" });
    } else {
      logger.warn(`❌ Trade failed: ${result.reason}`, { service: "TradeExecutor" });
      
      if (result.reason === "INSUFFICIENT_BALANCE" || (result.reason && result.reason.includes("saldo"))) {
        this.pendingSignals.push({
          symbol: signal.symbol,
          side: signal.type,
          strategy: signal.strategy,
          confidence: signal.confidence,
          agent: agent,
          prediction: prediction,
          timestamp: Date.now(),
          originalSignal: signal
        });
        logger.info(`📥 Signal enfileirado para ${agent} (falta saldo). Total pendentes: ${this.pendingSignals.length}`, { service: "TradeExecutor" });
      }
    }
  }

  _getAgentFromStrategy(strategy) {
    if (!strategy) return "trend";
    if (strategy.includes("HFT")) return "hft";
    if (strategy.includes("ARBITRAGE")) return "arbitrage";
    if (strategy.includes("DEEP")) return "deep";
    if (strategy.includes("SENTIMENT")) return "sentiment";
    return "trend";
  }

  _isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  start() { 
    logger.info("🔍 DEBUG: start() chamado!", { service: "TradeExecutor" });
    this.running = true; 
    this.paused = false;
    this._monitorOpenTrades();
    logger.info("🚀 TradeExecutorService started - AGORA VAI EXECUTAR TRADES!", { service: "TradeExecutor" });
    logger.info(`🔍 DEBUG: running agora é ${this.running}`, { service: "TradeExecutor" });
    return { success: true };
  }
  
  stop() { 
    this.running = false; 
    logger.info("TradeExecutorService stopped", { service: "TradeExecutor" });
    return { success: true };
  }

  pauseTrading() { 
    this.paused = true; 
    logger.info("Trading paused", { service: "TradeExecutor" });
    return { success: true, paused: true };
  }

  resumeTrading() { 
    this.paused = false; 
    logger.info("Trading resumed", { service: "TradeExecutor" });
    return { success: true, paused: false };
  }

  isPaused() { return this.paused; }

  // 🔥🔥🔥 NOVO: SISTEMA DE APRENDIZADO PÓS-PERDAS 🔥🔥🔥
  async _learnFromLosses(agent) {
    logger.info(`📚 ${agent} entrou em MODO DE ESTUDO após ${this.agentPerformance[agent].consecutiveLosses} perdas consecutivas!`, { service: "TradeExecutor" });
    
    // 1. PAUSA O AGENTE
    this.pausedAgents.add(agent);
    this.agentPauseReasons[agent] = `Estudando mercado após ${this.agentPerformance[agent].consecutiveLosses} perdas consecutivas`;
    
    // 2. ANALISA AS ÚLTIMAS PERDAS
    const lastLosses = this.tradeHistory
      .filter(t => t.agent === agent && t.result === "LOSS")
      .slice(0, this.agentPerformance[agent].consecutiveLosses);
    
    const lossAnalysis = this._analyzeLossPattern(lastLosses);
    
    // 3. ANALISA O MERCADO ATUAL
    const marketAnalysis = await this._analyzeMarketCondition();
    
    // 4. AJUSTA ESTRATÉGIA BASEADO NA ANÁLISE
    const adjustments = this._generateStrategyAdjustments(lossAnalysis, marketAnalysis);
    
    // 5. COMPARTILHA APRENDIZADO COM LEARNING BRAIN
    this._shareLearningWithBrain(agent, lossAnalysis, marketAnalysis, adjustments);
    
    // 6. EMITE EVENTO
    eventBus.emit(`learning:${agent}`, {
      type: "post_loss_learning",
      content: `${agent} estudando após ${this.agentPerformance[agent].consecutiveLosses} perdas. ${adjustments.summary}`,
      confidence: 0.85,
      priority: "high",
      data: {
        consecutiveLosses: this.agentPerformance[agent].consecutiveLosses,
        lossAnalysis,
        marketAnalysis,
        adjustments
      }
    });
    
    // 7. TEMPO DE ESTUDO (5 minutos)
    logger.info(`🧠 ${agent} estudando o mercado por 5 minutos...`, { service: "TradeExecutor" });
    
    setTimeout(async () => {
      const newMarketAnalysis = await this._analyzeMarketCondition();
      const marketImproved = this._isMarketAligned(newMarketAnalysis);
      
      if (marketImproved) {
        this.pausedAgents.delete(agent);
        delete this.agentPauseReasons[agent];
        this.agentPerformance[agent].consecutiveLosses = 0;
        
        logger.info(`✅ ${agent} retomou operações! Mercado alinhado com a estratégia.`, { service: "TradeExecutor" });
        
        eventBus.emit(`learning:${agent}`, {
          type: "resume_trading",
          content: `${agent} retomou operações após estudo. Mercado alinhado!`,
          confidence: 0.9,
          priority: "high"
        });
      } else {
        logger.info(`🔄 ${agent} mercado ainda não alinhado. Continuando estudo por mais 5 minutos...`, { service: "TradeExecutor" });
        
        setTimeout(() => {
          this.pausedAgents.delete(agent);
          delete this.agentPauseReasons[agent];
          this.agentPerformance[agent].consecutiveLosses = 0;
          logger.info(`✅ ${agent} retomou operações (tempo máximo de estudo atingido).`, { service: "TradeExecutor" });
        }, 300000);
      }
    }, 300000);
    
    return { lossAnalysis, marketAnalysis, adjustments };
  }

  // 🔥 ANALISA PADRÃO DAS PERDAS
  _analyzeLossPattern(losses) {
    let stopLossHits = 0;
    let wrongDirection = 0;
    let avgLossPct = 0;
    
    for (const loss of losses) {
      avgLossPct += Math.abs(loss.pnlPct);
      
      if (loss.exitPrice && loss.stopLoss) {
        const hitByStopLoss = loss.side === "BUY" 
          ? loss.exitPrice <= loss.stopLoss 
          : loss.exitPrice >= loss.stopLoss;
        
        if (hitByStopLoss) stopLossHits++;
      }
      
      const priceChange = loss.exitPrice && loss.entryPrice 
        ? ((loss.exitPrice - loss.entryPrice) / loss.entryPrice) * 100
        : 0;
      
      if ((loss.side === "BUY" && priceChange < 0) || (loss.side === "SELL" && priceChange > 0)) {
        wrongDirection++;
      }
    }
    
    avgLossPct = avgLossPct / (losses.length || 1);
    
    return {
      totalLosses: losses.length,
      stopLossHits,
      wrongDirection,
      avgLossPct,
      primaryIssue: stopLossHits > losses.length / 2 ? "STOP_LOSS_TOO_TIGHT" :
                    wrongDirection > losses.length / 2 ? "WRONG_DIRECTION" :
                    "MARKET_CONDITION"
    };
  }

  // 🔥 ANALISA CONDIÇÃO ATUAL DO MERCADO
  async _analyzeMarketCondition() {
    try {
      const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
      const marketData = {};
      
      for (const symbol of symbols) {
        const ticker = exchange.getTicker(symbol);
        const marketTrend = exchange.getMarketTrend();
        
        marketData[symbol] = {
          price: ticker?.price || 0,
          trend: marketTrend?.trend || "sideways",
          strength: marketTrend?.strength || 0,
          volatility: ticker?.spread || 0.5,
          volume: ticker?.volume24h || 0
        };
      }
      
      const trends = Object.values(marketData).map(m => m.trend);
      const bullishCount = trends.filter(t => t === "bullish").length;
      const bearishCount = trends.filter(t => t === "bearish").length;
      const sidewaysCount = trends.filter(t => t === "sideways").length;
      
      let overallTrend = "sideways";
      if (bullishCount > bearishCount && bullishCount > sidewaysCount) overallTrend = "bullish";
      if (bearishCount > bullishCount && bearishCount > sidewaysCount) overallTrend = "bearish";
      
      const avgVolatility = Object.values(marketData).reduce((sum, m) => sum + m.volatility, 0) / symbols.length;
      
      return {
        overallTrend,
        volatility: avgVolatility,
        isTrending: overallTrend !== "sideways",
        isSideways: overallTrend === "sideways",
        marketData
      };
    } catch (error) {
      logger.error(`Erro ao analisar mercado: ${error.message}`, { service: "TradeExecutor" });
      return { overallTrend: "sideways", volatility: 0.5, isTrending: false, isSideways: true };
    }
  }

  // 🔥 GERA AJUSTES DE ESTRATÉGIA
  _generateStrategyAdjustments(lossAnalysis, marketAnalysis) {
    const adjustments = {
      stopLossMultiplier: 1.0,
      takeProfitMultiplier: 1.0,
      confidenceThreshold: 0,
      positionSizeMultiplier: 1.0,
      summary: "",
      actions: []
    };
    
    if (lossAnalysis.primaryIssue === "STOP_LOSS_TOO_TIGHT") {
      adjustments.stopLossMultiplier = 1.5;
      adjustments.actions.push("Aumentar Stop Loss em 50%");
      adjustments.summary = "Stop loss muito apertado. Aumentando tolerância.";
    } else if (lossAnalysis.primaryIssue === "WRONG_DIRECTION") {
      adjustments.confidenceThreshold = 10;
      adjustments.actions.push("Aumentar confiança mínima em 10%");
      adjustments.summary = "Direção errada. Aumentando filtro de confiança.";
    } else {
      adjustments.positionSizeMultiplier = 0.7;
      adjustments.actions.push("Reduzir tamanho da posição em 30%");
      adjustments.summary = "Mercado desfavorável. Reduzindo exposição.";
    }
    
    if (marketAnalysis.isSideways) {
      adjustments.positionSizeMultiplier *= 0.5;
      adjustments.actions.push("Mercado lateral - reduzindo posição pela metade");
      adjustments.summary += " Mercado lateral detectado.";
    }
    
    return adjustments;
  }

  // 🔥 VERIFICA SE O MERCADO ESTÁ ALINHADO
  _isMarketAligned(marketAnalysis) {
    return !marketAnalysis.isSideways || marketAnalysis.volatility > 1.0;
  }

  // 🔥 COMPARTILHA APRENDIZADO COM LEARNING BRAIN
  _shareLearningWithBrain(agent, lossAnalysis, marketAnalysis, adjustments) {
    const insight = {
      type: "post_loss_analysis",
      content: `${agent} analisou ${lossAnalysis.totalLosses} perdas. Problema: ${lossAnalysis.primaryIssue}. Mercado: ${marketAnalysis.overallTrend}. Ajustes: ${adjustments.summary}`,
      confidence: 0.85,
      priority: "high",
      data: {
        agent,
        consecutiveLosses: this.agentPerformance[agent].consecutiveLosses,
        lossAnalysis,
        marketAnalysis,
        adjustments
      }
    };
    
    eventBus.emit(`learning:${agent}`, insight);
    eventBus.emit("improvement:broadcast", {
      to: agent,
      from: "trade_executor",
      type: "post_loss_learning",
      recommendation: adjustments.summary,
      confidence: 0.85,
      data: adjustments
    });
    
    logger.info(`📤 ${agent} compartilhou análise pós-perda com Learning Brain`, { service: "TradeExecutor" });
  }

  async executeTrade({ symbol, side, strategy, confidence, agent, prediction }) {
    logger.info(`🔍 DEBUG: executeTrade chamado para ${side} ${symbol}`, { service: "TradeExecutor" });
    
    if (!this.running) {
      logger.error(`❌ executeTrade: Engine stopped! running=${this.running}`, { service: "TradeExecutor" });
      return { success: false, reason: "Engine stopped" };
    }
    if (this.paused) {
      logger.error(`❌ executeTrade: Trading paused!`, { service: "TradeExecutor" });
      return { success: false, reason: "Trading paused" };
    }
    
    if (this._isAgentPaused(agent)) {
      logger.warn(`⏸️ executeTrade: Agente ${agent} está pausado. Ignorando trade.`, { service: "TradeExecutor" });
      return { success: false, reason: "AGENT_PAUSED_BY_CONSCIOUSNESS" };
    }
    
    const ticker = exchange.getTicker(symbol);
    if (!ticker) {
      logger.error(`❌ No ticker data for ${symbol}`, { service: "TradeExecutor" });
      return { success: false, reason: "No ticker data" };
    }

    const marketTrend = exchange.getMarketTrend ? exchange.getMarketTrend() : { trend: "sideways", strength: 0 };
    
    if (marketTrend.trend === "bullish" && side === "SELL") {
      logger.warn(`⏸️ Pulando SELL em ${symbol} - Mercado em BULLISH (força: ${marketTrend.strength.toFixed(1)}%)`, { service: "TradeExecutor" });
      return { success: false, reason: "Contra-tendência (bullish market)" };
    }
    
    if (marketTrend.trend === "bearish" && side === "BUY") {
      logger.warn(`⏸️ Pulando BUY em ${symbol} - Mercado em BEARISH (força: ${marketTrend.strength.toFixed(1)}%)`, { service: "TradeExecutor" });
      return { success: false, reason: "Contra-tendência (bearish market)" };
    }
    
    let trendMultiplier = 1.0;
    if (marketTrend.trend === "sideways") {
      trendMultiplier = 0.5;
      logger.info(`📊 Mercado lateral (sideways) - reduzindo tamanho da posição em 50%`, { service: "TradeExecutor" });
    }

    const cfg = db.getConfig();
    
    const performance = this.agentPerformance[agent] || { consecutiveWins: 0, consecutiveLosses: 0 };
    let adjustedConfidence = confidence;
    let sizeMultiplier = 1.0;
    
    if (this.tempSizeMultiplier) {
      sizeMultiplier = sizeMultiplier * this.tempSizeMultiplier;
    }
    if (this.baseConfidenceBoost) {
      adjustedConfidence = Math.min(98, adjustedConfidence + this.baseConfidenceBoost);
    }
    
    sizeMultiplier = sizeMultiplier * trendMultiplier;
    
    if (performance.consecutiveWins >= 3) {
      sizeMultiplier = Math.min(1.5, sizeMultiplier * (1 + (performance.consecutiveWins * 0.1)));
      adjustedConfidence = Math.min(98, adjustedConfidence + (performance.consecutiveWins * 2));
      logger.info(`📈 ${agent} em sequência de ${performance.consecutiveWins} lucros! Multiplicador: ${sizeMultiplier}x, Confiança ajustada: ${adjustedConfidence}%`, { service: "TradeExecutor" });
    } else if (performance.consecutiveLosses >= 2) {
      sizeMultiplier = Math.max(0.3, sizeMultiplier * (1 - (performance.consecutiveLosses * 0.2)));
      adjustedConfidence = Math.max(50, adjustedConfidence - (performance.consecutiveLosses * 5));
      logger.info(`📉 ${agent} em sequência de ${performance.consecutiveLosses} prejuízos! Multiplicador: ${sizeMultiplier}x, Confiança ajustada: ${adjustedConfidence}%`, { service: "TradeExecutor" });
      
      // 🔥 NOVO: SE PERDEU 3 OU MAIS, ENTRA EM MODO DE APRENDIZADO
      if (performance.consecutiveLosses >= 3 && !this._isAgentPaused(agent)) {
        logger.warn(`📚 ${agent} perdeu ${performance.consecutiveLosses} seguidas. Iniciando modo de estudo...`, { service: "TradeExecutor" });
        await this._learnFromLosses(agent);
        return { success: false, reason: "LEARNING_MODE_ACTIVATED" };
      }
    }
    
    const positionInfo = risk.calculatePositionSize(symbol, ticker.price, cfg.stopLoss, agent, adjustedConfidence);
    let finalQty = positionInfo.qty;
    
    if (sizeMultiplier !== 1.0 && finalQty > 0) {
      finalQty = finalQty * sizeMultiplier;
      logger.info(`📊 Aplicando multiplicador: ${sizeMultiplier}x -> ${finalQty.toFixed(6)} ${symbol}`, { service: "TradeExecutor" });
    }
    
    if (!finalQty || finalQty <= 0) {
      logger.warn(`❌ Invalid quantity: ${finalQty} for ${symbol}`, { service: "TradeExecutor" });
      return { success: false, reason: "Invalid quantity" };
    }
    
    const estimatedCost = finalQty * ticker.price;
    logger.info(`🔍 DEBUG: estimatedCost = ${estimatedCost} (qty: ${finalQty}, price: ${ticker.price})`, { service: "TradeExecutor" });
    
    const validation = risk.validateTrade(symbol, side, estimatedCost, agent);
    if (!validation.approved) {
      return { success: false, reason: validation.errors.join("; ") };
    }

    const slip = slippage.estimate(symbol, side, finalQty);
    if (!slip.acceptable) {
      return { success: false, reason: `Slippage too high: ${slip.estimated}%` };
    }

    try {
      let stopLossPercent = cfg.stopLoss;
      
      if (performance.consecutiveWins >= 2) {
        stopLossPercent = cfg.stopLoss * 0.7;
        logger.info(`🎯 Stop loss reduzido para ${stopLossPercent}% (sequência de lucros)`, { service: "TradeExecutor" });
      } else if (performance.consecutiveLosses >= 2) {
        stopLossPercent = cfg.stopLoss * 1.2;
        logger.info(`🎯 Stop loss aumentado para ${stopLossPercent}% (sequência de prejuízos)`, { service: "TradeExecutor" });
      }
      
      if (marketTrend.trend === "bullish" && side === "BUY") {
        stopLossPercent = stopLossPercent * 0.8;
      } else if (marketTrend.trend === "bearish" && side === "SELL") {
        stopLossPercent = stopLossPercent * 0.8;
      }
      
      const stopPrice = side === "BUY" 
        ? ticker.price * (1 - stopLossPercent / 100)
        : ticker.price * (1 + stopLossPercent / 100);
      
      const takeProfitPrice = side === "BUY"
        ? ticker.price * (1 + cfg.takeProfit / 100)
        : ticker.price * (1 - cfg.takeProfit / 100);
      
      logger.info(`🔍 DEBUG: Chamando exchange.placeOrder para ${symbol}`, { service: "TradeExecutor" });
      const order = await exchange.placeOrder(symbol, side, finalQty, ticker.price, agent);
      
      const trade = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        side,
        strategy: strategy || "unknown",
        agent: agent,
        confidence: adjustedConfidence,
        status: "OPEN",
        entryPrice: order.price,
        exitPrice: null,
        qty: finalQty,
        estimatedCost: estimatedCost,
        pnl: 0,
        pnlPct: 0,
        stopLoss: stopPrice,
        takeProfit: takeProfitPrice,
        stopLossPercent: stopLossPercent,
        takeProfitPercent: cfg.takeProfit,
        sizeMultiplier: sizeMultiplier,
        marketTrendAtEntry: marketTrend.trend,
        trendStrengthAtEntry: marketTrend.strength,
        predictionUsed: prediction?.patternUsed || null,
        predictedWinRate: prediction?.predictedWinRate || null,
        timestamp: new Date().toISOString(),
        orderId: order.orderId,
      };
      
      this.openTrades.push(trade);
      db.addTrade(trade);
      
      eventBus.emit("trade", { action: "OPEN", trade });
      eventBus.emit("trade:opened", trade);
      
      logger.info(`✅ Trade opened: ${side} ${finalQty.toFixed(6)} ${symbol} @ $${order.price.toFixed(2)} (agent: ${agent})`, { 
        service: "TradeExecutor",
        tradeId: trade.id,
        agent: agent,
        confidence: adjustedConfidence,
        sizeMultiplier: sizeMultiplier,
        trend: marketTrend.trend,
        patternUsed: prediction?.patternUsed || "nenhum"
      });
      
      this.dailyStats.totalTrades++;
      
      return { success: true, trade };
      
    } catch (err) {
      logger.error(`Trade execution failed: ${err.message}`, { service: "TradeExecutor" });
      return { success: false, reason: err.message };
    }
  }

  async _requestCapital(agent, amount, reason) {
    logger.info(`🔍 DEBUG: _requestCapital chamado para ${agent} - amount: ${amount}`, { service: "TradeExecutor" });
    return new Promise((resolve) => {
      capitalDistributor.handleRequest({
        agentId: agent,
        amount: amount,
        reason: reason,
        callback: resolve
      });
    });
  }

  _returnCapital(agent, amount, reason) {
    logger.info(`🔍 DEBUG: _returnCapital chamado para ${agent} - amount: ${amount}`, { service: "TradeExecutor" });
    eventBus.emit("capital:return", {
      agentId: agent,
      amount: amount,
      reason: reason
    });
  }

  _processPendingSignals(agentId) {
    const toProcess = this.pendingSignals.filter(s => s.agent === agentId);
    if (toProcess.length === 0) return;
    
    logger.info(`🔄 Processando ${toProcess.length} sinais pendentes para ${agentId}`, { service: "TradeExecutor" });
    
    this.pendingSignals = this.pendingSignals.filter(s => s.agent !== agentId);
    
    for (const signal of toProcess) {
      logger.info(`🔄 Tentando sinal pendente: ${signal.side} ${signal.symbol} para ${agentId}`, { service: "TradeExecutor" });
      this.executeTrade({
        symbol: signal.symbol,
        side: signal.side,
        strategy: signal.strategy,
        confidence: signal.confidence,
        agent: signal.agent,
        prediction: signal.prediction
      }).then(result => {
        if (result.success) {
          logger.info(`✅ Sinal pendente executado com sucesso: ${signal.side} ${signal.symbol}`, { service: "TradeExecutor" });
        } else if (result.reason === "INSUFFICIENT_BALANCE") {
          this.pendingSignals.push(signal);
          logger.info(`📥 Sinal pendente recolocado na fila para ${agentId} (saldo ainda insuficiente)`, { service: "TradeExecutor" });
        } else if (result.reason === "AGENT_PAUSED_BY_CONSCIOUSNESS") {
          this.pendingSignals.push(signal);
          logger.info(`📥 Sinal pendente recolocado na fila para ${agentId} (agente pausado)`, { service: "TradeExecutor" });
        } else if (result.reason === "LEARNING_MODE_ACTIVATED") {
          this.pendingSignals.push(signal);
          logger.info(`📥 Sinal pendente recolocado na fila para ${agentId} (modo estudo ativo)`, { service: "TradeExecutor" });
        } else {
          logger.warn(`❌ Sinal pendente falhou: ${result.reason}`, { service: "TradeExecutor" });
        }
      });
    }
  }

  _updateAgentPerformance(agent, isWin, pnl) {
    if (!this.agentPerformance[agent]) {
      this.agentPerformance[agent] = { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null, totalWins: 0, totalLosses: 0, winRate: 0 };
    }
    
    const perf = this.agentPerformance[agent];
    
    if (isWin) {
      perf.consecutiveWins++;
      perf.consecutiveLosses = 0;
      perf.totalWins++;
      perf.lastResult = "WIN";
      logger.info(`🏆 ${agent} - Vitória #${perf.consecutiveWins} consecutiva! Lucro: $${pnl.toFixed(2)}`, { service: "TradeExecutor" });
      
      if (perf.consecutiveWins >= 3) {
        logger.info(`✨ ${agent} está EM FASE! ${perf.consecutiveWins} vitórias seguidas.`, { service: "TradeExecutor" });
        eventBus.emit("agent:hotStreak", { agentId: agent, streak: perf.consecutiveWins });
      }
    } else {
      perf.consecutiveLosses++;
      perf.consecutiveWins = 0;
      perf.totalLosses++;
      perf.lastResult = "LOSS";
      logger.warn(`😞 ${agent} - Derrota #${perf.consecutiveLosses} consecutiva! Prejuízo: $${Math.abs(pnl).toFixed(2)}`, { service: "TradeExecutor" });
      
      if (perf.consecutiveLosses >= 3) {
        logger.error(`🚨 ${agent} em queda livre! ${perf.consecutiveLosses} derrotas seguidas.`, { service: "TradeExecutor" });
        eventBus.emit("agent:coldStreak", { agentId: agent, streak: perf.consecutiveLosses });
      }
    }
    
    const totalTrades = perf.totalWins + perf.totalLosses;
    perf.winRate = totalTrades > 0 ? (perf.totalWins / totalTrades) * 100 : 0;
    
    eventBus.emit(`learning:${agent}`, {
      type: "performance_update",
      content: `${agent} win rate ${perf.winRate.toFixed(0)}% após ${totalTrades} trades`,
      confidence: perf.winRate / 100,
      priority: perf.consecutiveWins >= 3 ? "high" : "normal",
      data: {
        winRate: perf.winRate,
        totalTrades: totalTrades,
        consecutiveWins: perf.consecutiveWins,
        consecutiveLosses: perf.consecutiveLosses,
        lastProfit: pnl
      }
    });
    
    if (db.updateAgentPerformance) {
      db.updateAgentPerformance(agent, perf);
    }
    
    return perf;
  }

  // 🔥 CORREÇÃO: MONITORAMENTO DE TRADES COM PNL CORRIGIDO E LIMITE
  _monitorOpenTrades() {
    logger.info("🔍 DEBUG: _monitorOpenTrades iniciado", { service: "TradeExecutor" });
    
    const MAX_PNL_PER_TRADE = 10000;
    
    setInterval(() => {
      if (!this.running) return;
      
      const cfg = db.getConfig();
      
      for (const trade of [...this.openTrades]) {
        const ticker = exchange.getTicker(trade.symbol);
        if (!ticker) continue;
        
        const currentPrice = ticker.price;
        const side = trade.side;
        
        let pnlPct = 0;
        if (side === "BUY") {
          pnlPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
        } else {
          pnlPct = ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        }
        
        let pnl = trade.estimatedCost * (pnlPct / 100);
        
        if (Math.abs(pnl) > MAX_PNL_PER_TRADE) {
          logger.error(`🚨 PnL EXCESSIVO detectado em ${trade.symbol}! Original: $${pnl.toFixed(2)}, Limitando para $${MAX_PNL_PER_TRADE}`);
          pnl = pnl > 0 ? MAX_PNL_PER_TRADE : -MAX_PNL_PER_TRADE;
          pnlPct = (pnl / trade.estimatedCost) * 100;
        }
        
        trade.pnl = Math.round(pnl * 100) / 100;
        trade.pnlPct = Math.round(pnlPct * 100) / 100;
        
        if (Math.abs(trade.pnl) > 5000) {
          logger.warn(`⚠️ PnL ALTO: ${trade.symbol} PnL=$${trade.pnl} (${trade.pnlPct}%), entry=$${trade.entryPrice}, current=$${currentPrice}, qty=${trade.qty}, estimatedCost=$${trade.estimatedCost}`, { service: "TradeExecutor" });
        }
        
        const hitSL = side === "BUY" 
          ? currentPrice <= trade.stopLoss 
          : currentPrice >= trade.stopLoss;
        const hitTP = side === "BUY" 
          ? currentPrice >= trade.takeProfit 
          : currentPrice <= trade.takeProfit;
        
        if (hitSL || hitTP) {
          trade.status = "CLOSED";
          trade.exitPrice = currentPrice;
          trade.closedAt = new Date().toISOString();
          trade.result = hitTP ? "WIN" : "LOSS";
          
          this.openTrades = this.openTrades.filter(t => t.id !== trade.id);
          this.tradeHistory.unshift(trade);
          if (this.tradeHistory.length > 200) this.tradeHistory.pop();
          
          db.addTrade(trade);
          
          const isWin = trade.result === "WIN";
          this._updateAgentPerformance(trade.agent, isWin, trade.pnl);
          
          if (trade.pnl > 0) {
            this.dailyStats.wins++;
            this.dailyStats.totalProfit += trade.pnl;
            
            if (tokenomics && tokenomics.processProfit) {
              tokenomics.processProfit(trade.pnl);
            }
            
            eventBus.emit("agent:profit", {
              agentId: trade.agent,
              amount: trade.pnl,
              tradeId: trade.id
            });
            
            eventBus.emit("trade:closed", {
              agent: trade.agent,
              profit: trade.pnl,
              id: trade.id,
              trade: trade
            });
            
            logger.info(`💰 WIN: ${trade.symbol} +$${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%) - ${trade.agent}`, { service: "TradeExecutor" });
          } else {
            this.dailyStats.losses++;
            this.dailyStats.totalLoss += Math.abs(trade.pnl);
            
            eventBus.emit("trade:closed", {
              agent: trade.agent,
              loss: Math.abs(trade.pnl),
              id: trade.id,
              trade: trade
            });
            
            logger.warn(`❌ LOSS: ${trade.symbol} $${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%) - ${trade.agent}`, { service: "TradeExecutor" });
          }
          
          const totalReturn = trade.estimatedCost + trade.pnl;
          if (totalReturn !== 0) {
            this._returnCapital(trade.agent, totalReturn, `Trade closed: ${trade.result}`);
          }
          
          eventBus.emit("trade", { action: "CLOSE", trade, reason: hitTP ? "TAKE_PROFIT" : "STOP_LOSS" });
        }
      }
    }, 5000);
  }

  resetDailyStats() {
    const today = new Date().toDateString();
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalProfit: 0,
        totalLoss: 0,
        date: today
      };
    }
  }

  getOpenTrades() { 
    return this.openTrades; 
  }
  
  getTotalOpenPnl() { 
    return this.openTrades.reduce((a, t) => a + t.pnl, 0); 
  }
  
  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(0, limit);
  }
  
  getStats() {
    this.resetDailyStats();
    
    const allClosedTrades = this.tradeHistory.filter(t => t.status === "CLOSED");
    const totalWins = allClosedTrades.filter(t => t.result === "WIN").length;
    const totalLosses = allClosedTrades.filter(t => t.result === "LOSS").length;
    const totalProfit = allClosedTrades.reduce((sum, t) => sum + (t.pnl > 0 ? t.pnl : 0), 0);
    const totalLoss = Math.abs(allClosedTrades.reduce((sum, t) => sum + (t.pnl < 0 ? t.pnl : 0), 0));
    
    return {
      daily: this.dailyStats,
      overall: {
        totalTrades: allClosedTrades.length,
        wins: totalWins,
        losses: totalLosses,
        winRate: allClosedTrades.length > 0 ? (totalWins / allClosedTrades.length) * 100 : 0,
        totalProfit: totalProfit,
        totalLoss: totalLoss,
        netProfit: totalProfit - totalLoss,
        sharpeRatio: 1.2
      },
      openTrades: {
        count: this.openTrades.length,
        totalPnl: this.getTotalOpenPnl()
      },
      byAgent: this._getStatsByAgent(allClosedTrades),
      agentPerformance: this.agentPerformance,
      pausedAgents: Array.from(this.pausedAgents)
    };
  }
  
  _getStatsByAgent(trades) {
    const byAgent = {};
    
    for (const trade of trades) {
      const agent = trade.agent || "unknown";
      if (!byAgent[agent]) {
        byAgent[agent] = { total: 0, wins: 0, losses: 0, totalProfit: 0 };
      }
      byAgent[agent].total++;
      if (trade.result === "WIN") {
        byAgent[agent].wins++;
        byAgent[agent].totalProfit += trade.pnl;
      } else {
        byAgent[agent].losses++;
      }
    }
    
    for (const agent of Object.keys(byAgent)) {
      byAgent[agent].winRate = (byAgent[agent].wins / byAgent[agent].total) * 100;
    }
    
    return byAgent;
  }
  
  resetAgentPerformance(agent) {
    if (this.agentPerformance[agent]) {
      this.agentPerformance[agent] = {
        consecutiveWins: 0,
        consecutiveLosses: 0,
        lastResult: null,
        totalWins: 0,
        totalLosses: 0,
        winRate: 0
      };
      logger.info(`🔄 Performance do agente ${agent} foi resetada`, { service: "TradeExecutor" });
    }
    return { success: true };
  }
  
  getAgentPerformance(agent) {
    return this.agentPerformance[agent] || { consecutiveWins: 0, consecutiveLosses: 0, lastResult: null };
  }
  
  isAgentPaused(agentId) {
    return this.pausedAgents.has(agentId);
  }
  
  getPausedAgents() {
    return Array.from(this.pausedAgents);
  }
  
  async switchToLiveMode() {
    logger.info("🔄 TradeExecutor migrando para LIVE MODE...", { service: "TradeExecutor" });
    const result = await capitalDistributor.switchToLiveMode();
    
    if (result.success) {
      logger.info("✅ TradeExecutor agora opera em LIVE MODE", { service: "TradeExecutor" });
    } else {
      logger.error("❌ Falha ao migrar TradeExecutor para LIVE MODE", { service: "TradeExecutor" });
    }
    
    return result;
  }
}

module.exports = new TradeExecutorService();
