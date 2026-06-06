const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");
const capitalDistributor = require("./CapitalDistributorService");

// Preços iniciais realistas
const INITIAL_PRICES = {
  BTCUSDT: 68000,
  ETHUSDT: 3200,
  BNBUSDT: 580,
  SOLUSDT: 150,
  XRPUSDT: 0.52,
};

// Volatilidade anual aproximada por par (%)
const VOLATILITY = {
  BTCUSDT: 0.45,
  ETHUSDT: 0.55,
  BNBUSDT: 0.50,
  SOLUSDT: 0.70,
  XRPUSDT: 0.60,
};

// Correlação entre pares
const CORRELATION = {
  BTCUSDT: 1.0,
  ETHUSDT: 0.85,
  BNBUSDT: 0.70,
  SOLUSDT: 0.65,
  XRPUSDT: 0.50,
};

class ExchangeAdapterService {
  constructor() {
    this.exchange = db.getConfig().exchange || "BYBIT";
    this.mode = db.getConfig().mode || "PAPER";
    this.connected = true;
    this.prices = {};
    this.tradeHistory = [];
    
    // Inicializa preços
    for (const [symbol, price] of Object.entries(INITIAL_PRICES)) {
      this.prices[symbol] = {
        price: price,
        bid: price * 0.999,
        ask: price * 1.001,
        spread: 0.02,
        volume24h: 0,
        high24h: price,
        low24h: price,
        change24h: 0,
        timestamp: Date.now()
      };
    }
    
    this._startRealisticSimulation();
    
    logger.info("ExchangeAdapterService initialized", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      status: "Usando CapitalDistributor para saldos"
    });
  }

  /**
   * Obtém saldo do agente via CapitalDistributor
   */
  getAgentBalance(agentId = "trend") {
    const agentInfo = capitalDistributor.getAgentInfo(agentId);
    const balance = agentInfo ? agentInfo.balance : 0;
    return balance;
  }

  _startRealisticSimulation() {
    setInterval(() => {
      const now = new Date();
      const hour = now.getUTCHours();
      
      let timeFactor = 0.5;
      if (hour >= 13 && hour <= 22) timeFactor = 1.5;
      else if (hour >= 8 && hour <= 17) timeFactor = 1.2;
      else if (hour >= 0 && hour <= 8) timeFactor = 0.8;
      
      const marketTrend = (Math.random() - 0.5) * 0.0003 * timeFactor;
      
      for (const [symbol, data] of Object.entries(this.prices)) {
        const vol = VOLATILITY[symbol] || 0.5;
        const correlation = CORRELATION[symbol] || 0.5;
        
        const specificNoise = (Math.random() - 0.5) * 0.0004 * timeFactor * (1 - correlation);
        const deltaPercent = (marketTrend * correlation) + specificNoise;
        const dailyVol = vol / Math.sqrt(365);
        const finalDelta = deltaPercent * dailyVol * timeFactor;
        
        let newPrice = data.price * (1 + finalDelta);
        
        if (symbol === 'BTCUSDT') newPrice = Math.max(30000, Math.min(150000, newPrice));
        if (symbol === 'ETHUSDT') newPrice = Math.max(1500, Math.min(8000, newPrice));
        if (symbol === 'BNBUSDT') newPrice = Math.max(200, Math.min(1200, newPrice));
        if (symbol === 'SOLUSDT') newPrice = Math.max(20, Math.min(500, newPrice));
        if (symbol === 'XRPUSDT') newPrice = Math.max(0.3, Math.min(3, newPrice));
        
        data.price = newPrice;
        data.bid = newPrice * 0.999;
        data.ask = newPrice * 1.001;
        
        if (newPrice > data.high24h) data.high24h = newPrice;
        if (newPrice < data.low24h) data.low24h = newPrice;
        
        const price24hAgo = data.price24hAgo || newPrice;
        data.change24h = ((newPrice - price24hAgo) / price24hAgo) * 100;
        data.volume24h = Math.floor(Math.random() * 50000000 * timeFactor) + 10000000;
        
        if (!data.lastReset || Date.now() - data.lastReset > 86400000) {
          data.price24hAgo = newPrice;
          data.lastReset = Date.now();
        }
      }
      
      eventBus.emit("tick", this.prices);
    }, 2000);
  }

  async getPrice(symbol) {
    const ticker = this.prices[symbol];
    if (ticker && ticker.price) {
      return ticker.price;
    }
    return INITIAL_PRICES[symbol] || 100;
  }

  getTicker(symbol) { 
    return this.prices[symbol] || null; 
  }
  
  getAllTickers() { 
    return this.prices; 
  }

  getSpread(symbol) {
    const ticker = this.prices[symbol];
    if (!ticker) return null;
    return {
      bid: ticker.bid,
      ask: ticker.ask,
      spread: ticker.ask - ticker.bid,
      spreadPercent: ((ticker.ask - ticker.bid) / ticker.price) * 100
    };
  }

  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    try {
      const realPrice = await this.getPrice(symbol);
      if (!realPrice) return null;
      
      const ticker = this.prices[symbol];
      const volatility = Math.abs(ticker.change24h) / 100;
      const maxSpread = Math.min(2.0, volatility * 0.5 + 0.3);
      const simulatedSpread = Math.random() * maxSpread;
      
      const isBinanceHigher = Math.random() > 0.5;
      let binancePrice = realPrice;
      let bybitPrice = realPrice;
      
      if (isBinanceHigher) {
        binancePrice = realPrice * (1 + simulatedSpread / 100);
      } else {
        bybitPrice = realPrice * (1 + simulatedSpread / 100);
      }
      
      const buyExchange = binancePrice < bybitPrice ? "BINANCE" : "BYBIT";
      const sellExchange = binancePrice < bybitPrice ? "BYBIT" : "BINANCE";

      return {
        symbol,
        binancePrice,
        bybitPrice,
        spread: parseFloat(simulatedSpread.toFixed(4)),
        buyExchange,
        sellExchange,
        isRealData: false,
        isSimulated: true,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Erro na análise de arbitragem: ${error.message}`);
      return null;
    }
  }

  /**
   * 🔥 EXECUTA ORDEM - DEBITA O CAPITAL DO CAPITAL DISTRIBUTOR
   */
  async placeOrder(symbol, side, qty, price = null, agentId = "trend") {
    if (this.mode === "PAPER") {
      const ticker = this.prices[symbol];
      if (!ticker) throw new Error(`Symbol ${symbol} not found`);
      
      const execPrice = price || ticker.price;
      const cost = execPrice * qty;
      
      // 🔥 VERIFICA SALDO NO CAPITAL DISTRIBUTOR
      const currentBalance = this.getAgentBalance(agentId);
      
      if (side === "BUY") {
        if (currentBalance < cost) {
          throw new Error(`Insufficient balance for ${agentId}. Need $${cost.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
        }
      }
      
      // 🔥🔥🔥 CRÍTICO: RESERVA/DEBITA O CAPITAL DO CAPITAL DISTRIBUTOR
      const capitalResult = await new Promise((resolve) => {
        capitalDistributor.handleRequest({
          agentId: agentId,
          amount: cost,
          reason: `Trade: ${side} ${symbol}`,
          callback: resolve
        });
      });
      
      if (!capitalResult.success) {
        throw new Error(`Failed to reserve capital: ${capitalResult.reason}`);
      }
      
      const newBalance = currentBalance - cost;
      
      logger.info(`[PAPER] ${side} ${qty.toFixed(6)} ${symbol} @ $${execPrice.toFixed(2)} | Total: $${cost.toFixed(2)} | Agent: ${agentId} | Balance: $${currentBalance.toFixed(2)} → $${newBalance.toFixed(2)}`);
      
      const order = { 
        orderId: `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, 
        symbol, 
        side, 
        qty, 
        price: execPrice,
        total: cost,
        status: "FILLED", 
        timestamp: new Date().toISOString(),
        mode: "PAPER",
        agent: agentId,
        balanceBefore: currentBalance,
        balanceAfter: newBalance
      };
      
      this.tradeHistory.unshift(order);
      if (this.tradeHistory.length > 1000) this.tradeHistory.pop();
      
      eventBus.emit("exchange:order", order);
      return order;
    }
    
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  /**
   * RETORNA SALDO DO AGENTE (via CapitalDistributor)
   */
  getBalance(agentId = "trend") {
    return { USDT: this.getAgentBalance(agentId) };
  }

  async getTotalBalance(agentId = "trend") {
    return this.getAgentBalance(agentId);
  }

  isConnected() { 
    return this.connected; 
  }

  setExchange(exchange) { 
    this.exchange = exchange; 
    db.updateConfig({ exchange });
  }

  setMode(mode) { 
    this.mode = mode; 
    db.updateConfig({ mode });
  }

  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(0, limit);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ExchangeAdapterService();
