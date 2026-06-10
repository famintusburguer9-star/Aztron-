const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

// 🔥 IMPORT NO TOPO (não dentro das funções)
let capitalDistributor = null;
try {
  capitalDistributor = require("./CapitalDistributorService");
} catch (err) {
  logger.warn(`CapitalDistributor não disponível: ${err.message}`, { service: "Tokenomics" });
}

// ─── $AZTRON Token Constants ──────────────────────────────────────────────────
const TOTAL_SUPPLY       = 1_000_000_000;   // 1 billion $AZTRON
const BURN_RATE_PER_TRADE = 0.005;           // 0.5% burned per profitable trade
const REWARD_THRESHOLD   = 60;              // win rate % to earn rewards
const REWARD_PER_WIN     = 100;             // tokens per winning trade
const INITIAL_PRICE_USD  = 0.0001;          // $0.0001 initial price

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
    
    // 🆕 SAVINGS AGORA VEM DO CAPITAL DISTRIBUTOR
    this._savingsBalance = 0;
    this._totalWithdrawn = 0;
    
    // 🆕 FLAG PARA EVITAR LOOP INFINITO
    this._processing = false;

    // Load saved data from database
    this._loadTokenData();

    // 🆕 ESCUTA EVENTOS DO CAPITAL DISTRIBUTOR PARA ATUALIZAR SAVINGS
    eventBus.on("capital:contribution", (data) => {
      if (data && data.savingsBalance !== undefined) {
        this._savingsBalance = data.savingsBalance;
        this._saveTokenData();
      }
    });
    
    eventBus.on("capital:daily:report", (report) => {
      if (report && report.savings !== undefined) {
        this._savingsBalance = report.savings;
        this._saveTokenData();
      }
    });
    
    eventBus.on("savings:withdraw:approved", (data) => {
      if (data && data.remaining !== undefined) {
        this._savingsBalance = data.remaining;
        this._totalWithdrawn += data.amount || 0;
        this._saveTokenData();
      }
    });

    // Listen to trades for auto-burn / auto-reward
    eventBus.on("trade", (data) => this._processTrade(data));
    
    logger.info("TokenomicsService initialized — $AZTRON supply: 1B (integrado com CapitalDistributor)", { service: "Tokenomics" });

    // Simulate price movement
    setInterval(() => this._simulatePriceMovement(), 30_000);
  }

  async start() {
    await this._syncSavings();
    logger.info("TokenomicsService started — $AZTRON ecosystem ready", { service: "Tokenomics" });
    return { success: true };
  }

  // 🆕 SINCRONIZA SAVINGS COM CAPITAL DISTRIBUTOR
  async _syncSavings() {
    if (!capitalDistributor) return;
    
    try {
      const status = capitalDistributor.getStatus();
      if (status && status.savings) {
        this._savingsBalance = status.savings.balance || 0;
        this._saveTokenData();
        logger.info(`[Tokenomics] Savings sincronizado: $${this._savingsBalance}`, { service: "Tokenomics" });
      }
    } catch (error) {
      logger.warn(`[Tokenomics] Erro ao sincronizar savings: ${error.message}`, { service: "Tokenomics" });
    }
  }

  _loadTokenData() {
    try {
      const saved = db.getTokenData?.();
      if (saved) {
        this._circulatingSupply = saved.circulatingSupply || this._circulatingSupply;
        this._burnedTotal = saved.burnedTotal || 0;
        this._rewardedTotal = saved.rewardedTotal || 0;
        this._holders = saved.holders || 8247;
        this._savingsBalance = saved.savingsBalance || 0;
        this._totalWithdrawn = saved.totalWithdrawn || 0;
        logger.info(`[Tokenomics] Dados carregados: supply=${this._circulatingSupply}, savings=$${this._savingsBalance}`, { service: "Tokenomics" });
      }
    } catch (error) {
      logger.warn(`[Tokenomics] Nenhum dado salvo encontrado`, { service: "Tokenomics" });
    }
  }

  _saveTokenData() {
    try {
      if (db.saveTokenData) {
        db.saveTokenData({
          circulatingSupply: this._circulatingSupply,
          burnedTotal: this._burnedTotal,
          rewardedTotal: this._rewardedTotal,
          holders: this._holders,
          savingsBalance: this._savingsBalance,
          totalWithdrawn: this._totalWithdrawn,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error(`[Tokenomics] Erro ao salvar: ${error.message}`, { service: "Tokenomics" });
    }
  }

  // 🆕 PROCESS PROFIT (COM FLAG ANTI-LOOP)
  processProfit(profitAmount, agentId = "trend") {
    if (this._processing) return { success: false, error: "Already processing" };
    if (profitAmount <= 0) return { success: false, error: "Profit must be positive" };
    
    this._processing = true;
    
    try {
      // Emite evento para o CapitalDistributor processar
      eventBus.emit("agent:profit", {
        agentId: agentId,
        amount: profitAmount,
        tradeId: `profit_${Date.now()}`
      });
      
      logger.info(`💰 Lucro de $${profitAmount.toFixed(2)} (${agentId}) delegado para CapitalDistributor`, { service: "Tokenomics" });
      
      return { 
        success: true, 
        delegated: true,
        savingsBalance: this._savingsBalance
      };
    } finally {
      this._processing = false;
    }
  }

  getSavingsStatus() {
    if (capitalDistributor) {
      try {
        const status = capitalDistributor.getStatus();
        const savings = status?.savings || {};
        return {
          savingsBalance: Math.round((savings.balance || this._savingsBalance) * 100) / 100,
          totalContributions: Math.round((savings.totalContributions || 0) * 100) / 100,
          totalWithdrawn: Math.round((savings.totalWithdrawals || this._totalWithdrawn) * 100) / 100,
          profitSharePercent: 30,
          source: "CapitalDistributor",
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        logger.warn(`Erro ao obter status do CapitalDistributor: ${err.message}`);
      }
    }
    
    return {
      savingsBalance: Math.round(this._savingsBalance * 100) / 100,
      totalContributions: 0,
      totalWithdrawn: Math.round(this._totalWithdrawn * 100) / 100,
      profitSharePercent: 30,
      source: "Local",
      lastUpdated: new Date().toISOString()
    };
  }

  async withdrawFromSavings(amount) {
    if (amount <= 0) return { success: false, error: "Amount must be positive" };
    if (!capitalDistributor) return { success: false, error: "CapitalDistributor not available" };
    
    return new Promise((resolve) => {
      capitalDistributor.handleWithdraw({
        amount: amount,
        to: "tokenomics_withdraw",
        reason: "Manual withdrawal via Tokenomics",
        callback: (result) => {
          if (result.success) {
            this._savingsBalance = result.remaining;
            this._totalWithdrawn += amount;
            this._saveTokenData();
            logger.info(`🏦 Saque realizado via CapitalDistributor: $${amount}`, { service: "Tokenomics" });
          }
          resolve(result);
        }
      });
    });
  }

  addToSavings(amount) {
    logger.warn(`⚠️ addToSavings está obsoleto. O CapitalDistributor gerencia o cofre automaticamente.`, { service: "Tokenomics" });
    return { success: false, error: "Deprecated - use CapitalDistributor directly", savingsBalance: this._savingsBalance };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _processTrade(data) {
    if (this._processing) return;
    if (!data || data.status !== "CLOSED") return;
    
    this._processing = true;
    
    try {
      const pnl = data.pnl ?? 0;
      if (pnl > 0) {
        this.burnTokens(Math.floor(TOTAL_SUPPLY * BURN_RATE_PER_TRADE * 0.001), "AUTO_BURN_TRADE");
        if ((data.pnlPct ?? 0) > 1) {
          this.mintTokens(REWARD_PER_WIN, data.symbol || "TRADE", "TRADE_REWARD");
        }
      }
    } finally {
      this._processing = false;
    }
  }

  _simulatePriceMovement() {
    const change = (Math.random() - 0.48) * 0.000005;
    this._priceUsd = Math.max(0.00001, this._priceUsd + change);
    this._priceChangeH = +(change / INITIAL_PRICE_USD * 100).toFixed(2);
    this._holders += Math.floor(Math.random() * 3);
    this._saveTokenData();
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
    this._saveTokenData();
    logger.info(`[Tokenomics] MINT ${amount} $AZTRON → ${recipient} (${reason})`, { service: "Tokenomics" });
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
    this._saveTokenData();
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
      savings: this.getSavingsStatus()
    };
  }

  getHolders() {
    return {
      total: this._holders,
      topHolders: [
        { address: "0xAZT...R0N", balance: Math.floor(this._circulatingSupply * 0.4), percentage: 40 },
        { address: "0xLIQ...POOL", balance: Math.floor(this._circulatingSupply * 0.25), percentage: 25 },
        { address: "0xTEA...M", balance: Math.floor(this._circulatingSupply * 0.15), percentage: 15 },
        { address: "AZTRON_SAVINGS", balance: Math.floor(this._savingsBalance * 100), percentage: 0.1 }
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
    this._saveTokenData();
    logger.info(`[Tokenomics] Liquidity added: $${amountUsd}`, { service: "Tokenomics" });
    return { success: true, poolLiquidity: this._poolLiquidity };
  }

  getStatus() {
    return {
      version: "v5.0.0",
      integratedWith: "CapitalDistributor",
      tokenStats: this.getTokenStats(),
      savings: this.getSavingsStatus(),
      launchStatus: this._launchStatus,
      network: this._network
    };
  }
}

module.exports = new TokenomicsService();
