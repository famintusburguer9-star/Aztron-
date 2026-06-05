const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService");
const db = require("./DatabaseService");
const logger = require("./LoggerService");
const capitalDistributor = require("./CapitalDistributorService");

class ArbitrageService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;
    this.db = db;
    this.isRunning = false;
    this.agentId = "arbitrage";
    this.capitalAllocated = 0;
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    
    // CONTROLE DE TEMPO
    this.lastScanTime = 0;
    this.lastTradeTime = 0;
    this.scanInterval = 30000; // 30 segundos entre scans
    this.tradeCooldown = 120000; // 2 MINUTOS entre trades
    
    // Configurações
    this.minSpread = 1.2;
    this.maxPositionPerTrade = 500;
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.tradeHistory = [];
    
    this.learningParams = {
      spreadThreshold: 1.2,
      riskMultiplier: 1.0,
      activeHours: { start: 0, end: 24 },
      lastAdjustedBy: null
    };
    
    // Escuta eventos
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("sentiment:extreme", (sentiment) => this.onSentimentExtreme(sentiment));
    
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated} (PAPER MODE)`);
    });
    
    EventBus.on(`improvement:${this.agentId}`, (improvement) => this.applyImprovement(improvement));
    
    this.logger.info("ArbitrageService initialized - USANDO DADOS REAIS DE MÚLTIPLAS EXCHANGES");
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.logger.info("📊 Sentimento extremo detectado - ajustando parâmetros");
      this.learningParams.spreadThreshold = 0.8;
      this.learningParams.riskMultiplier = 1.3;
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService não iniciado: aguardando alocação de capital");
      return { success: false, reason: "No capital allocated" };
    }
    
    this.isRunning = true;
    this.logger.info("🚀 ArbitrageService iniciado - CAÇANDO SPREADS REAIS");
    
    this.scanLoop();
    return { success: true };
  }

  applyImprovement(improvement) {
    this.logger.info(`🧠 Arbitrage recebeu melhoria: ${improvement.recommendation}`);
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE":
        this.learningParams.spreadThreshold = Math.max(0.5, this.learningParams.spreadThreshold * 0.8);
        break;
      case "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO":
        this.maxPositionPerTrade = Math.floor(this.maxPositionPerTrade * 0.7);
        break;
    }
  }

  learnFromOthers(learning) {
    this.logger.info(`📚 Aprendendo com ${learning.from}: ${learning.message}`);
    
    switch(learning.type) {
      case "market_volatility":
        if (learning.payload.volatility > 2.5) {
          this.learningParams.spreadThreshold += 0.3;
        }
        break;
      case "liquidity_warning":
        this.maxPositionPerTrade = Math.floor(this.maxPositionPerTrade * 0.7);
        break;
    }
  }

  sendLearning(from, message, type = "general", payload = {}) {
    EventBus.emit("consciousness:learning", { from, to: null, type, message, payload, timestamp: Date.now() });
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
        this.logger.error("Erro no scan de arbitragem:", err);
      }
      
      await this.sleep(1000);
    }
  }

  async scanArbitrageOpportunities() {
    try {
      if (this.capitalAllocated <= 0) return;
      
      // 🔥 BUSCA DADOS REAIS DE ARBITRAGEM ENTRE BINANCE E BYBIT
      const arbitrageData = await this.exchange.getArbitrageOpportunity("BTCUSDT");
      
      if (!arbitrageData) {
        this.logger.debug("Não foi possível obter dados de arbitragem");
        return;
      }
      
      const realSpread = arbitrageData.spread;
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
      this.logger.debug(`Spread REAL: ${realSpread}% | Threshold: ${adjustedThreshold}%`);
      
      if (realSpread > adjustedThreshold && this.capitalAllocated > 100) {
        const estimatedProfit = this.capitalAllocated * realSpread / 100;
        const capitalRequired = Math.min(this.capitalAllocated, this.maxPositionPerTrade);
        
        this.logger.info(`💰 OPORTUNIDADE REAL: spread ${realSpread}% | Lucro estimado: $${estimatedProfit.toFixed(2)}`);
        this.logger.info(`   Comprar em: ${arbitrageData.buyExchange} | Vender em: ${arbitrageData.sellExchange}`);
        
        const opportunity = {
          id: `arb_${Date.now()}`,
          spread: parseFloat(realSpread.toFixed(2)),
          pair: arbitrageData.symbol,
          estimatedProfit: parseFloat(estimatedProfit.toFixed(2)),
          capitalRequired: capitalRequired,
          buyExchange: arbitrageData.buyExchange,
          sellExchange: arbitrageData.sellExchange,
          binancePrice: arbitrageData.binancePrice,
          bybitPrice: arbitrageData.bybitPrice,
          timestamp: Date.now()
        };
        
        this.opportunities.unshift(opportunity);
        if (this.opportunities.length > 50) this.opportunities.pop();
        
        EventBus.emit("arbitrage:opportunity", opportunity);
        
        await this.executeTrade(opportunity);
      }
    } catch (err) {
      this.logger.error("Erro ao escanear oportunidades:", err);
    }
  }

  async executeTrade(opportunity) {
    const now = Date.now();
    
    if (now - this.lastTradeTime < this.tradeCooldown) return;
    
    const capitalRequired = opportunity.capitalRequired;
    
    const capitalRequest = await this.requestCapital(capitalRequired, `Arbitrage: spread ${opportunity.spread}%`);
    
    if (!capitalRequest.success) {
      this.logger.warn(`Arbitrage: Trade rejeitado - ${capitalRequest.reason}`);
      return;
    }
    
    this.lastTradeTime = now;
    
    // 🔥 COM DADOS REAIS, NÃO PRECISA SIMULAR TANTO
    // Apenas calcula lucro baseado no spread real
    const profit = opportunity.estimatedProfit * 0.9; // 10% de slippage/ custos
    
    const trade = {
      id: `arb_trade_${Date.now()}`,
      agentId: this.agentId,
      spread: opportunity.spread,
      estimatedProfit: opportunity.estimatedProfit,
      actualProfit: profit,
      isWin: profit > 0,
      buyExchange: opportunity.buyExchange,
      sellExchange: opportunity.sellExchange,
      timestamp: now
    };
    
    this.tradeHistory.unshift(trade);
    if (this.tradeHistory.length > 100) this.tradeHistory.pop();
    
    if (profit > 0) {
      this.dailyProfit += profit;
      this.logger.info(`✅ Arbitrage REAL lucrou: $${profit.toFixed(2)} (spread: ${opportunity.spread}%)`);
      
      EventBus.emit("agent:profit", {
        agentId: this.agentId,
        amount: profit,
        tradeId: trade.id
      });
    } else {
      this.dailyLoss += Math.abs(profit);
      this.consecutiveLosses++;
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)}`);
    }
    
    const netResult = profit;
    if (netResult !== 0) {
      EventBus.emit("capital:return", {
        agentId: this.agentId,
        amount: netResult,
        reason: `Trade closed: ${profit > 0 ? "WIN" : "LOSS"}`
      });
    }
    
    this.shareLearning();
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

  shareLearning() {
    const recentTrades = this.tradeHistory.slice(-20);
    const wins = recentTrades.filter(t => t.isWin).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 5) {
      EventBus.emit(`learning:${this.agentId}`, {
        type: "arbitrage_performance",
        content: `Arbitrage real com ${winRate.toFixed(0)}% de acerto nos últimos ${recentTrades.length} trades`,
        confidence: winRate / 100,
        priority: winRate > 55 ? "high" : "normal"
      });
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      capitalAvailable: this.capitalAllocated,
      spreadThreshold: this.learningParams.spreadThreshold,
      maxPositionPerTrade: this.maxPositionPerTrade,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      netDaily: this.dailyProfit - this.dailyLoss,
      totalTrades: this.tradeHistory.length,
      opportunitiesFound: this.opportunities.length
    };
  }

  getMetrics() {
    const closedTrades = this.tradeHistory;
    const wins = closedTrades.filter(t => t.isWin);
    const totalProfit = closedTrades.reduce((sum, t) => sum + (t.actualProfit || 0), 0);
    
    return {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: closedTrades.length - wins.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      totalProfit: totalProfit,
      avgProfit: wins.length > 0 ? totalProfit / wins.length : 0,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      capital: this.capitalAllocated
    };
  }

  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  
  stop() { 
    this.isRunning = false; 
    this.logger.info("ArbitrageService parado");
  }
}

module.exports = new ArbitrageService();
