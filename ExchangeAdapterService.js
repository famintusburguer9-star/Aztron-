const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");

const MOCK_PRICES = {
  BTCUSDT: { price: 69340.5, bid: 69335.0, ask: 69346.0, spread: 0.02, volume24h: 28450000000, high24h: 71200, low24h: 68100, change24h: 1.8 },
  ETHUSDT: { price: 3284.2, bid: 3283.5, ask: 3284.9, spread: 0.04, volume24h: 14200000000, high24h: 3350, low24h: 3200, change24h: 1.2 },
  BNBUSDT: { price: 312.8, bid: 312.6, ask: 313.0, spread: 0.06, volume24h: 1800000000, high24h: 320, low24h: 308, change24h: 0.5 },
  SOLUSDT: { price: 168.5, bid: 168.2, ask: 168.8, spread: 0.05, volume24h: 3500000000, high24h: 175, low24h: 162, change24h: 2.1 },
  XRPUSDT: { price: 0.52, bid: 0.519, ask: 0.521, spread: 0.03, volume24h: 980000000, high24h: 0.54, low24h: 0.51, change24h: -0.5 },
};

class ExchangeAdapterService {
  constructor() {
    this.exchange = db.getConfig().exchange || "BYBIT";
    this.mode = db.getConfig().mode || "PAPER";
    this.connected = true;
    this.prices = { ...MOCK_PRICES };
    this.paperBalance = { USDT: 41500, BTC: 0.312, ETH: 1.85, BNB: 5.4, SOL: 12.5, XRP: 850 };
    this.tradeHistory = [];
    this._simulatePrices();
    logger.info("ExchangeAdapterService initialized", { service: "ExchangeAdapter", exchange: this.exchange, mode: this.mode });
  }

  _simulatePrices() {
    setInterval(() => {
      for (const sym of Object.keys(this.prices)) {
        const t = this.prices[sym];
        // Simulação mais realista com tendência e volatilidade
        const volatility = 0.0006;
        const trend = (Math.random() - 0.5) * 0.0002;
        const delta = (Math.random() - 0.498) * t.price * volatility + (t.price * trend);
        t.price = Math.max(t.price + delta, 0.01);
        t.bid = t.price - (t.price * t.spread / 100 / 2);
        t.ask = t.price + (t.price * t.spread / 100 / 2);
        
        // Atualiza change24h a cada 5 minutos
        if (Math.random() < 0.01) {
          t.change24h = (Math.random() - 0.5) * 5;
        }
      }
      eventBus.emit("tick", this.prices);
    }, 2000);
  }

  /**
   * Retorna ticker de um símbolo
   * @param {string} symbol - Ex: "BTCUSDT"
   * @returns {object} - Dados do ticker
   */
  getTicker(symbol) { 
    return this.prices[symbol] || null; 
  }
  
  /**
   * Retorna todos os tickers
   * @returns {object} - Todos os preços
   */
  getAllTickers() { 
    return this.prices; 
  }

  /**
   * Retorna preço atual de um símbolo (MÉTODO NOVO para os serviços)
   * @param {string} symbol - Ex: "BTCUSDT", "ETHUSDT"
   * @returns {Promise<number>} - Preço atual
   */
  async getPrice(symbol) {
    try {
      const ticker = this.prices[symbol];
      if (ticker && ticker.price) {
        return ticker.price;
      }
      // Fallback para símbolo não encontrado
      logger.warn(`Símbolo ${symbol} não encontrado, usando fallback`, { service: "ExchangeAdapter" });
      return symbol === "BTCUSDT" ? 65000 : symbol === "ETHUSDT" ? 3200 : 100;
    } catch (error) {
      logger.error(`Erro ao buscar preço de ${symbol}:`, error);
      return 0;
    }
  }

  /**
   * Retorna preços de múltiplos símbolos de uma vez
   * @param {string[]} symbols - Array de símbolos
   * @returns {Promise<object>} - Objeto com preços
   */
  async getPrices(symbols) {
    const result = {};
    for (const symbol of symbols) {
      result[symbol] = await this.getPrice(symbol);
    }
    return result;
  }

  /**
   * Retorna bid/ask spread de um símbolo
   * @param {string} symbol 
   * @returns {object} - bid, ask, spreadPercent
   */
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

  /**
   * Executa ordem de compra/venda
   * @param {string} symbol - Par de trading
   * @param {string} side - "BUY" ou "SELL"
   * @param {number} qty - Quantidade
   * @param {number|null} price - Preço (opcional)
   * @returns {Promise<object>} - Ordem executada
   */
  async placeOrder(symbol, side, qty, price = null) {
    if (this.mode === "PAPER") {
      const ticker = this.prices[symbol];
      if (!ticker) throw new Error(`Symbol ${symbol} not found`);
      
      const execPrice = price || ticker.price;
      const asset = symbol.replace("USDT", "");
      const cost = execPrice * qty;
      
      if (side === "BUY") {
        if (this.paperBalance.USDT < cost) {
          throw new Error(`Insufficient USDT balance. Need $${cost.toFixed(2)}, have $${this.paperBalance.USDT.toFixed(2)}`);
        }
        this.paperBalance.USDT -= cost;
        this.paperBalance[asset] = (this.paperBalance[asset] || 0) + qty;
      } else {
        if ((this.paperBalance[asset] || 0) < qty) {
          throw new Error(`Insufficient ${asset} balance. Need ${qty}, have ${(this.paperBalance[asset] || 0)}`);
        }
        this.paperBalance[asset] -= qty;
        this.paperBalance.USDT += cost;
      }
      
      const order = { 
        orderId: `PAPER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, 
        symbol, 
        side, 
        qty, 
        price: execPrice,
        total: cost,
        status: "FILLED", 
        timestamp: new Date().toISOString(),
        mode: "PAPER"
      };
      
      this.tradeHistory.unshift(order);
      if (this.tradeHistory.length > 1000) this.tradeHistory.pop();
      
      logger.info(`Paper trade executed: ${side} ${qty.toFixed(6)} ${symbol} @ $${execPrice.toFixed(2)} | Total: $${cost.toFixed(2)}`, { 
        service: "ExchangeAdapter",
        balance: { USDT: this.paperBalance.USDT.toFixed(2), [asset]: this.paperBalance[asset]?.toFixed(6) }
      });
      
      eventBus.emit("exchange:order", order);
      return order;
    }
    
    // LIVE mode - implementar com API real
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  /**
   * Retorna saldo atual da conta
   * @returns {object} - Saldo por ativo
   */
  getBalance() { 
    return { ...this.paperBalance }; 
  }

  /**
   * Retorna saldo em USDT (equivalente)
   * @returns {Promise<number>} - Saldo total em USDT
   */
  async getTotalBalance() {
    let total = this.paperBalance.USDT || 0;
    for (const [asset, amount] of Object.entries(this.paperBalance)) {
      if (asset !== "USDT" && amount > 0) {
        const price = await this.getPrice(`${asset}USDT`);
        total += amount * price;
      }
    }
    return total;
  }

  /**
   * Verifica se está conectado
   * @returns {boolean}
   */
  isConnected() { 
    return this.connected; 
  }

  /**
   * Altera exchange (BYBIT/BINANCE)
   * @param {string} exchange 
   */
  setExchange(exchange) { 
    this.exchange = exchange; 
    db.updateConfig({ exchange });
    logger.info(`Exchange changed to ${exchange}`, { service: "ExchangeAdapter" });
  }

  /**
   * Altera modo (PAPER/LIVE)
   * @param {string} mode 
   */
  setMode(mode) { 
    this.mode = mode; 
    db.updateConfig({ mode });
    logger.info(`Mode changed to ${mode}`, { service: "ExchangeAdapter" });
  }

  /**
   * Reseta o saldo PAPER (útil para backtest)
   * @param {object} initialBalance - Saldo inicial
   */
  resetPaperBalance(initialBalance = { USDT: 10000, BTC: 0, ETH: 0, BNB: 0, SOL: 0, XRP: 0 }) {
    this.paperBalance = { ...initialBalance };
    logger.info("Paper balance reset", { service: "ExchangeAdapter", balance: this.paperBalance });
  }

  /**
   * Retorna histórico de trades
   * @param {number} limit - Limite de registros
   * @returns {array}
   */
  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(0, limit);
  }
}

module.exports = new ExchangeAdapterService();
