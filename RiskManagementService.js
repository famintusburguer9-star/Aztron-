const db = require("./DatabaseService");
const exchange = require("./ExchangeAdapterService");
const logger = require("./LoggerService");

class RiskManagementService {
  constructor() {
    this.paused = false;
    this.pausedSymbols = new Set();
    logger.info("RiskManagementService initialized", { service: "RiskManagement" });
  }

  // 🔥 NOVO: Calcula o total investido em posições abertas
  getTotalInvested() {
    const bal = exchange.getBalance();
    let totalInvested = 0;
    for (const [asset, qty] of Object.entries(bal)) {
      if (asset !== "USDT" && qty > 0) {
        const ticker = exchange.getTicker(`${asset}USDT`);
        if (ticker) {
          totalInvested += qty * ticker.price;
        }
      }
    }
    return totalInvested;
  }

  // 🔥 NOVO: Obtém o equity total (USDT + valor das posições)
  getTotalEquity() {
    const bal = exchange.getBalance();
    let totalEquity = bal.USDT || 0;
    for (const [asset, qty] of Object.entries(bal)) {
      if (asset !== "USDT" && qty > 0) {
        const ticker = exchange.getTicker(`${asset}USDT`);
        if (ticker) {
          totalEquity += qty * ticker.price;
        }
      }
    }
    return totalEquity;
  }

  validateTrade(symbol, side, notionalValue) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const totalEquity = this.getTotalEquity();
    const totalInvested = this.getTotalInvested();
    
    // 🔥 LIMITE DE 70% DO CAPITAL INVESTIDO
    const MAX_CAPITAL_USAGE = 0.70;
    const availableForNew = (totalEquity * MAX_CAPITAL_USAGE) - totalInvested;
    
    const riskAmount = totalEquity * (cfg.riskPerTrade / 100);
    const errors = [];

    if (this.paused) errors.push("Engine is paused");
    if (this.pausedSymbols.has(symbol)) errors.push(`${symbol} is paused (Flash Crash Shield)`);
    
    // 🔥 NOVO: Verifica se já atingiu o limite de capital investido
    if (notionalValue > availableForNew && availableForNew > 0) {
      errors.push(`Capital limit reached. Max new position: $${availableForNew.toFixed(2)}`);
    }
    
    // 🔥 REDUZIDO: Limite de 10x o risco (não 100x)
    if (notionalValue > riskAmount * 10) {
      errors.push(`Position size too large. Max: $${(riskAmount * 10).toFixed(2)}`);
    }
    
    if (bal.USDT < notionalValue * 0.1) {
      errors.push("Insufficient USDT balance");
    }

    return { approved: errors.length === 0, errors, maxPositionSize: riskAmount, totalEquity, availableForNew };
  }

  calculatePositionSize(symbol, price, stopLossPercent) {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    const totalEquity = this.getTotalEquity();
    const totalInvested = this.getTotalInvested();
    
    // 🔥 LIMITE DE 70% DO CAPITAL INVESTIDO
    const MAX_CAPITAL_USAGE = 0.70;
    const maxNewPositionValue = (totalEquity * MAX_CAPITAL_USAGE) - totalInvested;
    
    // 🔥 RISK PER TRADE: máximo 2% do equity por trade
    const riskPerTrade = Math.min(cfg.riskPerTrade, 2.0);
    const riskDollar = totalEquity * (riskPerTrade / 100);
    const stopLossDollar = price * (stopLossPercent / 100);
    
    let qty = riskDollar / stopLossDollar;
    
    // 🔥 LIMITA PELO CAPITAL DISPONÍVEL
    const maxQtyByCapital = maxNewPositionValue / price;
    if (qty > maxQtyByCapital && maxQtyByCapital > 0) {
      qty = maxQtyByCapital * 0.9; // Usa 90% do disponível
      logger.warn(`[RiskManagement] Qty limitada pelo capital disponível: ${qty.toFixed(6)} ${symbol}`);
    }
    
    // 🔥 LIMITE DO MODO PAPER: máximo 10% do saldo USDT
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
    
    // 🔥 LIMITE MÁXIMO ABSOLUTO: nunca mais que 20% do equity
    const absoluteMax = (totalEquity * 0.20) / price;
    if (qty > absoluteMax) {
      qty = absoluteMax;
      logger.warn(`[RiskManagement] Qty limitada a 20% do equity (${qty.toFixed(6)} ${symbol})`);
    }
    
    return { 
      qty: Math.round(qty * 10000) / 10000, 
      riskDollar: Math.round(riskDollar * 100) / 100,
      stopPrice: price * (1 - stopLossPercent / 100),
      maxNewPositionValue: Math.round(maxNewPositionValue * 100) / 100,
      totalEquity: Math.round(totalEquity * 100) / 100,
      investedPercent: Math.round((totalInvested / totalEquity) * 100)
    };
  }

  // 🔥 NOVO: Verifica se pode abrir nova posição
  canOpenNewPosition(symbol, notionalValue) {
    const totalEquity = this.getTotalEquity();
    const totalInvested = this.getTotalInvested();
    const investedPercent = (totalInvested / totalEquity) * 100;
    
    if (investedPercent >= 70) {
      return { allowed: false, reason: `Capital invested: ${investedPercent.toFixed(1)}% (max 70%)` };
    }
    
    const available = (totalEquity * 0.70) - totalInvested;
    if (notionalValue > available) {
      return { allowed: false, reason: `Insufficient capital. Need $${notionalValue}, available $${available.toFixed(2)}` };
    }
    
    return { allowed: true, available: available };
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
    const totalEquity = this.getTotalEquity();
    const totalInvested = this.getTotalInvested();
    const investedPercent = totalEquity > 0 ? (totalInvested / totalEquity) * 100 : 0;
    
    return { 
      paused: this.paused, 
      pausedSymbols: this.getPausedSymbols(), 
      riskPerTrade: cfg.riskPerTrade, 
      stopLoss: cfg.stopLoss, 
      takeProfit: cfg.takeProfit, 
      mode: cfg.mode,
      totalEquity: Math.round(totalEquity * 100) / 100,
      totalInvested: Math.round(totalInvested * 100) / 100,
      investedPercent: Math.round(investedPercent),
      availableCapital: Math.round((totalEquity - totalInvested) * 100) / 100
    };
  }
}

module.exports = new RiskManagementService();
