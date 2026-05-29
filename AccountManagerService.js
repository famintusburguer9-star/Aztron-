const exchange = require("./ExchangeAdapterService");
const db = require("./DatabaseService");
const logger = require("./LoggerService");

class AccountManagerService {
  constructor() { logger.info("AccountManagerService initialized", { service: "AccountManager" }); }

  getAccountInfo() {
    const cfg = db.getConfig();
    const bal = exchange.getBalance();
    return {
      mode: cfg.mode, exchange: cfg.exchange,
      connected: exchange.isConnected(),
      balance: bal,
      apiConfigured: cfg.bybitApiKey.length > 0 || cfg.binanceApiKey.length > 0,
    };
  }

  setCredentials({ exchange: exch, apiKey, apiSecret }) {
    if (exch === "BYBIT") db.updateConfig({ bybitApiKey: apiKey, bybitApiSecret: apiSecret });
    else db.updateConfig({ binanceApiKey: apiKey, binanceApiSecret: apiSecret });
    logger.info(`${exch} credentials updated`, { service: "AccountManager" });
    return { success: true };
  }
}

module.exports = new AccountManagerService();
