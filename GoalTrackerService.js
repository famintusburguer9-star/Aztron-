const storage = require("./storage");
const logger = require("./LoggerService");
const eventBus = require("./EventBus");

class GoalTrackerService {
  constructor() {
    this.agentId = "goals";
    this.isRunning = false;
    
    // Metas padrão
    this.goals = storage.get("goals", [
      { id: "g1", label: "Monthly ROI", target: 10, current: 0, unit: "%", startValue: 0, achieved: false, achievedAt: null },
      { id: "g2", label: "Win Rate", target: 75, current: 0, unit: "%", startValue: 0, achieved: false, achievedAt: null },
      { id: "g3", label: "Max Drawdown", target: 5, current: 0, unit: "%", startValue: 0, achieved: false, achievedAt: null, isLowerBetter: true },
      { id: "g4", label: "Total Trades", target: 100, current: 0, unit: "trades", startValue: 0, achieved: false, achievedAt: null },
      { id: "g5", label: "Profit Factor", target: 1.5, current: 0, unit: "x", startValue: 0, achieved: false, achievedAt: null }
    ]);
    
    // Histórico de progresso
    this.progressHistory = storage.get("goalProgress", []);
    
    // Configurações
    this.config = {
      checkInterval: 60000, // 1 minuto
      alertOnAchievement: true,
      alertOnRegression: false,
      maxHistorySize: 500
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA EVENTOS PARA ATUALIZAR METAS AUTOMATICAMENTE
    eventBus.on("trade:closed", (trade) => this._updateFromTrade(trade));
    eventBus.on("agent:profit", (profit) => this._updateFromProfit(profit));
    eventBus.on("market:stats", (stats) => this._updateFromStats(stats));
    
    logger.info("GoalTrackerService initialized", { service: "GoalTracker", goalsCount: this.goals.length });
  }

  // 🆕 APLICA MELHORIAS
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 GoalTracker recebeu melhoria: ${improvement.recommendation}`, { service: "GoalTracker" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.alertOnRegression = true;
        logger.info(`⚡ GoalTracker: alertas de regressão ativados`, { service: "GoalTracker" });
        break;
        
      case "REDUZIR_RISCO":
        // Ajusta metas para serem mais conservadoras
        const roiGoal = this.goals.find(g => g.id === "g1");
        if (roiGoal && !roiGoal.achieved) {
          roiGoal.target = Math.max(5, roiGoal.target * 0.8);
          this._saveGoals();
        }
        logger.info(`📉 GoalTracker: metas ajustadas para perfil conservador`, { service: "GoalTracker" });
        break;
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Verifica metas periodicamente
    setInterval(() => this._checkGoals(), this.config.checkInterval);
    
    logger.info("GoalTrackerService started", { service: "GoalTracker" });
  }

  stop() {
    this.isRunning = false;
    logger.info("GoalTrackerService stopped", { service: "GoalTracker" });
  }

  // 🆕 ATUALIZA METAS BASEADO EM TRADES
  _updateFromTrade(trade) {
    // Atualiza Win Rate
    const winRateGoal = this.goals.find(g => g.id === "g2");
    if (winRateGoal && trade.result) {
      // Precisa de dados acumulados para calcular win rate
      this._recalculateWinRate();
    }
    
    // Atualiza Total Trades
    const tradesGoal = this.goals.find(g => g.id === "g4");
    if (tradesGoal) {
      const db = require("./DatabaseService");
      const allTrades = db.getTrades({});
      tradesGoal.current = allTrades.length;
      this._saveGoals();
      this._recordProgress(tradesGoal);
    }
  }

  // 🆕 ATUALIZA METAS BASEADO EM LUCRO
  _updateFromProfit(profit) {
    const roiGoal = this.goals.find(g => g.id === "g1");
    if (roiGoal) {
      const capitalDistributor = require("./CapitalDistributorService");
      const totalCapital = capitalDistributor.getTotalSystemBalance?.() || 100000;
      const initialCapital = 100000;
      
      roiGoal.current = ((totalCapital - initialCapital) / initialCapital) * 100;
      this._saveGoals();
      this._recordProgress(roiGoal);
      this._checkGoalAchievement(roiGoal);
    }
  }

  // 🆕 ATUALIZA METAS BASEADO EM ESTATÍSTICAS DE MERCADO
  _updateFromStats(stats) {
    const drawdownGoal = this.goals.find(g => g.id === "g3");
    if (drawdownGoal && stats.maxDrawdown !== undefined) {
      drawdownGoal.current = Math.abs(stats.maxDrawdown);
      this._saveGoals();
      this._recordProgress(drawdownGoal);
      this._checkGoalAchievement(drawdownGoal);
    }
    
    const profitFactorGoal = this.goals.find(g => g.id === "g5");
    if (profitFactorGoal && stats.profitFactor !== undefined) {
      profitFactorGoal.current = stats.profitFactor;
      this._saveGoals();
      this._recordProgress(profitFactorGoal);
      this._checkGoalAchievement(profitFactorGoal);
    }
  }

  // 🆕 RECALCULA WIN RATE
  _recalculateWinRate() {
    const db = require("./DatabaseService");
    const closedTrades = db.getTrades({ status: "CLOSED" });
    const wins = closedTrades.filter(t => t.result === "WIN").length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
    
    const winRateGoal = this.goals.find(g => g.id === "g2");
    if (winRateGoal) {
      winRateGoal.current = Math.round(winRate * 10) / 10;
      this._saveGoals();
      this._recordProgress(winRateGoal);
      this._checkGoalAchievement(winRateGoal);
    }
  }

  // 🆕 REGISTRA PROGRESSO NO HISTÓRICO
  _recordProgress(goal) {
    this.progressHistory.unshift({
      goalId: goal.id,
      label: goal.label,
      target: goal.target,
      current: goal.current,
      progress: (goal.current / goal.target) * 100,
      timestamp: new Date().toISOString()
    });
    
    // Mantém apenas últimos N registros
    if (this.progressHistory.length > this.config.maxHistorySize) {
      this.progressHistory = this.progressHistory.slice(0, this.config.maxHistorySize);
    }
    
    storage.set("goalProgress", this.progressHistory);
  }

  // 🆕 VERIFICA SE META FOI ATINGIDA
  _checkGoalAchievement(goal) {
    if (goal.achieved) return;
    
    let isAchieved = false;
    
    if (goal.isLowerBetter) {
      isAchieved = goal.current <= goal.target;
    } else {
      isAchieved = goal.current >= goal.target;
    }
    
    if (isAchieved) {
      goal.achieved = true;
      goal.achievedAt = new Date().toISOString();
      this._saveGoals();
      
      if (this.config.alertOnAchievement) {
        this._emitGoalAchieved(goal);
      }
    }
  }

  // 🆕 VERIFICA TODAS AS METAS
  _checkGoals() {
    for (const goal of this.goals) {
      this._checkGoalAchievement(goal);
    }
  }

  // 🆕 EMITE ALERTA DE META ATINGIDA
  _emitGoalAchieved(goal) {
    const message = `🎯 META ATINGIDA! ${goal.label}: ${goal.current}${goal.unit} (target: ${goal.target}${goal.unit})`;
    
    logger.info(message, { service: "GoalTracker" });
    
    eventBus.emit("alert", {
      severity: "success",
      message: message,
      type: "goal_achieved",
      goal: goal
    });
    
    eventBus.emit(`learning:${this.agentId}`, {
      type: "goal_achieved",
      content: message,
      confidence: 1.0,
      priority: "high",
      data: goal
    });
  }

  // 🆕 SALVA METAS NO STORAGE
  _saveGoals() {
    storage.set("goals", this.goals);
  }

  // ========== MÉTODOS PÚBLICOS ==========

  getGoals() { 
    return this.goals; 
  }
  
  updateGoal(id, current) {
    const goal = this.goals.find(g => g.id === id);
    if (goal) {
      goal.current = current;
      this._saveGoals();
      this._recordProgress(goal);
      this._checkGoalAchievement(goal);
    }
    return goal;
  }

  addGoal(goal) {
    const newGoal = { 
      id: `g_${Date.now()}`, 
      current: 0,
      startValue: 0,
      achieved: false,
      achievedAt: null,
      ...goal 
    };
    this.goals.push(newGoal);
    this._saveGoals();
    logger.info(`Nova meta adicionada: ${newGoal.label} (target: ${newGoal.target}${newGoal.unit})`, { service: "GoalTracker" });
    return newGoal;
  }

  removeGoal(id) {
    const index = this.goals.findIndex(g => g.id === id);
    if (index !== -1) {
      const removed = this.goals.splice(index, 1)[0];
      this._saveGoals();
      logger.info(`Meta removida: ${removed.label}`, { service: "GoalTracker" });
      return { success: true, removed };
    }
    return { success: false, error: "Goal not found" };
  }

  getProgressHistory(goalId = null, limit = 20) {
    let history = this.progressHistory;
    if (goalId) {
      history = history.filter(h => h.goalId === goalId);
    }
    return history.slice(0, limit);
  }

  getAchievedGoals() {
    return this.goals.filter(g => g.achieved);
  }

  getPendingGoals() {
    return this.goals.filter(g => !g.achieved);
  }

  getProgress(goalId) {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return null;
    
    const progress = goal.isLowerBetter 
      ? Math.max(0, Math.min(100, (1 - goal.current / goal.target) * 100))
      : Math.min(100, (goal.current / goal.target) * 100);
    
    return {
      goalId: goal.id,
      label: goal.label,
      current: goal.current,
      target: goal.target,
      unit: goal.unit,
      progress: Math.round(progress * 10) / 10,
      achieved: goal.achieved,
      remaining: goal.isLowerBetter 
        ? Math.max(0, goal.current - goal.target)
        : Math.max(0, goal.target - goal.current)
    };
  }

  getOverallProgress() {
    const achieved = this.getAchievedGoals().length;
    const total = this.goals.length;
    
    return {
      achieved: achieved,
      total: total,
      percentage: total > 0 ? (achieved / total) * 100 : 0,
      goals: this.goals.map(g => this.getProgress(g.id))
    };
  }

  getStatus() {
    return {
      running: this.isRunning,
      totalGoals: this.goals.length,
      achievedGoals: this.getAchievedGoals().length,
      pendingGoals: this.getPendingGoals().length,
      config: this.config,
      historySize: this.progressHistory.length,
      overallProgress: this.getOverallProgress()
    };
  }

  reset() {
    // Reseta todas as metas
    for (const goal of this.goals) {
      goal.current = goal.startValue || 0;
      goal.achieved = false;
      goal.achievedAt = null;
    }
    this.progressHistory = [];
    this._saveGoals();
    storage.set("goalProgress", this.progressHistory);
    
    logger.info("GoalTrackerService reset", { service: "GoalTracker" });
    return { success: true };
  }
}

module.exports = new GoalTrackerService();
