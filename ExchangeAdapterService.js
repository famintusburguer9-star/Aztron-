const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");

const MOCK_PRICES = {
  BTCUSDT: { price: 69340.5, bid: 69335.0, ask: 69346.0, spread: 0.02, volume24h: 28_450_000_000, high24h: 71200, low24h: 68100 },
  ETHUSDT: { price: 3284.2, bid: 3283.5, ask: 3284.9, spread: 0.04, volume24h: 14_200_000_000, high24h: 3350, low24h: 3200 },
  BNBUSDT: { price: 312.8, bid: 312.6, ask: 313.0, spread: 0.06, volume24h: 1_800_000_000, high24h: 320, low24h: 308 },
};

class ExchangeAdapterService {
  constructor() {
    this.exchange = db.getConfig().exchange || "BYBIT";
    this.mode = db.getConfig().mode || "PAPER";
    this.connected = true;
    this.prices = { ...MOCK_PRICES };
    this.paperBalance = { USDT: 41500, BTC: 0.312, ETH: 1.85, BNB: 5.4 };
    this._simulatePrices();
    logger.info("ExchangeAdapterService initialized", { service: "ExchangeAdapter", exchange: this.exchange, mode: this.mode });
  }

  _simulatePrices() {
    setInterval(() => {
      for (const sym of Object.keys(this.prices)) {
        const t = this.prices[sym];
        const delta = (Math.random() - 0.498) * t.price * 0.0008;
        t.price = Math.max(t.price + delta, 1);
        t.bid = t.price - (t.price * t.spread / 100 / 2);
        t.ask = t.price + (t.price * t.spread / 100 / 2);
      }
      eventBus.emit("tick", this.prices);
    }, 2000);
  }

  getTicker(symbol) { return this.prices[symbol] || null; }
  getAllTickers() { return this.prices; }

  async placeOrder(symbol, side, qty, price = null) {
    if (this.mode === "PAPER") {
      const ticker = this.prices[symbol];
      const execPrice = price || ticker.price;
      const asset = symbol.replace("USDT", "");
      if (side === "BUY") {
        const cost = execPrice * qty;
        if (this.paperBalance.USDT < cost) throw new Error("Insufficient USDT balance");
        this.paperBalance.USDT -= cost;
        this.paperBalance[asset] = (this.paperBalance[asset] || 0) + qty;
      } else {
        if ((this.paperBalance[asset] || 0) < qty) throw new Error(`Insufficient ${asset} balance`);
        this.paperBalance[asset] -= qty;
        this.paperBalance.USDT += execPrice * qty;
      }
      const order = { orderId: `PAPER_${Date.now()}`, symbol, side, qty, price: execPrice, status: "FILLED", timestamp: new Date().toISOString() };
      logger.info(`Paper trade executed: ${side} ${qty} ${symbol} @ $${execPrice.toFixed(2)}`, { service: "ExchangeAdapter" });
      return order;
    }
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  getBalance() { return this.paperBalance; }
  isConnected() { return this.connected; }
  setExchange(exchange) { this.exchange = exchange; db.updateConfig({ exchange }); }
  setMode(mode) { this.mode = mode; db.updateConfig({ mode }); }
}

module.exports = new ExchangeAdapterService();
