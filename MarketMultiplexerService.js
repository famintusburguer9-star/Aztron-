const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class MarketMultiplexerService {
  constructor() {
    this.subscribers = new Map();
    this.symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];
    eventBus.on("tick", prices => this._broadcast(prices));
    logger.info("MarketMultiplexerService initialized", { service: "MarketMux" });
  }

  _broadcast(prices) {
    for (const [sym, handlers] of this.subscribers.entries()) {
      if (prices[sym]) handlers.forEach(fn => { try { fn(prices[sym]); } catch {} });
    }
  }

  subscribe(symbol, handler) {
    if (!this.subscribers.has(symbol)) this.subscribers.set(symbol, []);
    this.subscribers.get(symbol).push(handler);
  }

  getStatus() {
    return {
      activeSymbols: this.symbols,
      subscriberCount: [...this.subscribers.values()].reduce((a, v) => a + v.length, 0),
      lastTick: new Date().toISOString(),
      wsConnected: exchange.isConnected(),
    };
  }
}

module.exports = new MarketMultiplexerService();
