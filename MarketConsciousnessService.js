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

// Rolling 7-day simulated volume baseline (index 0 = today)
const _volumeHistory = {};
MEMECOINS.forEach(sym => {
  _volumeHistory[sym] = Array.from({ length: 7 }, () => Math.random() * 800_000_000 + 200_000_000);
});

class MarketConsciousnessService {
  constructor() {
    this._mode = "OPERATING";
    this._manuallyPaused = false;
    this._weeklyReport = null;
    this._memecoins = {};
    this._hypeAlerts = [];
    this._lastCheck = null;
    this._studyStarted = null;
    this._pauseReason = null;

    eventBus.on("tick", () => this._maybeAutoEvaluate());
    this._initMemecoins();
  }

  async start() {
    logger.info("MarketConsciousnessService started", { service: "MarketConsciousness" });
    return { success: true };
  }

  // ─── Volume helpers ─────────────────────────────────────────────────────────

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

  // ─── Sentiment helpers ──────────────────────────────────────────────────────

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

  // ─── Viral trend analysis ───────────────────────────────────────────────────

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

  // ─── Hype score calculation ─────────────────────────────────────────────────

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

  // ─── Init & periodic update ─────────────────────────────────────────────────

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
      }
    });
    return alerts;
  }

  // ─── Weekly report (integrado com AIZtronLearningService) ────────────────────

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
      
      return {
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

  _maybeAutoEvaluate() {
    const now = Date.now();
    if (this._lastCheck && now - this._lastCheck < 60_000) return;
    this._lastCheck = now;
    if (!this._manuallyPaused) this._autoEvaluate();
    this._updateMemecoins();
  }

  // 🔧 CORREÇÃO: Modo PAPER nunca entra em STUDY
  _autoEvaluate() {
    try {
      const db = require("./DatabaseService");
      const config = db.getConfig();
      
      // 🆕 SOLUÇÃO: Se for PAPER MODE, NUNCA entrar em MODO ESTUDO
      if (config.mode === "PAPER") {
        if (this._mode === "STUDY") {
          this._mode = "OPERATING";
          this._pauseReason = null;
          logger.info(`🔥 PAPER MODE: Forçando saída do MODO ESTUDO para operar e aprender.`);
        }
        return;
      }
      
      // Código original SÓ para modo LIVE
      this._weeklyReport = this._buildWeeklyReport();
      const { weeklyWinRate, maxDrawdown } = this._weeklyReport;

      if ((weeklyWinRate < 45 || maxDrawdown > 8) && this._mode === "OPERATING") {
        this._mode = "STUDY";
        this._studyStarted = new Date().toISOString();
        this._pauseReason = weeklyWinRate < 45 ? `Win rate baixo: ${weeklyWinRate}%` : `Drawdown excessivo: ${maxDrawdown}%`;
        logger.warn(`[Consciousness] MODO ESTUDO — ${this._pauseReason}`, { service: "MarketConsciousness" });
        eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "WARNING", message: `MODO ESTUDO ativado: ${this._pauseReason}`, timestamp: new Date().toISOString(), read: false });
      } else if (weeklyWinRate >= 55 && maxDrawdown < 8 && this._mode === "STUDY") {
        this._mode = "OPERATING";
        this._studyStarted = null;
        this._pauseReason = null;
        logger.info(`[Consciousness] Retomando OPERAÇÕES — WR: ${weeklyWinRate}%`, { service: "MarketConsciousness" });
        eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "INFO", message: `OPERAÇÕES retomadas: WR=${weeklyWinRate}%`, timestamp: new Date().toISOString(), read: false });
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
    };
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

  shouldPauseTrading() {
    const perf = this.getWeeklyPerformance();
    return perf.weeklyWinRate < 45 || perf.maxDrawdown > 8;
  }

  pauseTrading(reason = "Manual") {
    this._mode = "PAUSED";
    this._manuallyPaused = true;
    this._pauseReason = reason;
    logger.warn(`[Consciousness] PAUSADO — ${reason}`, { service: "MarketConsciousness" });
    eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "WARNING", message: `Operações pausadas: ${reason}`, timestamp: new Date().toISOString(), read: false });
    return { success: true, mode: this._mode, reason };
  }

  resumeTrading() {
    this._mode = "OPERATING";
    this._manuallyPaused = false;
    this._pauseReason = null;
    logger.info(`[Consciousness] RETOMADO`, { service: "MarketConsciousness" });
    eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "INFO", message: "Operações retomadas manualmente", timestamp: new Date().toISOString(), read: false });
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

  getHypeAlerts() { return this._hypeAlerts; }
}

module.exports = new MarketConsciousnessService();
