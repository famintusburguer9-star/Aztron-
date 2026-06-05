const db = require("./DatabaseService");
const exchange = require("./ExchangeAdapterService");
const logger = require("./LoggerService");
const capitalDistributor = require("./CapitalDistributorService");

class RiskManagementService {
  constructor() {
    this.paused = false;
    this.pausedSymbols = new Set();
    
    // 🆕 CONFIGURAÇÕES POR AGENTE
    this.agentConfigs = {
      trend: { maxCapitalUsage: 0.70, maxPositionPct: 0.20, minConfidence: 60 },
      hft: { maxCapitalUsage: 0.50, maxPositionPct: 0.10, minConfidence: 65 },
      arbitrage: { maxCapitalUsage: 0.60, maxPositionPct: 0.15, minConfidence: 70 },
      sentiment: { maxCapitalUsage: 0.30, maxPositionPct: 0.05, minConfidence: 55 },
      deep: { maxCapitalUsage: 0.40, maxPositionPct: 0.10, minConfidence: 60 }
    };
    
    logger.info("RiskManagementService initialized (integrado com CapitalDistributor)", { service: "RiskManagement" });
  }

  // 🆕 OBTÉM CAPITAL DO AGENTE (do CapitalDistributor)
  getAgentCapital(agentId) {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    return agentInfo ? agentInfo.balance : 0;
  }

  // 🆕 OBTÉM INVESTIMENTO ATUAL DO AGENTE (baseado em posições abertas)
  getAgentInvested(agentId) {
    // Aqui você precisaria rastrear quais posições pertencem a cada agente
    // Por enquanto, vamos usar uma abordagem simplificada
    const openTrades = this._getOpenTradesForAgent(agentId);
    let totalInvested = 0;
    
    for (const trade of openTrades) {
      totalInvested += trade.entryPrice * trade.qty;
    }
    
    return totalInvested;
  }

  // 🆕 OBTÉM TRADES ABERTOS POR AGENTE
  _getOpenTradesForAgent(agentId) {
    // Pega do DatabaseService ou do TradeExecutor
    const db = require("./DatabaseService");
    const allOpenTrades = db.getTrades({ status: "OPEN" });
    return allOpenTrades.filter(t => t.agent === agentId);
  }

  // 🆕 VALIDA TRADE PARA UM AGENTE ESPECÍFICO
  validateTrade(symbol, side, notionalValue, agentId = "trend") {
    const cfg = db.getConfig();
    const agentCapital = this.getAgentCapital(agentId);
    const agentConfig = this.agentConfigs[agentId] || this.agentConfigs.trend;
    const agentInvested = this.getAgentInvested(agentId);
    
    // 🆕 LIMITE DO CAPITAL DO AGENTE
    const maxCapitalUsage = agentConfig.maxCapitalUsage;
    const maxPositionValue = agentCapital * maxCapitalUsage;
    const availableForNew = maxPositionValue - agentInvested;
    
    // 🆕 RISK PER TRADE baseado no capital do agente
    const riskPerTrade = Math.min(cfg.riskPerTrade, 2.0);
    const riskDollar = agentCapital * (riskPerTrade / 100);
    
    const errors = [];

    if (this.paused) errors.push("Engine is paused");
    if (this.pausedSymbols.has(symbol)) errors.push(`${symbol} is paused (Flash Crash Shield)`);
    
    // Verifica se já atingiu o limite de capital do agente
    if (notionalValue > availableForNew && availableForNew > 0) {
      errors.push(`Capital limit for ${agentId}. Max new position: $${availableForNew.toFixed(2)}`);
    }
    
    // Verifica tamanho da posição (máximo 10x o risco)
    if (notionalValue > riskDollar * 10) {
      errors.push(`Position size too large for ${agentId}. Max: $${(riskDollar * 10).toFixed(2)}`);
    }
    
    // Verifica saldo (apenas para referência)
    const bal = exchange.getBalance();
    if (bal.USDT < notionalValue * 0.1) {
      errors.push("Insufficient USDT balance in exchange");
    }

    return { 
      approved: errors.length === 0, 
      errors, 
      maxPositionSize: riskDollar, 
      agentCapital,
      agentInvested,
      availableForNew: Math.max(0, availableForNew),
      usagePercent: agentCapital > 0 ? (agentInvested / agentCapital) * 100 : 0
    };
  }

  // 🆕 CALCULA TAMANHO DA POSIÇÃO PARA UM AGENTE ESPECÍFICO
  calculatePositionSize(symbol, price, stopLossPercent, agentId = "trend", confidence = 70) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const agentCapital = this.getAgentCapital(agentId);
    const agentConfig = this.agentConfigs[agentId] || this.agentConfigs.trend;
    const agentInvested = this.getAgentInvested(agentId);
    
    // 🆕 LIMITE DO CAPITAL DO AGENTE (máximo 70%)
    const maxCapitalUsage = agentConfig.maxCapitalUsage;
    const maxNewPositionValue = Math.max(0, (agentCapital * maxCapitalUsage) - agentInvested);
    
    // 🆕 RISK PER TRADE: máximo 2% do capital do agente
    const riskPerTrade = Math.min(cfg.riskPerTrade, 2.0);
    const riskDollar = agentCapital * (riskPerTrade / 100);
    const stopLossDollar = price * (stopLossPercent / 100);
    
    let qty = riskDollar / stopLossDollar;
    
    // 🆕 AJUSTA POR CONFIANÇA (mais confiança = posição maior)
    const confidenceMultiplier = 0.5 + (confidence / 100); // 0.5 a 1.5
    qty = qty * confidenceMultiplier;
    
    // Limita pelo capital disponível do agente
    const maxQtyByCapital = maxNewPositionValue / price;
    if (qty > maxQtyByCapital && maxQtyByCapital > 0) {
      qty = maxQtyByCapital * 0.9;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada pelo capital disponível: ${qty.toFixed(6)} ${symbol}`);
    }
    
    // 🆕 LIMITE MÁXIMO POR POSIÇÃO (% do capital do agente)
    const maxPositionPct = agentConfig.maxPositionPct;
    const maxQtyByPct = (agentCapital * maxPositionPct) / price;
    if (qty > maxQtyByPct) {
      qty = maxQtyByPct;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada a ${maxPositionPct * 100}% do capital (${qty.toFixed(6)} ${symbol})`);
    }
    
    // 🔥 LIMITE DO MODO PAPER: máximo 10% do saldo USDT (global)
    const isPaperMode = cfg.mode === "PAPER";
    if (isPaperMode) {
      const maxQtyPaper = (bal.USDT * 0.10) / price;
      if (qty > maxQtyPaper) {
        qty = maxQtyPaper;
        logger.warn(`[RiskManagement] PAPER MODE: Qty limitada a 10% do saldo (${qty.toFixed(6)} ${symbol})`);
      }
    }
    
    // 🔥 QUANTIDADE MÍNIMA POR SÍMBOLO
    let minQty = 0;
    if (symbol.includes("BTC")) minQty = 0.0001;
    else if (symbol.includes("ETH")) minQty = 0.001;
    else if (symbol.includes("BNB")) minQty = 0.01;
    else minQty = 0.1;
    
    if (qty < minQty) {
      qty = minQty;
      logger.warn(`[RiskManagement] Qty ajustada para mínimo (${minQty}) ${symbol}`);
    }
    
    // 🔥 LIMITE MÁXIMO ABSOLUTO: nunca mais que 20% do capital do agente
    const absoluteMax = (agentCapital * 0.20) / price;
    if (qty > absoluteMax) {
      qty = absoluteMax;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada a 20% do capital (${qty.toFixed(6)} ${symbol})`);
    }
    
    return { 
      qty: Math.round(qty * 10000) / 10000, 
      riskDollar: Math.round(riskDollar * 100) / 100,
      stopPrice: price * (1 - stopLossPercent / 100),
      maxNewPositionValue: Math.round(maxNewPositionValue * 100) / 100,
      agentCapital: Math.round(agentCapital * 100) / 100,
      agentInvested: Math.round(agentInvested * 100) / 100,
      investedPercent: agentCapital > 0 ? Math.round((agentInvested / agentCapital) * 100) : 0,
      confidenceMultiplier: confidenceMultiplier
    };
  }

  // 🆕 VERIFICA SE PODE ABRIR NOVA POSIÇÃO PARA UM AGENTE
  canOpenNewPosition(symbol, notionalValue, agentId = "trend") {
    const agentCapital = this.getAgentCapital(agentId);
    const agentConfig = this.agentConfigs[agentId] || this.agentConfigs.trend;
    const agentInvested = this.getAgentInvested(agentId);
    const investedPercent = agentCapital > 0 ? (agentInvested / agentCapital) * 100 : 0;
    const maxPercent = agentConfig.maxCapitalUsage * 100;
    
    if (investedPercent >= maxPercent) {
      return { 
        allowed: false, 
        reason: `${agentId}: Capital invested: ${investedPercent.toFixed(1)}% (max ${maxPercent}%)`,
        investedPercent,
        maxPercent
      };
    }
    
    const available = (agentCapital * agentConfig.maxCapitalUsage) - agentInvested;
    if (notionalValue > available) {
      return { 
        allowed: false, 
        reason: `${agentId}: Insufficient capital. Need $${notionalValue.toFixed(2)}, available $${available.toFixed(2)}`,
        available,
        needed: notionalValue
      };
    }
    
    return { 
      allowed: true, 
      available: available,
      investedPercent,
      agentCapital,
      maxPosition: agentCapital * agentConfig.maxPositionPct
    };
  }

  // 🆕 OBTÉM CONFIGURAÇÃO DO AGENTE
  getAgentConfig(agentId) {
    return this.agentConfigs[agentId] || this.agentConfigs.trend;
  }

  // 🆕 ATUALIZA CONFIGURAÇÃO DO AGENTE
  updateAgentConfig(agentId, config) {
    if (this.agentConfigs[agentId]) {
      this.agentConfigs[agentId] = { ...this.agentConfigs[agentId], ...config };
      logger.info(`[RiskManagement] Configuração atualizada para ${agentId}`, { service: "RiskManagement" });
      return { success: true, config: this.agentConfigs[agentId] };
    }
    return { success: false, error: "Agent not found" };
  }

  pauseSymbol(symbol, durationMs = 300000) {
    this.pausedSymbols.add(symbol);
    logger.warn(`${symbol} paused for ${durationMs / 1000}s`, { service: "RiskManagement" });
    setTimeout(() => { 
      this.pausedSymbols.delete(symbol); 
      logger.info(`${symbol} resumed`, { service: "RiskManagement" });
    }, durationMs);
  }

  pauseAll() { 
    this.paused = true; 
    logger.warn("All trading paused", { service: "RiskManagement" });
  }
  
  resumeAll() { 
    this.paused = false; 
    logger.info("All trading resumed", { service: "RiskManagement" });
  }
  
  isPaused(symbol) { 
    return this.paused || this.pausedSymbols.has(symbol); 
  }
  
  getPausedSymbols() { 
    return [...this.pausedSymbols]; 
  }
  
  // 🆕 OBTÉM ESTATÍSTICAS COMPLETAS (incluindo agentes)
  getStats() {
    const cfg = db.getConfig();
    const totalEquity = exchange.getBalance().USDT || 0;
    
    // 🆕 ESTATÍSTICAS POR AGENTE
    const agentsStats = {};
    for (const agentId of Object.keys(this.agentConfigs)) {
      const capital = this.getAgentCapital(agentId);
      const invested = this.getAgentInvested(agentId);
      agentsStats[agentId] = {
        capital: Math.round(capital * 100) / 100,
        invested: Math.round(invested * 100) / 100,
        available: Math.round((capital - invested) * 100) / 100,
        usagePercent: capital > 0 ? Math.round((invested / capital) * 100) : 0,
        config: this.agentConfigs[agentId]
      };
    }
    
    return { 
      paused: this.paused, 
      pausedSymbols: this.getPausedSymbols(), 
      riskPerTrade: cfg.riskPerTrade, 
      stopLoss: cfg.stopLoss, 
      takeProfit: cfg.takeProfit, 
      mode: cfg.mode,
      totalEquity: Math.round(totalEquity * 100) / 100,
      agents: agentsStats
    };
  }

  // 🆕 MÉTODO LEGADO PARA COMPATIBILIDADE (usa agente padrão "trend")
  getTotalInvested() {
    return this.getAgentInvested("trend");
  }

  getTotalEquity() {
    return this.getAgentCapital("trend");
  }
}

module.exports = new RiskManagementService();
