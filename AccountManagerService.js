const exchange = require("./ExchangeAdapterService");
const db = require("./DatabaseService");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const capitalDistributor = require("./CapitalDistributorService");

class AccountManagerService {
  constructor() {
    this.agentId = "account";
    this.isRunning = false;
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    eventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    logger.info("AccountManagerService initialized", { service: "AccountManager" });
  }

  // 🆕 APLICA MELHORIAS
  applyImprovement(improvement) {
    if (!improvement) return;
    logger.info(`🧠 AccountManager recebeu melhoria: ${improvement.recommendation}`, { service: "AccountManager" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        // Em modo PAPER, não faz nada
        logger.info(`⚡ AccountManager: modo ${db.getConfig().mode} mantido`, { service: "AccountManager" });
        break;
      case "REDUZIR_RISCO":
        logger.info(`📉 AccountManager: modo cauteloso ativado`, { service: "AccountManager" });
        break;
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "AccountManager" });
    }
  }

  getAccountInfo() {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    
    // 🆕 OBTÉM CAPITAL DE CADA AGENTE
    const agentsCapital = {};
    const agents = ["trend", "hft", "arbitrage", "sentiment", "deep"];
    
    for (const agent of agents) {
      const agentInfo = capitalDistributor.getAgentInfo(agent);
      agentsCapital[agent] = agentInfo ? agentInfo.balance : 0;
    }
    
    return {
      mode: cfg.mode,
      exchange: cfg.exchange,
      connected: exchange.isConnected(),
      balance: bal,
      totalSystemCapital: capitalDistributor.getTotalSystemBalance?.(),
      agentsCapital: agentsCapital,
      apiConfigured: (cfg.bybitApiKey?.length > 0) || (cfg.binanceApiKey?.length > 0),
      savingsBalance: capitalDistributor.getSavingsBalance?.()
    };
  }

  getAgentBalance(agentId) {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    return agentInfo ? agentInfo.balance : 0;
  }

  setCredentials({ exchange: exch, apiKey, apiSecret }) {
    if (exch === "BYBIT") {
      db.updateConfig({ bybitApiKey: apiKey, bybitApiSecret: apiSecret });
    } else {
      db.updateConfig({ binanceApiKey: apiKey, binanceApiSecret: apiSecret });
    }
    
    // 🆕 EMITE EVENTO DE ATUALIZAÇÃO
    eventBus.emit("account:credentials:updated", { exchange: exch, timestamp: Date.now() });
    
    logger.info(`${exch} credentials updated`, { service: "AccountManager" });
    return { success: true };
  }

  // 🆕 VERIFICA SAÚDE DA CONTA
  getHealth() {
    const cfg = db.getConfig();
    const issues = [];
    
    if (cfg.mode === "LIVE" && !this.getAccountInfo().apiConfigured) {
      issues.push("API keys not configured for LIVE mode");
    }
    
    const totalCapital = capitalDistributor.getTotalSystemBalance?.() || 0;
    if (totalCapital === 0) {
      issues.push("No capital allocated");
    }
    
    return {
      healthy: issues.length === 0,
      issues: issues,
      mode: cfg.mode,
      capitalAvailable: totalCapital
    };
  }

  // 🆕 STATUS COMPLETO
  getStatus() {
    const info = this.getAccountInfo();
    const health = this.getHealth();
    
    return {
      ...info,
      health: health,
      running: this.isRunning,
      version: "v2.0.0"
    };
  }

  start() {
    this.isRunning = true;
    logger.info("AccountManagerService started", { service: "AccountManager" });
    return { success: true };
  }

  stop() {
    this.isRunning = false;
    logger.info("AccountManagerService stopped", { service: "AccountManager" });
    return { success: true };
  }
}

module.exports = new AccountManagerService();
