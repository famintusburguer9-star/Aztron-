const EventBus = require("./EventBus");
const exchange = require("./ExchangeAdapterService");
const db = require("./DatabaseService");
const logger = require("./LoggerService");

class CapitalOrchestratorService {
  constructor() {
    this.logger = logger;
    this.exchange = exchange;
    this.db = db;
    this.totalCapital = 0;
    this.reservedCapital = 0;
    this.allocationHistory = [];
    
    this.limits = {
      strategies: { percent: 0.40, minAbsolute: 500, maxAbsolute: 50000 },
      arbitrage: { percent: 0.15, minAbsolute: 200, maxAbsolute: 10000 },
      hft: { percent: 0.10, minAbsolute: 300, maxAbsolute: 8000 },
      reserve: { percent: 0.35, minAbsolute: 1000, maxAbsolute: null }
    };
    
    this.servicePerformance = {
      strategies: { wins: 0, losses: 0, totalPnL: 0 },
      arbitrage: { wins: 0, losses: 0, totalPnL: 0 },
      hft: { wins: 0, losses: 0, totalPnL: 0 }
    };
  }

  async start() {
    this.logger.info("💰 CapitalOrchestratorService iniciado - GERENCIADOR DE CAPITAL ATIVO", { service: "CapitalOrchestrator" });
    
    EventBus.on("consciousness:learning", (learning) => this.learnAndAdjust(learning));
    EventBus.on("consciousness:report", (report) => this.onSynergyReport(report));
    EventBus.on("trade:profit", (profit) => this.recordProfit(profit));
    EventBus.on("trade:loss", (loss) => this.recordLoss(loss));
    EventBus.on("arbitrage:request", (request) => this.evaluateRequest(request));
    
    await this.updateBalance();
    setInterval(() => this.rebalance(), 600000);
  }

  async updateBalance() {
    try {
      const balance = await this.exchange.getBalance();
      this.totalCapital = balance.usdt || 10000;
      this.logger.info(`Saldo total atualizado: $${this.totalCapital}`);
      EventBus.emit("capital:total:updated", { total: this.totalCapital });
    } catch (err) {
      this.logger.error("Erro ao atualizar saldo:", err);
    }
  }

  async rebalance() {
    await this.updateBalance();
    const available = this.totalCapital - this.reservedCapital;
    const adjustedLimits = this.calculatePerformanceBasedLimits();
    
    const allocations = {};
    for (const [service, limit] of Object.entries(adjustedLimits)) {
      let allocation = available * limit.percent;
      if (limit.minAbsolute) allocation = Math.max(allocation, limit.minAbsolute);
      if (limit.maxAbsolute) allocation = Math.min(allocation, limit.maxAbsolute);
      allocations[service] = Math.floor(allocation);
    }
    
    this.logger.info(`📊 Rebalanceamento executado:`, allocations);
    
    EventBus.emit("capital:allocated", {
      strategies: allocations.strategies,
      arbitrage: allocations.arbitrage,
      hft: allocations.hft,
      timestamp: Date.now()
    });
    
    if (allocations.arbitrage > 0) {
      EventBus.emit("capital:orchestrator:advice", {
        to: "ArbitrageService",
        action: allocations.arbitrage > 1000 ? "INCREASE_RISK" : "NORMAL",
        reason: `Capital alocado: $${allocations.arbitrage}`,
        from: "CapitalOrchestrator"
      });
    }
    
    this.allocationHistory.push(allocations);
  }

  calculatePerformanceBasedLimits() {
    const limits = JSON.parse(JSON.stringify(this.limits));
    const perf = this.servicePerformance;
    
    if (perf.arbitrage.wins + perf.arbitrage.losses > 10) {
      const winRate = perf.arbitrage.wins / (perf.arbitrage.wins + perf.arbitrage.losses);
      if (winRate > 0.6) {
        limits.arbitrage.percent = Math.min(0.25, this.limits.arbitrage.percent + 0.03);
        this.logger.info(`📈 Arbitrage com win rate ${(winRate*100).toFixed(0)}% - aumentando limite`);
      } else if (winRate < 0.4) {
        limits.arbitrage.percent = Math.max(0.05, this.limits.arbitrage.percent - 0.03);
        this.logger.warn(`📉 Arbitrage com win rate baixo - reduzindo limite`);
      }
    }
    return limits;
  }

  learnAndAdjust(learning) {
    this.logger.info(`📚 CapitalOrchestrator aprendendo com: ${learning.message}`);
    
    if (learning.type === "risk_warning") {
      this.reservedCapital = this.totalCapital * 0.5;
      this.logger.warn(`🛡️ Alerta de risco: reservando ${this.reservedCapital} para segurança`);
    }
    
    if (learning.recommendation === "INCREASE_ARBITRAGE_LIMIT_BY_20") {
      this.limits.arbitrage.percent = Math.min(0.30, this.limits.arbitrage.percent * 1.2);
      this.logger.info(`🎯 Aumentando limite de arbitragem para ${this.limits.arbitrage.percent * 100}%`);
    }
    
    if (learning.recommendation === "REDUCE_ALL_POSITIONS_BY_50") {
      for (const [service, limit] of Object.entries(this.limits)) {
        if (service !== "reserve") {
          this.limits[service].percent = limit.percent * 0.5;
        }
      }
      this.limits.reserve.percent += 0.25;
      this.logger.warn("🛡️ Reduzindo todas as posições em 50%");
    }
  }

  evaluateRequest(request) {
    this.logger.info(`📨 Avaliando requisição de capital: ${request.id}`);
    const required = request.capitalRequired || 500;
    
    if (required <= this.totalCapital - this.reservedCapital) {
      EventBus.emit("capital:request:approved", {
        requestId: request.id,
        approved: true,
        allocated: required,
        maxLoss: required * 0.05
      });
      this.logger.info(`✅ Requisição aprovada: $${required}`);
    } else {
      EventBus.emit("capital:request:denied", {
        requestId: request.id,
        approved: false,
        reason: "Capital insuficiente"
      });
      this.logger.warn(`❌ Requisição negada: falta capital`);
    }
  }

  recordProfit(profit) {
    const service = profit.service || "strategies";
    if (this.servicePerformance[service]) {
      this.servicePerformance[service].wins++;
      this.servicePerformance[service].totalPnL += profit.amount;
    }
  }

  recordLoss(loss) {
    const service = loss.service || "strategies";
    if (this.servicePerformance[service]) {
      this.servicePerformance[service].losses++;
      this.servicePerformance[service].totalPnL -= loss.amount;
    }
  }

  onSynergyReport(report) {
    this.logger.info(`📊 Sinergia report recebida: ${report.patternsFound} padrões`);
  }

  stop() { this.logger.info("CapitalOrchestratorService parado"); }
}

module.exports = new CapitalOrchestratorService();
