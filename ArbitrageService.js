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
    
    this.lastScanTime = 0;
    this.lastTradeTime = 0;
    
    // 🔥 CONFIGURAÇÕES MAIS AGRESSIVAS
    this.scanInterval = 20000;           // 20 segundos (antes 30s)
    this.tradeCooldown = 60000;          // 60 segundos (antes 120s)
    
    this.minSpread = 0.3;                // 🔥 0.3% (antes 1.2%)
    this.maxPositionPerTrade = 1000;     // 🔥 $1000 (antes $500)
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.tradeHistory = [];
    
    this.learningParams = {
      spreadThreshold: 0.3,              // 🔥 0.3% (antes 1.2%)
      riskMultiplier: 1.2,              // 🔥 1.2 (antes 1.0)
    };
    
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("sentiment:extreme", (sentiment) => this.onSentimentExtreme(sentiment));
    
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated}`);
    });
    
    this.logger.info("ArbitrageService initialized - MODO AGRESSIVO (spread 0.3%)");
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.learningParams.spreadThreshold = 0.2;  // 🔥 Ainda mais baixo no medo extremo
      this.learningParams.riskMultiplier = 1.5;
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService: aguardando alocação de capital");
      return { success: false, reason: "No capital allocated" };
    }
    
    this.isRunning = true;
    this.logger.info("🚀 ArbitrageService iniciado - MODO AGRESSIVO (spread threshold 0.3%)");
    
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
      
      // Busca oportunidade via ExchangeAdapter
      const opportunity = await this.exchange.getArbitrageOpportunity("BTCUSDT");
      
      if (!opportunity) return;
      
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
      // 🔥 CRITÉRIO MAIS AGRESSIVO
      if (opportunity.spread > adjustedThreshold && this.capitalAllocated > 50) {
        const estimatedProfit = this.capitalAllocated * opportunity.spread / 100;
        const capitalRequired = Math.min(this.capitalAllocated, this.maxPositionPerTrade);
        
        this.logger.info(`💰 OPORTUNIDADE: spread ${opportunity.spread}% | Lucro estimado: $${estimatedProfit.toFixed(2)}`);
        this.logger.info(`   Comprar em: ${opportunity.buyExchange} | Vender em: ${opportunity.sellExchange}`);
        
        const opp = {
          id: `arb_${Date.now()}`,
          spread: opportunity.spread,
          pair: opportunity.symbol,
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
      }
    } catch (err) {
      this.logger.error("Erro ao escanear:", err);
    }
  }

  async executeTrade(opportunity) {
    const now = Date.now();
    
    if (now - this.lastTradeTime < this.tradeCooldown) return;
    
    const capitalRequest = await this.requestCapital(opportunity.capitalRequired, `Arbitrage: spread ${opportunity.spread}%`);
    
    if (!capitalRequest.success) {
      this.logger.warn(`Trade rejeitado: ${capitalRequest.reason}`);
      return;
    }
    
    this.lastTradeTime = now;
    
    // 🔥 SIMULA RESULTADO (60% de chance de lucro, mais realista)
    const isWin = Math.random() < 0.6;
    const profit = isWin ? opportunity.estimatedProfit * (0.3 + Math.random() * 0.7) : -opportunity.estimatedProfit * 0.6;
    
    const trade = {
      id: `arb_trade_${Date.now()}`,
      agentId: this.agentId,
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
      this.logger.info(`✅ Arbitrage lucrou: $${profit.toFixed(2)} (spread: ${opportunity.spread}%)`);
      EventBus.emit("agent:profit", { agentId: this.agentId, amount: profit, tradeId: trade.id });
    } else {
      this.dailyLoss += Math.abs(profit);
      this.consecutiveLosses++;
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)}`);
      
      if (this.consecutiveLosses >= 3) {
        this.logger.warn("⚠️ 3 perdas consecutivas! Reduzindo spreadThreshold");
        this.learningParams.spreadThreshold *= 0.9;
        this.consecutiveLosses = 0;
      }
    }
    
    EventBus.emit("capital:return", { agentId: this.agentId, amount: profit, reason: `Trade closed` });
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
    return {
      running: this.isRunning,
      capitalAvailable: this.capitalAllocated,
      spreadThreshold: this.learningParams.spreadThreshold,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      totalTrades: this.tradeHistory.length,
      opportunitiesFound: this.opportunities.length
    };
  }

  getMetrics() {
    const wins = this.tradeHistory.filter(t => t.isWin).length;
    return {
      totalTrades: this.tradeHistory.length,
      wins: wins,
      losses: this.tradeHistory.length - wins,
      winRate: this.tradeHistory.length > 0 ? (wins / this.tradeHistory.length) * 100 : 0,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      capital: this.capitalAllocated
    };
  }

  learnFromOthers(learning) {}
  applyImprovement(improvement) {}
  adjustStrategy(advice) {}
  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  stop() { this.isRunning = false; }
}

module.exports = new ArbitrageService();
