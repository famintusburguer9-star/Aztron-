const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const sentimentService = require("./SentimentService");
const db = require("./DatabaseService");

/**
 * SENTIMENT AGENT SERVICE - Versão Premium
 * 
 * Características:
 * ✅ Gera sinais de trade baseados no Fear & Greed Index
 * ✅ Suporte a múltiplos símbolos (BTC, ETH, BNB, SOL, XRP)
 * ✅ Cooldown inteligente por símbolo
 * ✅ Dimensionamento de posição baseado na força do sentimento
 * ✅ Integração com LearningBrain para aprender com acertos/erros
 * ✅ Alertas de sentimento extremo com prioridade HIGH
 * ✅ Análise de tendência de sentimento (momentum)
 * ✅ Filtro de qualidade baseado em volume de dados
 * ✅ Modo agressivo/conservador configurável
 * ✅ Estatísticas de performance do agente
 */

class SentimentAgentService {
  constructor() {
    this.agentId = "sentiment";
    this.isRunning = false;
    this.isPaused = false;
    
    // Configurações
    this.config = {
      minConfidenceToTrade: 60,        // Confiança mínima para gerar sinal
      cooldownSeconds: 180,            // 3 minutos entre sinais do mesmo símbolo
      extremeCooldownSeconds: 60,      // 1 minuto para sinais extremos
      maxPositionSizeMultiplier: 2.0,  // Máximo multiplicador de posição
      minPositionSizeMultiplier: 0.3,  // Mínimo multiplicador de posição
      useContrarianStrategy: true,     // Opera contra o sentimento extremo
      enableMomentumFilter: true,      // Filtra por tendência do sentimento
      symbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
      aggressionLevel: 0.7,            // 0 = conservador, 1 = agressivo
    };
    
    // Estado interno
    this.lastSignalTime = {};
    this.sentimentHistory = {};         // Histórico de sentimento por símbolo
    this.performanceStats = {
      totalSignals: 0,
      winningSignals: 0,
      losingSignals: 0,
      totalPnl: 0,
      byPattern: {}
    };
    
    // Thresholds para cada nível de sentimento
    this.thresholds = {
      EXTREME_FEAR: { buyConfidence: 85, sellConfidence: 0, sizeMultiplier: 1.5, direction: "BUY" },
      FEAR: { buyConfidence: 65, sellConfidence: 0, sizeMultiplier: 1.2, direction: "BUY" },
      NEUTRAL: { buyConfidence: 45, sellConfidence: 45, sizeMultiplier: 0.8, direction: null },
      GREED: { buyConfidence: 0, sellConfidence: 65, sizeMultiplier: 1.1, direction: "SELL" },
      EXTREME_GREED: { buyConfidence: 0, sellConfidence: 85, sizeMultiplier: 1.4, direction: "SELL" }
    };
    
    // Inicializa histórico
    for (const symbol of this.config.symbols) {
      this.sentimentHistory[symbol] = [];
      this.lastSignalTime[symbol] = 0;
    }
    
    // 🔥 ESCUTA EVENTOS DO SENTIMENT SERVICE
    eventBus.on("sentiment:update", (data) => {
      this._onSentimentUpdate(data);
    });
    
    eventBus.on("sentiment:extreme", (data) => {
      this._onExtremeSentiment(data);
    });
    
    // 🔥 ESCUTA FEEDBACK DO LEARNING BRAIN
    eventBus.on(`learning:${this.agentId}`, (insight) => {
      this._applyLearning(insight);
    });
    
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this._applyImprovement(improvement);
      }
    });
    
    // 🔥 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (tradeData) => {
      if (tradeData.agent === this.agentId || tradeData.agent === "sentiment") {
        this._recordTradeResult(tradeData);
      }
    });
    
    logger.info("🚀 SentimentAgentService initialized - Premium Version", {
      service: "SentimentAgent",
      agentId: this.agentId,
      symbols: this.config.symbols,
      aggressionLevel: this.config.aggressionLevel,
      contrarianMode: this.config.useContrarianStrategy
    });
  }
  
  /**
   * Inicia o agente
   */
  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    this.isRunning = true;
    this.isPaused = false;
    
    logger.info("✅ SentimentAgentService started - Gerando sinais de trade baseados em sentimento", {
      service: "SentimentAgent",
      config: this.config
    });
    
    // Emite evento de inicialização
    eventBus.emit("agent:started", {
      agentId: this.agentId,
      timestamp: Date.now(),
      config: this.config
    });
    
    return { success: true, agentId: this.agentId };
  }
  
  /**
   * Para o agente
   */
  stop() {
    this.isRunning = false;
    logger.info("⏹️ SentimentAgentService stopped", { service: "SentimentAgent" });
    
    eventBus.emit("agent:stopped", {
      agentId: this.agentId,
      timestamp: Date.now()
    });
    
    return { success: true };
  }
  
  /**
   * Pausa temporariamente
   */
  pause() {
    this.isPaused = true;
    logger.info("⏸️ SentimentAgentService paused", { service: "SentimentAgent" });
    return { success: true };
  }
  
  /**
   * Retoma operação
   */
  resume() {
    this.isPaused = false;
    logger.info("▶️ SentimentAgentService resumed", { service: "SentimentAgent" });
    return { success: true };
  }
  
  /**
   * Atualiza configuração em tempo real
   */
  updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    // Valida limites
    this.config.minConfidenceToTrade = Math.max(40, Math.min(90, this.config.minConfidenceToTrade));
    this.config.cooldownSeconds = Math.max(30, Math.min(600, this.config.cooldownSeconds));
    this.config.aggressionLevel = Math.max(0, Math.min(1, this.config.aggressionLevel));
    
    logger.info("⚙️ SentimentAgent config updated", {
      service: "SentimentAgent",
      old: oldConfig,
      new: this.config
    });
    
    return { success: true, config: this.config };
  }
  
  /**
   * Aplica aprendizados do LearningBrain
   */
  _applyLearning(insight) {
    if (!insight || !insight.data) return;
    
    logger.info(`🧠 SentimentAgent aprendendo: ${insight.type}`, { service: "SentimentAgent" });
    
    // Ajusta agressividade baseado em performance
    if (insight.data.winRate !== undefined) {
      if (insight.data.winRate < 45) {
        // Performance ruim: fica mais conservador
        this.config.aggressionLevel = Math.max(0.3, this.config.aggressionLevel * 0.9);
        logger.info(`📉 SentimentAgent reduzindo agressividade para ${this.config.aggressionLevel.toFixed(2)} (win rate baixo)`, { service: "SentimentAgent" });
      } else if (insight.data.winRate > 65) {
        // Performance boa: pode ser mais agressivo
        this.config.aggressionLevel = Math.min(0.9, this.config.aggressionLevel * 1.05);
        logger.info(`📈 SentimentAgent aumentando agressividade para ${this.config.aggressionLevel.toFixed(2)} (win rate alto)`, { service: "SentimentAgent" });
      }
    }
  }
  
  /**
   * Aplica melhoria do LearningBrain
   */
  _applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 SentimentAgent recebeu melhoria: ${improvement.recommendation}`, { service: "SentimentAgent" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.minConfidenceToTrade = Math.max(40, this.config.minConfidenceToTrade - 5);
        this.config.cooldownSeconds = Math.max(60, this.config.cooldownSeconds - 30);
        logger.info(`⚡ SentimentAgent aumentou sensibilidade: minConf=${this.config.minConfidenceToTrade}%, cooldown=${this.config.cooldownSeconds}s`, { service: "SentimentAgent" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.minConfidenceToTrade = Math.min(85, this.config.minConfidenceToTrade + 5);
        this.config.cooldownSeconds = Math.min(300, this.config.cooldownSeconds + 30);
        this.config.aggressionLevel = Math.max(0.3, this.config.aggressionLevel * 0.85);
        logger.info(`🛡️ SentimentAgent reduziu risco: minConf=${this.config.minConfidenceToTrade}%, cooldown=${this.config.cooldownSeconds}s, agg=${this.config.aggressionLevel.toFixed(2)}`, { service: "SentimentAgent" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        this.config.useContrarianStrategy = true;
        logger.info(`🔄 SentimentAgent ativou estratégia contrária`, { service: "SentimentAgent" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "SentimentAgent" });
    }
  }
  
  /**
   * Registra resultado de trade para aprendizado
   */
  _recordTradeResult(tradeData) {
    const isWin = tradeData.pnl > 0;
    const pattern = tradeData.strategy || "unknown";
    
    if (!this.performanceStats.byPattern[pattern]) {
      this.performanceStats.byPattern[pattern] = { wins: 0, losses: 0, totalPnl: 0 };
    }
    
    if (isWin) {
      this.performanceStats.winningSignals++;
      this.performanceStats.byPattern[pattern].wins++;
    } else {
      this.performanceStats.losingSignals++;
      this.performanceStats.byPattern[pattern].losses++;
    }
    
    this.performanceStats.totalSignals++;
    this.performanceStats.totalPnl += tradeData.pnl;
    this.performanceStats.byPattern[pattern].totalPnl += tradeData.pnl;
    
    // Log de performance
    const winRate = (this.performanceStats.winningSignals / this.performanceStats.totalSignals * 100).toFixed(1);
    logger.info(`📊 SentimentAgent performance: ${winRate}% win rate (${this.performanceStats.winningSignals}/${this.performanceStats.totalSignals})`, { service: "SentimentAgent" });
  }
  
  /**
   * Processa atualização de sentimento
   */
  _onSentimentUpdate(data) {
    if (!this.isRunning || this.isPaused) return;
    
    const { fearGreedIndex, fearGreedLabel, positionSizingMultiplier = 1.0, timestamp } = data;
    
    // Para cada símbolo, gera sinal baseado no sentimento geral do mercado
    for (const symbol of this.config.symbols) {
      this._evaluateSignalForSymbol(symbol, fearGreedIndex, fearGreedLabel, positionSizingMultiplier, timestamp);
    }
  }
  
  /**
   * Avalia e gera sinal para um símbolo específico
   */
  _evaluateSignalForSymbol(symbol, fearGreedIndex, fearGreedLabel, baseMultiplier, timestamp) {
    // Verifica cooldown
    const now = Date.now();
    const lastSignal = this.lastSignalTime[symbol] || 0;
    const cooldownMs = this.config.cooldownSeconds * 1000;
    
    if (now - lastSignal < cooldownMs) return;
    
    // Atualiza histórico de sentimento para este símbolo
    this.sentimentHistory[symbol].push({
      timestamp: timestamp || now,
      index: fearGreedIndex,
      label: fearGreedLabel
    });
    
    // Mantém apenas últimos 20 registros
    if (this.sentimentHistory[symbol].length > 20) {
      this.sentimentHistory[symbol].shift();
    }
    
    // Calcula momentum do sentimento (tendência)
    let momentum = 0;
    if (this.config.enableMomentumFilter && this.sentimentHistory[symbol].length >= 5) {
      const recent = this.sentimentHistory[symbol].slice(-5);
      const oldAvg = recent.slice(0, 3).reduce((s, h) => s + h.index, 0) / 3;
      const newAvg = recent.slice(-2).reduce((s, h) => s + h.index, 0) / 2;
      momentum = newAvg - oldAvg;
    }
    
    // Determina threshold baseado no nível de sentimento
    let threshold = this.thresholds[fearGreedLabel] || this.thresholds.NEUTRAL;
    
    // Aplica agressividade
    const aggressionFactor = 0.7 + (this.config.aggressionLevel * 0.6); // 0.7 a 1.3
    let adjustedConfidence = 0;
    let signalType = null;
    let finalMultiplier = threshold.sizeMultiplier;
    
    // Estratégia contrária (default) vs tendência
    if (this.config.useContrarianStrategy) {
      // Opera CONTRA o sentimento extremo
      if (fearGreedIndex <= 30) {
        signalType = "BUY";
        adjustedConfidence = threshold.buyConfidence * aggressionFactor;
        // Quanto mais medo, maior a oportunidade
        const fearBonus = (30 - Math.max(0, fearGreedIndex)) / 30 * 20;
        adjustedConfidence = Math.min(95, adjustedConfidence + fearBonus);
        finalMultiplier = threshold.sizeMultiplier * (1 + fearBonus / 100);
        
      } else if (fearGreedIndex >= 70) {
        signalType = "SELL";
        adjustedConfidence = threshold.sellConfidence * aggressionFactor;
        // Quanto mais ganância, maior a oportunidade de venda
        const greedBonus = (Math.min(100, fearGreedIndex) - 70) / 30 * 20;
        adjustedConfidence = Math.min(95, adjustedConfidence + greedBonus);
        finalMultiplier = threshold.sizeMultiplier * (1 + greedBonus / 100);
      }
    } else {
      // Opera NA DIREÇÃO do sentimento
      if (fearGreedLabel === "EXTREME_FEAR" || fearGreedLabel === "FEAR") {
        signalType = "SELL"; // Medo = vender
        adjustedConfidence = threshold.sellConfidence * aggressionFactor;
      } else if (fearGreedLabel === "EXTREME_GREED" || fearGreedLabel === "GREED") {
        signalType = "BUY"; // Ganância = comprar
        adjustedConfidence = threshold.buyConfidence * aggressionFactor;
      }
    }
    
    // Aplica momentum filter (se disponível)
    if (this.config.enableMomentumFilter && Math.abs(momentum) > 5) {
      if ((signalType === "BUY" && momentum < 0) || (signalType === "SELL" && momentum > 0)) {
        // Momentum contrário ao sinal: reduz confiança
        adjustedConfidence *= 0.8;
        logger.debug(`🔄 Momentum filter: reduzindo confiança para ${symbol} (momentum: ${momentum.toFixed(1)})`, { service: "SentimentAgent" });
      } else if ((signalType === "BUY" && momentum > 0) || (signalType === "SELL" && momentum < 0)) {
        // Momentum a favor: aumenta confiança
        adjustedConfidence *= 1.15;
      }
    }
    
    // Valida se deve gerar sinal
    if (signalType && adjustedConfidence >= this.config.minConfidenceToTrade) {
      // Aplica limites ao multiplicador
      finalMultiplier = Math.min(this.config.maxPositionSizeMultiplier, finalMultiplier);
      finalMultiplier = Math.max(this.config.minPositionSizeMultiplier, finalMultiplier);
      finalMultiplier = finalMultiplier * baseMultiplier;
      
      // Gera o sinal
      const signal = {
        type: signalType,
        symbol: symbol,
        confidence: Math.min(98, Math.floor(adjustedConfidence)),
        strategy: `SENTIMENT_${fearGreedLabel}`,
        agent: this.agentId,
        status: "ACTIVE",
        reason: this._generateReason(fearGreedIndex, fearGreedLabel, momentum),
        sizeMultiplier: parseFloat(finalMultiplier.toFixed(2)),
        priority: fearGreedLabel.includes("EXTREME") ? "HIGH" : "NORMAL",
        metadata: {
          fearGreedIndex: fearGreedIndex,
          fearGreedLabel: fearGreedLabel,
          momentum: parseFloat(momentum.toFixed(1)),
          aggressionLevel: this.config.aggressionLevel,
          timestamp: now
        }
      };
      
      // Registra o sinal
      this.lastSignalTime[symbol] = now;
      
      logger.info(`📢 [SentimentAgent] ${signal.type} ${symbol} (conf: ${signal.confidence}%) - ${signal.reason}`, {
        service: "SentimentAgent",
        symbol: symbol,
        type: signal.type,
        confidence: signal.confidence,
        multiplier: signal.sizeMultiplier,
        fgIndex: fearGreedIndex,
        fgLabel: fearGreedLabel
      });
      
      // Emite o sinal
      eventBus.emit("signal", signal);
      
      // Emite evento de métrica para monitoramento
      eventBus.emit("agent:signal", {
        agentId: this.agentId,
        signal: signal,
        timestamp: now
      });
      
      return signal;
    }
    
    return null;
  }
  
  /**
   * Processa sentimento extremo (alerta prioritário)
   */
  _onExtremeSentiment(data) {
    if (!this.isRunning || this.isPaused) return;
    
    const { type, index } = data;
    const now = Date.now();
    const extremeCooldownMs = this.config.extremeCooldownSeconds * 1000;
    
    for (const symbol of this.config.symbols) {
      const lastSignal = this.lastSignalTime[symbol] || 0;
      
      // Cooldown mais curto para extremos
      if (now - lastSignal < extremeCooldownMs) continue;
      
      let signal = null;
      let confidence = 0;
      
      if (type === "EXTREME_FEAR") {
        confidence = 88 + (this.config.aggressionLevel * 7);
        signal = {
          type: "BUY",
          symbol: symbol,
          confidence: Math.min(98, confidence),
          strategy: "SENTIMENT_EXTREME_FEAR_ALERT",
          agent: this.agentId,
          status: "ACTIVE",
          reason: `🚨 EXTREME FEAR ALERT (${index}) - Forte oportunidade de compra! Mercado em pânico injustificado.`,
          sizeMultiplier: 1.6 + (this.config.aggressionLevel * 0.4),
          priority: "HIGH",
          metadata: {
            extremeType: "EXTREME_FEAR",
            fearGreedIndex: index,
            isExtremeAlert: true,
            timestamp: now
          }
        };
      } else if (type === "EXTREME_GREED") {
        confidence = 83 + (this.config.aggressionLevel * 7);
        signal = {
          type: "SELL",
          symbol: symbol,
          confidence: Math.min(98, confidence),
          strategy: "SENTIMENT_EXTREME_GREED_ALERT",
          agent: this.agentId,
          status: "ACTIVE",
          reason: `🚨 EXTREME GREED ALERT (${index}) - Mercado supercomprado! Risco de correção iminente.`,
          sizeMultiplier: 1.5 + (this.config.aggressionLevel * 0.3),
          priority: "HIGH",
          metadata: {
            extremeType: "EXTREME_GREED",
            fearGreedIndex: index,
            isExtremeAlert: true,
            timestamp: now
          }
        };
      }
      
      if (signal) {
        this.lastSignalTime[symbol] = now;
        
        logger.info(`🔔 [SentimentAgent] 🚨 EMERGÊNCIA: ${signal.type} ${symbol} (conf: ${signal.confidence}%) - ${signal.reason}`, {
          service: "SentimentAgent",
          symbol: symbol,
          type: signal.type,
          confidence: signal.confidence,
          isExtreme: true
        });
        
        eventBus.emit("signal", signal);
        eventBus.emit("agent:extremeSignal", {
          agentId: this.agentId,
          signal: signal,
          timestamp: now
        });
      }
    }
  }
  
  /**
   * Gera motivo legível para o sinal
   */
  _generateReason(fearGreedIndex, fearGreedLabel, momentum) {
    const parts = [];
    
    parts.push(`Fear & Greed: ${fearGreedIndex} (${fearGreedLabel})`);
    
    if (fearGreedLabel === "EXTREME_FEAR") {
      parts.push("Mercado em pânico - oportunidade contrária de compra");
    } else if (fearGreedLabel === "EXTREME_GREED") {
      parts.push("Mercado eufórico - risco de correção");
    } else if (fearGreedLabel === "FEAR") {
      parts.push("Medo no mercado - zona de acumulação");
    } else if (fearGreedLabel === "GREED") {
      parts.push("Ganância no mercado - cautela recomendada");
    } else {
      parts.push("Sentimento neutro - aguardando definição");
    }
    
    if (Math.abs(momentum) > 3) {
      const direction = momentum > 0 ? "aumentando" : "diminuindo";
      parts.push(`Momentum ${direction} (${momentum.toFixed(1)} pts)`);
    }
    
    if (this.config.useContrarianStrategy) {
      parts.push("(Estratégia contrária)");
    }
    
    return parts.join(" | ");
  }
  
  /**
   * Obtém estatísticas do agente
   */
  getStats() {
    const winRate = this.performanceStats.totalSignals > 0
      ? (this.performanceStats.winningSignals / this.performanceStats.totalSignals) * 100
      : 0;
    
    return {
      agentId: this.agentId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      config: this.config,
      performance: {
        totalSignals: this.performanceStats.totalSignals,
        winningSignals: this.performanceStats.winningSignals,
        losingSignals: this.performanceStats.losingSignals,
        winRate: parseFloat(winRate.toFixed(1)),
        totalPnl: parseFloat(this.performanceStats.totalPnl.toFixed(2)),
        byPattern: this.performanceStats.byPattern
      },
      lastSignals: Object.entries(this.lastSignalTime).map(([symbol, time]) => ({
        symbol,
        lastSignalAt: time,
        secondsAgo: Math.floor((Date.now() - time) / 1000)
      })),
      sentimentHistory: Object.entries(this.sentimentHistory).map(([symbol, history]) => ({
        symbol,
        historyLength: history.length,
        lastIndex: history[history.length - 1]?.index || null,
        lastLabel: history[history.length - 1]?.label || null
      }))
    };
  }
  
  /**
   * Força um sinal manual para teste
   */
  forceSignal(symbol, type, confidence, reason = "Manual override") {
    if (!this.isRunning) {
      return { success: false, reason: "Agent not running" };
    }
    
    const signal = {
      type: type.toUpperCase(),
      symbol: symbol.toUpperCase(),
      confidence: Math.min(98, confidence),
      strategy: "SENTIMENT_MANUAL",
      agent: this.agentId,
      status: "ACTIVE",
      reason: `[MANUAL] ${reason}`,
      sizeMultiplier: 1.0,
      priority: "HIGH",
      metadata: {
        isManual: true,
        timestamp: Date.now()
      }
    };
    
    eventBus.emit("signal", signal);
    
    logger.info(`🎮 [SentimentAgent] Sinal manual emitido: ${signal.type} ${signal.symbol}`, {
      service: "SentimentAgent",
      signal: signal
    });
    
    return { success: true, signal: signal };
  }
  
  /**
   * Obtém recomendação atual para um símbolo
   */
  getCurrentRecommendation(symbol) {
    const sentiment = sentimentService.getSentiment();
    const fearGreedIndex = sentiment.fearGreedIndex;
    const fearGreedLabel = sentiment.fearGreedLabel;
    
    let recommendation = "HOLD";
    let confidence = 50;
    let reason = "";
    
    if (fearGreedIndex <= 25) {
      recommendation = "BUY";
      confidence = 70 + (25 - fearGreedIndex);
      reason = `Extreme Fear (${fearGreedIndex}) - Oportunidade de compra`;
    } else if (fearGreedIndex >= 75) {
      recommendation = "SELL";
      confidence = 65 + (fearGreedIndex - 75);
      reason = `Extreme Greed (${fearGreedIndex}) - Risco de correção`;
    } else if (fearGreedIndex <= 40) {
      recommendation = "BUY";
      confidence = 55;
      reason = `Fear (${fearGreedIndex}) - Zona de acumulação`;
    } else if (fearGreedIndex >= 60) {
      recommendation = "SELL";
      confidence = 55;
      reason = `Greed (${fearGreedIndex}) - Cautela recomendada`;
    } else {
      recommendation = "HOLD";
      confidence = 50;
      reason = `Sentimento neutro (${fearGreedIndex}) - Aguardar`;
    }
    
    return {
      symbol: symbol.toUpperCase(),
      recommendation: recommendation,
      confidence: Math.min(95, confidence),
      reason: reason,
      fearGreedIndex: fearGreedIndex,
      fearGreedLabel: fearGreedLabel,
      timestamp: Date.now()
    };
  }
}

module.exports = new SentimentAgentService();