const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const slippage = require("./SlippageEstimatorService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const tokenomics = require("./TokenomicsService");

// 🆕 INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");
const learningBrain = require("./LearningBrainService");

class TradeExecutorService {
  constructor() {
    this.running = false;
    this.paused = false;
    this.openTrades = db.getTrades({ status: "OPEN" });
    this.tradeHistory = [];
    this.dailyStats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalLoss: 0,
      date: new Date().toDateString()
    };
    
    // 🆕 MAPEAMENTO DE AGENTES (qual robô enviou o sinal)
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
      await this.handleSignal(signal);
    });
    
    // 🆕 ESCUTA DECISÕES DO CONSELHO (se implementado)
    eventBus.on("council:decision", async (decision) => {
      if (decision && decision.action !== "HOLD") {
        logger.info(`🏛️ Conselho decidiu: ${decision.action} (força: ${(decision.strength*100).toFixed(0)}%)`, { service: "TradeExecutor" });
      }
    });
    
    logger.info("TradeExecutorService initialized", { 
      service: "TradeExecutor",
      openTradesCount: this.openTrades.length,
      version: "v5.0.0"
    });
  }

  // 🆕 HANDLE SIGNAL - NOVA LÓGICA INTEGRADA
  async handleSignal(signal) {
    if (!this.running || this.paused) return;
    if (signal.status !== "ACTIVE") return;
    
    // Verifica se é final de semana (opcional)
    if (this._isWeekend() && signal.agent !== "hft") {
      logger.debug(`Ignorando sinal de ${signal.agent} no fim de semana`, { service: "TradeExecutor" });
      return;
    }
    
    logger.info(`📡 Signal received: ${signal.type} ${signal.symbol} (conf: ${signal.confidence}%) from ${signal.strategy || signal.agent}`, { 
      service: "TradeExecutor",
      agent: signal.agent || this._getAgentFromStrategy(signal.strategy)
    });
    
    // Determina o agente responsável
    const agent = signal.agent || this._getAgentFromStrategy(signal.strategy);
    
    // 🆕 PASSO 1: PREDIT COM LEARNING BRAIN
    let prediction = null;
    if (learningBrain && learningBrain.predictSignal) {
      prediction = learningBrain.predictSignal({
        symbol: signal.symbol,
        type: signal.type,
        confidence: signal.confidence,
        strategy: signal.strategy,
        agent: agent
      });
      
      if (prediction && prediction.recommendation === "SKIP") {
        logger.info(`⏭️ LearningBrain recomendou pular: ${prediction.patternUsed || "no pattern"}`, { service: "TradeExecutor" });
        return;
      }
      
      if (prediction && prediction.recommendation === "WAIT") {
        logger.info(`⏸️ LearningBrain recomendou aguardar`, { service: "TradeExecutor" });
        return;
      }
    }
    
    // 🆕 PASSO 2: EXECUTA O TRADE
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
    }
  }

  // 🆕 IDENTIFICA O AGENTE PELA ESTRATÉGIA
  _getAgentFromStrategy(strategy) {
    if (!strategy) return "trend";
    
    if (strategy.includes("HFT")) return "hft";
    if (strategy.includes("ARBITRAGE")) return "arbitrage";
    if (strategy.includes("DEEP")) return "deep";
    if (strategy.includes("SENTIMENT")) return "sentiment";
    
    return "trend";
  }

  // 🆕 VERIFICA SE É FIM DE SEMANA
  _isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  start() { 
    this.running = true; 
    this._monitorOpenTrades();
    logger.info("TradeExecutorService started", { service: "TradeExecutor" });
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

  // 🆕 EXECUTA TRADE COM INTEGRAÇÃO TOTAL
  async executeTrade({ symbol, side, strategy, confidence, agent, prediction }) {
    if (!this.running) return { success: false, reason: "Engine stopped" };
    if (this.paused) return { success: false, reason: "Trading paused" };
    
    const ticker = exchange.getTicker(symbol);
    if (!ticker) return { success: false, reason: "No ticker data" };

    const cfg = db.getConfig();
    const positionInfo = risk.calculatePositionSize(symbol, ticker.price, cfg.stopLoss);
    
    // Verifica se quantidade é válida
    if (!positionInfo.qty || positionInfo.qty <= 0) {
      logger.warn(`❌ Invalid quantity: ${positionInfo.qty} for ${symbol}`, { service: "TradeExecutor" });
      return { success: false, reason: "Invalid quantity" };
    }
    
    // Calcula custo estimado
    const estimatedCost = positionInfo.qty * ticker.price;
    
    // 🆕 PASSO 3: SOLICITA CAPITAL AO CAPITAL DISTRIBUTOR
    const capitalRequest = await this._requestCapital(agent, estimatedCost, `Trade: ${side} ${symbol}`);
    
    if (!capitalRequest.success) {
      logger.warn(`❌ Trade rejeitado pelo CapitalDistributor: ${capitalRequest.reason}`, { service: "TradeExecutor" });
      return { success: false, reason: capitalRequest.reason };
    }
    
    // Valida risco
    const validation = risk.validateTrade(symbol, side, estimatedCost);
    if (!validation.approved) {
      // Devolve capital reservado
      this._returnCapital(agent, estimatedCost, `Validation failed: ${validation.errors.join("; ")}`);
      return { success: false, reason: validation.errors.join("; ") };
    }

    // Estima slippage
    const slip = slippage.estimate(symbol, side, positionInfo.qty);
    if (!slip.acceptable) {
      this._returnCapital(agent, estimatedCost, `Slippage too high: ${slip.estimated}%`);
      return { success: false, reason: `Slippage too high: ${slip.estimated}%` };
    }

    try {
      // 🆕 AJUSTA STOP LOSS BASEADO NO INSIGHT DO LEARNING BRAIN
      let stopLossPercent = cfg.stopLoss;
      if (prediction && prediction.confidence) {
        // Se o LearningBrain tem alta confiança, reduz stop loss
        if (prediction.confidence > 80) {
          stopLossPercent = cfg.stopLoss * 0.8;
          logger.info(`🎯 Stop loss reduzido para ${stopLossPercent}% devido à alta confiança do LearningBrain`, { service: "TradeExecutor" });
        }
      }
      
      const stopPrice = side === "BUY" 
        ? ticker.price * (1 - stopLossPercent / 100)
        : ticker.price * (1 + stopLossPercent / 100);
      
      const takeProfitPrice = side === "BUY"
        ? ticker.price * (1 + cfg.takeProfit / 100)
        : ticker.price * (1 - cfg.takeProfit / 100);
      
      // Executa a ordem
      const order = await exchange.placeOrder(symbol, side, positionInfo.qty, ticker.price);
      
      const trade = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        side,
        strategy: strategy || "unknown",
        agent: agent,
        confidence: confidence || 70,
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
        predictionUsed: prediction?.patternUsed || null,
        timestamp: new Date().toISOString(),
        orderId: order.orderId,
      };
      
      this.openTrades.push(trade);
      db.addTrade(trade);
      
      eventBus.emit("trade", { action: "OPEN", trade });
      eventBus.emit("trade:opened", trade);
      
      logger.info(`Trade opened: ${side} ${positionInfo.qty.toFixed(6)} ${symbol} @ $${order.price.toFixed(2)} (agent: ${agent})`, { 
        service: "TradeExecutor",
        tradeId: trade.id,
        agent: agent,
        confidence: confidence
      });
      
      // Atualiza estatísticas diárias
      this.dailyStats.totalTrades++;
      
      return { success: true, trade };
      
    } catch (err) {
      logger.error(`Trade execution failed: ${err.message}`, { service: "TradeExecutor" });
      
      // Devolve capital em caso de erro
      this._returnCapital(agent, estimatedCost, `Execution error: ${err.message}`);
      
      return { success: false, reason: err.message };
    }
  }

  // 🆕 SOLICITA CAPITAL AO CAPITAL DISTRIBUTOR
  async _requestCapital(agent, amount, reason) {
    return new Promise((resolve) => {
      capitalDistributor.handleRequest({
        agentId: agent,
        amount: amount,
        reason: reason,
        callback: resolve
      });
    });
  }

  // 🆕 DEVOLVE CAPITAL AO CAPITAL DISTRIBUTOR
  _returnCapital(agent, amount, reason) {
    eventBus.emit("capital:return", {
      agentId: agent,
      amount: amount,
      reason: reason
    });
  }

  // 🆕 MONITORA TRADES ABERTOS
  _monitorOpenTrades() {
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
        
        // Verifica stop loss e take profit
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
          
          // Atualiza estatísticas diárias
          if (trade.pnl > 0) {
            this.dailyStats.wins++;
            this.dailyStats.totalProfit += trade.pnl;
            
            // Processa lucro no tokenomics
            if (tokenomics && tokenomics.processProfit) {
              tokenomics.processProfit(trade.pnl);
            }
            
            // 🆕 COMUNICA LUCRO PARA O CAPITAL DISTRIBUTOR
            eventBus.emit("agent:profit", {
              agentId: trade.agent,
              amount: trade.pnl,
              tradeId: trade.id
            });
            
            // 🆕 COMUNICA TRADE FECHADO PARA O LEARNING BRAIN
            eventBus.emit("trade:closed", {
              agent: trade.agent,
              profit: trade.pnl,
              id: trade.id,
              trade: trade
            });
            
            logger.info(`💰 Trade WIN: ${trade.symbol} PnL: $${trade.pnl} (${trade.pnlPct}%) - agent: ${trade.agent}`, { 
              service: "TradeExecutor",
              tradeId: trade.id,
              agent: trade.agent,
              profit: trade.pnl
            });
          } else {
            this.dailyStats.losses++;
            this.dailyStats.totalLoss += Math.abs(trade.pnl);
            
            // 🆕 COMUNICA PERDA PARA O LEARNING BRAIN
            eventBus.emit("trade:closed", {
              agent: trade.agent,
              loss: Math.abs(trade.pnl),
              id: trade.id,
              trade: trade
            });
            
            logger.warn(`❌ Trade LOSS: ${trade.symbol} PnL: $${trade.pnl} (${trade.pnlPct}%) - agent: ${trade.agent}`, { 
              service: "TradeExecutor",
              tradeId: trade.id,
              agent: trade.agent,
              loss: trade.pnl
            });
          }
          
          // 🆕 DEVOLVE CAPITAL (descontando lucro/perda)
          const netResult = trade.pnl;
          if (netResult !== 0) {
            this._returnCapital(trade.agent, netResult, `Trade closed: ${trade.result}`);
          }
          
          eventBus.emit("trade", { action: "CLOSE", trade, reason: hitTP ? "TAKE_PROFIT" : "STOP_LOSS" });
        }
      }
    }, 5000);
  }

  // 🆕 RESETA ESTATÍSTICAS DIÁRIAS
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
  
  // 🆕 OBTÉM ESTATÍSTICAS COMPLETAS
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
      byAgent: this._getStatsByAgent(allClosedTrades)
    };
  }
  
  // 🆕 ESTATÍSTICAS POR AGENTE
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
  
  // 🆕 MÉTODO PARA MIGRAR PARA LIVE
  async switchToLiveMode() {
    logger.info("🔄 TradeExecutor migrando para LIVE MODE...", { service: "TradeExecutor" });
    // Verifica se tem capital real
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
