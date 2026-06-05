const logger = require("./LoggerService");

class MemoryService {
  constructor() {
    this.patterns = [];      // Padrões aprendidos que deram certo
    this.strategies = [];    // Performance por estratégia
    this.tradeMemory = [];   // Memória de trades passados
    this.improvements = [];  // 🆕 Histórico de melhorias recebidas
    this.db = null;          // Será injetado depois
    this._initialized = false;
    logger.info("MemoryService initialized", { service: "Memory" });
  }

  // Injeta dependência do DatabaseService
  setDatabase(db) {
    this.db = db;
    logger.info("Database injected into MemoryService", { service: "Memory" });
  }

  async start() {
    await this.loadFromDatabase();
    this._initialized = true;
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
      // Tenta carregar do banco (se existir o método)
      const saved = this.db.getMemory ? this.db.getMemory() : null;
      if (saved) {
        this.patterns = saved.patterns || [];
        this.strategies = saved.strategies || [];
        this.tradeMemory = saved.tradeMemory || [];
        this.improvements = saved.improvements || [];
      }
    } catch (error) {
      logger.error(`Failed to load memory: ${error.message}`, { service: "Memory" });
    }
  }

  // 🆕 MÉTODO ADICIONADO: Registra melhoria recebida do LearningBrain
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
    if (this.improvements.length > 200) this.improvements.pop();
    
    this._persist();
    logger.debug(`Improvement recorded: ${improvement.recommendation?.substring(0, 50) || improvement.message?.substring(0, 50)}`, { service: "Memory" });
  }

  // 🆕 MARCA melhoria como aplicada
  markImprovementApplied(id) {
    const improvement = this.improvements.find(i => i.id === id);
    if (improvement) {
      improvement.applied = true;
      improvement.appliedAt = new Date().toISOString();
      this._persist();
    }
  }

  // 🆕 OBTÉM melhorias pendentes
  getPendingImprovements(limit = 10) {
    return this.improvements.filter(i => !i.applied).slice(0, limit);
  }

  // Salva um padrão que deu certo
  savePattern(pattern) {
    const newPattern = {
      id: `pat_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...pattern,
      createdAt: new Date().toISOString()
    };
    
    this.patterns.unshift(newPattern);
    // Mantém só os 100 padrões mais recentes
    if (this.patterns.length > 100) this.patterns.pop();
    
    this._persist();
    logger.info(`Pattern saved: ${pattern.name}`, { service: "Memory" });
  }

  // Busca padrão similar ao que deu certo antes
  findSimilarPattern(conditions) {
    if (!conditions) return null;
    
    // Procura padrão com chave similar
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

  // Registra performance de uma estratégia
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

  // Retorna a melhor estratégia baseada em win rate
  getBestStrategy() {
    if (this.strategies.length === 0) return null;
    
    const validStrategies = this.strategies.filter(s => s.totalTrades >= 5);
    if (validStrategies.length === 0) return this.strategies[0];
    
    return validStrategies.sort((a, b) => b.winRate - a.winRate)[0];
  }

  // Salva memória de um trade para aprendizado futuro
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
    if (this.tradeMemory.length > 200) this.tradeMemory.pop();
    this._persist();
  }

  // Consulta trades passados similares
  getSimilarTrades(conditions) {
    if (!conditions) return [];
    
    return this.tradeMemory.filter(t => 
      t.symbol === conditions.symbol && 
      t.action === conditions.action
    ).slice(0, 10);
  }

  // Persiste no banco
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
        improvements: this.improvements
      });
    } catch (error) {
      logger.error(`Failed to persist memory: ${error.message}`, { service: "Memory" });
    }
  }

  // Retorna estatísticas da memória
  getStats() {
    const bestStrategy = this.getBestStrategy();
    const pendingImprovements = this.improvements.filter(i => !i.applied).length;
    
    return {
      patternsCount: this.patterns.length,
      strategiesCount: this.strategies.length,
      tradesMemoryCount: this.tradeMemory.length,
      improvementsCount: this.improvements.length,
      pendingImprovements: pendingImprovements,
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

  stop() {
    this._persist();
    logger.info("MemoryService stopped", { service: "Memory" });
  }
}

module.exports = new MemoryService();
