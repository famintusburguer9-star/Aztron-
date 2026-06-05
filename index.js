require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const orchestrator = require("./Orchestrator");
const db = require("./DatabaseService");
const exchange = require("./ExchangeAdapterService");
const marketData = require("./MarketDataService");
const marketCondition = require("./MarketConditionService");
const signalService = require("./SignalService");
const tradeExecutor = require("./TradeExecutorService");
const portfolio = require("./PortfolioService");
const risk = require("./RiskManagementService");
const flashCrash = require("./FlashCrashShieldService");
const aiLearning = require("./AIZtronLearningService");
const aiOptimizer = require("./AIZtronOptimizerService");
const backtest = require("./BacktestService");
const backtestAI = require("./BacktestAIService");
const sandbox = require("./SandboxRunner");
const observability = require("./ObservabilityService");
const deployManager = require("./DeployManagerService");
const sentiment = require("./SentimentService");
const deepPattern = require("./DeepPatternRecognitionService");
const marketMux = require("./MarketMultiplexerService");
const slippage = require("./SlippageEstimatorService");
const spread = require("./SpreadAnalyzerService");
const account = require("./AccountManagerService");
const goals = require("./GoalTrackerService");
const multiStrategy = require("./MultiStrategyService");
const memoryService = require("./MemoryService");
const marketConsciousness = require("./MarketConsciousnessService");
const tokenomics = require("./TokenomicsService");

// 🆕 HFT SERVICES
const hft = require("./HFTService");
const capitalRouter = require("./CapitalRouterService");
const weeklySettlement = require("./WeeklySettlementService");

const PORT = process.env.PORT || 3001;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
  transports: ["websocket", "polling"],
});

app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── Request logger ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { service: "API" });
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "v5.0.0", timestamp: new Date().toISOString() });
});

// ─── Engine ───────────────────────────────────────────────────────────────────
app.get("/api/engine/status", (_req, res) => res.json(orchestrator.getStatus()));
app.post("/api/engine/start", async (_req, res) => res.json(await orchestrator.start()));
app.post("/api/engine/stop", async (_req, res) => res.json(await orchestrator.stop()));
app.get("/api/engine/config", (_req, res) => res.json(db.getConfig()));
app.put("/api/engine/config", (req, res) => res.json(db.updateConfig(req.body)));

// ─── Trades ───────────────────────────────────────────────────────────────────
app.get("/api/trades", (req, res) => {
  const { status, side, symbol, limit } = req.query;
  res.json(db.getTrades({ status, side, symbol, limit: parseInt(limit) || 50 }));
});
app.get("/api/trades/open", (_req, res) => res.json(tradeExecutor.getOpenTrades()));
app.get("/api/trades/stats", (_req, res) => res.json(db.stats()));

// ─── Signals ──────────────────────────────────────────────────────────────────
app.get("/api/signals", (req, res) => res.json(signalService.getSignals(parseInt(req.query.limit) || 20)));
app.get("/api/signals/latest", (_req, res) => res.json(signalService.getLatest()));
app.get("/api/signals/analyze/:symbol", (req, res) => res.json(multiStrategy.analyzeConsensus(req.params.symbol)));

// ─── Markets ──────────────────────────────────────────────────────────────────
app.get("/api/markets", (_req, res) => res.json(marketData.getAllIndicators()));
app.get("/api/markets/:symbol", (req, res) => {
  const data = marketData.getIndicators(req.params.symbol);
  if (!data) return res.status(404).json({ error: "Symbol not found" });
  res.json(data);
});
app.get("/api/markets/:symbol/condition", (req, res) => res.json(marketCondition.getCondition(req.params.symbol)));
app.get("/api/markets/conditions/all", (_req, res) => res.json(marketCondition.getAllConditions()));
app.get("/api/markets/:symbol/spread", (req, res) => res.json(spread.analyze(req.params.symbol)));
app.get("/api/markets/spread/all", (_req, res) => res.json(spread.analyzeAll()));

// ─── Portfolio ────────────────────────────────────────────────────────────────
app.get("/api/portfolio/summary", (_req, res) => res.json(portfolio.getSummary()));
app.get("/api/portfolio/positions", (_req, res) => res.json(portfolio.getPositions()));
app.get("/api/portfolio/pnl-history", (_req, res) => res.json(portfolio.getPnlHistory()));
app.get("/api/portfolio/balance", (_req, res) => res.json(exchange.getBalance()));
app.get("/api/portfolio/goals", (_req, res) => res.json(goals.getGoals()));

// ─── AI Brain ─────────────────────────────────────────────────────────────────
app.get("/api/ai/brain/status", (_req, res) => res.json(aiLearning.getStatus()));
app.get("/api/ai/thoughts", (req, res) => res.json(aiLearning.getThoughts(parseInt(req.query.limit) || 20)));
app.get("/api/ai/learning-history", (_req, res) => res.json(aiLearning.getLearningHistory()));
app.get("/api/ai/patterns", (req, res) => res.json(deepPattern.getPatterns(parseInt(req.query.limit) || 10)));
app.get("/api/ai/sentiment", (_req, res) => res.json(sentiment.getSentiment()));

// ─── Memory stats ─────────────────────────────────────────────────────────────
app.get("/api/memory/stats", (_req, res) => res.json(memoryService.getStats()));

// ─── SENTIMENT (rota básica) ──────────────────────────────────────────────────
app.get("/api/sentiment", (_req, res) => res.json(sentiment.getSentiment()));

// ─── SENTIMENT ADVANCED (Trend Analysis com IA) ───────────────────────────────
app.get("/api/sentiment/analysis", async (req, res) => {
  const { symbol = "BTC" } = req.query;
  
  try {
    const aiStatus = aiLearning.getStatus();
    
    if (aiStatus.status === "healthy" || aiStatus.status === "degraded") {
      const analysis = await aiLearning.getTrendAnalysis(symbol);
      if (analysis) {
        return res.json(analysis);
      }
    }
    
    const sentimentData = sentiment.getSentiment();
    const marketConditionData = marketCondition.getCondition(symbol);
    
    const fgIndex = sentimentData.fearGreedIndex || 50;
    const fgLabel = sentimentData.fearGreedLabel || "NEUTRAL";
    const overallSentiment = fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral";
    const sentimentScore = fgIndex;
    
    let positivePct = 33, negativePct = 33, neutralPct = 34;
    if (fgIndex >= 70) { positivePct = 70; negativePct = 10; neutralPct = 20; }
    else if (fgIndex >= 55) { positivePct = 55; negativePct = 20; neutralPct = 25; }
    else if (fgIndex <= 30) { positivePct = 10; negativePct = 70; neutralPct = 20; }
    else if (fgIndex <= 45) { positivePct = 20; negativePct = 55; neutralPct = 25; }
    
    let recommendation = "HOLD";
    let recommendationReason = "Market sentiment is neutral. Waiting for clearer signals.";
    
    if (fgIndex >= 75) {
      recommendation = "SELL";
      recommendationReason = `Extreme Greed detected (${fgIndex} - ${fgLabel}). Market may be overbought. Consider taking profits.`;
    } else if (fgIndex >= 60) {
      recommendation = "SELL";
      recommendationReason = `Greed sentiment (${fgIndex} - ${fgLabel}). Caution advised, reduce exposure.`;
    } else if (fgIndex <= 25) {
      recommendation = "BUY";
      recommendationReason = `Extreme Fear detected (${fgIndex} - ${fgLabel}). Potential buying opportunity.`;
    } else if (fgIndex <= 40) {
      recommendation = "BUY";
      recommendationReason = `Fear sentiment (${fgIndex} - ${fgLabel}). Accumulation zone possible.`;
    }
    
    let trendStrength = "moderate";
    if (marketConditionData && marketConditionData.volatility) {
      const vol = marketConditionData.volatility;
      if (vol > 2) trendStrength = "strong";
      else if (vol < 0.5) trendStrength = "weak";
    }
    
    const confidence = Math.min(85, Math.max(40, 100 - Math.abs(50 - fgIndex)));
    
    let simulatedReturn = 1.8;
    if (fgIndex >= 75) simulatedReturn = -3.2;
    else if (fgIndex >= 60) simulatedReturn = -1.5;
    else if (fgIndex <= 25) simulatedReturn = 6.8;
    else if (fgIndex <= 40) simulatedReturn = 3.5;
    
    const analysis = {
      symbol: symbol.toUpperCase(),
      overall_sentiment: overallSentiment,
      sentiment_score: sentimentScore,
      positive_pct: positivePct,
      negative_pct: negativePct,
      neutral_pct: neutralPct,
      trend_strength: trendStrength,
      posts_analyzed: 0,
      reddit_posts: 0,
      twitter_posts: 0,
      simulation_result: {
        simulated_return_pct: simulatedReturn,
        historical_accuracy: 68.5,
        confidence: confidence,
        period_days: 7
      },
      recommendation: recommendation,
      recommendation_reason: recommendationReason,
      last_updated: new Date().toISOString(),
      recent_posts: [
        {
          id: "sample1",
          source: "twitter",
          author: "@AZTRON_AI",
          content: `${symbol} sentiment analysis complete. Fear & Greed: ${fgIndex} (${fgLabel}). ${recommendation} signal generated.`,
          sentiment: overallSentiment,
          score: sentimentScore,
          symbol: symbol.toUpperCase(),
          created_at: new Date().toISOString()
        },
        {
          id: "sample2",
          source: "reddit",
          author: "u/AZTRON_Bot",
          content: `Market data for ${symbol} shows ${trendStrength} trend strength. ${recommendation} with ${confidence}% confidence.`,
          sentiment: overallSentiment,
          score: sentimentScore - 5,
          symbol: symbol.toUpperCase(),
          created_at: new Date().toISOString()
        }
      ]
    };
    
    res.json(analysis);
    
  } catch (error) {
    logger.error(`Sentiment analysis error: ${error.message}`, { service: "API" });
    res.status(500).json({ error: "Failed to analyze sentiment", message: error.message });
  }
});

// ─── SENTIMENT SCAN (dispara coleta de dados sociais) ─────────────────────────
app.post("/api/sentiment/scan", async (req, res) => {
  const { symbol } = req.body;
  
  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }
  
  try {
    logger.info(`Scanning sentiment for ${symbol}`, { service: "SentimentScan" });
    eventBus.emit("sentiment:scan", { symbol, timestamp: new Date().toISOString() });
    
    if (aiLearning && typeof aiLearning.scanSocialSentiment === 'function') {
      await aiLearning.scanSocialSentiment(symbol);
    }
    
    res.json({ 
      success: true, 
      message: `Sentiment scan started for ${symbol}`,
      symbol: symbol.toUpperCase()
    });
    
  } catch (error) {
    logger.error(`Sentiment scan error: ${error.message}`, { service: "SentimentScan" });
    res.status(500).json({ error: "Failed to start sentiment scan" });
  }
});

// ─── SENTIMENT POSTS (busca posts recentes) ───────────────────────────────────
app.get("/api/sentiment/posts", async (req, res) => {
  const { symbol, limit = 20 } = req.query;
  
  try {
    let posts = [];
    
    if (aiLearning && typeof aiLearning.getRecentPosts === 'function') {
      posts = await aiLearning.getRecentPosts(symbol, parseInt(limit));
    }
    
    if (!posts || posts.length === 0) {
      const sentimentData = sentiment.getSentiment();
      const fgIndex = sentimentData.fearGreedIndex || 50;
      const fgLabel = sentimentData.fearGreedLabel || "NEUTRAL";
      
      posts = [
        {
          id: "1",
          source: "twitter",
          author: "@AZTRON_AI",
          content: `${symbol?.toUpperCase() || "BTC"} sentiment score: ${fgIndex} (${fgLabel}). Market is showing ${fgIndex >= 55 ? "bullish" : fgIndex <= 45 ? "bearish" : "neutral"} signals.`,
          sentiment: fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral",
          score: fgIndex,
          symbol: symbol?.toUpperCase() || "BTC",
          created_at: new Date().toISOString()
        },
        {
          id: "2",
          source: "reddit",
          author: "u/AZTRON_Bot",
          content: `AZTRON AI has analyzed market conditions for ${symbol?.toUpperCase() || "BTC"}. Current recommendation based on sentiment data.`,
          sentiment: "neutral",
          score: 50,
          symbol: symbol?.toUpperCase() || "BTC",
          created_at: new Date().toISOString()
        }
      ];
    }
    
    res.json(posts);
    
  } catch (error) {
    logger.error(`Failed to fetch posts: ${error.message}`, { service: "API" });
    res.json([]);
  }
});

// ─── AI Optimizer ─────────────────────────────────────────────────────────────
app.post("/api/ai/optimize/start", (_req, res) => res.json(aiOptimizer.start()));
app.get("/api/ai/optimize/status", (_req, res) => res.json(aiOptimizer.getStatus()));
app.post("/api/ai/optimize/apply", (_req, res) => res.json(aiOptimizer.applyBestConfig()));
app.post("/api/ai/optimize/reset", (_req, res) => { aiOptimizer.reset(); res.json({ success: true }); });
app.get("/api/ai/optimize/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  res.json(aiOptimizer.getHistory(limit));
});
app.post("/api/ai/optimize/auto", (req, res) => {
  const { enabled } = req.body;
  res.json(aiOptimizer.enableAutoOptimize(enabled));
});

// ─── Backtest ─────────────────────────────────────────────────────────────────
app.post("/api/backtest/run", async (req, res) => {
  const { pair, strategy, initialBalance, days } = req.body;
  res.json(await backtest.run({ pair, strategy, initialBalance: parseFloat(initialBalance) || 10000, days: parseInt(days) || 30 }));
});
app.get("/api/backtest/results", (req, res) => res.json(backtest.getResults(parseInt(req.query.limit) || 10)));
app.get("/api/backtest/running", (_req, res) => res.json({ running: backtest.isRunning() }));
app.post("/api/backtest/ai", (req, res) => {
  const { pair, days } = req.body;
  res.json({ success: true, result: backtestAI.runWithAI(pair || "BTCUSDT", days || 30) });
});

// ─── Sandbox ──────────────────────────────────────────────────────────────────
app.post("/api/sandbox/run", async (req, res) => res.json(await sandbox.run(req.body)));
app.get("/api/sandbox/results", (req, res) => res.json(sandbox.getResults(parseInt(req.query.limit) || 10)));

// ─── Flash Crash Shield ───────────────────────────────────────────────────────
app.get("/api/flash-crash/status", (_req, res) => res.json(flashCrash.getStatus()));
app.put("/api/flash-crash/config", (req, res) => { flashCrash.updateConfig(req.body); res.json({ success: true, config: db.getConfig() }); });
app.get("/api/flash-crash/events", (_req, res) => res.json(flashCrash.getEvents()));
app.post("/api/flash-crash/toggle", (req, res) => { const { active } = req.body; flashCrash.setActive(active); res.json({ success: true, active }); });

// ─── Risk Management ─────────────────────────────────────────────────────────
app.get("/api/risk/status", (_req, res) => res.json(risk.getStats()));
app.post("/api/risk/pause", (req, res) => { const { symbol } = req.body; if (symbol) risk.pauseSymbol(symbol); else risk.pauseAll(); res.json({ success: true }); });
app.post("/api/risk/resume", (_req, res) => { risk.resumeAll(); res.json({ success: true }); });

// ─── Alerts ───────────────────────────────────────────────────────────────────
app.get("/api/alerts", (_req, res) => res.json(db.alerts));
app.put("/api/alerts/:id/read", (req, res) => {
  const alert = db.alerts.find(a => a.id === req.params.id);
  if (alert) { alert.read = true; db.saveAlerts(); }
  res.json({ success: !!alert });
});
app.post("/api/alerts/read-all", (_req, res) => {
  db.alerts.forEach(a => a.read = true);
  db.saveAlerts();
  res.json({ success: true });
});

// ─── Observability ────────────────────────────────────────────────────────────
app.get("/api/observability/metrics", (_req, res) => res.json(observability.getMetrics()));
app.get("/api/observability/services", (_req, res) => res.json(observability.getServices()));
app.get("/api/observability/logs", (req, res) => res.json(observability.getLogs(parseInt(req.query.limit) || 30)));
app.get("/api/observability/metric-logs", (req, res) => res.json(observability.getMetricLogs(parseInt(req.query.limit) || 20)));
app.get("/api/observability/mux", (_req, res) => res.json(marketMux.getStatus()));

// ─── Deploy History ───────────────────────────────────────────────────────────
app.get("/api/deploy/history", (_req, res) => res.json(deployManager.getHistory()));
app.post("/api/deploy/new", (req, res) => res.json(deployManager.deploy(req.body.notes || "Manual deploy")));
app.post("/api/deploy/rollback/:version", (req, res) => res.json(deployManager.rollback(req.params.version)));

// ─── Admin ────────────────────────────────────────────────────────────────────
app.get("/api/admin/config", (_req, res) => {
  const cfg = { ...db.getConfig() };
  delete cfg.bybitApiSecret;
  delete cfg.binanceApiSecret;
  res.json(cfg);
});
app.put("/api/admin/config", (req, res) => res.json({ success: true, config: db.updateConfig(req.body) }));
app.get("/api/admin/health", (_req, res) => {
  res.json({
    status: "ok",
    engine: orchestrator.running,
    services: observability.getServices().filter(s => s.status !== "Healthy").length === 0 ? "all_healthy" : "degraded",
    metrics: observability.getMetrics(),
    exchange: { connected: exchange.isConnected(), mode: db.getConfig().mode, exchange: db.getConfig().exchange },
  });
});
app.post("/api/admin/credentials", (req, res) => res.json(account.setCredentials(req.body)));
app.get("/api/admin/account", (_req, res) => res.json(account.getAccountInfo()));
app.post("/api/admin/exchange/set", (req, res) => {
  const { exchange: exch } = req.body;
  if (!["BYBIT", "BINANCE"].includes(exch)) return res.status(400).json({ error: "Invalid exchange" });
  exchange.setExchange(exch);
  res.json({ success: true, exchange: exch });
});
app.post("/api/admin/mode/set", (req, res) => {
  const { mode } = req.body;
  if (!["PAPER", "LIVE"].includes(mode)) return res.status(400).json({ error: "Invalid mode" });
  exchange.setMode(mode);
  res.json({ success: true, mode });
});

// ─── Slippage ────────────────────────────────────────────────────────────────
app.get("/api/slippage/:symbol", (req, res) => {
  res.json(slippage.getSymbolSlippage(req.params.symbol));
});

// ─── Market Consciousness Service ─────────────────────────────────────────────
app.get("/api/consciousness/status", (_req, res) => res.json(marketConsciousness.getConsciousnessStatus()));
app.get("/api/consciousness/report", (_req, res) => res.json(marketConsciousness.getReport()));
app.post("/api/consciousness/pause", (_req, res) => res.json(marketConsciousness.pauseTrading("Manual via API")));
app.post("/api/consciousness/resume", (_req, res) => res.json(marketConsciousness.resumeTrading()));
app.get("/api/consciousness/memecoin/all", (_req, res) => res.json(marketConsciousness.getMemecoinsAll()));
app.get("/api/consciousness/memecoin/:symbol", (req, res) => res.json(marketConsciousness.analyzeMemecoin(req.params.symbol)));
app.get("/api/consciousness/memecoin/hype", (_req, res) => res.json(marketConsciousness.getMemecoinsHype()));
app.get("/api/consciousness/alerts", (_req, res) => res.json(marketConsciousness.getHypeAlerts()));
app.get("/api/consciousness/weekly", (_req, res) => res.json(marketConsciousness.getWeeklyPerformance()));

// ─── NOVAS ROTAS: Relatório Diário ────────────────────────────────────────────
app.get("/api/consciousness/daily", (_req, res) => res.json(marketConsciousness.getDailyReport()));
app.get("/api/consciousness/daily/history", (req, res) => {
  const limit = parseInt(req.query.limit) || 7;
  res.json(marketConsciousness.getDailyHistory(limit));
});

// ─── Tokenomics Service ($AZTRON Token) ───────────────────────────────────────
app.get("/api/tokenomics/stats", (_req, res) => res.json(tokenomics.getTokenStats()));
app.post("/api/tokenomics/burn", (req, res) => {
  const { amount } = req.body;
  res.json(tokenomics.burnTokens(amount || 10000));
});
app.post("/api/tokenomics/mint", (req, res) => {
  const { amount, to } = req.body;
  res.json(tokenomics.mintTokens(amount || 0, to || "system"));
});
app.get("/api/tokenomics/holders", (_req, res) => res.json(tokenomics.getHolders()));
app.get("/api/tokenomics/rewards", (_req, res) => res.json(tokenomics.getPendingRewards()));
app.post("/api/tokenomics/reward", (req, res) => {
  const { userId, amount, reason } = req.body;
  res.json(tokenomics.rewardUser(userId, amount || 100, reason || "trade_win"));
});
app.get("/api/tokenomics/roadmap", (_req, res) => res.json(tokenomics.getRoadmap()));

// 🆕 ROTAS DO SAVINGS (COFRE)
app.get("/api/savings/status", (_req, res) => res.json(tokenomics.getSavingsStatus()));
app.post("/api/savings/withdraw", (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Amount is required and must be positive" });
  }
  res.json(tokenomics.withdrawFromSavings(amount));
});

// ==================== 🆕 HFT ROUTES (CORRIGIDAS - usando 'hft') ====================

// Iniciar HFT
app.post("/api/hft/start", async (req, res) => {
  try {
    const result = await hft.start();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("HFT start error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Parar HFT
app.post("/api/hft/stop", async (req, res) => {
  try {
    const result = await hft.stop();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("HFT stop error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Status do HFT
app.get("/api/hft/status", async (req, res) => {
  try {
    const status = hft.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Métricas do HFT
app.get("/api/hft/metrics", async (req, res) => {
  try {
    const metrics = hft.getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trades do HFT
app.get("/api/hft/trades", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const trades = db.getHFTTrades?.(limit) || [];
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Capital dos robôs (HFT + SWING)
app.get("/api/capital/balance", async (req, res) => {
  try {
    const capitals = await capitalRouter.getCapitals();
    res.json(capitals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fluxo de capital (log de transferências HFT → SWING)
app.get("/api/capital/flow", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const flow = db.getCapitalFlowLog?.(limit) || [];
    res.json(flow);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Executar liquidação semanal (manual)
app.post("/api/weekly/settle", async (req, res) => {
  try {
    const { swingProfit } = req.body;
    if (swingProfit === undefined) {
      return res.status(400).json({ error: "swingProfit é obrigatório" });
    }
    const result = await weeklySettlement.settleWeekly(swingProfit);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico de liquidações semanais
app.get("/api/weekly/settlements", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const settlements = await weeklySettlement.getSettlementHistory(limit);
    res.json(settlements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Última liquidação
app.get("/api/weekly/last", async (req, res) => {
  try {
    const last = await weeklySettlement.getLastSettlement();
    res.json(last || { message: "Nenhuma liquidação encontrada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset HFT (admin)
app.post("/api/hft/reset", (req, res) => {
  try {
    const result = db.resetHFTData?.() || { success: true };
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FIM HFT ROUTES ====================

// ─── WebSocket ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  logger.info(`WebSocket connected: ${socket.id}`, { service: "WebSocket" });

  socket.emit("engine:status", { running: orchestrator.running });
  socket.emit("markets", marketData.getAllIndicators());

  const tickHandler = (prices) => socket.emit("tick", prices);
  const signalHandler = (signal) => socket.emit("signal", signal);
  const tradeHandler = (data) => socket.emit("trade", data);
  const thoughtHandler = (thought) => socket.emit("thought", thought);
  const alertHandler = (alert) => socket.emit("alert", alert);
  const engineHandler = (status) => socket.emit("engine:status", status);
  const optimizerHandler = (data) => socket.emit("optimizer:progress", data);
  const optimizerCompleteHandler = (data) => socket.emit("optimizer:complete", data);
  const sentimentScanHandler = (data) => socket.emit("sentiment:scan:complete", data);
  const savingsUpdateHandler = (data) => socket.emit("savings:update", data);
  
  // 🆕 HFT WebSocket events
  const hftTradeHandler = (trade) => socket.emit("hft:trade", trade);
  const hftStatusHandler = (status) => socket.emit("hft:status", status);

  eventBus.on("tick", tickHandler);
  eventBus.on("signal", signalHandler);
  eventBus.on("trade", tradeHandler);
  eventBus.on("thought", thoughtHandler);
  eventBus.on("alert", alertHandler);
  eventBus.on("engine:status", engineHandler);
  eventBus.on("optimizer:progress", optimizerHandler);
  eventBus.on("optimizer:complete", optimizerCompleteHandler);
  eventBus.on("sentiment:scan:complete", sentimentScanHandler);
  eventBus.on("savings:update", savingsUpdateHandler);
  eventBus.on("hft:trade", hftTradeHandler);
  eventBus.on("hft:status", hftStatusHandler);

  socket.on("disconnect", () => {
    eventBus.off("tick", tickHandler);
    eventBus.off("signal", signalHandler);
    eventBus.off("trade", tradeHandler);
    eventBus.off("thought", thoughtHandler);
    eventBus.off("alert", alertHandler);
    eventBus.off("engine:status", engineHandler);
    eventBus.off("optimizer:progress", optimizerHandler);
    eventBus.off("optimizer:complete", optimizerCompleteHandler);
    eventBus.off("sentiment:scan:complete", sentimentScanHandler);
    eventBus.off("savings:update", savingsUpdateHandler);
    eventBus.off("hft:trade", hftTradeHandler);
    eventBus.off("hft:status", hftStatusHandler);
    logger.info(`WebSocket disconnected: ${socket.id}`, { service: "WebSocket" });
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
  memoryService.setDatabase(db);
  await memoryService.start();
  
  await marketConsciousness.start?.();
  await tokenomics.start?.();
  
  // 🆕 Inicializar serviços HFT
  await capitalRouter.initialize();
  await hft.initialize();
  
  await orchestrator.init();
  await orchestrator.start();
  
  // 🆕 Auto-start HFT se configurado
  const config = db.getConfig();
  if (config.hftEnabled) {
    await hft.start();
    logger.info("🚀 HFT Service auto-started", { service: "HFT" });
  }

  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`AZTRON Backend running on port ${PORT}`, { service: "Orchestrator" });
    logger.info(`REST API: http://0.0.0.0:${PORT}/api`, { service: "Orchestrator" });
    logger.info(`WebSocket: ws://0.0.0.0:${PORT}`, { service: "Orchestrator" });
    logger.info(`🤖 HFT Trading Engine ready`, { service: "HFT" });
    logger.info(`💰 Capital Router ready`, { service: "CapitalRouter" });
    logger.info(`📊 Weekly Settlement ready`, { service: "WeeklySettlement" });
  });
}

main().catch(err => { logger.error(`Fatal startup error: ${err.message}`); process.exit(1); });
