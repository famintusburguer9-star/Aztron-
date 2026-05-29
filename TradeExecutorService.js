const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const slippage = require("./SlippageEstimatorService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class TradeExecutorService {
  constructor() {
    this.running = false;
    this.openTrades = db.getTrades({ status: "OPEN" });
    logger.info("TradeExecutorService initialized", { service: "TradeExecutor" });
  }

  start() { this.running = true; this._monitorOpenTrades(); }
  stop() { this.running = false; }

  async executeTrade({ symbol, side, strategy, confidence }) {
    if (!this.running) return { success: false, reason: "Engine stopped" };

    const ticker = exchange.getTicker(symbol);
    if (!ticker) return { success: false, reason: "No ticker data" };

    const cfg = db.getConfig();
    const positionInfo = risk.calculatePositionSize(symbol, ticker.price, cfg.stopLoss);
    const validation = risk.validateTrade(symbol, side, positionInfo.qty * ticker.price);
    if (!validation.approved) return { success: false, reason: validation.errors.join("; ") };

    const slip = slippage.estimate(symbol, side, positionInfo.qty);
    if (!slip.acceptable) return { success: false, reason: `Slippage too high: ${slip.estimated}%` };

    try {
      const order = await exchange.placeOrder(symbol, side, positionInfo.qty, ticker.price);
      const trade = {
        id: `trade_${Date.now()}`, symbol, side, strategy, confidence,
        status: "OPEN", entryPrice: order.price, exitPrice: null, qty: positionInfo.qty,
        pnl: 0, pnlPct: 0, stopLoss: positionInfo.stopPrice,
        takeProfit: order.price * (1 + cfg.takeProfit / 100),
        timestamp: new Date().toISOString(), orderId: order.orderId,
      };
      this.openTrades.push(trade);
      db.addTrade(trade);
      eventBus.emit("trade", { action: "OPEN", trade });
      logger.info(`Trade opened: ${side} ${positionInfo.qty} ${symbol} @ $${order.price}`, { service: "TradeExecutor" });
      return { success: true, trade };
    } catch (err) {
      logger.error(`Trade execution failed: ${err.message}`, { service: "TradeExecutor" });
      return { success: false, reason: err.message };
    }
  }

  _monitorOpenTrades() {
    setInterval(() => {
      if (!this.running) return;
      const cfg = db.getConfig();
      for (const trade of [...this.openTrades]) {
        const ticker = exchange.getTicker(trade.symbol);
        if (!ticker) continue;
        const currentPrice = ticker.price;
        const side = trade.side;
        const pnlPct = side === "BUY"
          ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
        const pnl = (pnlPct / 100) * trade.entryPrice * trade.qty;
        trade.pnl = Math.round(pnl * 100) / 100;
        trade.pnlPct = Math.round(pnlPct * 100) / 100;

        const hitSL = side === "BUY" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss * 2 - trade.entryPrice;
        const hitTP = side === "BUY" ? currentPrice >= trade.takeProfit : currentPrice <= trade.entryPrice - (trade.takeProfit - trade.entryPrice);

        if (hitSL || hitTP) {
          trade.status = "CLOSED";
          trade.exitPrice = currentPrice;
          this.openTrades = this.openTrades.filter(t => t.id !== trade.id);
          db.addTrade(trade);
          eventBus.emit("trade", { action: "CLOSE", trade, reason: hitTP ? "TAKE_PROFIT" : "STOP_LOSS" });
          logger.info(`Trade closed (${hitTP ? "TP" : "SL"}): ${trade.symbol} PnL: $${trade.pnl}`, { service: "TradeExecutor" });
          if (hitSL) {
            db.addAlert({ id: `al_${Date.now()}`, severity: "warning", message: `Stop loss hit: ${trade.symbol} PnL: $${trade.pnl}`, timestamp: new Date().toISOString(), read: false });
            eventBus.emit("alert", { severity: "warning", message: `Stop loss hit: ${trade.symbol}` });
          }
        }
      }
    }, 5000);
  }

  getOpenTrades() { return this.openTrades; }
  getTotalOpenPnl() { return this.openTrades.reduce((a, t) => a + t.pnl, 0); }
}

module.exports = new TradeExecutorService();
