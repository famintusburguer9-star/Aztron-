const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService"); // ← JÁ é uma instância, não classe
const db = require("./DatabaseService");
const logger = require("./LoggerService");

class ArbitrageService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;  // ← usa a instância diretamente
    this.db = db;
    this.isRunning = false;
    this.availableCapital = 0;
    this.minSpread = 1.2;
    this.maxPositionPerTrade = 500;
    this.consecutiveLosses = 0;
    this.opportunities = [];
    this.performanceHistory = [];
    
    this.learningParams = {
      spreadThreshold: 1.2,
      riskMultiplier: 1.0,
      activeHours: { start: 0, end: 24 },
      lastAdjustedBy: null
    };
  }

  start() {
    this.isRunning = true;
    this.logger.info("🚀 ArbitrageService iniciado - MODO GUERRA ATIVADO", { service: "ArbitrageService" });
    
    // Escuta eventos
    EventBus.on("consciousness:learning", (learning) => this.learnFromOthers(learning));
    EventBus.on("capital:orchestrator:advice", (advice) => this.adjustStrategy(advice));
    EventBus.on("sentiment:extreme", (sentiment) => {
      if (sentiment.type === "EXTREME_FEAR") {
        this.logger.info("📊 Sentimento extremo detectado - ajustando parâmetros");
        this.learningParams.spreadThreshold = 0.8;
        this.learningParams.riskMultiplier = 1.3;
        this.sendLearning("ArbitrageService", "Ajustei spreadThreshold para 0.8 devido ao EXTREME_FEAR");
      }
    });
    
    EventBus.on("capital:allocated", (data) => {
      this.availableCapital = data.arbitrage || 0;
      this.logger.info(`💰 Capital alocado para arbitragem: $${this.availableCapital}`);
    });
    
    this.scanLoop();
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
      const btcPrice = await this.exchange.getPrice("BTCUSDT");
      
      const simulatedSpread = Math.random() * 2;
      const adjustedThreshold = this.learningParams.spreadThreshold * this.learningParams.riskMultiplier;
      
      if (simulatedSpread > adjustedThreshold && this.availableCapital > 100) {
        const estimatedProfit = this.availableCapital * simulatedSpread / 100;
        
        const opportunity = {
          id: `arb_${Date.now()}`,
          spread: simulatedSpread,
          pair: "BTC/USDT",
          action: "buy_low_sell_high",
          estimatedProfit: estimatedProfit,
          capitalRequired: Math.min(this.availableCapital, this.maxPositionPerTrade),
          timestamp: Date.now()
        };
        
        this.opportunities.unshift(opportunity);
        if (this.opportunities.length > 100) this.opportunities.pop();
        
        this.logger.info(`💰 Oportunidade de arbitragem: ${simulatedSpread.toFixed(2)}%`);
        EventBus.emit("arbitrage:opportunity", opportunity);
        EventBus.emit("arbitrage:request", opportunity);
      }
    } catch (err) {
      this.logger.error("Erro ao escanear oportunidades:", err);
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

  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  stop() { this.isRunning = false; }
}

module.exports = new ArbitrageService();
