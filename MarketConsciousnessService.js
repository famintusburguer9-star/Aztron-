const eventBus = require("./EventBus");
const logger = require("./LoggerService");
const aiLearning = require("./AIZtronLearningService");

// ─── Memecoin watchlist ───────────────────────────────────────────────────────
const MEMECOINS = ["DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "BONKUSDT", "WIFUSDT"];

const MEMECOIN_META = {
  DOGEUSDT: { name: "DOGE", icon: "🐶", hashtags: ["#DOGE", "#Dogecoin", "#DogeArmy"], community: "Twitter/Reddit" },
  SHIBUSDT: { name: "SHIB", icon: "🐕", hashtags: ["#SHIB", "#ShibArmy", "#Shiba"], community: "Twitter/Reddit" },
  PEPEUSDT: { name: "PEPE", icon: "🐸", hashtags: ["#PEPE", "#PepeCoin", "#PepeArmy"], community: "Twitter/4chan" },
  BONKUSDT: { name: "BONK", icon: "🔨", hashtags: ["#BONK", "#BonkArmy", "#BONKSOL"], community: "Twitter/Solana" },
  WIFUSDT:  { name: "WIF",  icon: "🧢", hashtags: ["#WIF", "#dogwifhat", "#WIFcoin"], community: "Twitter/Solana" },
};

// Rolling 7-day simulated volume baseline
const _volumeHistory = {};
MEMECOINS.forEach(sym => {
  _volumeHistory[sym] = Array.from({ length: 7 }, () => Math.random() * 800_000_000 + 200_000_000);
});

class MarketConsciousnessService {
  constructor() {
    this._mode = "OPERATING";
    this._manuallyPaused = false;
    this._weeklyReport = null;
    this._dailyReports = [];
    this._memecoins = {};
    this._hypeAlerts = [];
    this._lastCheck = null;
    this._studyStarted = null;
    this._pauseReason = null;
    this.isRunning = false;
    
    // 🔥 NOVO: AGENTES PAUSADOS INDIVIDUALMENTE
    this.pausedAgents = new Set(); // IDs dos robôs que estão sem capital
    
    this.agentId = "market_consciousness";
    
    this.config = {
      winRateThreshold: 45,
      drawdownThreshold: 8,
      autoStudyEnabled: true,
      hypeSensitivity: 1.0,
      reportSharingEnabled: true
    };

    eventBus.on("tick", () => this._maybeAutoEvaluate());
    
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    eventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    this._initMemecoins();
    this._scheduleDailyReport();
  }

  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 MarketConsciousness recebeu melhoria: ${improvement.recommendation}`, { service: "MarketConsciousness" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.winRateThreshold = Math.max(35, this.config.winRateThreshold - 5);
        this.config.hypeSensitivity = Math.min(1.5, this.config.hypeSensitivity * 1.1);
        logger.info(`⚡ MarketConsciousness aumentou sensibilidade: winRateThreshold=${this.config.winRateThreshold}%, hypeSensitivity=${this.config.hypeSensitivity}x`, { service: "MarketConsciousness" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.winRateThreshold = Math.min(55, this.config.winRateThreshold + 5);
        this.config.hypeSensitivity = Math.max(0.5, this.config.hypeSensitivity * 0.9);
        logger.info(`📉 MarketConsciousness reduziu risco: winRateThreshold=${this.config.winRateThreshold}%, hypeSensitivity=${this.config.hypeSensitivity}x`, { service: "MarketConsciousness" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        if (this._mode === "OPERATING" && !this._manuallyPaused) {
          this.pauseTrading("Alerta de mercado - recomendação de revisão do Learning Brain");
        }
        break;
    }
    
    setTimeout(() => {
      this.config.winRateThreshold = 45;
      this.config.hypeSensitivity = 1.0;
      logger.info(`🔄 MarketConsciousness resetou ajustes`, { service: "MarketConsciousness" });
    }, 3600000);
  }

  _shareInsight(type, content, confidence, data = {}) {
    if (!this.config.reportSharingEnabled) return;
    
    eventBus.emit(`learning:${this.agentId}`, {
      type: type,
      content: content,
      confidence: Math.min(0.95, confidence),
      priority: confidence > 0.8 ? "high" : "normal",
      data: data
    });
  }

  async start() {
    this.isRunning = true;
    logger.info("MarketConsciousnessService started", { service: "MarketConsciousness" });
    return { success: true };
  }

  stop() {
    this.isRunning = false;
    logger.info("MarketConsciousnessService stopped", { service: "MarketConsciousness" });
    return { success: true };
  }

  _scheduleDailyReport() {
    const now = new Date();
    const night = new Date(now);
    night.setHours(24, 0, 0, 0);
    const delay = night.getTime() - now.getTime();
    
    setTimeout(() => {
      this._generateDailyReport();
      setInterval(() => this._generateDailyReport(), 24 * 60 * 60 * 1000);
    }, delay);
  }

  _generateDailyReport() {
    try {
      const db = require("./DatabaseService");
      const exchange = require("./ExchangeAdapterService");
      
      const trades = db.getTrades({ limit: 500, status: "CLOSED" });
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayTrades = trades.filter(t => new Date(t.timestamp) >= today);
      
      const wins = todayTrades.filter(t => t.pnl > 0).length;
      const losses = todayTrades.filter(t => t.pnl <= 0).length;
      const winRate = todayTrades.length > 0 ? (wins / todayTrades.length) * 100 : 0;
      const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      
      const bestTrade = todayTrades.length > 0 ? todayTrades.reduce((best, t) => (t.pnl > best.pnl ? t : best), todayTrades[0]) : null;
      const worstTrade = todayTrades.length > 0 ? todayTrades.reduce((worst, t) => (t.pnl < worst.pnl ? t : worst), todayTrades[0]) : null;
      
      const balance = exchange.getBalance();
      let totalEquity = balance.USDT || 0;
      
      const dailyReport = {
        date: new Date().toISOString(),
        dateStr: today.toISOString().split('T')[0],
        totalTrades: todayTrades.length,
        wins,
        losses,
        winRate: Math.round(winRate * 10) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        bestTrade: bestTrade ? {
          symbol: bestTrade.symbol,
          pnl: Math.round(bestTrade.pnl * 100) / 100,
          pnlPct: bestTrade.pnlPct
        } : null,
        worstTrade: worstTrade ? {
          symbol: worstTrade.symbol,
          pnl: Math.round(worstTrade.pnl * 100) / 100,
          pnlPct: worstTrade.pnlPct
        } : null,
        finalBalance: Math.round(totalEquity * 100) / 100,
        generatedAt: new Date().toISOString()
      };
      
      this._dailyReports.unshift(dailyReport);
      if (this._dailyReports.length > 30) this._dailyReports.pop();
      
      const storage = require("./storage");
      storage.set("dailyReports", this._dailyReports);
      
      logger.info(`[Consciousness] Relatório Diário gerado: ${dailyReport.totalTrades} trades, PnL: $${dailyReport.totalPnl}, WR: ${dailyReport.winRate}%`, { service: "MarketConsciousness" });
      
      eventBus.emit("daily_report", dailyReport);
      
      this._shareInsight("daily_report", 
        `Relatório diário: ${dailyReport.totalTrades} trades, WR ${dailyReport.winRate}%, PnL $${dailyReport.totalPnl}`,
        dailyReport.winRate / 100,
        dailyReport
      );
      
      return dailyReport;
    } catch (error) {
      logger.error(`[Consciousness] Error generating daily report: ${error.message}`, { service: "MarketConsciousness" });
      return null;
    }
  }

  _get7DayAvgVolume(sym) {
    const hist = _volumeHistory[sym];
    if (!hist || hist.length < 2) return 500_000_000;
    return hist.slice(1).reduce((a, b) => a + b, 0) / (hist.length - 1);
  }

  _simulateCurrentVolume(sym) {
    const avg = this._get7DayAvgVolume(sym);
    const spike = Math.random() < 0.12;
    const mult = spike ? 2.0 + Math.random() * 2 : 0.5 + Math.random();
    return avg * mult;
  }

  _getSentimentForCoin(sym) {
    try {
      const sentiment = require("./SentimentService");
      const base = sentiment.getSentiment();
      const fgi = base.fearGreedIndex ?? 50;
      if (fgi > 70) return "positive";
      if (fgi < 35) return "negative";
      return Math.random() > 0.4 ? "positive" : "neutral";
    } catch {
      return "neutral";
    }
  }

  _analyzeViralTrend(sym) {
    const meta = MEMECOIN_META[sym];
    if (!meta) return { trending: false, growthRate: 0, topHashtag: "" };
    const growthRate = Math.random() < 0.15 ? Math.random() * 300 + 100 : Math.random() * 60 - 10;
    const trending = growthRate > 80;
    const topHashtag = meta.hashtags[Math.floor(Math.random() * meta.hashtags.length)];
    return {
      trending,
      growthRate: +growthRate.toFixed(1),
      topHashtag,
      mentions24h: Math.floor(Math.random() * 50000) + (trending ? 80000 : 5000),
      platform: meta.community,
    };
  }

  _calcHypeScore(volChange, viralGrowth, sentiment, priceChange) {
    let score = 30;
    if (volChange > 200) score += 40;
    else if (volChange > 100) score += 25;
    else if (volChange > 50) score += 12;
    
    if (viralGrowth > 200) score += 20;
    else if (viralGrowth > 80) score += 12;
    else if (viralGrowth > 30) score += 5;
    
    if (sentiment === "positive") score += 15;
    else if (sentiment === "negative") score -= 10;
    
    if (priceChange > 15) score += 15;
    else if (priceChange > 5) score += 8;
    else if (priceChange < -10) score -= 8;
    
    return Math.min(100, Math.max(0, +score.toFixed(1)));
  }

  _initMemecoins() {
    MEMECOINS.forEach(sym => {
      this._memecoins[sym] = this._buildCoinAnalysis(sym);
    });
  }

  _buildCoinAnalysis(sym) {
    const meta = MEMECOIN_META[sym] || { name: sym, icon: "🪙", hashtags: [], community: "" };
    const avgVol = this._get7DayAvgVolume(sym);
    const curVol = this._simulateCurrentVolume(sym);
    const volChangePercent = +((curVol / avgVol - 1) * 100).toFixed(1);
    const sentiment = this._getSentimentForCoin(sym);
    const viral = this._analyzeViralTrend(sym);
    const priceChange = +(Math.random() * 30 - 8).toFixed(2);
    const hypeScore = this._calcHypeScore(volChangePercent, viral.growthRate, sentiment, priceChange);

    let recommendation = "IGNORAR";
    if (hypeScore >= 80 && sentiment === "positive") recommendation = "COMPRAR";
    else if (hypeScore >= 60) recommendation = "MONITORAR";
    else if (hypeScore >= 45) recommendation = "OBSERVAR";

    return {
      symbol: sym,
      name: meta.name,
      icon: meta.icon,
      sentiment,
      hypeScore,
      volumeChange: volChangePercent,
      currentVolume: +curVol.toFixed(0),
      avgVolume7d: +avgVol.toFixed(0),
      priceChange24h: priceChange,
      viralScore: +viral.growthRate.toFixed(1),
      trending: viral.trending,
      topHashtag: viral.topHashtag,
      mentions24h: viral.mentions24h,
      community: viral.platform,
      hashtags: meta.hashtags,
      recommendation,
      hypeAlert: hypeScore > 70,
      lastUpdated: new Date().toISOString(),
    };
  }

  _updateMemecoins() {
    const alerts = [];
    MEMECOINS.forEach(sym => {
      const prev = this._memecoins[sym];
      const fresh = this._buildCoinAnalysis(sym);
      this._memecoins[sym] = fresh;

      if (fresh.hypeScore > 70 && (!prev || prev.hypeScore <= 70)) {
        const alert = {
          id: `hype_${sym}_${Date.now()}`,
          type: "HYPE",
          symbol: sym,
          name: fresh.name,
          icon: fresh.icon,
          hypeScore: fresh.hypeScore,
          volumeChange: fresh.volumeChange,
          message: `🚀 ${fresh.name} HYPE DETECTADO! Score ${fresh.hypeScore} — Vol +${fresh.volumeChange}% vs média 7d`,
          timestamp: new Date().toISOString(),
        };
        alerts.push(alert);
        this._hypeAlerts.unshift(alert);
        if (this._hypeAlerts.length > 20) this._hypeAlerts = this._hypeAlerts.slice(0, 20);
        eventBus.emit("alert", { id: alert.id, type: "WARNING", message: alert.message, timestamp: alert.timestamp, read: false });
        logger.warn(`[Consciousness] Hype alert: ${fresh.name} score=${fresh.hypeScore}`, { service: "MarketConsciousness" });
        
        this._shareInsight("hype_alert",
          `🚀 ${fresh.name} HYPE DETECTADO! Score ${fresh.hypeScore}`,
          fresh.hypeScore / 100,
          { symbol: sym, hypeScore: fresh.hypeScore, volumeChange: fresh.volumeChange }
        );
      }
    });
    return alerts;
  }

  _buildWeeklyReport() {
    try {
      const db = require("./DatabaseService");
      
      const aiStats = aiLearning.getLearningStats();
      const winRate = aiStats?.overallWinRate || 0;
      const totalTrades = aiStats?.totalTrades || 0;
      const patternsCount = aiStats?.patternsLearned || 0;
      const aiConfidence = aiStats?.currentConfidence || 0;
      
      const trades = db.getTrades({ limit: 200, status: "CLOSED" });
      let maxDrawdown = 0;
      let peak = 0;
      let balance = 0;
      let totalPnl = 0;
      
      trades.forEach(t => {
        const pnl = t.pnl || 0;
        totalPnl += pnl;
        balance += pnl;
        if (balance > peak) peak = balance;
        const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
      });
      
      const grade = winRate >= 70 ? "A" : winRate >= 60 ? "B" : winRate >= 50 ? "C" : winRate >= 40 ? "D" : "F";
      const weAreGood = winRate >= 55 && maxDrawdown < 8;
      
      logger.info(`[Consciousness] Report: WR=${winRate}%, DD=${maxDrawdown.toFixed(2)}%, Grade=${grade}, Good=${weAreGood}`, { service: "MarketConsciousness" });
      
      const report = {
        weeklyWinRate: winRate,
        maxDrawdown: +maxDrawdown.toFixed(2),
        totalPnl: +totalPnl.toFixed(2),
        totalTrades: totalTrades,
        patternsLearned: patternsCount,
        aiConfidence: aiConfidence,
        bestStrategy: "AI Learning",
        grade: grade,
        vsLastWeek: 0,
        improved: false,
        weAreGood: weAreGood,
        aiVerdict: weAreGood ? "SIM ✅" : "NÃO ⚠️",
        generatedAt: new Date().toISOString(),
      };
      
      this._shareInsight("weekly_report",
        `Relatório semanal: WR ${winRate}%, DD ${maxDrawdown.toFixed(2)}%, Grade ${grade}, Good=${weAreGood}`,
        winRate / 100,
        { winRate, maxDrawdown, grade, weAreGood }
      );
      
      return report;
    } catch (error) {
      logger.error(`[Consciousness] Error building report: ${error.message}`, { service: "MarketConsciousness" });
      return {
        weeklyWinRate: 0,
        maxDrawdown: 0,
        totalPnl: 0,
        totalTrades: 0,
        patternsLearned: 0,
        aiConfidence: 0,
        bestStrategy: "N/A",
        grade: "N/A",
        vsLastWeek: 0,
        improved: false,
        weAreGood: false,
        aiVerdict: "N/A",
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // 🔥🔥🔥 NOVO: MONITORA CAPITAL DOS ROBÔS (PAUSA APENAS O ROBÔ ESPECÍFICO) 🔥🔥🔥
  _checkCapitalStatus() {
    try {
      const capitalDistributor = require("./CapitalDistributorService");
      const status = capitalDistributor.getStatus();
      const agents = status.agents || [];
      
      const agentsToPause = [];
      const agentsToResume = [];
      
      // Mapeamento de nomes para IDs
      const nameToId = {
        "Trend Aztron": "trend",
        "HFT Service": "hft",
        "Arbitrage Service": "arbitrage",
        "Sentiment Service": "sentiment",
        "Deep Pattern": "deep"
      };
      
      for (const agent of agents) {
        const agentId = nameToId[agent.name];
        if (!agentId) continue;
        
        // Se o robô está sem capital, PAUSA ele
        if (agent.balance <= 0 && !this.pausedAgents.has(agentId)) {
          this.pausedAgents.add(agentId);
          agentsToPause.push(agent.name);
          
          // 🔥 EMITE EVENTO PARA PAUSAR O ROBÔ ESPECÍFICO
          eventBus.emit(`agent:pause`, {
            agentId: agentId,
            reason: `Sem capital (saldo: $${agent.balance})`,
            duration: null // pausa até ter capital
          });
          
          logger.warn(`[Consciousness] ⏸️ ROBÔ PAUSADO: ${agent.name} - Sem capital!`, { service: "MarketConsciousness" });
        }
        // Se o robô tem capital suficiente e estava pausado, RETOMA ele
        else if (agent.balance > 100 && this.pausedAgents.has(agentId)) {
          this.pausedAgents.delete(agentId);
          agentsToResume.push(agent.name);
          
          // 🔥 EMITE EVENTO PARA RETOMAR O ROBÔ ESPECÍFICO
          eventBus.emit(`agent:resume`, {
            agentId: agentId,
            reason: `Capital restaurado (saldo: $${agent.balance})`
          });
          
          logger.info(`[Consciousness] ▶️ ROBÔ RETOMADO: ${agent.name} - Capital disponível!`, { service: "MarketConsciousness" });
        }
      }
      
      // Emite alertas se houver mudanças
      if (agentsToPause.length > 0) {
        eventBus.emit("alert", {
          id: `cs_pause_${Date.now()}`,
          type: "WARNING",
          message: `Robôs pausados por falta de capital: ${agentsToPause.join(", ")}`,
          timestamp: new Date().toISOString(),
          read: false
        });
        
        this._shareInsight("agents_paused",
          `Robôs pausados por falta de capital: ${agentsToPause.join(", ")}`,
          0.95,
          { pausedAgents: agentsToPause }
        );
      }
      
      if (agentsToResume.length > 0) {
        eventBus.emit("alert", {
          id: `cs_resume_${Date.now()}`,
          type: "INFO",
          message: `Robôs retomados: ${agentsToResume.join(", ")}`,
          timestamp: new Date().toISOString(),
          read: false
        });
        
        this._shareInsight("agents_resumed",
          `Robôs retomados: ${agentsToResume.join(", ")}`,
          0.9,
          { resumedAgents: agentsToResume }
        );
      }
      
      return { pausedAgents: Array.from(this.pausedAgents), agentsToPause, agentsToResume };
    } catch (error) {
      logger.error(`[Consciousness] Erro ao verificar capital: ${error.message}`, { service: "MarketConsciousness" });
      return { pausedAgents: [], agentsToPause: [], agentsToResume: [] };
    }
  }

  _maybeAutoEvaluate() {
    const now = Date.now();
    if (this._lastCheck && now - this._lastCheck < 60_000) return;
    this._lastCheck = now;
    if (!this._manuallyPaused && this.config.autoStudyEnabled) this._autoEvaluate();
    this._updateMemecoins();
  }

  _autoEvaluate() {
    try {
      const db = require("./DatabaseService");
      const config = db.getConfig();
      
      // 🔥 VERIFICA CAPITAL DOS ROBÔS (PAUSA APENAS OS QUE ESTÃO SEM DINHEIRO)
      this._checkCapitalStatus();
      
      if (config.mode === "PAPER") {
        if (this._mode === "STUDY" && !this._pauseReason?.includes("sem capital")) {
          this._mode = "OPERATING";
          this._pauseReason = null;
          logger.info(`🔥 PAPER MODE: Forçando saída do MODO ESTUDO para operar e aprender.`);
        }
        return;
      }
      
      this._weeklyReport = this._buildWeeklyReport();
      const { weeklyWinRate, maxDrawdown } = this._weeklyReport;

      if ((weeklyWinRate < this.config.winRateThreshold || maxDrawdown > this.config.drawdownThreshold) && this._mode === "OPERATING") {
        this._mode = "STUDY";
        this._studyStarted = new Date().toISOString();
        this._pauseReason = weeklyWinRate < this.config.winRateThreshold ? `Win rate baixo: ${weeklyWinRate}%` : `Drawdown excessivo: ${maxDrawdown}%`;
        logger.warn(`[Consciousness] MODO ESTUDO — ${this._pauseReason}`, { service: "MarketConsciousness" });
        eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "WARNING", message: `MODO ESTUDO ativado: ${this._pauseReason}`, timestamp: new Date().toISOString(), read: false });
        
        this._shareInsight("mode_change",
          `Mudança para MODO ESTUDO: ${this._pauseReason}`,
          0.9,
          { from: "OPERATING", to: "STUDY", reason: this._pauseReason, winRate: weeklyWinRate, drawdown: maxDrawdown }
        );
      } else if (weeklyWinRate >= 55 && maxDrawdown < 8 && this._mode === "STUDY" && !this._pauseReason?.includes("sem capital")) {
        this._mode = "OPERATING";
        this._studyStarted = null;
        this._pauseReason = null;
        logger.info(`[Consciousness] Retomando OPERAÇÕES — WR: ${weeklyWinRate}%`, { service: "MarketConsciousness" });
        eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "INFO", message: `OPERAÇÕES retomadas: WR=${weeklyWinRate}%`, timestamp: new Date().toISOString(), read: false });
        
        this._shareInsight("mode_change",
          `Retorno ao MODO OPERAÇÕES: WR ${weeklyWinRate}%`,
          0.9,
          { from: "STUDY", to: "OPERATING", winRate: weeklyWinRate, drawdown: maxDrawdown }
        );
      }
    } catch (e) {
      logger.error(`[Consciousness] autoEvaluate error: ${e.message}`, { service: "MarketConsciousness" });
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  getConsciousnessStatus() {
    return {
      mode: this._mode,
      manuallyPaused: this._manuallyPaused,
      pauseReason: this._pauseReason,
      studyStarted: this._studyStarted,
      lastCheck: this._lastCheck ? new Date(this._lastCheck).toISOString() : null,
      isOperating: this._mode === "OPERATING",
      isStudying: this._mode === "STUDY",
      isPaused: this._mode === "PAUSED",
      pausedAgents: Array.from(this.pausedAgents)  // 🔥 NOVO: lista de robôs pausados
    };
  }

  // 🔥 NOVO: Verifica se um robô específico está pausado
  isAgentPaused(agentId) {
    return this.pausedAgents.has(agentId);
  }

  getWeeklyPerformance() {
    if (!this._weeklyReport) {
      this._weeklyReport = this._buildWeeklyReport();
    }
    return this._weeklyReport;
  }

  getReport() {
    this._updateMemecoins();
    return { status: this.getConsciousnessStatus(), performance: this.getWeeklyPerformance(), memecoins: Object.values(this._memecoins) };
  }

  getDailyReport() {
    if (this._dailyReports.length === 0) {
      return this._generateDailyReport();
    }
    return this._dailyReports[0];
  }

  getDailyHistory(limit = 7) {
    return this._dailyReports.slice(0, limit);
  }

  shouldPauseTrading() {
    const perf = this.getWeeklyPerformance();
    return perf.weeklyWinRate < this.config.winRateThreshold || perf.maxDrawdown > this.config.drawdownThreshold;
  }

  pauseTrading(reason = "Manual") {
    this._mode = "PAUSED";
    this._manuallyPaused = true;
    this._pauseReason = reason;
    logger.warn(`[Consciousness] PAUSADO — ${reason}`, { service: "MarketConsciousness" });
    eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "WARNING", message: `Operações pausadas: ${reason}`, timestamp: new Date().toISOString(), read: false });
    
    this._shareInsight("mode_change",
      `Operações PAUSADAS: ${reason}`,
      0.95,
      { from: this._mode, to: "PAUSED", reason: reason }
    );
    
    return { success: true, mode: this._mode, reason };
  }

  resumeTrading() {
    this._mode = "OPERATING";
    this._manuallyPaused = false;
    this._pauseReason = null;
    logger.info(`[Consciousness] RETOMADO`, { service: "MarketConsciousness" });
    eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "INFO", message: "Operações retomadas manualmente", timestamp: new Date().toISOString(), read: false });
    
    this._shareInsight("mode_change",
      `Operações RETOMADAS manualmente`,
      0.9,
      { from: "PAUSED", to: "OPERATING" }
    );
    
    return { success: true, mode: this._mode };
  }

  analyzeMemecoin(symbol) {
    const key = symbol.toUpperCase().includes("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
    if (!this._memecoins[key]) {
      const meta = { name: symbol.toUpperCase(), icon: "🪙", hashtags: [`#${symbol.toUpperCase()}`], community: "Twitter" };
      MEMECOIN_META[key] = meta;
      _volumeHistory[key] = Array.from({ length: 7 }, () => Math.random() * 500_000_000 + 100_000_000);
      this._memecoins[key] = this._buildCoinAnalysis(key);
    }
    return this._memecoins[key];
  }

  getMemecoinsAll() {
    this._updateMemecoins();
    return Object.values(this._memecoins).sort((a, b) => b.hypeScore - a.hypeScore);
  }

  getMemecoinsHype() {
    this._updateMemecoins();
    return Object.values(this._memecoins)
      .filter(c => c.hypeScore > 70)
      .sort((a, b) => b.hypeScore - a.hypeScore)
      .map(c => ({ ...c, alertType: "HYPE_IMMINENT", detectedAt: new Date().toISOString() }));
  }

  getHypeAlerts() { 
    return this._hypeAlerts; 
  }
  
  getStatus() {
    return {
      running: this.isRunning,
      mode: this._mode,
      manuallyPaused: this._manuallyPaused,
      config: this.config,
      dailyReportsCount: this._dailyReports.length,
      memecoinsTracked: Object.keys(this._memecoins).length,
      hypeAlertsCount: this._hypeAlerts.length,
      agentId: this.agentId,
      pausedAgents: Array.from(this.pausedAgents)  // 🔥 NOVO
    };
  }
  
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info("MarketConsciousnessService config updated", { service: "MarketConsciousness", config: this.config });
    return { success: true, config: this.config };
  }
}

module.exports = new MarketConsciousnessService();
