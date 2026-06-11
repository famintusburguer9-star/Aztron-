const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

// 🆕 IMPORT PARA INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");

// ─── CONFIGURAÇÕES DO HFT (CORRIGIDAS) ────────────────────────────────────────
const HFT_CONFIG = {
  SYMBOLS: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
  MAX_POSITION_SIZE: 0.01,
  STOP_LOSS: 0.01,
  TAKE_PROFIT: 0.02,
  MIN_CONFIDENCE: 55,
  MAX_TRADES_PER_HOUR: 8,
  COOLDOWN_SECONDS: 60,
  SCAN_INTERVAL: 10000,
  // 🔥 CONFIGURAÇÕES QUE PODEM SER AJUSTADAS PELO APRENDIZADO
  ADAPTIVE: {
    stopLossMultiplier: 1.0,
    takeProfitMultiplier: 1.0,
    confidenceAdjustment: 0,
    lastAdjustment: null,
    learningHistory: []
  }
};

// ─── ESTRATÉGIAS HFT ─────────────────────────────────────────────────────────
const STRATEGIES = {
  MEAN_REVERSION: (price, indicators) => {
    const recentAvg = indicators?.avgPrice || price;
    const deviation = ((price - recentAvg) / recentAvg) * 100;
    if (deviation < -0.3) return { signal: "BUY", confidence: 65 + Math.abs(deviation) * 40 };
    if (deviation > 0.3) return { signal: "SELL", confidence: 65 + deviation * 40 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  BREAKOUT: (price, indicators) => {
    const high = indicators?.high24h || price * 1.01;
    const low = indicators?.low24h || price * 0.99;
    if (price > high) return { signal: "BUY", confidence: 70 };
    if (price < low) return { signal: "SELL", confidence: 70 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  MOMENTUM: (price, indicators) => {
    const priceChange = indicators?.change5m || 0;
    if (priceChange > 0.2) return { signal: "BUY", confidence: 60 + priceChange * 40 };
    if (priceChange < -0.2) return { signal: "SELL", confidence: 60 + Math.abs(priceChange) * 40 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  VWAP: (price, indicators) => {
    const vwap = indicators?.vwap || price;
    const deviation = ((price - vwap) / vwap) * 100;
    if (deviation < -0.2) return { signal: "BUY", confidence: 65 };
    if (deviation > 0.2) return { signal: "SELL", confidence: 65 };
    return { signal: "HOLD", confidence: 0 };
  },
  
  ORDER_BOOK: (price, indicators) => {
    const bidAskRatio = indicators?.bidAskRatio || 1;
    if (bidAskRatio > 1.15) return { signal: "BUY", confidence: 68 };
    if (bidAskRatio < 0.85) return { signal: "SELL", confidence: 68 };
    return { signal: "HOLD", confidence: 0 };
  }
};

class HFTService {
  constructor() {
    this.running = false;
    this.activeTrades = [];
    this.tradeHistory = [];
    this.lastTradeTime = {};
    this.tradesPerHour = {};
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this._intervalId = null;
    this._priceHistory = {};
    
    // 🔥 CONTROLE DE PERDAS CONSECUTIVAS
    this.consecutiveLosses = 0;
    this.maxConsecutiveLosses = 5;
    this.isLearningMode = false;
    
    // Integração com Capital Distributor
    this.agentId = "hft";
    this.capitalAllocated = 0;
    this.dailyProfitToSend = 0;
    this.initialized = false;
    
    // Ajustes temporários do LearningBrain
    this.tempScanMultiplier = 1.0;
    this.tempRiskMultiplier = 1.0;
    
    // Controle de sinais emitidos
    this.lastSignalEmitted = {};
    this.signalCooldown = 120000;
    
    // Inicializa histórico de preços
    HFT_CONFIG.SYMBOLS.forEach(sym => {
      this._priceHistory[sym] = [];
      this.lastSignalEmitted[sym] = 0;
    });
    
    // Escuta ticks de preço
    eventBus.on("tick", (prices) => this._onTick(prices));
    
    // CONSUME SINAIS DO SIGNAL SERVICE
    eventBus.on("signal", async (signal) => {
      await this._onExternalSignal(signal);
    });
    
    // ESCUTA ALOCAÇÃO DE CAPITAL
    eventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      logger.info(`💰 HFT recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`, { service: "HFT" });
      
      if (!this.running && this.capitalAllocated > 0) {
        logger.info(`🚀 HFT detectou capital e vai iniciar automaticamente...`, { service: "HFT" });
        this.start();
      }
    });
    
    // ESCUTA RETORNO DE CAPITAL
    eventBus.on("capital:return", ({ agentId, amount, reason }) => {
      if (agentId === this.agentId && amount !== 0) {
        this.capitalAllocated += amount;
        logger.info(`💰 HFT recebeu retorno de capital: $${amount}. Novo saldo: $${this.capitalAllocated}`, { service: "HFT" });
      }
    });
    
    // ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId) || !improvement.to) {
        this.applyImprovement(improvement);
      }
    });
    
    eventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    logger.info("HFTService initialized - Com sistema de aprendizado", { service: "HFT" });
  }
  
  // 🔥🔥🔥 NOVO: ANALISA PADRÃO DAS PERDAS 🔥🔥🔥
  _analyzeLossPattern() {
    // Pega as últimas 5 perdas
    const lastLosses = this.tradeHistory.filter(t => t.pnl < 0).slice(0, 5);
    
    if (lastLosses.length < 3) return null;
    
    let stopLossHits = 0;
    let takeProfitTooHigh = 0;
    let wrongDirection = 0;
    let avgLossSize = 0;
    
    for (const loss of lastLosses) {
      avgLossSize += Math.abs(loss.pnlPct);
      
      // Verifica se perdeu por Stop Loss (preço bateu no SL)
      if (loss.exitPrice && loss.stopLoss) {
        const hitByStopLoss = loss.side === "BUY" 
          ? loss.exitPrice <= loss.stopLoss 
          : loss.exitPrice >= loss.stopLoss;
        
        if (hitByStopLoss) stopLossHits++;
      }
      
      // Verifica se a direção estava errada
      const priceChange = loss.exitPrice && loss.entryPrice 
        ? ((loss.exitPrice - loss.entryPrice) / loss.entryPrice) * 100
        : 0;
      
      if ((loss.side === "BUY" && priceChange < 0) || (loss.side === "SELL" && priceChange > 0)) {
        wrongDirection++;
      }
    }
    
    avgLossSize = avgLossSize / lastLosses.length;
    
    return {
      stopLossHits,
      wrongDirection,
      avgLossSize,
      totalLosses: lastLosses.length
    };
  }
  
  // 🔥🔥🔥 NOVO: APRENDE COM OS ERROS E AJUSTA ESTRATÉGIA 🔥🔥🔥
  async _learnFromLosses() {
    const analysis = this._analyzeLossPattern();
    
    if (!analysis || analysis.totalLosses < 3) return;
    
    logger.info(`📚 HFT ANALISANDO ${analysis.totalLosses} PERDAS CONSECUTIVAS:`, { service: "HFT" });
    logger.info(`   - Stop Loss hits: ${analysis.stopLossHits}/${analysis.totalLosses}`, { service: "HFT" });
    logger.info(`   - Wrong direction: ${analysis.wrongDirection}/${analysis.totalLosses}`, { service: "HFT" });
    logger.info(`   - Avg loss size: ${analysis.avgLossSize.toFixed(2)}%`, { service: "HFT" });
    
    let adjustments = [];
    
    // 1. Se perdeu muito por Stop Loss → STOP MUITO APERTADO
    if (analysis.stopLossHits >= 3) {
      const oldStopLoss = HFT_CONFIG.STOP_LOSS;
      HFT_CONFIG.STOP_LOSS = Math.min(2.5, HFT_CONFIG.STOP_LOSS * 1.3);
      adjustments.push(`Stop Loss: ${oldStopLoss}% → ${HFT_CONFIG.STOP_LOSS}%`);
      logger.info(`📈 HFT aprendeu: Stop Loss muito apertado! Aumentou para ${HFT_CONFIG.STOP_LOSS}%`, { service: "HFT" });
    }
    
    // 2. Se perdeu por direção errada → CONFIANÇA MÍNIMA MAIS ALTA
    if (analysis.wrongDirection >= 3) {
      const oldMinConf = HFT_CONFIG.MIN_CONFIDENCE;
      HFT_CONFIG.MIN_CONFIDENCE = Math.min(75, HFT_CONFIG.MIN_CONFIDENCE + 8);
      adjustments.push(`Confiança mínima: ${oldMinConf}% → ${HFT_CONFIG.MIN_CONFIDENCE}%`);
      logger.info(`📈 HFT aprendeu: Direção errada! Aumentou confiança mínima para ${HFT_CONFIG.MIN_CONFIDENCE}%`, { service: "HFT" });
    }
    
    // 3. Perdas muito grandes → TAKE PROFIT MUITO ALTO
    if (analysis.avgLossSize > 1.5) {
      const oldTakeProfit = HFT_CONFIG.TAKE_PROFIT;
      HFT_CONFIG.TAKE_PROFIT = Math.max(1.0, HFT_CONFIG.TAKE_PROFIT * 0.85);
      adjustments.push(`Take Profit: ${oldTakeProfit}% → ${HFT_CONFIG.TAKE_PROFIT}%`);
      logger.info(`📈 HFT aprendeu: Perdas grandes! Reduziu Take Profit para ${HFT_CONFIG.TAKE_PROFIT}%`, { service: "HFT" });
    }
    
    // 4. Se ainda está perdendo muito, reduz tamanho da posição
    if (analysis.stopLossHits >= 2 && analysis.wrongDirection >= 2) {
      const oldMaxSize = HFT_CONFIG.MAX_POSITION_SIZE;
      HFT_CONFIG.MAX_POSITION_SIZE = Math.max(0.005, HFT_CONFIG.MAX_POSITION_SIZE * 0.7);
      adjustments.push(`Tamanho máximo: ${oldMaxSize * 100}% → ${HFT_CONFIG.MAX_POSITION_SIZE * 100}%`);
      logger.info(`📉 HFT aprendeu: Reduzindo tamanho da posição para ${HFT_CONFIG.MAX_POSITION_SIZE * 100}% do capital`, { service: "HFT" });
    }
    
    // 🔥 SALVA HISTÓRICO DE APRENDIZADO
    if (adjustments.length > 0) {
      HFT_CONFIG.ADAPTIVE.learningHistory.unshift({
        timestamp: Date.now(),
        adjustments: adjustments,
        consecutiveLosses: this.consecutiveLosses,
        analysis: analysis
      });
      
      // Mantém só últimos 20 aprendizados
      if (HFT_CONFIG.ADAPTIVE.learningHistory.length > 20) {
        HFT_CONFIG.ADAPTIVE.learningHistory.pop();
      }
      
      // COMPARTILHA APRENDIZADO COM O LEARNING BRAIN
      this._shareLearningWithBrain(adjustments, analysis);
    }
  }
  
  // 🔥🔥🔥 NOVO: COMPARTILHA APRENDIZADO COM O CÉREBRO 🔥🔥🔥
  _shareLearningWithBrain(adjustments, analysis) {
    const learning = {
      type: "performance_analysis",
      content: `HFT aprendeu com ${analysis.totalLosses} perdas: ${adjustments.join(", ")}`,
      confidence: 0.8,
      priority: "high",
      data: {
        adjustments: adjustments,
        stopLossHits: analysis.stopLossHits,
        wrongDirection: analysis.wrongDirection,
        avgLossSize: analysis.avgLossSize,
        newConfig: {
          stopLoss: HFT_CONFIG.STOP_LOSS,
          takeProfit: HFT_CONFIG.TAKE_PROFIT,
          minConfidence: HFT_CONFIG.MIN_CONFIDENCE,
          maxPositionSize: HFT_CONFIG.MAX_POSITION_SIZE
        }
      }
    };
    
    eventBus.emit(`learning:${this.agentId}`, learning);
    logger.info(`📤 HFT compartilhou aprendizado com o Learning Brain`, { service: "HFT" });
  }
  
  // 🔥🔥🔥 NOVO: RESETA PARA CONFIGURAÇÕES PADRÃO 🔥🔥🔥
  _resetToDefaultConfig() {
    logger.info(`🔄 HFT resetando para configurações padrão`, { service: "HFT" });
    
    HFT_CONFIG.STOP_LOSS = 0.01;
    HFT_CONFIG.TAKE_PROFIT = 0.02;
    HFT_CONFIG.MIN_CONFIDENCE = 55;
    HFT_CONFIG.MAX_POSITION_SIZE = 0.01;
    HFT_CONFIG.ADAPTIVE.stopLossMultiplier = 1.0;
    HFT_CONFIG.ADAPTIVE.takeProfitMultiplier = 1.0;
    HFT_CONFIG.ADAPTIVE.confidenceAdjustment = 0;
    HFT_CONFIG.ADAPTIVE.lastAdjustment = Date.now();
    
    this.tempRiskMultiplier = 1.0;
    this.tempScanMultiplier = 1.0;
    
    logger.info(`✅ HFT resetado: Stop=${HFT_CONFIG.STOP_LOSS}%, TP=${HFT_CONFIG.TAKE_PROFIT}%, Conf=${HFT_CONFIG.MIN_CONFIDENCE}%`, { service: "HFT" });
  }
  
  // 🔥 MÉTODO DE PAUSA COM APRENDIZADO (SUBSTITUI O ANTIGO)
  async _pauseAndLearn() {
    this.isLearningMode = true;
    
    logger.error(`🚨 HFT: ${this.consecutiveLosses} perdas consecutivas!`, { service: "HFT" });
    logger.info(`🧠 HFT: Iniciando modo de APRENDIZADO por 5 minutos...`, { service: "HFT" });
    
    // 1. ANALISA AS PERDAS
    await this._learnFromLosses();
    
    // 2. PAUSA POR 5 MINUTOS
    await this.sleep(300000); // 5 minutos
    
    // 3. RESETA O CONTADOR DE PERDAS
    this.consecutiveLosses = 0;
    this.isLearningMode = false;
    
    logger.info(`🔄 HFT: Modo aprendizado finalizado. Retomando operações.`, { service: "HFT" });
  }
  
  async initialize() {
    if (this.initialized) return { success: true, capital: this.capitalAllocated };
    
    logger.info("🔍 HFT: Inicializando e aguardando capital...", { service: "HFT" });
    
    let attempts = 0;
    while (this.capitalAllocated === 0 && attempts < 60) {
      await this.sleep(100);
      attempts++;
    }
    
    if (this.capitalAllocated === 0) {
      const capital = capitalDistributor.getAgentInfo(this.agentId)?.balance || 0;
      if (capital > 0) {
        this.capitalAllocated = capital;
        logger.info(`✅ HFT recuperou capital do CapitalDistributor: $${this.capitalAllocated}`, { service: "HFT" });
      }
    }
    
    this.initialized = true;
    
    if (this.capitalAllocated > 0) {
      logger.info(`✅ HFTService initialized com capital $${this.capitalAllocated}`, { service: "HFT" });
      if (!this.running) {
        this.start();
      }
      return { success: true, capital: this.capitalAllocated };
    } else {
      logger.warn("⚠️ HFTService initialized sem capital - aguardando evento de alocação", { service: "HFT" });
      return { success: true, capital: 0, waitingForCapital: true };
    }
  }
  
  async _onExternalSignal(signal) {
    if (!this.running) return;
    if (signal.status !== "ACTIVE") return;
    if (!signal.symbol) return;
    if (this.capitalAllocated <= 0) return;
    if (signal.agent === this.agentId) return;
    if (this.isLearningMode) return; // 🔥 NÃO OPERA EM MODO APRENDIZADO
    
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      logger.warn(`⛔ HFT com ${this.consecutiveLosses} perdas consecutivas. Pausando novos trades.`, { service: "HFT" });
      this._pauseAndLearn(); // 🔥 APRENDE COM OS ERROS
      return;
    }
    
    const now = Date.now();
    const lastTrade = this.lastTradeTime[signal.symbol];
    if (lastTrade && (now - lastTrade) < HFT_CONFIG.COOLDOWN_SECONDS * 1000) return;
    
    const hasOpenTrade = this.activeTrades.some(t => t.symbol === signal.symbol);
    if (hasOpenTrade) return;
    
    const minConfidence = HFT_CONFIG.MIN_CONFIDENCE;
    if (signal.confidence < minConfidence) return;
    
    const ticker = exchange.getTicker(signal.symbol);
    if (!ticker) return;
    
    logger.info(`📡 HFT recebeu sinal externo: ${signal.type} ${signal.symbol} (conf: ${signal.confidence}%) de ${signal.agent}`, { service: "HFT" });
    
    await this._executeTrade(signal.type, signal.symbol, ticker.price, signal.confidence);
  }
  
  _emitOwnSignal(signalType, symbol, confidence, strategy, reasoning) {
    const now = Date.now();
    const lastSignal = this.lastSignalEmitted[symbol] || 0;
    
    if (now - lastSignal < this.signalCooldown) return;
    if (confidence < HFT_CONFIG.MIN_CONFIDENCE) return;
    if (this.isLearningMode) return; // 🔥 NÃO EMITE EM MODO APRENDIZADO
    
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      logger.debug(`⏸️ HFT não emite sinal (${this.consecutiveLosses} perdas consecutivas)`, { service: "HFT" });
      this._pauseAndLearn();
      return;
    }
    
    const signal = {
      type: signalType,
      symbol: symbol,
      confidence: Math.min(98, confidence),
      strategy: `HFT_${strategy}`,
      agent: this.agentId,
      status: "ACTIVE",
      reason: reasoning,
      sizeMultiplier: 0.7 + (confidence / 100),
      priority: confidence > 75 ? "HIGH" : "NORMAL",
      metadata: { source: "hft_scan", strategy: strategy, timestamp: now }
    };
    
    this.lastSignalEmitted[symbol] = now;
    
    logger.info(`📢 HFT emitindo sinal próprio: ${signal.type} ${symbol} (conf: ${signal.confidence}%) - ${strategy}`, { service: "HFT" });
    
    eventBus.emit("signal", signal);
    eventBus.emit("hft:signal", signal);
  }
  
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 HFT recebeu melhoria: ${improvement.recommendation}`, { service: "HFT" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.tempScanMultiplier = Math.max(0.5, this.tempScanMultiplier * 0.9);
        if (this._intervalId) {
          clearInterval(this._intervalId);
          const newInterval = Math.max(5000, HFT_CONFIG.SCAN_INTERVAL * this.tempScanMultiplier);
          this._intervalId = setInterval(() => this._scan(), newInterval);
          logger.info(`⚡ HFT aumentou scan para ${newInterval}ms`, { service: "HFT" });
        }
        break;
        
      case "REDUZIR_RISCO":
        this.tempRiskMultiplier = Math.max(0.6, this.tempRiskMultiplier * 0.85);
        logger.info(`📉 HFT reduziu risco: riskMultiplier=${this.tempRiskMultiplier}x`, { service: "HFT" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "HFT" });
    }
    
    setTimeout(() => {
      this.tempScanMultiplier = 1.0;
      this.tempRiskMultiplier = 1.0;
      logger.info(`🔄 HFT resetou ajustes temporários`, { service: "HFT" });
    }, 3600000);
    
    this.shareLearning();
  }
  
  shareLearning() {
    const recentTrades = this.tradeHistory.filter(t => t.status === "CLOSED").slice(-20);
    const wins = recentTrades.filter(t => t.pnl > 0).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 5) {
      const learningData = {
        type: "performance_update",
        content: `HFT com ${winRate.toFixed(0)}% de acerto nos últimos ${recentTrades.length} trades`,
        confidence: Math.min(0.95, winRate / 100),
        priority: winRate > 55 ? "high" : "normal",
        data: {
          winRate: winRate,
          totalTrades: recentTrades.length,
          consecutiveLosses: this.consecutiveLosses,
          tempRiskMultiplier: this.tempRiskMultiplier,
          adaptiveConfig: {
            stopLoss: HFT_CONFIG.STOP_LOSS,
            takeProfit: HFT_CONFIG.TAKE_PROFIT,
            minConfidence: HFT_CONFIG.MIN_CONFIDENCE
          }
        }
      };
      
      eventBus.emit(`learning:${this.agentId}`, learningData);
      logger.info(`📤 HFT compartilhou aprendizado: win rate ${winRate.toFixed(0)}%`, { service: "HFT" });
    }
  }
  
  async requestCapital(amount, reason) {
    return new Promise((resolve) => {
      capitalDistributor.handleRequest({
        agentId: this.agentId,
        amount: amount,
        reason: reason,
        callback: resolve
      });
    });
  }
  
  returnCapital(amount, reason) {
    eventBus.emit("capital:return", {
      agentId: this.agentId,
      amount: amount,
      reason: reason
    });
  }
  
  async sendDailyProfitToTrend() {
    if (this.dailyProfitToSend <= 0) return;
    
    const amount = this.dailyProfitToSend;
    logger.info(`🔄 HFT enviando lucro diário de $${amount} para o Trend`, { service: "HFT" });
    
    eventBus.emit("capital:hft:dailyProfit", {
      agentId: this.agentId,
      amount: amount,
      destination: "trend",
      timestamp: Date.now()
    });
    
    eventBus.emit(`learning:${this.agentId}`, {
      type: "daily_settlement",
      content: `HFT enviou $${amount} de lucro diário para o Trend`,
      confidence: 0.9,
      data: { amount }
    });
    
    this.dailyProfitToSend = 0;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  start() {
    if (this.running) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      const capital = capitalDistributor.getAgentInfo(this.agentId)?.balance || 0;
      if (capital > 0) {
        this.capitalAllocated = capital;
        logger.info(`✅ HFT recuperou capital: $${this.capitalAllocated}`, { service: "HFT" });
      } else {
        logger.warn("HFTService: sem capital, vai aguardar alocação...", { service: "HFT" });
        return { success: false, reason: "No capital allocated - waiting" };
      }
    }
    
    this.running = true;
    this.consecutiveLosses = 0;
    this.isLearningMode = false;
    const effectiveInterval = Math.max(5000, HFT_CONFIG.SCAN_INTERVAL * this.tempScanMultiplier);
    this._intervalId = setInterval(() => this._scan(), effectiveInterval);
    this.scheduleDailyTransfer();
    
    logger.info(`🚀 HFTService started com $${this.capitalAllocated} (scan: ${effectiveInterval}ms)`, { service: "HFT" });
    logger.info(`   Configurações: Stop=${HFT_CONFIG.STOP_LOSS}%, TP=${HFT_CONFIG.TAKE_PROFIT}%, ConfMin=${HFT_CONFIG.MIN_CONFIDENCE}%`, { service: "HFT" });
    return { success: true };
  }
  
  stop() {
    this.running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    logger.info("HFTService stopped", { service: "HFT" });
    return { success: true };
  }
  
  scheduleDailyTransfer() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55, 0);
    const msUntilNight = night.getTime() - now.getTime();
    
    setTimeout(() => {
      this.sendDailyProfitToTrend();
      setInterval(() => this.sendDailyProfitToTrend(), 86400000);
    }, msUntilNight > 0 ? msUntilNight : 86400000 + msUntilNight);
  }
  
  getStatus() {
    return {
      running: this.running,
      activeTrades: this.activeTrades.length,
      totalTradesToday: this.tradeHistory.length,
      dailyProfit: Math.round(this.dailyProfit * 100) / 100,
      dailyLoss: Math.round(this.dailyLoss * 100) / 100,
      netDaily: Math.round((this.dailyProfit - this.dailyLoss) * 100) / 100,
      dailyProfitToSend: Math.round(this.dailyProfitToSend * 100) / 100,
      capitalAvailable: this.capitalAllocated,
      tempRiskMultiplier: this.tempRiskMultiplier,
      tempScanMultiplier: this.tempScanMultiplier,
      consecutiveLosses: this.consecutiveLosses,
      isLearningMode: this.isLearningMode,
      adaptiveConfig: {
        stopLoss: HFT_CONFIG.STOP_LOSS,
        takeProfit: HFT_CONFIG.TAKE_PROFIT,
        minConfidence: HFT_CONFIG.MIN_CONFIDENCE,
        maxPositionSize: HFT_CONFIG.MAX_POSITION_SIZE
      },
      learningHistory: HFT_CONFIG.ADAPTIVE.learningHistory.slice(0, 5)
    };
  }
  
  async getMetrics() {
    const closedTrades = this.tradeHistory.filter(t => t.status === "CLOSED");
    const wins = closedTrades.filter(t => t.pnl > 0);
    const totalProfit = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    return {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: closedTrades.length - wins.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      totalProfit: totalProfit,
      tradesToday: this.tradeHistory.length,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      dailyProfitToSend: this.dailyProfitToSend,
      capital: this.capitalAllocated,
      consecutiveLosses: this.consecutiveLosses
    };
  }
  
  _onTick(prices) {
    if (!this.running) return;
    
    for (const [symbol, data] of Object.entries(prices)) {
      if (!HFT_CONFIG.SYMBOLS.includes(symbol)) continue;
      
      if (!this._priceHistory[symbol]) this._priceHistory[symbol] = [];
      this._priceHistory[symbol].push({
        price: data.price,
        timestamp: Date.now(),
        bid: data.bid,
        ask: data.ask
      });
      
      if (this._priceHistory[symbol].length > 100) {
        this._priceHistory[symbol] = this._priceHistory[symbol].slice(-100);
      }
    }
  }
  
  _calculateIndicators(symbol) {
    const history = this._priceHistory[symbol] || [];
    if (history.length < 10) return null;
    
    const prices = history.map(h => h.price);
    const currentPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const recentPrices = prices.slice(-5);
    const change5m = ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]) * 100;
    const volatility = this._calculateVolatility(prices.slice(-20));
    const high24h = Math.max(...prices);
    const low24h = Math.min(...prices);
    
    const typicalPrices = history.map(h => (h.price + (h.bid || h.price) + (h.ask || h.price)) / 3);
    const vwap = typicalPrices.reduce((a, b) => a + b, 0) / typicalPrices.length;
    const lastBid = history[history.length - 1]?.bid || currentPrice * 0.999;
    const lastAsk = history[history.length - 1]?.ask || currentPrice * 1.001;
    const bidAskRatio = lastBid / lastAsk;
    
    return { 
      currentPrice, avgPrice, change5m, volatility, high24h, low24h, 
      vwap, bidAskRatio, bid: lastBid, ask: lastAsk
    };
  }
  
  _calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }
  
  _checkRateLimits(symbol) {
    const now = Date.now();
    const hourKey = `${symbol}_${Math.floor(now / 3600000)}`;
    
    this.tradesPerHour[hourKey] = this.tradesPerHour[hourKey] || 0;
    if (this.tradesPerHour[hourKey] >= HFT_CONFIG.MAX_TRADES_PER_HOUR) {
      return false;
    }
    
    const lastTrade = this.lastTradeTime[symbol];
    if (lastTrade && (now - lastTrade) < HFT_CONFIG.COOLDOWN_SECONDS * 1000) {
      return false;
    }
    
    return true;
  }
  
  _generateSignal(symbol, indicators) {
    if (!indicators) return null;
    
    const signals = [];
    
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      const result = strategy(indicators.currentPrice, indicators);
      if (result.confidence >= HFT_CONFIG.MIN_CONFIDENCE) {
        signals.push({ strategy: name, signal: result.signal, confidence: result.confidence });
      }
    }
    
    if (signals.length === 0) return null;
    
    const buyCount = signals.filter(s => s.signal === "BUY").length;
    const sellCount = signals.filter(s => s.signal === "SELL").length;
    
    if (buyCount >= 2) {
      const avgConfidence = signals.filter(s => s.signal === "BUY").reduce((a, b) => a + b.confidence, 0) / buyCount;
      const bestStrategy = signals.find(s => s.signal === "BUY")?.strategy || "MULTI_BUY";
      return { signal: "BUY", confidence: Math.min(95, Math.round(avgConfidence)), strategy: bestStrategy };
    }
    
    if (sellCount >= 2) {
      const avgConfidence = signals.filter(s => s.signal === "SELL").reduce((a, b) => a + b.confidence, 0) / sellCount;
      const bestStrategy = signals.find(s => s.signal === "SELL")?.strategy || "MULTI_SELL";
      return { signal: "SELL", confidence: Math.min(95, Math.round(avgConfidence)), strategy: bestStrategy };
    }
    
    const best = signals.reduce((a, b) => a.confidence > b.confidence ? a : b);
    return { signal: best.signal, confidence: best.confidence, strategy: best.strategy };
  }
  
  _calculatePositionSize(symbol, price, confidence) {
    const totalEquity = this.capitalAllocated;
    if (totalEquity <= 0) return 0;
    
    let qty = (totalEquity * HFT_CONFIG.MAX_POSITION_SIZE * this.tempRiskMultiplier) / price;
    const confidenceMultiplier = 0.5 + (confidence / 100);
    qty = qty * confidenceMultiplier;
    
    const maxQty = (totalEquity * 0.03) / price;
    if (qty > maxQty) qty = maxQty;
    
    let minQty = 0;
    if (symbol.includes("BTC")) minQty = 0.0001;
    else if (symbol.includes("ETH")) minQty = 0.001;
    else minQty = 0.01;
    
    if (qty < minQty) qty = minQty;
    
    return Math.round(qty * 10000) / 10000;
  }
  
  async _executeTrade(signal, symbol, price, confidence) {
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      logger.warn(`⛔ HFT com ${this.consecutiveLosses} perdas consecutivas. Pausando execução.`, { service: "HFT" });
      this._pauseAndLearn();
      return null;
    }
    
    const qty = this._calculatePositionSize(symbol, price, confidence);
    if (qty <= 0) return null;
    
    const estimatedCost = price * qty;
    
    if (estimatedCost > this.capitalAllocated) {
      logger.warn(`HFT: Capital insuficiente. Necessário $${estimatedCost}, disponível $${this.capitalAllocated}`, { service: "HFT" });
      return null;
    }
    
    const effectiveStopLoss = HFT_CONFIG.STOP_LOSS * this.tempRiskMultiplier;
    const effectiveTakeProfit = HFT_CONFIG.TAKE_PROFIT * (1 / this.tempRiskMultiplier);
    
    const stopPrice = signal === "BUY" ? price * (1 - effectiveStopLoss) : price * (1 + effectiveStopLoss);
    const takeProfitPrice = signal === "BUY" ? price * (1 + effectiveTakeProfit) : price * (1 - effectiveTakeProfit);
    
    try {
      const capitalRequest = await this.requestCapital(estimatedCost, `Trade: ${signal} ${symbol}`);
      
      if (!capitalRequest.success) {
        logger.warn(`HFT: Trade rejeitado - ${capitalRequest.reason}`, { service: "HFT" });
        return null;
      }
      
      const order = await exchange.placeOrder(symbol, signal, qty, price, this.agentId);
      
      const trade = {
        id: `hft_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        symbol, side: signal, entryPrice: order.price, qty, estimatedCost,
        stopLoss: stopPrice, takeProfit: takeProfitPrice, confidence,
        strategy: "HFT_" + (signal === "BUY" ? "SIGNAL_BUY" : "SIGNAL_SELL"),
        status: "OPEN",
        openedAt: new Date().toISOString(), closedAt: null, pnl: 0, pnlPct: 0
      };
      
      this.activeTrades.push(trade);
      this.lastTradeTime[symbol] = Date.now();
      const hourKey = `${symbol}_${Math.floor(Date.now() / 3600000)}`;
      this.tradesPerHour[hourKey] = (this.tradesPerHour[hourKey] || 0) + 1;
      
      db.addTrade({
        id: trade.id, symbol, side: signal, status: "OPEN",
        entryPrice: order.price, qty, strategy: trade.strategy,
        timestamp: trade.openedAt
      });
      
      eventBus.emit("hft:trade", { action: "OPEN", trade });
      logger.info(`[HFT] Trade opened: ${signal} ${qty} ${symbol} @ $${price} (conf: ${confidence}%)`, { service: "HFT" });
      
      return trade;
      
    } catch (error) {
      logger.error(`[HFT] Trade execution failed: ${error.message}`, { service: "HFT" });
      return null;
    }
  }
  
  _monitorTrades() {
    for (const trade of [...this.activeTrades]) {
      const ticker = exchange.getTicker(trade.symbol);
      if (!ticker) continue;
      
      const currentPrice = ticker.price;
      const pnlPct = trade.side === "BUY"
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
      const pnl = (pnlPct / 100) * trade.entryPrice * trade.qty;
      
      trade.pnl = Math.round(pnl * 100) / 100;
      trade.pnlPct = Math.round(pnlPct * 100) / 100;
      
      const hitSL = trade.side === "BUY" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss;
      const hitTP = trade.side === "BUY" ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit;
      
      if (hitSL || hitTP) {
        trade.status = "CLOSED";
        trade.closedAt = new Date().toISOString();
        trade.exitPrice = currentPrice;
        trade.result = hitTP ? "WIN" : "LOSS";
        
        this.activeTrades = this.activeTrades.filter(t => t.id !== trade.id);
        this.tradeHistory.unshift(trade);
        if (this.tradeHistory.length > 100) this.tradeHistory.pop();
        
        if (trade.pnl > 0) {
          this.dailyProfit += trade.pnl;
          this.dailyProfitToSend += trade.pnl;
          
          this.consecutiveLosses = 0;
          
          eventBus.emit("agent:profit", {
            agentId: this.agentId,
            amount: trade.pnl,
            tradeId: trade.id
          });
          
          logger.info(`[HFT] 🎉 LUCRO: $${trade.pnl} (${trade.pnlPct}%) - Perdas resetadas!`, { service: "HFT" });
        } else {
          this.dailyLoss += Math.abs(trade.pnl);
          this.consecutiveLosses++;
          
          eventBus.emit("trade:closed", {
            agent: this.agentId,
            loss: Math.abs(trade.pnl),
            id: trade.id
          });
          
          logger.warn(`[HFT] 😞 PERDA: $${Math.abs(trade.pnl)} (${trade.pnlPct}%) - ${this.consecutiveLosses} perda(s) consecutiva(s)`, { service: "HFT" });
          
          // 🔥 SE BATER 5 PERDAS, APRENDE E RESETA
          if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
            this._pauseAndLearn();
          }
        }
        
        const totalReturn = trade.estimatedCost + (trade.pnl || 0);
        if (totalReturn !== 0) {
          this.returnCapital(totalReturn, `Trade closed: ${trade.result}`);
        }
        
        db.addTrade({
          id: trade.id, symbol: trade.symbol, side: trade.side, status: "CLOSED",
          entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
          pnl: trade.pnl, pnlPct: trade.pnlPct, strategy: trade.strategy,
          timestamp: trade.openedAt, closedAt: trade.closedAt
        });
        
        if (db.addHFTTrade) db.addHFTTrade(trade);
        
        eventBus.emit("hft:trade", { action: "CLOSE", trade });
        
        this.shareLearning();
      }
    }
  }
  
  async _scan() {
    if (!this.running) return;
    if (this.isLearningMode) return;
    
    this._monitorTrades();
    
    if (this.capitalAllocated <= 0) return;
    
    if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
      return;
    }
    
    for (const symbol of HFT_CONFIG.SYMBOLS) {
      if (!this._checkRateLimits(symbol)) continue;
      
      const indicators = this._calculateIndicators(symbol);
      if (!indicators) continue;
      
      const signal = this._generateSignal(symbol, indicators);
      if (!signal || signal.signal === "HOLD") continue;
      
      const hasOpenTrade = this.activeTrades.some(t => t.symbol === symbol);
      if (hasOpenTrade) continue;
      
      const reasoning = `${signal.strategy} detectou oportunidade: ${signal.signal === "BUY" ? "compra" : "venda"} com ${signal.confidence}% confiança`;
      this._emitOwnSignal(signal.signal, symbol, signal.confidence, signal.strategy, reasoning);
    }
  }
  
  getTrades(limit = 20) {
    return this.tradeHistory.slice(0, limit);
  }
  
  async switchToLiveMode() {
    logger.info("🔄 HFT migrando para LIVE MODE...", { service: "HFT" });
    const result = await capitalDistributor.switchToLiveMode();
    if (result.success) {
      logger.info("✅ HFT agora opera em LIVE MODE", { service: "HFT" });
    } else {
      logger.error("❌ Falha ao migrar HFT para LIVE MODE", { service: "HFT" });
    }
    return result;
  }
  
  resetDaily() {
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.dailyProfitToSend = 0;
    this.tradesPerHour = {};
    this.tradeHistory = [];
    this.consecutiveLosses = 0;
    this.isLearningMode = false;
    this._resetToDefaultConfig();
    logger.info("[HFT] Daily counters reset", { service: "HFT" });
    return { success: true };
  }
}

module.exports = new HFTService();
