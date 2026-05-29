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
  res.json({ status: "ok", version: "v4.2.1", timestamp: new Date().toISOString() });
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

// ─── AI Optimizer ─────────────────────────────────────────────────────────────
app.post("/api/ai/optimize/start", (_req, res) => res.json(aiOptimizer.start()));
app.get("/api/ai/optimize/status", (_req, res) => res.json(aiOptimizer.getStatus()));
app.post("/api/ai/optimize/apply", (_req, res) => res.json(aiOptimizer.applyBestConfig()));
app.post("/api/ai/optimize/reset", (_req, res) => { aiOptimizer.reset(); res.json({ success: true }); });

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
  const { qty } = req.query;
  res.json(slippage.getSymbolSlippage(req.params.symbol));
});

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

  eventBus.on("tick", tickHandler);
  eventBus.on("signal", signalHandler);
  eventBus.on("trade", tradeHandler);
  eventBus.on("thought", thoughtHandler);
  eventBus.on("alert", alertHandler);
  eventBus.on("engine:status", engineHandler);
  eventBus.on("optimizer:progress", optimizerHandler);
  eventBus.on("optimizer:complete", optimizerCompleteHandler);

  socket.on("disconnect", () => {
    eventBus.off("tick", tickHandler);
    eventBus.off("signal", signalHandler);
    eventBus.off("trade", tradeHandler);
    eventBus.off("thought", thoughtHandler);
    eventBus.off("alert", alertHandler);
    eventBus.off("engine:status", engineHandler);
    eventBus.off("optimizer:progress", optimizerHandler);
    eventBus.off("optimizer:complete", optimizerCompleteHandler);
    logger.info(`WebSocket disconnected: ${socket.id}`, { service: "WebSocket" });
  });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
  await orchestrator.init();
  await orchestrator.start();

  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`AZTRON Backend running on port ${PORT}`, { service: "Orchestrator" });
    logger.info(`REST API: http://0.0.0.0:${PORT}/api`, { service: "Orchestrator" });
    logger.info(`WebSocket: ws://0.0.0.0:${PORT}`, { service: "Orchestrator" });
  });
}

main().catch(err => { logger.error(`Fatal startup error: ${err.message}`); process.exit(1); });
