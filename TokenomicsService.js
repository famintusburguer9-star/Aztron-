const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

// ─── $AZTRON Token Constants ──────────────────────────────────────────────────
const TOTAL_SUPPLY       = 1_000_000_000;   // 1 billion $AZTRON
const BURN_RATE_PER_TRADE = 0.005;           // 0.5% burned per profitable trade
const REWARD_THRESHOLD   = 60;              // win rate % to earn rewards
const REWARD_PER_WIN     = 100;             // tokens per winning trade
const INITIAL_PRICE_USD  = 0.0001;          // $0.0001 initial price

// 🆕 Savings (Cofre) Configuration
const PROFIT_SHARE_PERCENT = 20;             // 20% do lucro vai pro cofre
const SAVINGS_ACCOUNT = "AZTRON_SAVINGS";    // Identificador do cofre

// Allocation breakdown
const ALLOCATION = {
  publicSale:    { pct: 40, label: "Venda Pública",    color: "#00D4FF" },
  liquidity:     { pct: 25, label: "Liquidez",         color: "#00E676" },
  team:          { pct: 15, label: "Time",             color: "#1A6FD4" },
  marketing:     { pct: 10, label: "Marketing",        color: "#FFB300" },
  rewards:       { pct: 5,  label: "Recompensas",      color: "#7B61FF" },
  reserve:       { pct: 5,  label: "Reserva",          color: "#666680" },
};

class TokenomicsService {
  constructor() {
    this._circulatingSupply = TOTAL_SUPPLY * 0.4; // 40% in circulation at launch
    this._burnedTotal   = 0;
    this._rewardedTotal = 0;
    this._transactions  = [];
    this._holders       = 8247;
    this._priceUsd      = INITIAL_PRICE_USD;
    this._priceChangeH  = 0;
    this._network       = "BSC"; // Binance Smart Chain
    this._contractAddr  = "0xAZT...R0N"; // placeholder — replace after real deploy
    this._launchStatus  = "PRE_LAUNCH"; // PRE_LAUNCH | LIVE | PAUSED
    this._poolLiquidity = 0;
    this._lastBurn      = null;
    this._lastReward    = null;
    
    // 🆕 Savings (Cofre) properties
    this._savingsBalance = 0;      // Saldo do cofre (você pode sacar)
    this._workingCapital = 0;      // Capital de trabalho (robô opera)
    this._totalWithdrawn = 0;      // Total já sacado

    // Load saved data from database
    this._loadSavingsData();

    // Listen to trades for auto-burn / auto-reward
    eventBus.on("trade", (data) => this._processTrade(data));
    logger.info("TokenomicsService initialized — $AZTRON supply: 1B", { service: "Tokenomics" });

    // Simulate price movement
    setInterval(() => this._simulatePriceMovement(), 30_000);
  }

  async start() {
    logger.info("TokenomicsService started — $AZTRON ecosystem ready", { service: "Tokenomics" });
    return { success: true };
  }

  // 🆕 Load savings data from database
  _loadSavingsData() {
    try {
      const saved = db.getSavings?.();
      if (saved) {
        this._savingsBalance = saved.savingsBalance || 0;
        this._workingCapital = saved.workingCapital || 0;
        this._totalWithdrawn = saved.totalWithdrawn || 0;
        logger.info(`[Savings] Carregado: Cofre=$${this._savingsBalance}, Capital=$${this._workingCapital}`, { service: "Tokenomics" });
      }
    } catch (error) {
      logger.warn(`[Savings] Nenhum dado salvo encontrado`, { service: "Tokenomics" });
    }
  }

  // 🆕 Save savings data to database
  _saveSavingsData() {
    try {
      if (db.saveSavings) {
        db.saveSavings({
          savingsBalance: this._savingsBalance,
          workingCapital: this._workingCapital,
          totalWithdrawn: this._totalWithdrawn,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error(`[Savings] Erro ao salvar: ${error.message}`, { service: "Tokenomics" });
    }
  }

  // 🆕 Processa lucro de trade (separando para o cofre)
  processProfit(profitAmount) {
    if (profitAmount <= 0) return { success: false, error: "Profit must be positive" };
    
    const toSavings = profitAmount * (PROFIT_SHARE_PERCENT / 100);
    const toCapital = profitAmount - toSavings;
    
    this._savingsBalance += toSavings;
    this._workingCapital += toCapital;
    this._saveSavingsData();
    
    logger.info(`💰 Lucro processado: $${profitAmount.toFixed(2)} | Cofre: +$${toSavings.toFixed(2)} | Capital: +$${toCapital.toFixed(2)}`, { 
      service: "Tokenomics",
      savings: this._savingsBalance,
      capital: this._workingCapital
    });
    
    eventBus.emit("savings:update", {
      profit: profitAmount,
      toSavings,
      toCapital,
      savingsBalance: this._savingsBalance,
      workingCapital: this._workingCapital,
      timestamp: new Date().toISOString()
    });
    
    return { success: true, toSavings, toCapital, savingsBalance: this._savingsBalance, workingCapital: this._workingCapital };
  }

  // 🆕 Sacar dinheiro do cofre
  withdrawFromSavings(amount) {
    if (amount <= 0) return { success: false, error: "Amount must be positive" };
    if (amount > this._savingsBalance) return { success: false, error: "Insufficient savings balance" };
    
    this._savingsBalance -= amount;
    this._totalWithdrawn += amount;
    this._saveSavingsData();
    
    logger.info(`🏦 Saque realizado: $${amount.toFixed(2)} | Saldo restante: $${this._savingsBalance.toFixed(2)}`, { service: "Tokenomics" });
    
    eventBus.emit("savings:withdraw", {
      amount,
      remaining: this._savingsBalance,
      totalWithdrawn: this._totalWithdrawn,
      timestamp: new Date().toISOString()
    });
    
    return { success: true, amount, remainingBalance: this._savingsBalance, totalWithdrawn: this._totalWithdrawn };
  }

  // 🆕 Obter status do cofre
  getSavingsStatus() {
    return {
      savingsBalance: Math.round(this._savingsBalance * 100) / 100,
      workingCapital: Math.round(this._workingCapital * 100) / 100,
      totalWithdrawn: Math.round(this._totalWithdrawn * 100) / 100,
      profitSharePercent: PROFIT_SHARE_PERCENT,
      lastUpdated: new Date().toISOString()
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _processTrade(data) {
    if (!data || data.status !== "CLOSED") return;
    const pnl = data.pnl ?? 0;
    if (pnl > 0) {
      this.burnTokens(Math.floor(TOTAL_SUPPLY * BURN_RATE_PER_TRADE * 0.001), "AUTO_BURN_TRADE");
      if ((data.pnlPct ?? 0) > 1) {
        this.mintTokens(REWARD_PER_WIN, data.symbol || "TRADE", "TRADE_REWARD");
      }
    }
  }

  _simulatePriceMovement() {
    const change = (Math.random() - 0.48) * 0.000005;
    this._priceUsd = Math.max(0.00001, this._priceUsd + change);
    this._priceChangeH = +(change / INITIAL_PRICE_USD * 100).toFixed(2);
    this._holders += Math.floor(Math.random() * 3);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  mintTokens(amount, recipient = "SYSTEM", reason = "REWARD") {
    if (amount <= 0) return { success: false, error: "amount must be > 0" };
    if (this._launchStatus === "PRE_LAUNCH") {
      const tx = { id: `tx_${Date.now()}`, type: "MINT", amount, recipient, reason, status: "QUEUED", timestamp: new Date().toISOString() };
      this._transactions.unshift(tx);
      return { success: true, queued: true, tx };
    }
    this._circulatingSupply += amount;
    this._rewardedTotal += amount;
    this._lastReward = new Date().toISOString();
    const tx = { id: `tx_${Date.now()}`, type: "MINT", amount, recipient, reason, status: "CONFIRMED", timestamp: new Date().toISOString() };
    this._transactions.unshift(tx);
    if (this._transactions.length > 50) this._transactions = this._transactions.slice(0, 50);
    logger.info(`[Tokenomics] MINT ${amount} $AZTRON → ${recipient} (${reason})`, { service: "Tokenomics" });
    eventBus.emit("alert", { id: `tok_${Date.now()}`, type: "INFO", message: `+${amount} $AZTRON mintados para ${recipient}`, timestamp: new Date().toISOString(), read: false });
    return { success: true, tx };
  }

  burnTokens(amount, reason = "MANUAL") {
    if (amount <= 0) return { success: false, error: "amount must be > 0" };
    const burned = Math.min(amount, this._circulatingSupply);
    this._circulatingSupply -= burned;
    this._burnedTotal += burned;
    this._lastBurn = new Date().toISOString();
    const tx = { id: `tx_${Date.now()}`, type: "BURN", amount: burned, reason, status: "CONFIRMED", timestamp: new Date().toISOString() };
    this._transactions.unshift(tx);
    if (this._transactions.length > 50) this._transactions = this._transactions.slice(0, 50);
    logger.info(`[Tokenomics] BURN ${burned} $AZTRON (${reason})`, { service: "Tokenomics" });
    return { success: true, burned, tx };
  }

  getTokenStats() {
    const marketCap = this._circulatingSupply * this._priceUsd;
    const burnedPct  = (this._burnedTotal / TOTAL_SUPPLY) * 100;

    return {
      symbol:            "$AZTRON",
      network:           this._network,
      contractAddress:   this._contractAddr,
      launchStatus:      this._launchStatus,
      totalSupply:       TOTAL_SUPPLY,
      circulatingSupply: Math.floor(this._circulatingSupply),
      burnedTotal:       Math.floor(this._burnedTotal),
      burnedPercent:     +burnedPct.toFixed(4),
      rewardedTotal:     Math.floor(this._rewardedTotal),
      priceUsd:          +this._priceUsd.toFixed(8),
      priceChangeH:      this._priceChangeH,
      marketCapUsd:      +marketCap.toFixed(2),
      holders:           this._holders,
      poolLiquidity:     this._poolLiquidity,
      burnRatePerTrade:  `${(BURN_RATE_PER_TRADE * 100).toFixed(1)}%`,
      rewardPerWin:      REWARD_PER_WIN,
      rewardThreshold:   `${REWARD_THRESHOLD}% win rate`,
      lastBurn:          this._lastBurn,
      lastReward:        this._lastReward,
      allocation:        ALLOCATION,
      recentTxs:         this._transactions.slice(0, 10),
      savings: this.getSavingsStatus() // 🆕 Inclui status do cofre
    };
  }

  getHolders() {
    return {
      total: this._holders,
      topHolders: [
        { address: "0xAZT...R0N", balance: Math.floor(this._circulatingSupply * 0.4), percentage: 40 },
        { address: "0xLIQ...POOL", balance: Math.floor(this._circulatingSupply * 0.25), percentage: 25 },
        { address: "0xTEA...M", balance: Math.floor(this._circulatingSupply * 0.15), percentage: 15 },
        { address: SAVINGS_ACCOUNT, balance: Math.floor(this._savingsBalance * 100), percentage: 0.1 } // 🆕 Conta do cofre
      ]
    };
  }

  getPendingRewards() {
    return {
      pending: this._rewardedTotal,
      lastReward: this._lastReward,
      rewardRate: `${REWARD_PER_WIN} $AZTRON por win rate > ${REWARD_THRESHOLD}%`
    };
  }

  rewardUser(userId, amount, reason) {
    return this.mintTokens(amount, userId, reason);
  }

  getRoadmap() {
    return [
      { phase: "Fase 1", title: "Token Generation Event", status: "PENDING", description: "Deploy contrato BSC, definir supply, configurar tokenomics", target: "Q3 2026" },
      { phase: "Fase 2", title: "PancakeSwap Listing", status: "PENDING", description: "Criar pool de liquidez AZTRON/USDT na PancakeSwap BSC", target: "Q3 2026" },
      { phase: "Fase 3", title: "Reward System Live", status: "PENDING", description: "Ativar recompensas automáticas por win rate + queima por trade", target: "Q4 2026" },
      { phase: "Fase 4", title: "Carteiras Integradas", status: "PENDING", description: "Conectar MetaMask + Trust Wallet para saque direto de recompensas", target: "Q4 2026" },
      { phase: "Fase 5", title: "CEX Listing", status: "PENDING", description: "Listagem em exchanges centralizadas (Bybit, Gate.io)", target: "Q1 2027" },
    ];
  }

  getContractTemplate() {
    return {
      network: "BSC (BEP-20)",
      solanaAlt: "Solana (SPL Token)",
      compiledWith: "Solidity ^0.8.20",
      tokenStandard: "BEP-20 / ERC-20 compatible",
      features: ["Mint by owner", "Burn by holder", "Anti-whale (max 2% per tx)", "Renounce ownership after launch"],
      deploySteps: [
        "1. Instalar Remix IDE (remix.ethereum.org)",
        "2. Colar o contrato Solidity gerado",
        "3. Compilar com Solidity 0.8.20",
        "4. Conectar MetaMask na rede BSC Mainnet",
        "5. Deploy → confirmar no MetaMask (~$5 em BNB)",
        "6. Verificar contrato no BscScan",
        "7. Criar pool na PancakeSwap: Add Liquidity AZTRON/USDT",
      ],
      note: "Contrato pronto para deploy — substitua contractAddress após deploy real.",
    };
  }

  setLaunchStatus(status) {
    if (!["PRE_LAUNCH", "LIVE", "PAUSED"].includes(status)) return { success: false, error: "invalid status" };
    this._launchStatus = status;
    logger.info(`[Tokenomics] Launch status → ${status}`, { service: "Tokenomics" });
    return { success: true, launchStatus: status };
  }

  addLiquidity(amountUsd) {
    this._poolLiquidity += amountUsd;
    logger.info(`[Tokenomics] Liquidity added: $${amountUsd}`, { service: "Tokenomics" });
    return { success: true, poolLiquidity: this._poolLiquidity };
  }
}

module.exports = new TokenomicsService();
