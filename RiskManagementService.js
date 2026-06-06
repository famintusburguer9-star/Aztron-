const db = require("./DatabaseService");
const exchange = require("./ExchangeAdapterService");
const logger = require("./LoggerService");
const capitalDistributor = require("./CapitalDistributorService");

class RiskManagementService {
  constructor() {
    this.paused = false;
    this.pausedSymbols = new Set();
    
    // 🔥 CONFIGURAÇÕES POR AGENTE - AJUSTADAS PARA MAIS AGRESSIVIDADE
    this.agentConfigs = {
      trend: { maxCapitalUsage: 0.80, maxPositionPct: 0.30, minConfidence: 50 },   // Aumentado: 70%→80%, 20%→30%
      hft: { maxCapitalUsage: 0.60, maxPositionPct: 0.15, minConfidence: 55 },     // Aumentado
      arbitrage: { maxCapitalUsage: 0.70, maxPositionPct: 0.20, minConfidence: 60 }, // Aumentado
      sentiment: { maxCapitalUsage: 0.40, maxPositionPct: 0.10, minConfidence: 50 },
      deep: { maxCapitalUsage: 0.50, maxPositionPct: 0.15, minConfidence: 55 }
    };
    
    logger.info("RiskManagementService initialized (integrado com CapitalDistributor)", { service: "RiskManagement" });
  }

  getAgentCapital(agentId) {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    return agentInfo ? agentInfo.balance : 0;
  }

  getAgentInvested(agentId) {
    const openTrades = this._getOpenTradesForAgent(agentId);
    let totalInvested = 0;
    for (const trade of openTrades) {
      totalInvested += (trade.entryPrice * trade.qty);
    }
    return totalInvested;
  }

  _getOpenTradesForAgent(agentId) {
    const db = require("./DatabaseService");
    const allOpenTrades = db.getTrades({ status: "OPEN" });
    return allOpenTrades.filter(t => t.agent === agentId);
  }

  validateTrade(symbol, side, notionalValue, agentId = "trend") {
    const cfg = db.getConfig();
    const agentCapital = this.getAgentCapital(agentId);
    const agentConfig = this.agentConfigs[agentId] || this.agentConfigs.trend;
    const agentInvested = this.getAgentInvested(agentId);
    
    const maxCapitalUsage = agentConfig.maxCapitalUsage;
    const maxPositionValue = agentCapital * maxCapitalUsage;
    const availableForNew = maxPositionValue - agentInvested;
    
    // 🔥 AUMENTADO: riskPerTrade máximo 3% (antes 2%)
    const riskPerTrade = Math.min(cfg.riskPerTrade, 3.0);
    const riskDollar = agentCapital * (riskPerTrade / 100);
    
    const errors = [];

    if (this.paused) errors.push("Engine is paused");
    if (this.pausedSymbols.has(symbol)) errors.push(`${symbol} is paused (Flash Crash Shield)`);
    
    if (notionalValue > availableForNew && availableForNew > 0) {
      errors.push(`Capital limit for ${agentId}. Max new position: $${availableForNew.toFixed(2)}`);
    }
    
    // 🔥 AUMENTADO: posição pode ser até 20x o risco (antes 10x)
    if (notionalValue > riskDollar * 20) {
      errors.push(`Position size too large for ${agentId}. Max: $${(riskDollar * 20).toFixed(2)}`);
    }
    
    const bal = exchange.getBalance();
    if (bal.USDT < notionalValue * 0.05) {
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

  calculatePositionSize(symbol, price, stopLossPercent, agentId = "trend", confidence = 70) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const agentCapital = this.getAgentCapital(agentId);
    const agentConfig = this.agentConfigs[agentId] || this.agentConfigs.trend;
    const agentInvested = this.getAgentInvested(agentId);
    
    const maxCapitalUsage = agentConfig.maxCapitalUsage;
    const maxNewPositionValue = Math.max(0, (agentCapital * maxCapitalUsage) - agentInvested);
    
    // 🔥 AUMENTADO: riskPerTrade máximo 3% (antes 2%)
    const riskPerTrade = Math.min(cfg.riskPerTrade, 3.0);
    const riskDollar = agentCapital * (riskPerTrade / 100);
    const stopLossDollar = price * (stopLossPercent / 100);
    
    let qty = riskDollar / stopLossDollar;
    
    const confidenceMultiplier = 0.6 + (confidence / 100); // 0.6 a 1.6 (antes 0.5 a 1.5)
    qty = qty * confidenceMultiplier;
    
    const maxQtyByCapital = maxNewPositionValue / price;
    if (qty > maxQtyByCapital && maxQtyByCapital > 0) {
      qty = maxQtyByCapital * 0.95;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada pelo capital disponível: ${qty.toFixed(6)} ${symbol}`);
    }
    
    // 🔥 AUMENTADO: maxPositionPct agora é o limite principal (30% para trend)
    const maxPositionPct = agentConfig.maxPositionPct;
    const maxQtyByPct = (agentCapital * maxPositionPct) / price;
    if (qty > maxQtyByPct) {
      qty = maxQtyByPct;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada a ${maxPositionPct * 100}% do capital (${qty.toFixed(6)} ${symbol})`);
    }
    
    // 🔥 AUMENTADO: PAPER MODE agora permite 25% do saldo (antes 10%)
    const isPaperMode = cfg.mode === "PAPER";
    if (isPaperMode) {
      const maxQtyPaper = (bal.USDT * 0.25) / price;
      if (qty > maxQtyPaper) {
        qty = maxQtyPaper;
        logger.warn(`[RiskManagement] PAPER MODE: Qty limitada a 25% do saldo (${qty.toFixed(6)} ${symbol})`);
      }
    }
    
    // Quantidades mínimas
    let minQty = 0;
    if (symbol.includes("BTC")) minQty = 0.0001;
    else if (symbol.includes("ETH")) minQty = 0.001;
    else if (symbol.includes("BNB")) minQty = 0.01;
    else minQty = 0.1;
    
    if (qty < minQty) {
      qty = minQty;
      logger.warn(`[RiskManagement] Qty ajustada para mínimo (${minQty}) ${symbol}`);
    }
    
    // 🔥 AUMENTADO: limite máximo absoluto de 40% do capital do agente (antes 20%)
    const absoluteMax = (agentCapital * 0.40) / price;
    if (qty > absoluteMax) {
      qty = absoluteMax;
      logger.warn(`[RiskManagement] ${agentId}: Qty limitada a 40% do capital (${qty.toFixed(6)} ${symbol})`);
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

  getAgentConfig(agentId) {
    return this.agentConfigs[agentId] || this.agentConfigs.trend;
  }

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
  
  getStats() {
    const cfg = db.getConfig();
    const totalEquity = exchange.getBalance().USDT || 0;
    
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

  getTotalInvested() {
    return this.getAgentInvested("trend");
  }

  getTotalEquity() {
    return this.getAgentCapital("trend");
  }
}

module.exports = new RiskManagementService();
