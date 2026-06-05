const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService");
const db = require("./DatabaseService");
const logger = require("./LoggerService");

// 🆕 IMPORT PARA INTEGRAÇÃO COM NOVOS SERVIÇOS
const capitalDistributor = require("./CapitalDistributorService");
const learningBrain = require("./LearningBrainService");

class ArbitrageService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;
    this.db = db;
    this.isRunning = false;
    
    // 🆕 INTEGRAÇÃO COM CAPITAL DISTRIBUTOR
    this.agentId = "arbitrage";
    this.capitalAllocated = 0;
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    
    // Configurações
    this.minSpread = 1.2;
    this.maxPositionPerTrade = 500;
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.performanceHistory = [];
    this.tradeHistory = [];
    
    this.learningParams = {
      spreadThreshold: 1.2,
      riskMultiplier: 1.0,
      activeHours: { start: 0, end: 24 },
      lastAdjustedBy: null
    };
    
    // Escuta eventos do sistema
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("sentiment:extreme", (sentiment) => this.onSentimentExtreme(sentiment));
    
    // 🆕 ESCUTA ALOCAÇÃO DE CAPITAL DO CAPITAL DISTRIBUTOR
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`, { service: "ArbitrageService" });
    });
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    EventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    this.logger.info("ArbitrageService initialized", { service: "ArbitrageService" });
  }

  // 🆕 APLICA MELHORIAS RECEBIDAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    this.logger.info(`🧠 Arbitrage recebeu melhoria: ${improvement.recommendation}`, { service: "ArbitrageService" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE":
        this.learningParams.spreadThreshold = Math.max(0.5, this.learningParams.spreadThreshold * 0.8);
        this.logger.info(`📈 Aumentando sensibilidade: spreadThreshold agora ${this.learningParams.spreadThreshold}%`, { service: "ArbitrageService" });
        break;
        
      case "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO":
        this.maxPositionPerTrade = Math.floor(this.maxPositionPerTrade * 0.7);
        this.logger.info(`📉 Reduzindo posição máxima para $${this.maxPositionPerTrade}`, { service: "ArbitrageService" });
        break;
        
      default:
        this.logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "ArbitrageService" });
    }
    
    // Compartilha aprendizado
    this.shareLearning();
  }

  // 🆕 COMPARTILHA APRENDIZADO COM O LEARNING BRAIN
  shareLearning() {
    const recentTrades = this.tradeHistory.slice(-20);
    const wins = recentTrades.filter(t => t.profit > 0).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 5) {
      const learningData = {
        type: "arbitrage_performance",
        content: `Arbitrage com ${winRate.toFixed(0)}% de acerto nos últimos ${recentTrades.length} trades - spread médio ${this.learningParams.spreadThreshold}%`,
        confidence: winRate / 100,
        priority: winRate > 65 ? "high" : "normal",
        data: {
          winRate: winRate,
          totalTrades: recentTrades.length,
          spreadThreshold: this.learningParams.spreadThreshold,
          avgProfit: recentTrades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0) / (wins || 1)
        }
      };
      
      EventBus.emit(`learning:${this.agentId}`, learningData);
      this.logger.debug(`📤 Arbitrage compartilhou aprendizado: win rate ${winRate.toFixed(0)}%`, { service: "ArbitrageService" });
    }
  }

  // 🆕 SOLICITA CAPITAL PARA EXECUTAR UM TRADE
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
  
  // 🆕 DEVOLVE CAPITAL NÃO UTILIZADO
  returnCapital(amount, reason) {
    EventBus.emit("capital:return", {
      agentId: this.agentId,
      amount: amount,
      reason: reason
    });
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.logger.info("📊 Sentimento extremo detectado - ajustando parâmetros");
      this.learningParams.spreadThreshold = 0.8;
      this.learningParams.riskMultiplier = 1.3;
      this.sendLearning("ArbitrageService", "Ajustei spreadThreshold para 0.8 devido ao EXTREME_FEAR");
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    // Verifica se tem capital
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService não iniciado: aguardando alocação de capital", { service: "ArbitrageService" });
      return { success: false, reason: "No capital allocated" };
    }
    
    this.isRunning = true;
    this.logger.info("🚀 ArbitrageService iniciado - MODO GUERRA ATIVADO", { service: "ArbitrageService" });
    
    this.scanLoop();
    
    return { success: true };
  }

  learnFromOthers(learning) {
    this.logger.info(`📚 Aprendendo com ${learning.from}: ${learning.message}`);
    
    switch(learning.type) {
      case "market_volatility":
        if (learning.payload.volatility > 2.5) {
          this.learningParams.spreadThreshold += 0.3;
          this.logger.info("Aumentando spreadThreshold devido à alta volatilidade");
        }
        break;
      case "liquidity_warning":
        this.maxPositionPerTrade = Math.floor(this.maxPositionPerTrade * 0.7);
        this.logger.warn(`Reduzindo posição máxima para $${this.maxPositionPerTrade} devido à baixa liquidez`);
        break;
      case "strategy_profit":
        if (learning.payload.strategy === "arbitrage" && learning.payload.result === "loss") {
          this.consecutiveLosses++;
          if (this.consecutiveLosses >= 3) {
            this.sendLearning("ArbitrageService", "3 perdas consecutivas - reduzindo spreadThreshold em 20%");
            this.learningParams.spreadThreshold *= 0.8;
            this.consecutiveLosses = 0;
          }
        }
        break;
    }
  }

  sendLearning(from, message, type = "general", payload = {}) {
    const learningEvent = {
      from: from,
      to: null,
      type: type,
      message: message,
      payload: payload,
      timestamp: Date.now()
    };
    EventBus.emit("consciousness:learning", learningEvent);
    this.logger.info(`🧠 Enviando aprendizado: ${message}`);
  }

  async scanLoop() {
    while (this.isRunning) {
      try {
        await this.scanArbitrageOpportunities();
        await this.sleep(30000);
      } catch (err) {
        this.logger.error("Erro no scan de arbitragem:", err);
      }
    }
  }

  async scanArbitrageOpportunities() {
    try {
      // Verifica se tem capital
      if (this.capitalAllocated <= 0) {
        return;
      }
      
      const btcPrice = await this.exchange.getPrice("BTCUSDT");
      
      // Simula spread baseado em condições reais
      const hour = new Date().getHours();
      const isActiveHour = hour >= 9 && hour <= 16; // Horário NY mais volátil
      const baseVolatility = isActiveHour ? 1.5 : 0.8;
      const simulatedSpread = baseVolatility * (Math.random() * 1.2 + 0.3);
      
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
      if (simulatedSpread > adjustedThreshold && this.capitalAllocated > 100) {
        const estimatedProfit = this.capitalAllocated * simulatedSpread / 100;
        const capitalRequired = Math.min(this.capitalAllocated, this.maxPositionPerTrade);
        
        // 🆕 SOLICITA CAPITAL ANTES DE EXECUTAR
        const capitalRequest = await this.requestCapital(capitalRequired, `Arbitrage: spread ${simulatedSpread.toFixed(2)}%`);
        
        if (!capitalRequest.success) {
          this.logger.warn(`Arbitrage: Trade rejeitado - ${capitalRequest.reason}`, { service: "ArbitrageService" });
          return;
        }
        
        const opportunity = {
          id: `arb_${Date.now()}`,
          spread: parseFloat(simulatedSpread.toFixed(2)),
          pair: "BTC/USDT",
          action: "buy_low_sell_high",
          estimatedProfit: parseFloat(estimatedProfit.toFixed(2)),
          capitalRequired: capitalRequired,
          btcPrice: btcPrice,
          timestamp: Date.now()
        };
        
        this.opportunities.unshift(opportunity);
        if (this.opportunities.length > 100) this.opportunities.pop();
        
        this.logger.info(`💰 Oportunidade de arbitragem: ${simulatedSpread.toFixed(2)}% | Lucro estimado: $${estimatedProfit.toFixed(2)}`);
        EventBus.emit("arbitrage:opportunity", opportunity);
        
        // 🆕 SIMULA EXECUÇÃO DO TRADE (para teste)
        await this.simulateTradeExecution(opportunity);
      }
    } catch (err) {
      this.logger.error("Erro ao escanear oportunidades:", err);
    }
  }

  // 🆕 SIMULA EXECUÇÃO DO TRADE DE ARBITRAGEM
  async simulateTradeExecution(opportunity) {
    // Simula resultado do trade (70% de chance de lucro)
    const isWin = Math.random() < 0.7;
    const profit = isWin ? opportunity.estimatedProfit * (0.5 + Math.random() * 0.5) : -opportunity.estimatedProfit * 0.5;
    
    const trade = {
      id: `arb_trade_${Date.now()}`,
      agentId: this.agentId,
      spread: opportunity.spread,
      estimatedProfit: opportunity.estimatedProfit,
      actualProfit: profit,
      isWin: profit > 0,
      timestamp: Date.now()
    };
    
    this.tradeHistory.unshift(trade);
    if (this.tradeHistory.length > 100) this.tradeHistory.pop();
    
    if (profit > 0) {
      this.dailyProfit += profit;
      this.logger.info(`✅ Arbitrage lucrou: $${profit.toFixed(2)} (spread: ${opportunity.spread}%)`, { service: "ArbitrageService" });
      
      // Comunica lucro para o CapitalDistributor recolher 30%
      EventBus.emit("agent:profit", {
        agentId: this.agentId,
        amount: profit,
        tradeId: trade.id
      });
      
      // Comunica trade fechado para o LearningBrain
      EventBus.emit("trade:closed", {
        agent: this.agentId,
        profit: profit,
        id: trade.id
      });
    } else {
      this.dailyLoss += Math.abs(profit);
      this.consecutiveLosses++;
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)}`, { service: "ArbitrageService" });
      
      EventBus.emit("trade:closed", {
        agent: this.agentId,
        loss: Math.abs(profit),
        id: trade.id
      });
      
      // Verifica perdas consecutivas
      if (this.consecutiveLosses >= 3) {
        this.sendLearning("ArbitrageService", "3 perdas consecutivas - reduzindo spreadThreshold em 20%");
        this.learningParams.spreadThreshold *= 0.8;
        this.consecutiveLosses = 0;
      }
    }
    
    // 🆕 DEVOLVE CAPITAL (desconta lucro/perda)
    const netResult = profit;
    if (netResult !== 0) {
      this.returnCapital(netResult, `Trade closed: ${profit > 0 ? "WIN" : "LOSS"}`);
    }
    
    // Compartilha aprendizado periodicamente
    if (this.tradeHistory.length % 5 === 0) {
      this.shareLearning();
    }
  }

  adjustStrategy(advice) {
    this.logger.info(`🎯 Ajustando estratégia: ${advice.reason}`);
    if (advice.action === "REDUCE_RISK") {
      this.learningParams.riskMultiplier = 0.5;
      this.maxPositionPerTrade = Math.floor(this.maxPositionPerTrade * 0.5);
    } else if (advice.action === "INCREASE_RISK") {
      this.learningParams.riskMultiplier = 1.5;
    }
  }

  // 🆕 MÉTODO PARA MIGRAR PARA LIVE (quando estiver pronto)
  async switchToLiveMode() {
    this.logger.info("🔄 Arbitrage migrando para LIVE MODE...", { service: "ArbitrageService" });
    
    const result = await capitalDistributor.switchToLiveMode();
    
    if (result.success) {
      this.logger.info("✅ Arbitrage agora opera em LIVE MODE", { service: "ArbitrageService" });
    } else {
      this.logger.error("❌ Falha ao migrar Arbitrage para LIVE MODE", { service: "ArbitrageService" });
    }
    
    return result;
  }

  getStatus() {
    const recentTrades = this.tradeHistory.slice(-20);
    const wins = recentTrades.filter(t => t.isWin).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    return {
      running: this.isRunning,
      capitalAvailable: this.capitalAllocated,
      spreadThreshold: this.learningParams.spreadThreshold,
      maxPositionPerTrade: this.maxPositionPerTrade,
      dailyProfit: this.dailyProfit,
      dailyLoss: this.dailyLoss,
      netDaily: this.dailyProfit - this.dailyLoss,
      totalTrades: this.tradeHistory.length,
      winRate: winRate,
      consecutiveLosses: this.consecutiveLosses,
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
    this.logger.info("ArbitrageService parado", { service: "ArbitrageService" });
  }
}

module.exports = new ArbitrageService();
