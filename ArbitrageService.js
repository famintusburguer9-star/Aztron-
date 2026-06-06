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
    
    // Configurações (já ajustadas)
    this.scanInterval = 20000;           // 20 segundos
    this.tradeCooldown = 60000;          // 60 segundos
    
    this.minSpread = 0.3;                // 0.3%
    this.maxPositionPerTrade = 1000;     // $1000
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.tradeHistory = [];
    
    // 🔥 FILA DE OPORTUNIDADES PENDENTES (quando falta saldo)
    this.pendingOpportunities = [];
    
    this.learningParams = {
      spreadThreshold: 0.3,
      riskMultiplier: 1.2,
    };
    
    // Escuta eventos
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("sentiment:extreme", (sentiment) => this.onSentimentExtreme(sentiment));
    
    // 🔥 ESCUTA ALOCAÇÃO DE CAPITAL - INICIA AUTOMATICAMENTE
    EventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      this.logger.info(`💰 Arbitrage recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`);
      
      // Se não está rodando e tem capital, inicia agora!
      if (!this.isRunning && this.capitalAllocated > 0) {
        this.logger.info(`🚀 Arbitrage detectou capital e vai iniciar automaticamente...`);
        this.start();
      }
    });
    
    // 🔥 ESCUTA RETORNO DE CAPITAL (quando trade fecha)
    EventBus.on("capital:return", ({ agentId, amount, reason }) => {
      if (agentId === this.agentId && amount !== 0) {
        this.capitalAllocated += amount;
        this.logger.info(`💰 Arbitrage recebeu retorno de capital: $${amount}. Novo saldo: $${this.capitalAllocated}`);
        
        // 🔥 Processa oportunidades pendentes
        this._processPendingOpportunities();
      }
    });
    
    // 🔥 ESCUTA MELHORIAS DE OUTROS AGENTES
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🔥 ESCUTA APRENDIZADO COMPARTILHADO
    EventBus.on("learning:share", (learning) => {
      this._applySharedLearning(learning);
    });
    
    this.logger.info("ArbitrageService initialized - MODO AGRESSIVO (spread 0.3%)");
  }

  // 🔥 INICIALIZAÇÃO - CHAME UMA VEZ AO SUBIR O SISTEMA
  async initialize() {
    if (this.initialized) return { success: true, capital: this.capitalAllocated };
    
    this.logger.info("🔍 Arbitrage: Inicializando e aguardando capital...");
    
    // Aguarda alocação de capital por até 10 segundos
    let attempts = 0;
    while (this.capitalAllocated === 0 && attempts < 100) {
      await this.sleep(100);
      attempts++;
    }
    
    this.initialized = true;
    
    if (this.capitalAllocated > 0) {
      this.logger.info(`✅ ArbitrageService initialized com capital $${this.capitalAllocated}`);
      if (!this.isRunning) {
        this.start();
      }
      return { success: true, capital: this.capitalAllocated };
    } else {
      this.logger.warn("⚠️ ArbitrageService initialized sem capital - aguardando evento de alocação");
      return { success: true, capital: 0, waitingForCapital: true };
    }
  }

  onSentimentExtreme(sentiment) {
    if (sentiment.type === "EXTREME_FEAR") {
      this.learningParams.spreadThreshold = 0.2;
      this.learningParams.riskMultiplier = 1.5;
      this.logger.info(`📉 Arbitrage ajustou spreadThreshold para ${this.learningParams.spreadThreshold}% (extreme fear)`);
    }
  }

  // 🔥 APLICA MELHORIAS RECEBIDAS
  applyImprovement(improvement) {
    this.logger.info(`🧠 Arbitrage recebeu melhoria: ${improvement.recommendation}`, { service: "Arbitrage" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.learningParams.spreadThreshold = Math.max(0.15, this.learningParams.spreadThreshold * 0.8);
        this.scanInterval = Math.max(10000, this.scanInterval * 0.8);
        this.logger.info(`⚡ Arbitrage aumentou sensibilidade: spreadThreshold=${this.learningParams.spreadThreshold}%, scanInterval=${this.scanInterval}ms`);
        break;
        
      case "REDUZIR_RISCO":
        this.learningParams.riskMultiplier = Math.max(0.5, this.learningParams.riskMultiplier * 0.7);
        this.maxPositionPerTrade = Math.max(200, this.maxPositionPerTrade * 0.7);
        this.logger.info(`📉 Arbitrage reduziu risco: riskMultiplier=${this.learningParams.riskMultiplier}, maxPosition=$${this.maxPositionPerTrade}`);
        break;
        
      default:
        this.logger.debug(`Melhoria recebida: ${improvement.recommendation}`);
    }
  }

  // 🔥 APRENDE COM OUTROS AGENTES
  _applySharedLearning(learning) {
    if (!learning || learning.agentId === this.agentId) return;
    
    this.logger.info(`🧠 Arbitrage aprendeu com ${learning.agentId}: ${learning.content}`);
    
    // Se outro agente está com alta performance, ajusta estratégia
    if (learning.type === "performance_update" && learning.data?.winRate > 65) {
      this.logger.info(`✨ Arbitrage aumentando agressividade baseado no sucesso de ${learning.agentId}`);
      this.learningParams.spreadThreshold = Math.max(0.2, this.learningParams.spreadThreshold * 0.9);
    }
    
    // Se outro agente está perdendo, reduz risco
    if (learning.type === "performance_update" && learning.data?.winRate < 40) {
      this.logger.info(`⚠️ Arbitrage reduzindo risco baseado no desempenho de ${learning.agentId}`);
      this.learningParams.riskMultiplier = Math.max(0.7, this.learningParams.riskMultiplier * 0.9);
    }
  }

  // 🔥 COMPARTILHA APRENDIZADO
  shareLearning() {
    const recentTrades = this.tradeHistory.filter(t => t.isWin !== undefined).slice(-20);
    const wins = recentTrades.filter(t => t.isWin).length;
    const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 0;
    
    if (recentTrades.length >= 10 && (winRate > 65 || winRate < 40)) {
      const learningData = {
        agentId: this.agentId,
        type: "performance_update",
        content: `Arbitrage win rate ${winRate.toFixed(0)}% nos últimos ${recentTrades.length} trades (spread threshold: ${this.learningParams.spreadThreshold}%)`,
        confidence: winRate / 100,
        data: {
          winRate: winRate,
          totalTrades: recentTrades.length,
          spreadThreshold: this.learningParams.spreadThreshold,
          consecutiveLosses: this.consecutiveLosses
        }
      };
      
      EventBus.emit("learning:share", learningData);
      this.logger.info(`📤 Arbitrage compartilhou aprendizado: win rate ${winRate.toFixed(0)}%`);
    }
  }

  // 🔥 PROCESSA OPORTUNIDADES PENDENTES
  _processPendingOpportunities() {
    if (this.pendingOpportunities.length === 0) return;
    
    this.logger.info(`🔄 Processando ${this.pendingOpportunities.length} oportunidades pendentes...`);
    
    const toProcess = [...this.pendingOpportunities];
    this.pendingOpportunities = [];
    
    for (const opp of toProcess) {
      this.executeTrade(opp).catch(err => {
        this.logger.error(`Erro ao processar oportunidade pendente: ${err.message}`);
      });
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    if (this.capitalAllocated <= 0) {
      this.logger.warn("ArbitrageService: sem capital, vai aguardar alocação...");
      return { success: false, reason: "No capital allocated - waiting" };
    }
    
    this.isRunning = true;
    this.logger.info(`🚀 ArbitrageService iniciado com $${this.capitalAllocated} - spread threshold ${this.learningParams.spreadThreshold}%`);
    
    // Inicia scan loop
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
      
      const opportunity = await this.exchange.getArbitrageOpportunity("BTCUSDT");
      
      if (!opportunity) return;
      
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
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
    
    // 🔥 VERIFICA SE TEM CAPITAL SUFICIENTE
    if (opportunity.capitalRequired > this.capitalAllocated) {
      this.logger.warn(`Arbitrage: capital insuficiente. Necessário $${opportunity.capitalRequired}, disponível $${this.capitalAllocated}`);
      // Guarda na fila para tentar depois
      this.pendingOpportunities.push(opportunity);
      return;
    }
    
    const capitalRequest = await this.requestCapital(opportunity.capitalRequired, `Arbitrage: spread ${opportunity.spread}%`);
    
    if (!capitalRequest.success) {
      this.logger.warn(`Trade rejeitado: ${capitalRequest.reason}`);
      
      // 🔥 SE FOI FALTA DE SALDO, GUARDA NA FILA
      if (capitalRequest.reason === "Insufficient balance" || capitalRequest.reason?.includes("saldo")) {
        this.pendingOpportunities.push(opportunity);
        this.logger.info(`📥 Oportunidade enfileirada (falta saldo). Total pendentes: ${this.pendingOpportunities.length}`);
      }
      return;
    }
    
    this.lastTradeTime = now;
    
    // 🔥 SIMULA RESULTADO (60% de chance de lucro, ajustado pela confiança)
    const baseWinChance = 0.6;
    const winChance = Math.min(0.85, baseWinChance + (opportunity.spread / 100));
    const isWin = Math.random() < winChance;
    
    // Lucro varia baseado no spread (maior spread = maior potencial)
    const profitMultiplier = 0.3 + (opportunity.spread / 100) + (Math.random() * 0.5);
    const profit = isWin ? opportunity.estimatedProfit * profitMultiplier : -opportunity.estimatedProfit * 0.5;
    
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
      this.consecutiveLosses = 0;
      this.logger.info(`✅ Arbitrage lucrou: $${profit.toFixed(2)} (spread: ${opportunity.spread}%)`);
      EventBus.emit("agent:profit", { agentId: this.agentId, amount: profit, tradeId: trade.id });
      
      // 🔥 Sequência de lucros - aumenta agressividade
      if (this.tradeHistory.filter(t => t.isWin).slice(0, 3).length === 3) {
        this.learningParams.spreadThreshold = Math.max(0.15, this.learningParams.spreadThreshold * 0.9);
        this.logger.info(`📈 Arbitrage em sequência de lucros! spreadThreshold reduzido para ${this.learningParams.spreadThreshold}%`);
        EventBus.emit("agent:hotStreak", { agentId: this.agentId, streak: 3 });
      }
    } else {
      this.dailyLoss += Math.abs(profit);
      this.consecutiveLosses++;
      this.logger.warn(`❌ Arbitrage perdeu: $${Math.abs(profit).toFixed(2)} (spread: ${opportunity.spread}%)`);
      
      // 🔥 Sequência de perdas - reduz risco
      if (this.consecutiveLosses >= 2) {
        this.learningParams.spreadThreshold *= 1.1;
        this.learningParams.riskMultiplier = Math.max(0.5, this.learningParams.riskMultiplier * 0.9);
        this.logger.warn(`⚠️ ${this.consecutiveLosses} perdas consecutivas! Ajustando: spreadThreshold=${this.learningParams.spreadThreshold}%, riskMultiplier=${this.learningParams.riskMultiplier}`);
      }
      
      if (this.consecutiveLosses >= 3) {
        this.logger.warn(`🚨 Arbitrage: 3 perdas consecutivas! Pausando temporariamente...`);
        EventBus.emit("agent:coldStreak", { agentId: this.agentId, streak: this.consecutiveLosses });
        // Pausa por 2 minutos
        await this.sleep(120000);
        this.consecutiveLosses = 0;
      }
    }
    
    // 🔥 COMPARTILHA APRENDIZADO A CADA 10 TRADES
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
    return {
      running: this.isRunning,
      capitalAvailable: this.capitalAllocated,
      spreadThreshold: this.learningParams.spreadThreshold,
      riskMultiplier: this.learningParams.riskMultiplier,
      dailyProfit: Math.round(this.dailyProfit * 100) / 100,
      dailyLoss: Math.round(this.dailyLoss * 100) / 100,
      netDaily: Math.round((this.dailyProfit - this.dailyLoss) * 100) / 100,
      totalTrades: this.tradeHistory.length,
      opportunitiesFound: this.opportunities.length,
      pendingOpportunities: this.pendingOpportunities.length,
      consecutiveLosses: this.consecutiveLosses
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

  learnFromOthers(learning) {
    // Aprende com consciência coletiva
    if (learning && learning.type === "market_insight") {
      this.logger.info(`🧠 Arbitrage aprendeu: ${learning.content}`);
      if (learning.recommendation === "increase_aggressiveness") {
        this.learningParams.spreadThreshold = Math.max(0.2, this.learningParams.spreadThreshold * 0.85);
      }
    }
  }

  adjustStrategy(advice) {
    if (advice.action === "REDUCE_RISK") {
      this.learningParams.riskMultiplier = Math.max(0.5, this.learningParams.riskMultiplier * 0.8);
      this.maxPositionPerTrade = Math.max(100, this.maxPositionPerTrade * 0.8);
      this.logger.info(`📉 Arbitrage ajustou estratégia: riskMultiplier=${this.learningParams.riskMultiplier}`);
    } else if (advice.action === "INCREASE_AGGRESSIVENESS") {
      this.learningParams.spreadThreshold = Math.max(0.15, this.learningParams.spreadThreshold * 0.9);
      this.logger.info(`📈 Arbitrage aumentou agressividade: spreadThreshold=${this.learningParams.spreadThreshold}%`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  stop() {
    this.isRunning = false;
    this.logger.info("ArbitrageService stopped");
    return { success: true };
  }
  
  resetDaily() {
    this.dailyProfit = 0;
    this.dailyLoss = 0;
    this.consecutiveLosses = 0;
    this.tradeHistory = [];
    this.opportunities = [];
    this.pendingOpportunities = [];
    this.logger.info("ArbitrageService daily counters reset");
    return { success: true };
  }
}

module.exports = new ArbitrageService();
