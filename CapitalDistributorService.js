const EventBus = require("./EventBus");
const logger = require("./LoggerService");
const db = require("./DatabaseService");

class CapitalDistributorService {
  constructor() {
    // CONFIGURAÇÃO INICIAL
    this.totalCapital = 100000; // 100k total
    this.savingsPercent = 0.30; // 30% do lucro vai pro cofre
    this.reinvestPercent = 0.70; // 70% reinveste
    
    // MODO: PAPER ou LIVE (puxa do banco)
    this.mode = "PAPER"; // Começa em PAPER
    
    // 5 ROBÔS
    this.agents = [
      { 
        id: "trend", 
        name: "Trend Aztron", 
        balance: 0, 
        initialBalance: 0,
        initialPercent: 0.20, // 20k
        active: true,
        paperBalance: 0,
        totalPnL: 0,
        trades: []
      },
      { 
        id: "hft", 
        name: "HFT Service", 
        balance: 0, 
        initialBalance: 0,
        initialPercent: 0.20,
        active: true,
        paperBalance: 0,
        totalPnL: 0,
        trades: []
      },
      { 
        id: "arbitrage", 
        name: "Arbitrage Service", 
        balance: 0, 
        initialBalance: 0,
        initialPercent: 0.20,
        active: true,
        paperBalance: 0,
        totalPnL: 0,
        trades: []
      },
      { 
        id: "sentiment", 
        name: "Sentiment Service", 
        balance: 0, 
        initialBalance: 0,
        initialPercent: 0.20,
        active: true,
        paperBalance: 0,
        totalPnL: 0,
        trades: []
      },
      { 
        id: "deep", 
        name: "Deep Pattern", 
        balance: 0, 
        initialBalance: 0,
        initialPercent: 0.20,
        active: true,
        paperBalance: 0,
        totalPnL: 0,
        trades: []
      }
    ];
    
    // COFRE (Savings)
    this.savings = { 
      balance: 0, 
      totalContributions: 0, 
      totalWithdrawals: 0,
      paperBalance: 0
    };
    
    // Histórico
    this.dailyContributions = {};
    this.dailyReports = [];
    this.isRunning = false;
  }

  async start() {
    this.isRunning = true;
    
    // Carrega estado salvo
    await this.loadState();
    
    // Distribui capital inicial
    if (this.agents[0].balance === 0) {
      this.distributeInitialCapital();
    }
    
    // Escuta lucros para coletar 30%
    EventBus.on("agent:profit", (profit) => this.collectSavings(profit));
    
    // Escuta pedidos de capital dos robôs
    EventBus.on("capital:request", (request) => this.handleRequest(request));
    
    // Escuta devolução de capital
    EventBus.on("capital:return", (returnData) => this.handleReturn(returnData));
    
    // Relatório diário (meia noite)
    this.scheduleDailyReport();
    
    logger.info("💰 CapitalDistributorService iniciado em PAPER MODE");
    logger.info(`   Total inicial: $${this.totalCapital}`);
    logger.info(`   5 robôs x $${this.totalCapital / this.agents.length} cada`);
    this.logStatus();
  }

  distributeInitialCapital() {
    const amountPerAgent = this.totalCapital / this.agents.length;
    
    for (const agent of this.agents) {
      agent.balance = amountPerAgent;
      agent.initialBalance = amountPerAgent;
      agent.paperBalance = amountPerAgent;
      
      // Emite evento de alocação para o robô
      EventBus.emit(`capital:${agent.id}:allocated`, {
        agent: agent.id,
        amount: amountPerAgent,
        total: this.totalCapital,
        mode: this.mode
      });
      
      logger.info(`💰 ${agent.name}: $${amountPerAgent.toFixed(2)} (20%) - PAPER MODE`);
    }
    
    this.saveState();
  }

  handleRequest(request) {
    const { agentId, amount, reason, callback } = request;
    const agent = this.agents.find(a => a.id === agentId);
    
    if (!agent) {
      const response = { success: false, reason: "Agent not found" };
      if (callback) callback(response);
      return response;
    }
    
    if (!agent.active) {
      const response = { success: false, reason: "Agent inactive" };
      if (callback) callback(response);
      return response;
    }
    
    if (amount > agent.balance) {
      logger.warn(`${agent.name}: Saldo insuficiente. Necessário $${amount}, disponível $${agent.balance}`);
      const response = { success: false, reason: "Insufficient balance", available: agent.balance };
      if (callback) callback(response);
      return response;
    }
    
    // Reserva o capital
    agent.balance -= amount;
    agent.paperBalance = agent.balance;
    
    this.saveState();
    
    logger.info(`✅ ${agent.name}: $${amount} reservado para ${reason}. Saldo restante: $${agent.balance}`);
    
    const response = { success: true, amount, newBalance: agent.balance };
    if (callback) callback(response);
    return response;
  }

  handleReturn(returnData) {
    const { agentId, amount, reason } = returnData;
    const agent = this.agents.find(a => a.id === agentId);
    
    if (agent) {
      agent.balance += amount;
      agent.paperBalance = agent.balance;
      
      this.saveState();
      
      logger.info(`🔄 ${agent.name}: $${amount} devolvido. Motivo: ${reason}. Novo saldo: $${agent.balance}`);
      
      EventBus.emit(`capital:${agentId}:returned`, {
        agent: agentId,
        amount,
        newBalance: agent.balance
      });
    }
  }

  collectSavings(profit) {
    const { agentId, amount, tradeId } = profit;
    const agent = this.agents.find(a => a.id === agentId);
    
    if (!agent) return;
    
    const contribution = amount * this.savingsPercent;
    const reinvest = amount * this.reinvestPercent;
    
    // Atualiza saldo do robô (já descontou o que foi usado no trade)
    // O lucro já está incluso, agora só tira a contribuição
    agent.balance += reinvest; // 70% do lucro volta
    agent.totalPnL += amount;
    agent.paperBalance = agent.balance;
    
    // Registra trade
    agent.trades.push({
      id: tradeId,
      profit: amount,
      contribution,
      reinvest,
      timestamp: Date.now()
    });
    
    // Mantém só últimos 100 trades
    if (agent.trades.length > 100) agent.trades.shift();
    
    // Adiciona ao cofre
    this.savings.balance += contribution;
    this.savings.totalContributions += contribution;
    this.savings.paperBalance = this.savings.balance;
    
    // Registra contribuição diária
    const today = new Date().toDateString();
    if (!this.dailyContributions[today]) {
      this.dailyContributions[today] = {};
    }
    this.dailyContributions[today][agentId] = (this.dailyContributions[today][agentId] || 0) + contribution;
    
    logger.info(`🏦 ${agent.name}: Lucro $${amount} → Cofre $${contribution} (30%) | Reinveste $${reinvest} (70%)`);
    logger.info(`   Saldo ${agent.name}: $${agent.balance.toFixed(2)}`);
    logger.info(`   Cofre total: $${this.savings.balance.toFixed(2)}`);
    
    EventBus.emit("capital:contribution", {
      agent: agentId,
      profit: amount,
      contribution,
      reinvest,
      savingsBalance: this.savings.balance,
      agentBalance: agent.balance
    });
    
    this.saveState();
  }

  getAgentBalance(agentId) {
    const agent = this.agents.find(a => a.id === agentId);
    return agent ? agent.balance : 0;
  }

  getAgentInfo(agentId) {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      balance: agent.balance,
      initialBalance: agent.initialBalance,
      totalPnL: agent.totalPnL,
      active: agent.active,
      tradesCount: agent.trades.length
    };
  }

  getSavingsBalance() {
    return this.savings.balance;
  }

  handleWithdraw(request) {
    const { amount, to, reason, callback } = request;
    
    if (amount > this.savings.balance) {
      logger.warn(`Cofre: Saldo insuficiente. Necessário $${amount}, disponível $${this.savings.balance}`);
      if (callback) callback({ success: false, reason: "Insufficient balance" });
      return;
    }
    
    this.savings.balance -= amount;
    this.savings.totalWithdrawals += amount;
    this.savings.paperBalance = this.savings.balance;
    
    logger.info(`🏦 SAQUE DO COFRE: $${amount} para ${to || "desconhecido"} - Motivo: ${reason}`);
    logger.info(`   Cofre restante: $${this.savings.balance.toFixed(2)}`);
    
    EventBus.emit("savings:withdraw:approved", { amount, to, reason, remaining: this.savings.balance });
    this.saveState();
    
    if (callback) callback({ success: true, amount, remaining: this.savings.balance });
  }

  scheduleDailyReport() {
    // Executa relatório diário às 23:59
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
    const msUntilNight = night.getTime() - now.getTime();
    
    setTimeout(() => {
      this.dailyReport();
      setInterval(() => this.dailyReport(), 86400000);
    }, msUntilNight);
  }

  dailyReport() {
    const today = new Date().toDateString();
    const contributions = this.dailyContributions[today] || {};
    
    const report = {
      date: today,
      savings: this.savings.balance,
      totalContributions: this.savings.totalContributions,
      totalWithdrawals: this.savings.totalWithdrawals,
      agents: this.agents.map(a => ({
        name: a.name,
        balance: a.balance,
        pnl: a.balance - a.initialBalance,
        pnlPercent: ((a.balance - a.initialBalance) / a.initialBalance * 100).toFixed(2),
        tradesCount: a.trades.length
      })),
      dailyContributions: contributions
    };
    
    this.dailyReports.unshift(report);
    if (this.dailyReports.length > 30) this.dailyReports.pop();
    
    logger.info(`📊 ================== RELATÓRIO DIÁRIO ==================`);
    logger.info(`📅 DATA: ${today}`);
    logger.info(`💰 COFRE: $${this.savings.balance.toFixed(2)}`);
    logger.info(`📈 CONTRIBUIÇÕES TOTAIS: $${this.savings.totalContributions.toFixed(2)}`);
    logger.info(`📤 SAQUES TOTAIS: $${this.savings.totalWithdrawals.toFixed(2)}`);
    logger.info(`👥 ROBÔS:`);
    
    for (const agent of report.agents) {
      const pnlSignal = agent.pnl >= 0 ? "+" : "";
      logger.info(`   ${agent.name}: $${agent.balance.toFixed(2)} (${pnlSignal}${agent.pnlPercent}%) - ${agent.tradesCount} trades`);
    }
    
    logger.info(`📊 =====================================================`);
    
    EventBus.emit("capital:daily:report", report);
    this.saveState();
  }

  async loadState() {
    try {
      const saved = db.get("capitalDistributor");
      if (saved) {
        this.agents = saved.agents || this.agents;
        this.savings = saved.savings || this.savings;
        this.dailyContributions = saved.dailyContributions || {};
        this.dailyReports = saved.dailyReports || [];
        logger.info("📂 Estado do CapitalDistributor carregado");
      }
    } catch (err) {
      logger.warn("Nenhum estado salvo encontrado");
    }
  }

  saveState() {
    db.save("capitalDistributor", {
      agents: this.agents,
      savings: this.savings,
      dailyContributions: this.dailyContributions,
      dailyReports: this.dailyReports
    });
  }

  logStatus() {
    logger.info(`📊 STATUS CAPITAL (${this.mode} MODE):`);
    for (const agent of this.agents) {
      const pnl = agent.balance - agent.initialBalance;
      const pnlPercent = (pnl / agent.initialBalance * 100).toFixed(2);
      logger.info(`   ${agent.name}: $${agent.balance.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPercent}%)`);
    }
    logger.info(`   🏦 Cofre: $${this.savings.balance.toFixed(2)}`);
    logger.info(`   💰 Total do sistema: $${this.getTotalSystemBalance().toFixed(2)}`);
  }

  getTotalSystemBalance() {
    const agentsTotal = this.agents.reduce((sum, a) => sum + a.balance, 0);
    return agentsTotal + this.savings.balance;
  }

  getStatus() {
    return {
      mode: this.mode,
      totalCapital: this.totalCapital,
      currentTotal: this.getTotalSystemBalance(),
      savings: this.savings,
      agents: this.agents.map(a => ({
        id: a.id,
        name: a.name,
        balance: a.balance,
        initialBalance: a.initialBalance,
        pnl: a.balance - a.initialBalance,
        pnlPercent: ((a.balance - a.initialBalance) / a.initialBalance * 100).toFixed(2),
        active: a.active,
        tradesCount: a.trades.length
      })),
      dailyReports: this.dailyReports.slice(0, 7)
    };
  }

  // Método para migrar para LIVE (quando estiver pronto)
  async switchToLiveMode() {
    this.mode = "LIVE";
    
    // Verifica se tem saldo real na exchange
    const exchange = require("./ExchangeAdapterService");
    const realBalance = await exchange.getBalance();
    
    if (realBalance.USDT < this.totalCapital) {
      logger.error(`❌ Não é possível migrar para LIVE: Saldo real $${realBalance.USDT} < necessário $${this.totalCapital}`);
      return { success: false, reason: "Insufficient real balance" };
    }
    
    logger.info(`🔄 Migrando para LIVE MODE...`);
    logger.info(`   Saldo real disponível: $${realBalance.USDT}`);
    
    // Atualiza configuração no banco
    db.updateConfig({ mode: "LIVE" });
    
    EventBus.emit("capital:mode:changed", { mode: "LIVE" });
    
    return { success: true, mode: "LIVE" };
  }

  stop() {
    this.isRunning = false;
    logger.info("CapitalDistributorService parado");
  }
}

module.exports = new CapitalDistributorService();