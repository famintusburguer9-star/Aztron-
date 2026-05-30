const eventBus = require("./EventBus");
const logger = require("./LoggerService");

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

  // ─── Volume helpers ─────────────────────────────────────────────────────────

  _get7DayAvgVolume(sym) {
    const hist = _volumeHistory[sym];
    if (!hist || hist.length < 2) return 500_000_000;
    return hist.slice(1).reduce((a, b) => a + b, 0) / (hist.length - 1);
  }

  _simulateCurrentVolume(sym) {
    const avg = this._get7DayAvgVolume(sym);
    // Random ±50% normally, but occasionally 200-400% spike
    const spike = Math.random() < 0.12; // 12% chance of spike
    const mult = spike ? 2.0 + Math.random() * 2 : 0.5 + Math.random();
    return avg * mult;
  }

  // ─── Sentiment helpers ──────────────────────────────────────────────────────

  _getSentimentForCoin(sym) {
    try {
      const sentiment = require("./SentimentService");
      const base = sentiment.getSentiment();
      const fgi = base.fearGreedIndex ?? 50;
      // Memecoins amplify market sentiment
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
    // Simulate mention growth (realistic: most not trending, occasional viral)
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
    // Volume contribution (max 40 pts)
    if (volChange > 200) score += 40;
    else if (volChange > 100) score += 25;
    else if (volChange > 50) score += 12;
    // Viral contribution (max 20 pts)
    if (viralGrowth > 200) score += 20;
    else if (viralGrowth > 80) score += 12;
    else if (viralGrowth > 30) score += 5;
    // Sentiment (max 15 pts)
    if (sentiment === "positive") score += 15;
    else if (sentiment === "negative") score -= 10;
    // Price action (max 15 pts)
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

      // Fire alert if hype crossed 70 threshold
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

  // ─── Weekly report ───────────────────────────────────────────────────────────

  _buildWeeklyReport(db) {
    const trades = typeof db.getTrades === "function" ? db.getTrades({ limit: 500 }) : [];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const thisWeek = trades.filter(t => new Date(t.timestamp).getTime() > weekAgo && t.status === "CLOSED");
    const lastWeek = trades.filter(t => {
      const ts = new Date(t.timestamp).getTime();
      return ts > twoWeeksAgo && ts <= weekAgo && t.status === "CLOSED";
    });

    const calcStats = (list) => {
      if (!list.length) return { winRate: 0, maxDrawdown: 0, byStrategy: {}, totalPnl: 0, count: 0 };
      const wins = list.filter(t => (t.pnl ?? 0) > 0).length;
      const winRate = (wins / list.length) * 100;
      const pnls = list.map(t => t.pnl ?? 0);
      const totalPnl = pnls.reduce((a, b) => a + b, 0);
      let peak = 0, dd = 0, balance = 0;
      pnls.forEach(p => {
        balance += p;
        if (balance > peak) peak = balance;
        const cur = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
        if (cur > dd) dd = cur;
      });
      const byStrategy = {};
      list.forEach(t => {
        const s = t.strategy || "Unknown";
        if (!byStrategy[s]) byStrategy[s] = { wins: 0, total: 0 };
        byStrategy[s].total++;
        if ((t.pnl ?? 0) > 0) byStrategy[s].wins++;
      });
      return { winRate: +winRate.toFixed(1), maxDrawdown: +dd.toFixed(2), byStrategy, totalPnl: +totalPnl.toFixed(2), count: list.length };
    };

    const cur  = calcStats(thisWeek);
    const prev = calcStats(lastWeek);
    const gradeFor = (wr) => wr >= 70 ? "A" : wr >= 60 ? "B" : wr >= 50 ? "C" : wr >= 40 ? "D" : "F";
    const bestStrategy = Object.entries(cur.byStrategy)
      .sort((a, b) => (b[1].wins / Math.max(b[1].total, 1)) - (a[1].wins / Math.max(a[1].total, 1)))[0]?.[0] || "N/A";
    const vsLastWeek = cur.winRate - prev.winRate;
    const grade = gradeFor(cur.winRate);
    const weAreGood = cur.winRate >= 55 && cur.maxDrawdown < 8;

    return {
      weeklyWinRate: cur.winRate, maxDrawdown: cur.maxDrawdown, totalPnl: cur.totalPnl,
      totalTrades: cur.count, byStrategy: cur.byStrategy, bestStrategy, grade,
      vsLastWeek: +vsLastWeek.toFixed(1), improved: vsLastWeek > 0, weAreGood,
      aiVerdict: weAreGood ? "SIM ✅" : "NÃO ⚠️",
      generatedAt: new Date().toISOString(),
    };
  }

  _maybeAutoEvaluate() {
    const now = Date.now();
    if (this._lastCheck && now - this._lastCheck < 60_000) return;
    this._lastCheck = now;
    if (!this._manuallyPaused) this._autoEvaluate();
    this._updateMemecoins();
  }

  _autoEvaluate() {
    try {
      const db = require("./DatabaseService");
      this._weeklyReport = this._buildWeeklyReport(db);
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
      mode: this._mode, manuallyPaused: this._manuallyPaused,
      pauseReason: this._pauseReason, studyStarted: this._studyStarted,
      lastCheck: this._lastCheck ? new Date(this._lastCheck).toISOString() : null,
      isOperating: this._mode === "OPERATING", isStudying: this._mode === "STUDY", isPaused: this._mode === "PAUSED",
    };
  }

  getWeeklyPerformance() {
    if (!this._weeklyReport) {
      try { const db = require("./DatabaseService"); this._weeklyReport = this._buildWeeklyReport(db); } catch {}
    }
    return this._weeklyReport || {
      weeklyWinRate: 0, maxDrawdown: 0, totalPnl: 0, totalTrades: 0,
      byStrategy: {}, bestStrategy: "N/A", grade: "N/A",
      vsLastWeek: 0, improved: false, weAreGood: false, aiVerdict: "N/A",
      generatedAt: new Date().toISOString(),
    };
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
    this._mode = "PAUSED"; this._manuallyPaused = true; this._pauseReason = reason;
    logger.warn(`[Consciousness] PAUSADO — ${reason}`, { service: "MarketConsciousness" });
    eventBus.emit("alert", { id: `cs_${Date.now()}`, type: "WARNING", message: `Operações pausadas: ${reason}`, timestamp: new Date().toISOString(), read: false });
    return { success: true, mode: this._mode, reason };
  }

  resumeTrading() {
    this._mode = "OPERATING"; this._manuallyPaused = false; this._pauseReason = null;
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

  /** Returns memecoins currently in hype state (score > 70) sorted by score */
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
