const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService");
const logger = require("./LoggerService");
const capitalDistributor = require("./CapitalDistributorService");

class ArbitrageService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;
    this.isRunning = false;
    this.agentId = "arbitrage";
    this.capitalAllocated = 0;
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.initialized = false;
    
    this.lastScanTime = 0;
    this.lastTradeTime = 0;
    
    // 🔥 CONFIGURAÇÕES MUITO MAIS LENTAS
    this.scanInterval = 60000;           // 60 segundos (antes 30s)
    this.tradeCooldown = 120000;          // 120 segundos (2 minutos)
    
    this.minSpread = 0.15;               
    this.maxPositionPerTrade = 2000;     
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.tradeHistory = [];
    
    // 🔥 LIMITADORES DE TAXA (MUITO MAIS RESTRITIVOS)
    this.tradesThisMinute = 0;
    this.lastMinuteReset = Date.now();
    this.maxTradesPerMinute = 1;          // 🔥 MÁXIMO 1 TRADE POR MINUTO
    
    // 🔥 LIMITADOR DE TRADES POR HORA
    this.tradesThisHour = 0;
    this.lastHourReset = Date.now();
    this.maxTradesPerHour = 10;           // 🔥 MÁXIMO 10 TRADES POR HORA
    
    this.symbolsToScan = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
    this.pendingOpportunities = [];
    
    this.tempRiskMultiplier = 1.0;
    this.tempSpreadAdjustment = 1.0;
    
    this.learningParams = {
      spreadThreshold: 0.15,
      riskMultiplier: 1.0,
    };
    
    // ESCUTA EVENTOS...
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`, { service: "Arbitrage" });
      
      if (!this.isRunning && this.capitalAllocated > 0) {
        this.logger.info(`🚀 Arbitrage detectou capital e vai iniciar automaticamente...`, { service: "Arbitrage" });
        this.start();
      }
    });
    
    EventBus.on("capital:return", ({ agentId, amount, reason }) => {
      if (agentId === this.agentId && amount !== 0) {
        this.capitalAllocated += amount;
        this.logger.info(`💰 Arbitrage recebeu retorno de capital: $${amount}. Novo saldo: $${this.capitalAllocated}`, { service: "Arbitrage" });
        this._processPendingOpportunities();
      }
    });
    
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId) || !improvement.to) {
        this.applyImprovement(improvement);
      }
    });
    
    EventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    EventBus.on("sentiment:extreme", (sentiment) => {
      this.onSentimentExtreme(sentiment);
    });
    
    this.logger.info("ArbitrageService initialized - MODO LENTO (máx 1 trade/minuto)", { service: "Arbitrage" });
  }

  async initialize() {
    if (this.initialized) return { success: true, capital: this.capitalAllocated };
    
    this.logger.info("🔍 Arbitrage: Inicializando e aguardando capital...", { service: "Arbitrage" });
    
    let attempts = 0;
    while (this.capitalAllocated === 0 && attempts < 100) {
      await this.sleep(100);
      attempts++;
    }
    
    this.initialized = true;
    
    if (this.capitalAllocated > 0) {
      this.logger.info(`✅ ArbitrageService initialized com capital $${this.capitalAllocated}`, { service: "Arbitrage" });
      if (!this.isRunning) {
        this.start();
      }
      return { success: true, capital: this.capitalAllocated };
    } else {
      this.logger.warn("⚠️ ArbitrageService initialized sem capital - aguardando evento de alocação", { service: "Arbitrage" });
      return { success: true, capital: 0, waitingForCapital: true };
    }
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.learningParams.spreadThreshold = 0.1;
      this.learningParams.riskMultiplier = 1.2;
      this.logger.info(`📉 Arbitrage ajustou spreadThreshold para ${this.learningParams.spreadThreshold}% (extreme fear)`, { service: "Arbitrage" });
    } else if (sentiment.type === "EXTREME_GREED") {
      this.learningParams.spreadThreshold = 0.25;
      this.learningParams.riskMultiplier = 0.8;
      this.logger.info(`📈 Arbitrage ajustou spreadThreshold para ${this.learningParams.spreadThreshold}% (extreme greed)`, { service: "Arbitrage" });
    }
  }

  applyImprovement(improvement) {
    if (!improvement) return;
    
    this.logger.info(`🧠 Arbitrage recebeu melhoria: ${improvement.recommendation}`, { service: "Arbitrage" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
      case "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE":
        this.tempSpreadAdjustment = Math.max(0.8, this.tempSpreadAdjustment * 0.95);
        this.scanInterval = Math.max(30000, this.scanInterval * 0.95);
        this.logger.info(`⚡ Arbitrage aumentou sensibilidade: spread ajuste=${this.tempSpreadAdjustment}x, scan=${this.scanInterval}ms`, { service: "Arbitrage" });
        break;
        
      case "REDUZIR_RISCO":
      case "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO":
        this.tempRiskMultiplier = Math.max(0.6, this.tempRiskMultiplier * 0.9);
        this.maxPositionPerTrade = Math.max(500, this.maxPositionPerTrade * 0.9);
        this.logger.info(`📉 Arbitrage reduziu risco: riskMultiplier=${this.tempRiskMultiplier}x, maxPosition=$${this.maxPositionPerTrade}`, { service: "Arbitrage" });
        break;
        
      default:
        this.logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "Arbitrage" });
    }
    
    setTimeout(() => {
      this.tempRiskMultiplier = 1.0;
      this.tempSpreadAdjustment = 1.0;
      this.logger.info(`🔄 Arbitrage resetou ajustes temporários`, { service: "Arbitrage" });
    }, 3600000);
  }

  shareLearning() {
    const recentTrades = this.tradeHistory.filter(t => t.isWin !== undefined).slice(-20);
    const wins = recentTrades.filter(t => t.isWin).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 10) {
      const learningData = {
        type: "performance_update",
        content: `Arbitrage win rate ${winRate.toFixed(0)}% nos últimos ${recentTrades.length} trades`,
        confidence: Math.min(0.95, winRate / 100),
        priority: winRate > 65 ? "high" : "normal",
        data: {
          winRate: winRate,
          totalTrades: recentTrades.length,
          spreadThreshold: this.learningParams.spreadThreshold,
          consecutiveLosses: this.consecutiveLosses
        }
      };
      
      EventBus.emit(`learning:${this.agentId}`, learningData);
      this.logger.info(`📤 Arbitrage compartilhou aprendizado: win rate ${winRate.toFixed(0)}%`, { service: "Arbitrage" });
    }
  }

  _processPendingOpportunities() {
    if (this.pendingOpportunities.length === 0) return;
    
    this.logger.info(`🔄 Processando ${this.pendingOpportunities.length} oportunidades pendentes...`, { service: "Arbitrage" });
    
    const toProcess = [...this.pendingOpportunities];
    this.pendingOpportunities = [];
    
    for (const opp of toProcess) {
      this.executeTrade(opp).catch(err => {
        this.logger.error(`Erro ao processar oportunidade pendente: ${err.message}`, { service: "Arbitrage" });
      });
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService: sem capital, vai aguardar alocação...", { service: "Arbitrage" });
      return { success: false, reason: "No capital allocated - waiting" };
    }
    
    this.isRunning = true;
    const effectiveThreshold = this.learningParams.spreadThreshold * this.tempSpreadAdjustment;
    this.logger.info(`🚀 ArbitrageService iniciado com $${this.capitalAllocated} - spread threshold ${effectiveThreshold}%`, { service: "Arbitrage" });
    
    this.scanLoop();
    return { success: true };
  }

  async scanLoop() {
    while (this.isRunning) {
      try {
        const now = Date.now();
        
        if (now - this.lastScanTime < this.scanInterval) {
          await this.sleep(1000);
          continue;
        }
        
        this.lastScanTime = now;
        
        if (now - this.lastTradeTime < this.tradeCooldown) {
          continue;
        }
        
        await this.scanArbitrageOpportunities();
        
      } catch (err) {
        this.logger.error("Erro no scan:", err);
      }
      await this.sleep(1000);
    }
  }

  async scanArbitrageOpportunities() {
    try {
      if (this.capitalAllocated <= 0) return;
      
      // 🔥 VERIFICA LIMITE DE TRADES POR MINUTO
      const now = Date.now();
      if (now - this.lastMinuteReset > 60000) {
        this.tradesThisMinute = 0;
        this.lastMinuteReset = now;
      }
      if (this.tradesThisMinute >= this.maxTradesPerMinute) {
        return;
      }
      
      // 🔥 VERIFICA LIMITE DE TRADES POR HORA
      if (now - this.lastHourReset > 3600000) {
        this.tradesThisHour = 0;
        this.lastHourReset = now;
      }
      if (this.tradesThisHour >= this.maxTradesPerHour) {
        this.logger.debug(`⏸️ Arbitrage: limite de ${this.maxTradesPerHour} trades/hora atingido`);
        return;
      }
      
      // 🔥 ESCANEIA APENAS 1 SÍMBOLO POR VEZ (para reduzir carga)
      for (const symbol of this.symbolsToScan) {
        const opportunity = await this.exchange.getArbitrageOpportunity(symbol);
        
        if (!opportunity) continue;
        
        const effectiveThreshold = this.learningParams.spreadThreshold * this.tempSpreadAdjustment;
        const adjustedThreshold = effectiveThreshold * this.learningParams.riskMultiplier * this.tempRiskMultiplier;
        
        if (opportunity.spread > adjustedThreshold && this.capitalAllocated > 100) {
          const estimatedProfit = this.capitalAllocated * opportunity.spread / 100;
          const capitalRequired = Math.min(this.capitalAllocated, this.maxPositionPerTrade);
          
          this.logger.info(`💰 OPORTUNIDADE em ${symbol}: spread ${opportunity.spread}% | Lucro estimado: $${estimatedProfit.toFixed(2)}`, { service: "Arbitrage" });
          
          const opp = {
            id: `arb_${Date.now()}_${symbol}`,
            spread: opportunity.spread,
            pair: symbol,
            estimatedProfit: estimatedProfit,
            capitalRequired: capitalRequired,
            buyExchange: opportunity.buyExchange,
            sellExchange: opportunity.sellExchange,
            timestamp: Date.now()
          };
          
          this.opportunities.unshift(opp);
          if (this.opportunities.length > 50) this.opportunities.pop();
          
          EventBus.emit("arbitrage:opportunity", opp);
          
          await this.executeTrade(opp);
          return; // SAI APÓS EXECUTAR 1 TRADE
        }
      }
    } catch (err) {
      this.logger.error("Erro ao escanear:", err);
    }
  }

  async executeTrade(opportunity) {
    const now = Date.now();
    
    if (now - this.lastTradeTime < this.tradeCooldown) return;
    if (this.tradesThisMinute >= this.maxTradesPerMinute) return;
    if (this.tradesThisHour >= this.maxTradesPerHour) return;
    
    if (opportunity.capitalRequired > this.capitalAllocated) {
      this.pendingOpportunities.push(opportunity);
      return;
    }
    
    const capitalRequest = await this.requestCapital(opportunity.capitalRequired, `Arbitrage: spread ${opportunity.spread}% em ${opportunity.pair}`);
    
    if (!capitalRequest.success) {
      if (capitalRequest.reason === "Insufficient balance" || capitalRequest.reason?.includes("saldo")) {
        this.pendingOpportunities.push(opportunity);
      }
      return;
    }
    
    this.lastTradeTime = now;
    this.tradesThisMinute++;
    this.tradesThisHour++;
    
    // 🔥 CHANCE DE LUCRO MAIS CONSERVADORA
    const winChance = Math.min(0.7, 0.55 + (opportunity.spread / 150));
    const isWin = Math.random() < winChance;
    
    const profitMultiplier = 0.3 + (opportunity.spread / 150) + (Math.random() * 0.3);
    const profit = isWin ? opportunity.estimatedProfit * profitMultiplier : -opportunity.estimatedProfit * 0.5;
    
    const trade = {
      id: `arb_trade_${Date.now()}`,
      agentId: this.agentId,
      pair: opportunity.pair,
      spread: opportunity.spread,
      estimatedProfit: opportunity.estimatedProfit,
      actualProfit: profit,
      isWin: profit > 0,
      timestamp: now
    };
    
    this.tradeHistory.unshift(trade);
    if (this.tradeHistory.length > 100) this.tradeHistory.pop();
    
    if (profit > 0) {
      this.dailyProfit += profit;
      this.consecutiveLosses = 0;
      this.logger.info(`✅ Arbitrage lucrou: $${profit.toFixed(2)} (spread: ${opportunity.spread}%)`, { service: "Arbitrage" });
      EventBus.emit("agent:profit", { agentId: this.agentId, amount: profit, tradeId: trade.id });
    } else {
      this.dailyLoss += Math.abs(profit);
      this.consecutiveLosses++;
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)} (spread: ${opportunity.spread}%)`, { service: "Arbitrage" });
      
      if (this.consecutiveLosses >= 3) {
        this.logger.warn(`🚨 Arbitrage: 3 perdas consecutivas! Pausando...`, { service: "Arbitrage" });
        EventBus.emit("agent:coldStreak", { agentId: this.agentId, streak: this.consecutiveLosses });
        await this.sleep(180000);
        this.consecutiveLosses = 0;
      }
    }
    
    if (this.tradeHistory.length % 10 === 0 && this.tradeHistory.length > 0) {
      this.shareLearning();
    }
    
    EventBus.emit("capital:return", { agentId: this.agentId, amount: profit, reason: `Trade closed: ${profit > 0 ? "WIN" : "LOSS"}` });
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

  getStatus() {
    const effectiveThreshold = this.learningParams.spreadThreshold * this.tempSpreadAdjustment;
    
    return {
      running: this.isRunning,
      capitalAvailable: this.capitalAllocated,
      spreadThreshold: effectiveThreshold,
      baseSpreadThreshold: this.learningParams.spreadThreshold,
      riskMultiplier: this.learningParams.riskMultiplier * this.tempRiskMultiplier,
      dailyProfit: Math.round(this.dailyProfit * 100) / 100,
      dailyLoss: Math.round(this.dailyLoss * 100) / 100,
      netDaily: Math.round((this.dailyProfit - this.dailyLoss) * 100) / 100,
      totalTrades: this.tradeHistory.length,
      opportunitiesFound: this.opportunities.length,
      pendingOpportunities: this.pendingOpportunities.length,
      consecutiveLosses: this.consecutiveLosses,
      tradesThisMinute: this.tradesThisMinute,
      maxTradesPerMinute: this.maxTradesPerMinute,
      tradesThisHour: this.tradesThisHour,
      maxTradesPerHour: this.maxTradesPerHour
    };
  }

  getMetrics() {
    const wins = this.tradeHistory.filter(t => t.isWin).length;
    const totalProfit = this.tradeHistory.reduce((sum, t) => sum + (t.actualProfit > 0 ? t.actualProfit : 0), 0);
    const totalLoss = Math.abs(this.tradeHistory.reduce((sum, t) => sum + (t.actualProfit < 0 ? t.actualProfit : 0), 0));
    
    return {
      totalTrades: this.tradeHistory.length,
      wins: wins,
      losses: this.tradeHistory.length - wins,
      winRate: this.tradeHistory.length > 0 ? (wins / this.tradeHistory.length) * 100 : 0,
      totalProfit: totalProfit,
      totalLoss: totalLoss,
      netProfit: totalProfit - totalLoss,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      capital: this.capitalAllocated,
      spreadThreshold: this.learningParams.spreadThreshold
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  stop() {
    this.isRunning = false;
    this.logger.info("ArbitrageService stopped", { service: "Arbitrage" });
    return { success: true };
  }
  
  resetDaily() {
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.consecutiveLosses = 0;
    this.tradeHistory = [];
    this.opportunities = [];
    this.pendingOpportunities = [];
    this.tradesThisMinute = 0;
    this.tradesThisHour = 0;
    this.logger.info("ArbitrageService daily counters reset", { service: "Arbitrage" });
    return { success: true };
  }
}

module.exports = new ArbitrageService();
