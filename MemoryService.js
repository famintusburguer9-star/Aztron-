const logger = require("./LoggerService");
const eventBus = require("./EventBus");

class MemoryService {
  constructor() {
    this.patterns = [];
    this.strategies = [];
    this.tradeMemory = [];
    this.improvements = [];
    this.correlations = [];      // 🆕 Correlações descobertas
    this.db = null;
    this._initialized = false;
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "memory";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      maxPatterns: 100,
      maxTradeMemory: 500,
      maxImprovements: 200,
      autoPrune: true,
      pruneAgeDays: 30
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // 🆕 ESCUTA RESULTADOS DE TRADES PARA APRENDER
    eventBus.on("trade:closed", (trade) => {
      if (trade.agent && trade.strategy) {
        this.recordStrategyPerformance(trade.strategy, trade.result === "WIN", trade.pnl || 0);
        this.rememberTrade({
          id: trade.id,
          symbol: trade.symbol,
          action: trade.side,
          wasWin: trade.result === "WIN",
          pnl: trade.pnl,
          conditions: {
            confidence: trade.confidence,
            strategy: trade.strategy,
            agent: trade.agent
          }
        });
      }
    });
    
    logger.info("MemoryService initialized", { service: "Memory" });
  }

  // 🆕 APLICA MELHORIAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 MemoryService recebeu melhoria: ${improvement.recommendation}`, { service: "Memory" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.maxPatterns = Math.min(200, this.config.maxPatterns + 50);
        this.config.maxTradeMemory = Math.min(1000, this.config.maxTradeMemory + 200);
        logger.info(`⚡ MemoryService aumentou capacidade: patterns=${this.config.maxPatterns}, trades=${this.config.maxTradeMemory}`, { service: "Memory" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.autoPrune = true;
        this.config.pruneAgeDays = 14;
        logger.info(`📉 MemoryService reduziu retenção: pruneAgeDays=${this.config.pruneAgeDays}`, { service: "Memory" });
        break;
    }
  }

  // 🆕 COMPARTILHA INSIGHT COM LEARNING BRAIN
  _shareInsight(type, content, confidence, data = {}) {
    eventBus.emit(`learning:${this.agentId}`, {
      type: type,
      content: content,
      confidence: confidence,
      priority: confidence > 0.8 ? "high" : "normal",
      data: data
    });
  }

  // Injeta dependência do DatabaseService
  setDatabase(db) {
    this.db = db;
    logger.info("Database injected into MemoryService", { service: "Memory" });
  }

  async start() {
    await this.loadFromDatabase();
    this._initialized = true;
    this.isRunning = true;
    
    // 🆕 AGENDA LIMPEZA AUTOMÁTICA
    if (this.config.autoPrune) {
      setInterval(() => this.pruneOldMemory(), 24 * 60 * 60 * 1000);
    }
    
    logger.info("MemoryService started", { 
      service: "Memory",
      patterns: this.patterns.length,
      strategies: this.strategies.length,
      trades: this.tradeMemory.length,
      improvements: this.improvements.length
    });
  }

  async loadFromDatabase() {
    if (!this.db) {
      logger.warn("Database not available yet, memory will be empty", { service: "Memory" });
      return;
    }
    
    try {
      const saved = this.db.getMemory ? this.db.getMemory() : null;
      if (saved) {
        this.patterns = saved.patterns || [];
        this.strategies = saved.strategies || [];
        this.tradeMemory = saved.tradeMemory || [];
        this.improvements = saved.improvements || [];
        this.correlations = saved.correlations || [];
      }
    } catch (error) {
      logger.error(`Failed to load memory: ${error.message}`, { service: "Memory" });
    }
  }

  // 🆕 LIMPA MEMÓRIA ANTIGA
  pruneOldMemory() {
    const now = Date.now();
    const maxAge = this.config.pruneAgeDays * 24 * 60 * 60 * 1000;
    
    const oldPatternsCount = this.patterns.filter(p => now - new Date(p.createdAt).getTime() > maxAge).length;
    const oldTradesCount = this.tradeMemory.filter(t => now - new Date(t.timestamp).getTime() > maxAge).length;
    
    this.patterns = this.patterns.filter(p => now - new Date(p.createdAt).getTime() <= maxAge);
    this.tradeMemory = this.tradeMemory.filter(t => now - new Date(t.timestamp).getTime() <= maxAge);
    this.improvements = this.improvements.slice(0, this.config.maxImprovements);
    
    if (oldPatternsCount > 0 || oldTradesCount > 0) {
      logger.info(`Pruned memory: ${oldPatternsCount} patterns, ${oldTradesCount} trades`, { service: "Memory" });
      this._persist();
    }
  }

  recordImprovement(improvement) {
    if (!improvement) return;
    
    const newImprovement = {
      id: `imp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      from: improvement.from || "unknown",
      type: improvement.type,
      message: improvement.message,
      recommendation: improvement.recommendation,
      confidence: improvement.confidence,
      receivedAt: new Date().toISOString(),
      applied: false
    };
    
    this.improvements.unshift(newImprovement);
    if (this.improvements.length > this.config.maxImprovements) this.improvements.pop();
    
    this._persist();
    logger.debug(`Improvement recorded: ${improvement.recommendation?.substring(0, 50)}`, { service: "Memory" });
    
    // 🆕 COMPARTILHA COM LEARNING BRAIN
    this._shareInsight("improvement_recorded",
      `Nova melhoria registrada de ${improvement.from}: ${improvement.recommendation}`,
      improvement.confidence || 0.7,
      newImprovement
    );
  }

  markImprovementApplied(id) {
    const improvement = this.improvements.find(i => i.id === id);
    if (improvement) {
      improvement.applied = true;
      improvement.appliedAt = new Date().toISOString();
      this._persist();
    }
  }

  getPendingImprovements(limit = 10) {
    return this.improvements.filter(i => !i.applied).slice(0, limit);
  }

  savePattern(pattern) {
    const newPattern = {
      id: `pat_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...pattern,
      createdAt: new Date().toISOString()
    };
    
    this.patterns.unshift(newPattern);
    if (this.patterns.length > this.config.maxPatterns) this.patterns.pop();
    
    this._persist();
    logger.info(`Pattern saved: ${pattern.name}`, { service: "Memory" });
    
    // 🆕 COMPARTILHA COM LEARNING BRAIN
    this._shareInsight("pattern_saved",
      `Novo padrão salvo: ${pattern.name} com ${pattern.winRate}% WR`,
      (pattern.winRate || 70) / 100,
      { name: pattern.name, winRate: pattern.winRate, key: pattern.key }
    );
  }

  findSimilarPattern(conditions) {
    if (!conditions) return null;
    
    const similar = this.patterns.find(p => 
      p.key === conditions.key || 
      (p.symbol === conditions.symbol && p.regime === conditions.regime)
    );
    
    if (similar && similar.winRate > 60) {
      logger.debug(`Found similar pattern: ${similar.name} (${similar.winRate}% WR)`, { service: "Memory" });
      return similar;
    }
    return null;
  }

  recordStrategyPerformance(strategyName, wasWin, pnl) {
    let strategy = this.strategies.find(s => s.name === strategyName);
    
    if (!strategy) {
      strategy = {
        name: strategyName,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        winRate: 0
      };
      this.strategies.push(strategy);
    }
    
    strategy.totalTrades++;
    if (wasWin) strategy.wins++;
    else strategy.losses++;
    strategy.totalPnl += pnl;
    strategy.winRate = Math.round((strategy.wins / strategy.totalTrades) * 100);
    
    this._persist();
  }

  getBestStrategy() {
    if (this.strategies.length === 0) return null;
    
    const validStrategies = this.strategies.filter(s => s.totalTrades >= 5);
    if (validStrategies.length === 0) return this.strategies[0];
    
    return validStrategies.sort((a, b) => b.winRate - a.winRate)[0];
  }

  rememberTrade(trade) {
    const memory = {
      id: trade.id,
      symbol: trade.symbol,
      action: trade.action,
      wasWin: trade.wasWin,
      pnl: trade.pnl,
      conditions: trade.conditions,
      timestamp: new Date().toISOString()
    };
    
    this.tradeMemory.unshift(memory);
    if (this.tradeMemory.length > this.config.maxTradeMemory) this.tradeMemory.pop();
    this._persist();
  }

  getSimilarTrades(conditions) {
    if (!conditions) return [];
    
    return this.tradeMemory.filter(t => 
      t.symbol === conditions.symbol && 
      t.action === conditions.action
    ).slice(0, 10);
  }

  // 🆕 ANALISA CORRELAÇÕES ENTRE CONDIÇÕES E RESULTADOS
  analyzeCorrelations() {
    const correlations = [];
    
    // Agrupa trades por símbolo e ação
    const bySymbol = {};
    for (const trade of this.tradeMemory) {
      const key = `${trade.symbol}_${trade.action}`;
      if (!bySymbol[key]) bySymbol[key] = { wins: 0, losses: 0, total: 0 };
      bySymbol[key].total++;
      if (trade.wasWin) bySymbol[key].wins++;
      else bySymbol[key].losses++;
    }
    
    for (const [key, data] of Object.entries(bySymbol)) {
      const winRate = (data.wins / data.total) * 100;
      if (data.total >= 10) {
        correlations.push({
          key,
          wins: data.wins,
          losses: data.losses,
          total: data.total,
          winRate: Math.round(winRate),
          confidence: Math.min(0.95, data.total / 100)
        });
      }
    }
    
    this.correlations = correlations.sort((a, b) => b.winRate - a.winRate).slice(0, 20);
    this._persist();
    
    return this.correlations;
  }

  _persist() {
    if (!this.db || !this.db.saveMemory) {
      logger.debug("Cannot persist memory: database not available", { service: "Memory" });
      return;
    }
    
    try {
      this.db.saveMemory({
        patterns: this.patterns,
        strategies: this.strategies,
        tradeMemory: this.tradeMemory,
        improvements: this.improvements,
        correlations: this.correlations
      });
    } catch (error) {
      logger.error(`Failed to persist memory: ${error.message}`, { service: "Memory" });
    }
  }

  getStats() {
    const bestStrategy = this.getBestStrategy();
    const pendingImprovements = this.improvements.filter(i => !i.applied).length;
    
    return {
      patternsCount: this.patterns.length,
      strategiesCount: this.strategies.length,
      tradesMemoryCount: this.tradeMemory.length,
      improvementsCount: this.improvements.length,
      pendingImprovements: pendingImprovements,
      correlationsCount: this.correlations.length,
      bestStrategy: bestStrategy ? {
        name: bestStrategy.name,
        winRate: bestStrategy.winRate,
        totalTrades: bestStrategy.totalTrades
      } : null,
      topPatterns: this.patterns.slice(0, 5).map(p => ({
        name: p.name,
        winRate: p.winRate
      }))
    };
  }
  
  // 🆕 OBTÉM STATUS
  getStatus() {
    return {
      running: this.isRunning,
      initialized: this._initialized,
      config: this.config,
      stats: this.getStats()
    };
  }
  
  // 🆕 LIMPA TODA MEMÓRIA
  clear() {
    this.patterns = [];
    this.strategies = [];
    this.tradeMemory = [];
    this.improvements = [];
    this.correlations = [];
    this._persist();
    logger.info("MemoryService cleared", { service: "Memory" });
    return { success: true };
  }

  stop() {
    this.isRunning = false;
    this._persist();
    logger.info("MemoryService stopped", { service: "Memory" });
  }
}

module.exports = new MemoryService();
