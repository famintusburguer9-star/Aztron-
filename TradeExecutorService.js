const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const slippage = require("./SlippageEstimatorService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const tokenomics = require("./TokenomicsService");

// 🆕 INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");
// const learningBrain = require("./LearningBrainService"); // 🔥 COMENTADO

class TradeExecutorService {
  constructor() {
    this.running = false;
    this.paused = false;
    this.openTrades = db.getTrades({ status: "OPEN" });
    this.tradeHistory = [];
    
    // 🆕 FILA DE SINAIS PENDENTES (para quando não tem saldo)
    this.pendingSignals = [];
    
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
    
    // 🆕 ESCUTA QUANDO CAPITAL VOLTA (para processar fila)
    eventBus.on("capital:return", (capitalReturn) => {
      logger.info(`💸 Capital retornou para ${capitalReturn.agentId}: $${capitalReturn.amount}`, { service: "TradeExecutor" });
      this._processPendingSignals(capitalReturn.agentId);
    });
    
    // 🔥 NOVO: ESCUTA APRENDIZADO COMPARTILHADO DE OUTROS AGENTES (HFT, ARBITRAGE)
    eventBus.on("learning:share", (learning) => {
      this._applySharedLearning(learning);
    });
    
    // 🔥 NOVO: ESCUTA DICAS DO CONSELHO
    eventBus.on("council:decision", async (decision) => {
      if (decision && decision.action !== "HOLD") {
        logger.info(`🏛️ Conselho decidiu: ${decision.action} (força: ${(decision.strength*100).toFixed(0)}%)`, { service: "TradeExecutor" });
        
        // Se o conselho recomenda algo com alta força, o Trend considera
        if (decision.strength > 0.7 && decision.action === "BUY") {
          logger.info(`📈 Trend seguindo recomendação do conselho para ${decision.symbol || "mercado"}`, { service: "TradeExecutor" });
        }
      }
    });
    
    logger.info("TradeExecutorService initialized", { 
      service: "TradeExecutor",
      openTradesCount: this.openTrades.length,
      version: "v5.2.0"
    });
    
    // 🔥🔥🔥 FORÇA O START DO TRADE EXECUTOR 🔥🔥🔥
    logger.info("🔍 DEBUG: Chamando this.start() no construtor", { service: "TradeExecutor" });
    this.start();
  }

  // 🔥 NOVO: APLICA APRENDIZADO COMPARTILHADO DE OUTROS AGENTES
  _applySharedLearning(learning) {
    if (!learning || learning.agentId === "trend") return;
    
    logger.info(`🧠 Trend recebeu aprendizado de ${learning.agentId}: ${learning.content}`, { service: "TradeExecutor" });
    
    // Se outro agente está com alta performance, ajusta parâmetros internos
    if (learning.type === "strategy_performance" && learning.confidence > 0.7) {
      const winRate = learning.data?.winRate || 0;
      
      if (winRate > 70) {
        logger.info(`✨ Trend aumentando confiança baseado no sucesso de ${learning.agentId} (${winRate}% win rate)`, { service: "TradeExecutor" });
        
        // Emite melhoria para o próprio Trend se ajustar
        eventBus.emit("improvement:broadcast", {
          sourceAgent: learning.agentId,
          recommendation: "AUMENTAR_SENSIBILIDADE",
          affectedAgents: ["trend"],
          confidence: learning.confidence,
          timestamp: Date.now()
        });
      } else if (winRate < 40) {
        logger.info(`⚠️ Trend reduzindo risco baseado no desempenho ruim de ${learning.agentId}`, { service: "TradeExecutor" });
        
        eventBus.emit("improvement:broadcast", {
          sourceAgent: learning.agentId,
          recommendation: "REDUZIR_RISCO",
          affectedAgents: ["trend"],
          confidence: learning.confidence,
          timestamp: Date.now()
        });
      }
    }
    
    // Se recebeu daily settlement do HFT
    if (learning.type === "daily_settlement" && learning.data?.amount > 0) {
      logger.info(`💰 Trend registrou recebimento de $${learning.data.amount} do HFT`, { service: "TradeExecutor" });
    }
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
    
    logger.info(`📡 Signal received: ${signal.type} ${signal.symbol} (conf: ${signal.confidence}%) from ${signal.strategy || signal.agent}`, { 
      service: "TradeExecutor",
      agent: signal.agent || this._getAgentFromStrategy(signal.strategy)
    });
    
    const agent = signal.agent || this._getAgentFromStrategy(signal.strategy);
    
    const result = await this.executeTrade({
      symbol: signal.symbol,
      side: signal.type,
      strategy: signal.strategy,
      confidence: signal.confidence,
      agent: agent,
      prediction: null
    });
    
    if (result.success) {
      logger.info(`✅ Trade executed: ${signal.type} ${signal.symbol} (agent: ${agent})`, { service: "TradeExecutor" });
    } else {
      logger.warn(`❌ Trade failed: ${result.reason}`, { service: "TradeExecutor" });
      
      // 🔥 SE FOI FALTA DE SALDO, GUARDA NA FILA
      if (result.reason === "INSUFFICIENT_BALANCE" || (result.reason && result.reason.includes("saldo"))) {
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
    
    const ticker = exchange.getTicker(symbol);
    if (!ticker) {
      logger.error(`❌ No ticker data for ${symbol}`, { service: "TradeExecutor" });
      return { success: false, reason: "No ticker data" };
    }

    const cfg = db.getConfig();
    
    // 🆕 AJUSTA POSITION SIZE BASEADO NA SEQUÊNCIA DE LUCROS/PREJUÍZOS
    const performance = this.agentPerformance[agent] || { consecutiveWins: 0, consecutiveLosses: 0 };
    let adjustedConfidence = confidence;
    let sizeMultiplier = 1.0;
    
    if (performance.consecutiveWins >= 3) {
      sizeMultiplier = Math.min(1.5, 1 + (performance.consecutiveWins * 0.1));
      adjustedConfidence = Math.min(98, confidence + (performance.consecutiveWins * 2));
      logger.info(`📈 ${agent} em sequência de ${performance.consecutiveWins} lucros! Multiplicador: ${sizeMultiplier}x, Confiança ajustada: ${adjustedConfidence}%`, { service: "TradeExecutor" });
    } else if (performance.consecutiveLosses >= 2) {
      sizeMultiplier = Math.max(0.5, 1 - (performance.consecutiveLosses * 0.2));
      adjustedConfidence = Math.max(50, confidence - (performance.consecutiveLosses * 5));
      logger.info(`📉 ${agent} em sequência de ${performance.consecutiveLosses} prejuízos! Multiplicador: ${sizeMultiplier}x, Confiança ajustada: ${adjustedConfidence}%`, { service: "TradeExecutor" });
      
      if (performance.consecutiveLosses >= 3) {
        logger.warn(`⛔ ${agent} perdeu ${performance.consecutiveLosses} seguidas. Pulando este trade para evitar mais perdas.`, { service: "TradeExecutor" });
        return { success: false, reason: "CONSECUTIVE_LOSSES_BREAK" };
      }
    }
    
    const positionInfo = risk.calculatePositionSize(symbol, ticker.price, cfg.stopLoss, agent, adjustedConfidence);
    
    if (positionInfo.qty && positionInfo.qty > 0) {
      positionInfo.qty = positionInfo.qty * sizeMultiplier;
    }
    
    if (!positionInfo.qty || positionInfo.qty <= 0) {
      logger.warn(`❌ Invalid quantity: ${positionInfo.qty} for ${symbol}`, { service: "TradeExecutor" });
      return { success: false, reason: "Invalid quantity" };
    }
    
    const estimatedCost = positionInfo.qty * ticker.price;
    logger.info(`🔍 DEBUG: estimatedCost = ${estimatedCost} (sizeMultiplier: ${sizeMultiplier}x)`, { service: "TradeExecutor" });
    
    const capitalRequest = await this._requestCapital(agent, estimatedCost, `Trade: ${side} ${symbol}`);
    
    if (!capitalRequest.success) {
      logger.warn(`❌ Trade rejeitado pelo CapitalDistributor: ${capitalRequest.reason}`, { service: "TradeExecutor" });
      
      if (capitalRequest.reason === "INSUFFICIENT_BALANCE" || (capitalRequest.reason && capitalRequest.reason.includes("saldo"))) {
        return { success: false, reason: "INSUFFICIENT_BALANCE" };
      }
      
      return { success: false, reason: capitalRequest.reason };
    }
    
    const validation = risk.validateTrade(symbol, side, estimatedCost, agent);
    if (!validation.approved) {
      this._returnCapital(agent, estimatedCost, `Validation failed: ${validation.errors.join("; ")}`);
      return { success: false, reason: validation.errors.join("; ") };
    }

    const slip = slippage.estimate(symbol, side, positionInfo.qty);
    if (!slip.acceptable) {
      this._returnCapital(agent, estimatedCost, `Slippage too high: ${slip.estimated}%`);
      return { success: false, reason: `Slippage too high: ${slip.estimated}%` };
    }

    try {
      let stopLossPercent = cfg.stopLoss;
      
      if (performance.consecutiveWins >= 2) {
        stopLossPercent = cfg.stopLoss * 0.7;
        logger.info(`🎯 Stop loss reduzido para ${stopLossPercent}% (sequência de lucros)`, { service: "TradeExecutor" });
      } else if (performance.consecutiveLosses >= 2) {
        stopLossPercent = cfg.stopLoss * 1.3;
        logger.info(`🎯 Stop loss aumentado para ${stopLossPercent}% (sequência de prejuízos)`, { service: "TradeExecutor" });
      }
      
      const stopPrice = side === "BUY" 
        ? ticker.price * (1 - stopLossPercent / 100)
        : ticker.price * (1 + stopLossPercent / 100);
      
      const takeProfitPrice = side === "BUY"
        ? ticker.price * (1 + cfg.takeProfit / 100)
        : ticker.price * (1 - cfg.takeProfit / 100);
      
      logger.info(`🔍 DEBUG: Chamando exchange.placeOrder para ${symbol}`, { service: "TradeExecutor" });
      const order = await exchange.placeOrder(symbol, side, positionInfo.qty, ticker.price, agent);
      
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
        qty: positionInfo.qty,
        estimatedCost: estimatedCost,
        pnl: 0,
        pnlPct: 0,
        stopLoss: stopPrice,
        takeProfit: takeProfitPrice,
        stopLossPercent: stopLossPercent,
        takeProfitPercent: cfg.takeProfit,
        sizeMultiplier: sizeMultiplier,
        predictionUsed: prediction?.patternUsed || null,
        timestamp: new Date().toISOString(),
        orderId: order.orderId,
      };
      
      this.openTrades.push(trade);
      db.addTrade(trade);
      
      eventBus.emit("trade", { action: "OPEN", trade });
      eventBus.emit("trade:opened", trade);
      
      logger.info(`✅ Trade opened: ${side} ${positionInfo.qty.toFixed(6)} ${symbol} @ $${order.price.toFixed(2)} (agent: ${agent})`, { 
        service: "TradeExecutor",
        tradeId: trade.id,
        agent: agent,
        confidence: adjustedConfidence,
        sizeMultiplier: sizeMultiplier
      });
      
      this.dailyStats.totalTrades++;
      
      return { success: true, trade };
      
    } catch (err) {
      logger.error(`Trade execution failed: ${err.message}`, { service: "TradeExecutor" });
      this._returnCapital(agent, estimatedCost, `Execution error: ${err.message}`);
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
        } else {
          logger.warn(`❌ Sinal pendente falhou: ${result.reason}`, { service: "TradeExecutor" });
        }
      });
    }
  }

  // 🔥 ATUALIZA PERFORMANCE E COMPARTILHA COM OUTROS AGENTES
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
    
    // 🔥 COMPARTILHA APRENDIZADO COM OUTROS AGENTES (HFT, ARBITRAGE)
    if (totalTrades > 0 && totalTrades % 10 === 0) {
      const learningData = {
        agentId: "trend",
        type: "performance_update",
        content: `Trend win rate ${perf.winRate.toFixed(0)}% após ${totalTrades} trades (${perf.consecutiveWins > 0 ? `${perf.consecutiveWins} wins seguidos` : `${perf.consecutiveLosses} losses seguidos`})`,
        confidence: perf.winRate / 100,
        data: {
          winRate: perf.winRate,
          totalTrades: totalTrades,
          consecutiveWins: perf.consecutiveWins,
          consecutiveLosses: perf.consecutiveLosses,
          agent: agent
        }
      };
      
      eventBus.emit("learning:share", learningData);
      logger.info(`📤 Trend compartilhou aprendizado: win rate ${perf.winRate.toFixed(0)}%`, { service: "TradeExecutor" });
    }
    
    // Salva no banco
    if (db.updateAgentPerformance) {
      db.updateAgentPerformance(agent, perf);
    }
    
    return perf;
  }

  _monitorOpenTrades() {
    logger.info("🔍 DEBUG: _monitorOpenTrades iniciado", { service: "TradeExecutor" });
    setInterval(() => {
      if (!this.running) return;
      
      const cfg = db.getConfig();
      
      for (const trade of [...this.openTrades]) {
        const ticker = exchange.getTicker(trade.symbol);
        if (!ticker) continue;
        
        const currentPrice = ticker.price;
        const side = trade.side;
        const pnlPct = side === "BUY"
          ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        const pnl = (pnlPct / 100) * trade.entryPrice * trade.qty;
        
        trade.pnl = Math.round(pnl * 100) / 100;
        trade.pnlPct = Math.round(pnlPct * 100) / 100;
        
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
          
          const netResult = trade.pnl;
          if (netResult !== 0) {
            this._returnCapital(trade.agent, netResult, `Trade closed: ${trade.result}`);
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
      agentPerformance: this.agentPerformance
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
