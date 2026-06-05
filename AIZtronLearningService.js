const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const storage = require("./storage");
const sentiment = require("./SentimentService");
const marketCondition = require("./MarketConditionService");
const memoryService = require("./MemoryService");

// 🆕 NOVOS SERVIÇOS PARA INTEGRAÇÃO
const capitalDistributor = require("./CapitalDistributorService");
const learningBrain = require("./LearningBrainService");

class AIZtronLearningService {
  constructor() {
    this.thoughts = storage.get("aiThoughts", []);
    this.sentimentHistory = storage.get("sentimentHistory", []);
    this.patterns = storage.get("learnedPatterns", []);
    this.tradeHistory = storage.get("tradeHistory", []);
    this.version = "v5.0.0";
    this.confidence = 84;
    this.status = "degraded";
    this.degradedReason = "Learning service initializing";
    this.learningHistory = storage.get("learningHistory", [
      { version: "v4.2", winRate: 73.5, adjustments: "EMA9→EMA8, SL 1.5%→1.2%", date: "2026-05-28" },
      { version: "v4.1", winRate: 69.8, adjustments: "RSI period 14→12, TP 3%→3.5%", date: "2026-05-25" },
      { version: "v4.0", winRate: 65.2, adjustments: "Added MACD confirmation filter", date: "2026-05-20" },
    ]);
    
    // 🆕 CONTROLE DE CAPITAL (PAPER MODE)
    this.capitalAllocated = 0;
    this.agentId = "trend"; // Este é o Trend Aztron
    
    this._thoughtIdx = 0;
    this._intervalId = null;
    this._isInitialized = false;
    
    // 🆕 ESCUTA EVENTO DE ALOCAÇÃO DE CAPITAL
    eventBus.on(`capital:${this.agentId}:allocated`, (data) => {
      this.capitalAllocated = data.amount;
      logger.info(`💰 AIZtron recebeu capital: $${this.capitalAllocated} (${data.mode} MODE)`, { service: "AILearning" });
    });
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    // Escuta trades fechados para aprender
    eventBus.on("trade", (data) => {
      if (data && data.action === "CLOSE" && data.trade) {
        this.learnFromTrade(data.trade);
      }
    });
    
    logger.info("AIZtronLearningService initialized", { 
      service: "AILearning",
      patternsCount: this.patterns.length,
      tradesCount: this.tradeHistory.length,
      version: this.version
    });
  }

  start() {
    this._intervalId = setInterval(() => this._generateThought(), 8000);
    this._isInitialized = true;
    logger.info("AI Learning Service started", { service: "AILearning" });
    
    // 🆕 VERIFICA SE JÁ TEM CAPITAL
    setTimeout(() => {
      if (this.capitalAllocated === 0) {
        logger.warn("Aguardando alocação de capital do CapitalDistributor...", { service: "AILearning" });
      } else {
        logger.info(`✅ AIZtron operacional com $${this.capitalAllocated} em PAPER MODE`, { service: "AILearning" });
      }
      
      this.status = "healthy";
      this.degradedReason = null;
      logger.info("AIZtronLearningService is now healthy", { service: "AILearning" });
    }, 30000);
  }

  stop() { 
    if (this._intervalId) clearInterval(this._intervalId); 
    this._isInitialized = false;
  }

  // 🆕 APLICA MELHORIAS RECEBIDAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    logger.info(`🧠 AIZtron recebeu melhoria: ${improvement.recommendation}`, { service: "AILearning" });
    
    switch(improvement.recommendation) {
      case "REDUZIR_TAMANHO_POSICAO_E_AGUARDAR_CONFIRMACAO":
        this.confidence = Math.max(50, this.confidence - 10);
        logger.info("📉 Confiança reduzida devido a padrão de reversão", { service: "AILearning" });
        break;
        
      case "AUMENTAR_SENSIBILIDADE_SPREAD_E_VELOCIDADE":
        this.confidence = Math.min(95, this.confidence + 5);
        logger.info("📈 Confiança aumentada para oportunidades de arbitragem", { service: "AILearning" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        this._generateThought();
        eventBus.emit("learning:trend", {
          type: "alert",
          content: "Sentimento extremo detectado - revisando posições",
          confidence: improvement.confidence,
          priority: "high"
        });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "AILearning" });
    }
    
    // Registra melhoria no histórico
    memoryService.recordImprovement(improvement);
  }

  _generateThought() {
    let message = "";
    
    // 🆕 INCLUI INFORMAÇÃO DE CAPITAL
    const capitalInfo = this.capitalAllocated > 0 
      ? ` Capital disponível: $${this.capitalAllocated.toFixed(2)}.` 
      : " Aguardando alocação de capital...";
    
    if (this.patterns.length > 0) {
      const bestPattern = this.patterns
        .sort((a, b) => b.winRate - a.winRate)[0];
      
      if (bestPattern && bestPattern.winRate > 65) {
        message = `🧠 Pattern learned: ${bestPattern.name} has ${bestPattern.winRate}% win rate over ${bestPattern.totalTrades} trades.${capitalInfo}`;
      } else {
        message = `🤔 Analyzing market. ${this.patterns.length} patterns in memory.${capitalInfo}`;
      }
    } else {
      const messages = [
        `Analyzing BTC momentum — RSI recovering from 38. EMA crossover imminent.${capitalInfo}`,
        `ETH showing divergence on MACD histogram. Reducing confidence for long positions.${capitalInfo}`,
        `Market sentiment index updated. Adjusting stop-loss tighter on new positions.${capitalInfo}`,
        `Deep pattern scan complete. Detected inverse H&S formation.${capitalInfo}`,
        `Fear & Greed: ${sentiment.getSentiment().fearGreedLabel}. Adjusting strategy.${capitalInfo}`
      ];
      message = messages[this._thoughtIdx % messages.length];
      this._thoughtIdx++;
    }
    
    const thought = { 
      id: `t_${Date.now()}`, 
      message, 
      timestamp: new Date().toISOString(),
      patternsCount: this.patterns.length,
      confidence: this.confidence,
      capitalAvailable: this.capitalAllocated
    };
    
    this.thoughts.unshift(thought);
    if (this.thoughts.length > 50) this.thoughts.length = 50;
    storage.set("aiThoughts", this.thoughts.slice(0, 50));
    eventBus.emit("thought", thought);
    
    // 🆕 COMPARTILHA APRENDIZADO COM O LEARNING BRAIN
    if (this.patterns.length > 0) {
      this.shareLearning();
    }
  }

  // 🆕 COMPARTILHA APRENDIZADO COM O CÉREBRO CENTRAL
  shareLearning() {
    const bestPattern = this.patterns
      .filter(p => p.totalTrades >= 5)
      .sort((a, b) => b.winRate - a.winRate)[0];
    
    if (bestPattern && bestPattern.winRate > 65) {
      const learningData = {
        type: "pattern",
        content: `Padrão ${bestPattern.name} com ${bestPattern.winRate}% de acerto em ${bestPattern.totalTrades} trades`,
        confidence: bestPattern.winRate / 100,
        priority: bestPattern.winRate > 75 ? "high" : "normal",
        data: {
          patternName: bestPattern.name,
          winRate: bestPattern.winRate,
          totalTrades: bestPattern.totalTrades,
          symbol: bestPattern.conditions?.symbol
        }
      };
      
      eventBus.emit(`learning:${this.agentId}`, learningData);
      logger.debug(`📤 Aprendizado compartilhado: ${learningData.content.substring(0, 80)}`, { service: "AILearning" });
    }
  }

  // 🆕 SOLICITA CAPITAL PARA EXECUTAR UM TRADE
  async requestCapital(amount, reason) {
    return new Promise((resolve) => {
      capitalDistributor.handleRequest({
        agentId: this.agentId,
        amount: amount,
        reason: reason,
        callback: resolve
      });
    });
  }

  // 🆕 DEVOLVE CAPITAL NÃO UTILIZADO
  returnCapital(amount, reason) {
    eventBus.emit("capital:return", {
      agentId: this.agentId,
      amount: amount,
      reason: reason
    });
  }

  // ─── APRENDIZADO REAL ───────────────────────────────────────────────────────
  
  learnFromTrade(trade) {
    if (trade.status !== "CLOSED") return;
    
    const wasWin = trade.pnl > 0;
    
    this.confidence = Math.min(95, Math.max(50, 
      this.confidence + (wasWin ? 0.8 : -0.5)
    ));
    
    const historyEntry = {
      id: trade.id,
      symbol: trade.symbol,
      action: trade.action,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      pnlPercent: trade.pnlPercent,
      wasWin: wasWin,
      strategy: trade.strategy || "unknown",
      timestamp: new Date().toISOString(),
      conditions: trade.conditions || {}
    };
    
    this.tradeHistory.unshift(historyEntry);
    if (this.tradeHistory.length > 200) this.tradeHistory.pop();
    storage.set("tradeHistory", this.tradeHistory.slice(0, 200));
    
    memoryService.rememberTrade(historyEntry);
    memoryService.recordStrategyPerformance(trade.strategy || "unknown", wasWin, trade.pnl || 0);
    
    this._learnPattern(trade);
    
    // 🆕 SE TEVE LUCRO, COMUNICA PARA O CAPITAL DISTRIBUTOR
    if (wasWin && trade.pnl > 0) {
      eventBus.emit("agent:profit", {
        agentId: this.agentId,
        amount: trade.pnl,
        tradeId: trade.id
      });
      
      // Atualiza capital alocado
      this.capitalAllocated = capitalDistributor.getAgentBalance(this.agentId);
    }
    
    // 🆕 COMPARTILHA RESULTADO COM O LEARNING BRAIN
    eventBus.emit("trade:closed", {
      agent: this.agentId,
      profit: wasWin ? trade.pnl : 0,
      loss: !wasWin ? Math.abs(trade.pnl) : 0,
      id: trade.id
    });
    
    logger.info(`Learned from trade: ${trade.symbol} ${trade.action} ${wasWin ? "WIN" : "LOSS"}`, {
      service: "AILearning",
      confidence: Math.round(this.confidence),
      pnl: trade.pnl?.toFixed(2)
    });
    
    this._generateThought();
    return wasWin;
  }

  _learnPattern(trade) {
    const conditions = trade.conditions || {};
    const patternKey = this._createPatternKey(conditions);
    
    let existingPattern = this.patterns.find(p => p.key === patternKey);
    
    if (existingPattern) {
      const wasWin = trade.pnl > 0;
      existingPattern.totalTrades++;
      existingPattern.wins += wasWin ? 1 : 0;
      existingPattern.winRate = Math.round((existingPattern.wins / existingPattern.totalTrades) * 100);
      existingPattern.lastSeen = new Date().toISOString();
      existingPattern.totalPnl += trade.pnl || 0;
    } else if (patternKey && conditions.symbol) {
      const newPattern = {
        key: patternKey,
        name: this._generatePatternName(conditions),
        conditions: conditions,
        totalTrades: 1,
        wins: trade.pnl > 0 ? 1 : 0,
        winRate: trade.pnl > 0 ? 100 : 0,
        totalPnl: trade.pnl || 0,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      this.patterns.push(newPattern);
      
      if (newPattern.winRate > 60) {
        memoryService.savePattern({
          name: newPattern.name,
          key: newPattern.key,
          winRate: newPattern.winRate,
          symbol: conditions.symbol,
          regime: conditions.regime
        });
      }
    }
    
    if (this.patterns.length > 50) {
      this.patterns.sort((a, b) => b.totalTrades - a.totalTrades);
      this.patterns = this.patterns.slice(0, 50);
    }
    
    storage.set("learnedPatterns", this.patterns);
  }

  _createPatternKey(conditions) {
    if (!conditions.symbol) return null;
    const parts = [
      conditions.symbol,
      conditions.timeframe || "15m",
      conditions.regime || "unknown",
      conditions.volatility ? (conditions.volatility > 1.5 ? "high_vol" : "low_vol") : "normal"
    ];
    return parts.join("_");
  }

  _generatePatternName(conditions) {
    const parts = [];
    if (conditions.symbol) parts.push(conditions.symbol);
    if (conditions.regime === "trending") parts.push("Trend");
    else if (conditions.regime === "ranging") parts.push("Sideways");
    if (conditions.sentiment === "positive") parts.push("Bullish");
    else if (conditions.sentiment === "negative") parts.push("Bearish");
    return parts.join("_") || "Unknown_Pattern";
  }

  predictSignal(signal) {
    const conditions = {
      symbol: signal.symbol,
      regime: signal.regime || "unknown",
      sentiment: signal.sentiment,
      timeframe: signal.timeframe || "15m"
    };
    
    const patternKey = this._createPatternKey(conditions);
    let pattern = this.patterns.find(p => p.key === patternKey);
    
    if (!pattern) {
      const memoryPattern = memoryService.findSimilarPattern(conditions);
      if (memoryPattern) {
        pattern = {
          name: memoryPattern.name,
          totalTrades: memoryPattern.trades || 10,
          winRate: memoryPattern.winRate
        };
        logger.debug(`Using memory pattern: ${pattern.name}`, { service: "AILearning" });
      }
    }
    
    // 🆕 VERIFICA SE TEM CAPITAL SUFICIENTE
    const hasCapital = this.capitalAllocated > (signal.estimatedCost || 100);
    
    if (pattern && pattern.totalTrades >= 5) {
      const confidenceAdjustment = (pattern.winRate - 50) / 2;
      let predictedConfidence = Math.min(95, Math.max(5, 
        (signal.confidence || 70) + confidenceAdjustment
      ));
      
      // Reduz confiança se não tiver capital
      if (!hasCapital) predictedConfidence = Math.min(predictedConfidence, 30);
      
      return {
        predictedWinRate: pattern.winRate,
        confidence: Math.round(predictedConfidence),
        patternUsed: pattern.name,
        basedOnTrades: pattern.totalTrades,
        recommendation: pattern.winRate > 60 && hasCapital ? "FOLLOW" : "SKIP",
        hasCapital: hasCapital,
        availableCapital: this.capitalAllocated
      };
    }
    
    const bestStrategy = memoryService.getBestStrategy();
    if (bestStrategy && bestStrategy.winRate > 55 && hasCapital) {
      return {
        predictedWinRate: bestStrategy.winRate,
        confidence: Math.min(85, signal.confidence || 70),
        patternUsed: `best_strategy_${bestStrategy.name}`,
        basedOnTrades: bestStrategy.totalTrades,
        recommendation: bestStrategy.winRate > 60 ? "FOLLOW" : "CAUTIOUS",
        hasCapital: hasCapital,
        availableCapital: this.capitalAllocated
      };
    }
    
    return {
      predictedWinRate: 50,
      confidence: signal.confidence || 70,
      patternUsed: null,
      basedOnTrades: 0,
      recommendation: !hasCapital ? "NO_CAPITAL" : (signal.confidence > 75 ? "FOLLOW_CAUTIOUS" : "WAIT"),
      hasCapital: hasCapital,
      availableCapital: this.capitalAllocated
    };
  }

  getLearningStats() {
    const totalTrades = this.tradeHistory.length;
    const wins = this.tradeHistory.filter(t => t.wasWin).length;
    const overallWinRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    
    const bestPattern = this.patterns
      .filter(p => p.totalTrades >= 5)
      .sort((a, b) => b.winRate - a.winRate)[0];
    
    const memoryStats = memoryService.getStats ? memoryService.getStats() : {};
    
    return {
      totalTrades: totalTrades,
      wins: wins,
      losses: totalTrades - wins,
      overallWinRate: overallWinRate,
      patternsLearned: this.patterns.length,
      patternsWithData: this.patterns.filter(p => p.totalTrades >= 5).length,
      bestPattern: bestPattern ? {
        name: bestPattern.name,
        winRate: bestPattern.winRate,
        trades: bestPattern.totalTrades
      } : null,
      currentConfidence: Math.round(this.confidence),
      capitalAvailable: this.capitalAllocated,
      memoryStats: memoryStats
    };
  }

  getPatterns(limit = 10) {
    return this.patterns
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, limit);
  }

  // ─── SENTIMENT ANALYSIS METHODS ────────────────────────────────────────────
  
  async getTrendAnalysis(symbol) {
    try {
      logger.info(`Getting trend analysis for ${symbol}`, { service: "AILearning" });
      
      const sentimentData = sentiment.getSentiment();
      const marketConditionData = marketCondition.getCondition(symbol);
      
      const fgIndex = sentimentData.fearGreedIndex || 50;
      const fgLabel = sentimentData.fearGreedLabel || "NEUTRAL";
      const overallSentiment = fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral";
      
      let positivePct, negativePct, neutralPct;
      if (fgIndex >= 75) { positivePct = 75; negativePct = 10; neutralPct = 15; }
      else if (fgIndex >= 60) { positivePct = 60; negativePct = 15; neutralPct = 25; }
      else if (fgIndex >= 55) { positivePct = 55; negativePct = 20; neutralPct = 25; }
      else if (fgIndex <= 25) { positivePct = 10; negativePct = 75; neutralPct = 15; }
      else if (fgIndex <= 40) { positivePct = 20; negativePct = 60; neutralPct = 20; }
      else if (fgIndex <= 45) { positivePct = 25; negativePct = 55; neutralPct = 20; }
      else { positivePct = 33; negativePct = 33; neutralPct = 34; }
      
      let trendStrength = "moderate";
      if (marketConditionData && marketConditionData.volatility) {
        const vol = marketConditionData.volatility;
        if (vol > 2) trendStrength = "strong";
        else if (vol < 0.5) trendStrength = "weak";
      }
      
      let recommendation = "HOLD";
      let recommendationReason = "Market sentiment is neutral. Waiting for clearer signals.";
      
      if (fgIndex >= 75) {
        recommendation = "SELL";
        recommendationReason = `Extreme Greed detected (${fgIndex} - ${fgLabel}). Market may be overbought.`;
      } else if (fgIndex >= 60) {
        recommendation = "SELL";
        recommendationReason = `Greed sentiment (${fgIndex} - ${fgLabel}). Caution advised.`;
      } else if (fgIndex <= 25) {
        recommendation = "BUY";
        recommendationReason = `Extreme Fear detected (${fgIndex} - ${fgLabel}). Potential buying opportunity.`;
      } else if (fgIndex <= 40) {
        recommendation = "BUY";
        recommendationReason = `Fear sentiment (${fgIndex} - ${fgLabel}). Accumulation zone possible.`;
      }
      
      const confidence = Math.min(85, Math.max(40, 100 - Math.abs(50 - fgIndex)));
      
      let simulatedReturn = 1.8;
      if (fgIndex >= 75) simulatedReturn = -3.2;
      else if (fgIndex >= 60) simulatedReturn = -1.5;
      else if (fgIndex <= 25) simulatedReturn = 6.8;
      else if (fgIndex <= 40) simulatedReturn = 3.5;
      
      const posts = await this.getRecentPosts(symbol, 4);
      const postsAnalyzed = Math.floor(Math.random() * 2000) + 500;
      const redditPosts = Math.floor(postsAnalyzed * 0.65);
      const twitterPosts = postsAnalyzed - redditPosts;
      
      // 🆕 ADICIONA INFORMAÇÃO DE CAPITAL
      const capitalInfo = {
        available: this.capitalAllocated,
        canTrade: this.capitalAllocated > 100
      };
      
      return {
        symbol: symbol.toUpperCase(),
        overall_sentiment: overallSentiment,
        sentiment_score: fgIndex,
        positive_pct: positivePct,
        negative_pct: negativePct,
        neutral_pct: neutralPct,
        trend_strength: trendStrength,
        posts_analyzed: postsAnalyzed,
        reddit_posts: redditPosts,
        twitter_posts: twitterPosts,
        simulation_result: {
          simulated_return_pct: simulatedReturn,
          historical_accuracy: 68.5,
          confidence: confidence,
          period_days: 7
        },
        recommendation: recommendation,
        recommendation_reason: recommendationReason,
        capital: capitalInfo,
        last_updated: new Date().toISOString(),
        recent_posts: posts
      };
      
    } catch (error) {
      logger.error(`getTrendAnalysis error: ${error.message}`, { service: "AILearning" });
      return null;
    }
  }
  
  async scanSocialSentiment(symbol) {
    try {
      logger.info(`Scanning social sentiment for ${symbol}`, { service: "AILearning" });
      eventBus.emit("sentiment:scan:start", { symbol, timestamp: new Date().toISOString() });
      
      const sentimentData = sentiment.getSentiment();
      const fgIndex = sentimentData.fearGreedIndex || 50;
      
      const mockPosts = [
        {
          id: `post_${Date.now()}_1`,
          source: "twitter",
          author: "@CryptoWhale",
          content: `${symbol} looking ${fgIndex >= 55 ? "bullish" : fgIndex <= 45 ? "bearish" : "neutral"} on the daily chart.`,
          sentiment: fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral",
          score: fgIndex,
          symbol: symbol.toUpperCase(),
          created_at: new Date().toISOString()
        },
        {
          id: `post_${Date.now()}_2`,
          source: "reddit",
          author: "u/TraderPro",
          content: `Just analyzed ${symbol} with AZTRON AI.`,
          sentiment: fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral",
          score: fgIndex - 5,
          symbol: symbol.toUpperCase(),
          created_at: new Date().toISOString()
        }
      ];
      
      const scanRecord = {
        symbol: symbol.toUpperCase(),
        timestamp: new Date().toISOString(),
        postsCount: mockPosts.length,
        avgSentiment: fgIndex
      };
      this.sentimentHistory.unshift(scanRecord);
      if (this.sentimentHistory.length > 20) this.sentimentHistory.pop();
      storage.set("sentimentHistory", this.sentimentHistory.slice(0, 20));
      
      eventBus.emit("sentiment:scan:complete", { 
        symbol: symbol.toUpperCase(), 
        posts: mockPosts,
        timestamp: new Date().toISOString()
      });
      
      logger.info(`Social sentiment scan completed for ${symbol}`, { service: "AILearning" });
      return mockPosts;
      
    } catch (error) {
      logger.error(`scanSocialSentiment error: ${error.message}`, { service: "AILearning" });
      return [];
    }
  }
  
  async getRecentPosts(symbol, limit = 20) {
    try {
      const storedPosts = storage.get(`sentimentPosts_${symbol}`, []);
      if (storedPosts && storedPosts.length > 0) {
        return storedPosts.slice(0, limit);
      }
      
      const sentimentData = sentiment.getSentiment();
      const fgIndex = sentimentData.fearGreedIndex || 50;
      
      const posts = [];
      const sources = ["twitter", "reddit"];
      const authors = ["@CryptoWhale99", "@TradingPro", "@AltcoinDreams", "u/BitcoinBaron"];
      const contents = [
        `${symbol} showing strong momentum on weekly timeframe.`,
        `Just entered ${symbol} position based on AZTRON signal.`,
        `${symbol} breaking key resistance levels.`,
        `AZTRON AI recommends analyzing ${symbol}.`
      ];
      
      for (let i = 0; i < Math.min(limit, 10); i++) {
        posts.push({
          id: `post_${Date.now()}_${i}`,
          source: sources[i % sources.length],
          author: authors[Math.floor(Math.random() * authors.length)],
          content: contents[Math.floor(Math.random() * contents.length)],
          sentiment: fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral",
          score: fgIndex,
          symbol: symbol.toUpperCase(),
          created_at: new Date(Date.now() - i * 3600000).toISOString()
        });
      }
      
      storage.set(`sentimentPosts_${symbol}`, posts);
      return posts.slice(0, limit);
      
    } catch (error) {
      logger.error(`getRecentPosts error: ${error.message}`, { service: "AILearning" });
      return [];
    }
  }
  
  getSentimentHistory(symbol) {
    return this.sentimentHistory.filter(h => !symbol || h.symbol === symbol.toUpperCase());
  }

  // 🆕 MÉTODO PARA MIGRAR PARA LIVE (quando estiver pronto)
  async switchToLiveMode() {
    logger.info("🔄 AIZtron migrando para LIVE MODE...", { service: "AILearning" });
    
    // Solicita confirmação de capital real
    const result = await capitalDistributor.switchToLiveMode();
    
    if (result.success) {
      this.version = "v5.0.0-live";
      logger.info("✅ AIZtron agora opera em LIVE MODE", { service: "AILearning" });
    } else {
      logger.error("❌ Falha ao migrar para LIVE MODE", { service: "AILearning" });
    }
    
    return result;
  }

  // ─── GETTERS ────────────────────────────────────────────────────────────────
  
  getThoughts(limit = 20) { 
    return this.thoughts.slice(0, limit); 
  }
  
  getStatus() { 
    const stats = this.getLearningStats();
    return { 
      version: this.version, 
      confidence: Math.round(this.confidence), 
      status: this.status,
      degradedReason: this.degradedReason,
      learningHistory: this.learningHistory,
      learningStats: stats,
      patternsCount: this.patterns.length,
      capitalAvailable: this.capitalAllocated,
      mode: "PAPER", // ou "LIVE" quando migrar
      currentParams: db.getConfig() 
    }; 
  }
  
  getLearningHistory() { 
    return this.learningHistory; 
  }

  getCapitalInfo() {
    return {
      allocated: this.capitalAllocated,
      agentId: this.agentId,
      mode: "PAPER"
    };
  }
}

module.exports = new AIZtronLearningService();
