const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");

// URLs das APIs Públicas (funcionam SEM chave)
const BINANCE_API_URL = "https://api.binance.com";
const BYBIT_API_URL = "https://api.bybit.com";

// Preços de fallback (simulação)
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
    this.paperBalance = { USDT: 20000, BTC: 0, ETH: 0, BNB: 0, SOL: 0, XRP: 0 };
    this.tradeHistory = [];
    
    // Cache para preços reais
    this.cachedPrices = {
      binance: {},
      bybit: {}
    };
    
    this._simulatePrices();
    
    logger.info("ExchangeAdapterService initialized", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      arbitrageMode: "BINANCE vs BYBIT (REAL PRICES)"
    });
  }

  // Simulação de preços para fallback (quando APIs falham)
  _simulatePrices() {
    setInterval(() => {
      for (const sym of Object.keys(this.prices)) {
        const t = this.prices[sym];
        const volatility = 0.0006;
        const trend = (Math.random() - 0.5) * 0.0002;
        const delta = (Math.random() - 0.498) * t.price * volatility + (t.price * trend);
        t.price = Math.max(t.price + delta, 0.01);
        t.bid = t.price - (t.price * t.spread / 100 / 2);
        t.ask = t.price + (t.price * t.spread / 100 / 2);
        
        if (Math.random() < 0.01) {
          t.change24h = (Math.random() - 0.5) * 5;
        }
      }
      eventBus.emit("tick", this.prices);
    }, 2000);
  }

  // ==================== 🔥 APIs PÚBLICAS (SEM CHAVE) ====================

  /**
   * Busca preço REAL da Binance (API pública - NÃO precisa de chave)
   * @param {string} symbol - Ex: "BTCUSDT"
   * @returns {Promise<number>}
   */
  async getBinancePrice(symbol) {
    try {
      // Verifica cache (atualizado a cada 5 segundos)
      const cached = this.cachedPrices.binance[symbol];
      if (cached && (Date.now() - cached.timestamp) < 5000) {
        return cached.price;
      }
      
      const url = `${BINANCE_API_URL}/api/v3/ticker/price?symbol=${symbol}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.price) {
        const price = parseFloat(data.price);
        // Atualiza cache
        this.cachedPrices.binance[symbol] = { price, timestamp: Date.now() };
        return price;
      }
      throw new Error(`Preço não encontrado para ${symbol}`);
    } catch (error) {
      logger.error(`Erro ao buscar preço na Binance: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca preço REAL da Bybit (API pública - NÃO precisa de chave)
   * @param {string} symbol - Ex: "BTCUSDT"
   * @returns {Promise<number>}
   */
  async getBybitPrice(symbol) {
    try {
      // Verifica cache (atualizado a cada 5 segundos)
      const cached = this.cachedPrices.bybit[symbol];
      if (cached && (Date.now() - cached.timestamp) < 5000) {
        return cached.price;
      }
      
      const url = `${BYBIT_API_URL}/v5/market/tickers?category=spot&symbol=${symbol}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.result && data.result.list && data.result.list[0]) {
        const price = parseFloat(data.result.list[0].lastPrice);
        // Atualiza cache
        this.cachedPrices.bybit[symbol] = { price, timestamp: Date.now() };
        return price;
      }
      throw new Error(`Preço não encontrado para ${symbol}`);
    } catch (error) {
      logger.error(`Erro ao buscar preço na Bybit: ${error.message}`);
      return null;
    }
  }

  /**
   * 🔥 DETECTA OPORTUNIDADE REAL DE ARBITRAGEM
   * Compara preços REAIS entre Binance e Bybit
   * @param {string} symbol - Ex: "BTCUSDT"
   * @returns {Promise<object>}
   */
  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    try {
      // Busca preços em paralelo
      const [binancePrice, bybitPrice] = await Promise.all([
        this.getBinancePrice(symbol),
        this.getBybitPrice(symbol)
      ]);

      // Se não conseguiu preços reais, retorna null (não usa simulação)
      if (!binancePrice || !bybitPrice) {
        logger.debug(`Não foi possível obter preços reais para ${symbol}`, { 
          binance: !!binancePrice, 
          bybit: !!bybitPrice 
        });
        return null;
      }

      // Calcula spread REAL
      const spread = Math.abs((binancePrice - bybitPrice) / binancePrice) * 100;
      
      // Determina direção da arbitragem
      let buyExchange = binancePrice < bybitPrice ? "BINANCE" : "BYBIT";
      let sellExchange = binancePrice < bybitPrice ? "BYBIT" : "BINANCE";
      let action = `BUY_ON_${buyExchange}_SELL_ON_${sellExchange}`;

      const result = {
        symbol,
        binancePrice,
        bybitPrice,
        spread: parseFloat(spread.toFixed(4)),
        action,
        buyExchange,
        sellExchange,
        isRealData: true,
        timestamp: Date.now()
      };

      // Log apenas quando spread for significativo (acima de 0.3%)
      if (spread > 0.3) {
        logger.info(`🎯 ARBITRAGEM DETECTADA: ${symbol} | Spread: ${spread}% | Comprar em ${buyExchange} | Vender em ${sellExchange}`);
      }

      return result;
    } catch (error) {
      logger.error(`Erro na análise de arbitragem: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca oportunidades em múltiplos símbolos
   * @param {string[]} symbols 
   * @returns {Promise<object[]>}
   */
  async getMultipleArbitrageOpportunities(symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT"]) {
    const opportunities = [];
    for (const symbol of symbols) {
      const opp = await this.getArbitrageOpportunity(symbol);
      if (opp && opp.spread > 0.3) {
        opportunities.push(opp);
      }
      // Pequeno delay para não sobrecarregar
      await this.sleep(500);
    }
    return opportunities.sort((a, b) => b.spread - a.spread);
  }

  // ==================== MÉTODOS EXISTENTES (com fallback) ====================

  getTicker(symbol) { 
    return this.prices[symbol] || null; 
  }
  
  getAllTickers() { 
    return this.prices; 
  }

  /**
   * Obtém preço (prioriza real da Bybit, fallback para simulação)
   */
  async getPrice(symbol) {
    try {
      // Prioriza preço real da Bybit
      const realPrice = await this.getBybitPrice(symbol);
      if (realPrice) return realPrice;
      
      // Fallback para simulação
      const ticker = this.prices[symbol];
      if (ticker && ticker.price) {
        return ticker.price;
      }
      
      logger.warn(`Símbolo ${symbol} não encontrado, usando fallback`);
      return symbol === "BTCUSDT" ? 65000 : symbol === "ETHUSDT" ? 3200 : 100;
    } catch (error) {
      logger.error(`Erro ao buscar preço de ${symbol}:`, error);
      return 0;
    }
  }

  async getPrices(symbols) {
    const result = {};
    for (const symbol of symbols) {
      result[symbol] = await this.getPrice(symbol);
    }
    return result;
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
    
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  getBalance() { 
    return { ...this.paperBalance }; 
  }

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

  isConnected() { 
    return this.connected; 
  }

  setExchange(exchange) { 
    this.exchange = exchange; 
    db.updateConfig({ exchange });
    logger.info(`Exchange changed to ${exchange}`, { service: "ExchangeAdapter" });
  }

  setMode(mode) { 
    this.mode = mode; 
    db.updateConfig({ mode });
    logger.info(`Mode changed to ${mode}`, { service: "ExchangeAdapter" });
  }

  resetPaperBalance(initialBalance = { USDT: 20000, BTC: 0, ETH: 0, BNB: 0, SOL: 0, XRP: 0 }) {
    this.paperBalance = { ...initialBalance };
    logger.info("Paper balance reset", { service: "ExchangeAdapter", balance: this.paperBalance });
  }

  getTradeHistory(limit = 50) {
    return this.tradeHistory.slice(0, limit);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ExchangeAdapterService();
