const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService"); // ← USA O EXCHANGE ADAPTER!
const logger = require("./LoggerService");
const capitalDistributor = require("./CapitalDistributorService");

class ArbitrageService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;  // ← USA O EXCHANGE ADAPTER!
    this.isRunning = false;
    this.agentId = "arbitrage";
    this.capitalAllocated = 0;
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    
    this.lastScanTime = 0;
    this.lastTradeTime = 0;
    this.scanInterval = 30000;
    this.tradeCooldown = 120000;
    
    this.minSpread = 1.2;
    this.maxPositionPerTrade = 500;
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.tradeHistory = [];
    
    this.learningParams = {
      spreadThreshold: 1.2,
      riskMultiplier: 1.0,
    };
    
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("sentiment:extreme", (sentiment) => this.onSentimentExtreme(sentiment));
    
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated}`);
    });
    
    this.logger.info("ArbitrageService initialized - usando simulação do ExchangeAdapter");
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.learningParams.spreadThreshold = 0.8;
      this.learningParams.riskMultiplier = 1.3;
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService: aguardando alocação de capital");
      return { success: false, reason: "No capital allocated" };
    }
    
    this.isRunning = true;
    this.logger.info("🚀 ArbitrageService iniciado - usando simulação realista");
    
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
      
      // 🔥 USA O MÉTODO DO EXCHANGE ADAPTER (SIMULAÇÃO REALISTA)
      const opportunity = await this.exchange.getArbitrageOpportunity("BTCUSDT");
      
      if (!opportunity) return;
      
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
      if (opportunity.spread > adjustedThreshold && this.capitalAllocated > 100) {
        const estimatedProfit = this.capitalAllocated * opportunity.spread / 100;
        const capitalRequired = Math.min(this.capitalAllocated, this.maxPositionPerTrade);
        
        this.logger.info(`💰 Oportunidade: spread ${opportunity.spread}% | Lucro estimado: $${estimatedProfit.toFixed(2)}`);
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
    
    // Simula resultado (70% de chance de lucro)
    const isWin = Math.random() < 0.7;
    const profit = isWin ? opportunity.estimatedProfit * (0.5 + Math.random() * 0.5) : -opportunity.estimatedProfit * 0.5;
    
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
      this.logger.info(`✅ Arbitrage lucrou: $${profit.toFixed(2)}`);
      EventBus.emit("agent:profit", { agentId: this.agentId, amount: profit, tradeId: trade.id });
    } else {
      this.dailyLoss += Math.abs(profit);
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)}`);
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
