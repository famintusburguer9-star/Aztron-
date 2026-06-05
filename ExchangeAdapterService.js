const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");

// 🔥 URL CORRETA DA BYBIT TESTNET
const BYBIT_API_URL = "https://api-testnet.bybit.com";

// 🔥 SUAS CHAVES DA BYBIT TESTNET
const BYBIT_API_KEY = "hBicpcF6fsEo7FS1xJ";
const BYBIT_API_SECRET = "dmAOkQFYlhm3JngDlKgahjWxOif4Nv8HIKYy";

// Preços de fallback (caso API falhe)
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
    
    // Cache para preços
    this.cachedPrices = {
      bybit: {}
    };
    
    this._simulatePrices();
    
    logger.info("ExchangeAdapterService initialized", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      bybitUrl: BYBIT_API_URL,
      status: "Usando BYBIT TESTNET com chave"
    });
  }

  // Simulação de preços para fallback (quando API falha)
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

  // ==================== 🔥 BYBIT TESTNET COM CHAVE ====================

  /**
   * Gera a assinatura para a requisição da Bybit
   */
  _generateSignature(params, secret) {
    const crypto = require('crypto');
    const queryString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
  }

  /**
   * Busca preço REAL da Bybit TESTNET (com chave)
   * @param {string} symbol - Ex: "BTCUSDT"
   * @returns {Promise<number>}
   */
  async getBybitPrice(symbol) {
    try {
      // Verifica cache (5 segundos)
      const cached = this.cachedPrices.bybit[symbol];
      if (cached && (Date.now() - cached.timestamp) < 5000) {
        return cached.price;
      }
      
      // 🔥 URL da TESTNET
      const url = `${BYBIT_API_URL}/v5/market/tickers?category=spot&symbol=${symbol}`;
      
      const timestamp = Date.now().toString();
      const params = {
        api_key: BYBIT_API_KEY,
        timestamp: timestamp,
        recv_window: 5000
      };
      
      const signature = this._generateSignature(params, BYBIT_API_SECRET);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: {
          'X-BAPI-API-KEY': BYBIT_API_KEY,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-SIGN': signature,
          'X-BAPI-RECV-WINDOW': '5000'
        }
      });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.result && data.result.list && data.result.list[0]) {
        const price = parseFloat(data.result.list[0].lastPrice);
        
        // Atualiza cache
        this.cachedPrices.bybit[symbol] = { price, timestamp: Date.now() };
        
        logger.info(`✅ Bybit TESTNET: ${symbol} = $${price}`);
        return price;
      }
      
      throw new Error(`Preço não encontrado para ${symbol}`);
    } catch (error) {
      logger.error(`Erro ao buscar preço na Bybit TESTNET: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca volatilidade REAL da Bybit TESTNET
   * @param {string} symbol 
   * @returns {Promise<number>}
   */
  async getBybitVolatility(symbol) {
    try {
      const url = `${BYBIT_API_URL}/v5/market/tickers?category=spot&symbol=${symbol}`;
      const timestamp = Date.now().toString();
      const params = {
        api_key: BYBIT_API_KEY,
        timestamp: timestamp,
        recv_window: 5000
      };
      const signature = this._generateSignature(params, BYBIT_API_SECRET);
      
      const response = await fetch(url, {
        headers: {
          'X-BAPI-API-KEY': BYBIT_API_KEY,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-SIGN': signature,
          'X-BAPI-RECV-WINDOW': '5000'
        }
      });
      const data = await response.json();
      
      if (data && data.result && data.result.list && data.result.list[0]) {
        const change24h = parseFloat(data.result.list[0].change24h) || 0;
        return Math.abs(change24h);
      }
      return 1.0;
    } catch (error) {
      logger.error(`Erro ao buscar volatilidade: ${error.message}`);
      return 1.0;
    }
  }

  /**
   * 🔥 GERA OPORTUNIDADE SIMULADA PARA TESTE
   * (baseada na volatilidade real da Bybit)
   */
  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    try {
      const realPrice = await this.getBybitPrice(symbol);
      
      if (!realPrice) {
        return null;
      }
      
      // Pega volatilidade real para simular spread
      const volatility = await this.getBybitVolatility(symbol);
      
      // Gera spread simulado baseado na volatilidade real (0.1% a 2%)
      const simulatedSpread = Math.min(2.0, Math.max(0.1, volatility * 0.3 + Math.random() * 0.5));
      
      // Determina direção aleatória (mas realista)
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

      const result = {
        symbol,
        binancePrice,
        bybitPrice,
        spread: parseFloat(simulatedSpread.toFixed(4)),
        buyExchange,
        sellExchange,
        isRealData: false,
        isSimulated: true,
        baseRealPrice: realPrice,
        volatility: volatility,
        timestamp: Date.now()
      };

      if (simulatedSpread > 0.5) {
        logger.info(`🎯 SIMULAÇÃO ARBITRAGEM: ${symbol} | Spread: ${simulatedSpread}% | Comprar em ${buyExchange} | Vender em ${sellExchange} | Base real: $${realPrice}`);
      }

      return result;
    } catch (error) {
      logger.error(`Erro na análise de arbitragem: ${error.message}`);
      return null;
    }
  }

  // ==================== MÉTODOS PRINCIPAIS ====================

  async getPrice(symbol) {
    try {
      // Prioriza preço real da Bybit TESTNET
      const realPrice = await this.getBybitPrice(symbol);
      if (realPrice) return realPrice;
      
      // Fallback para simulação
      const ticker = this.prices[symbol];
      if (ticker && ticker.price) {
        return ticker.price;
      }
      
      logger.warn(`Símbolo ${symbol} não encontrado, usando fallback`);
      return symbol === "BTCUSDT" ? 65000 : 3200;
    } catch (error) {
      logger.error(`Erro ao buscar preço de ${symbol}:`, error);
      return 0;
    }
  }

  getTicker(symbol) { 
    return this.prices[symbol] || null; 
  }
  
  getAllTickers() { 
    return this.prices; 
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
      
      logger.info(`Paper trade executed: ${side} ${qty.toFixed(6)} ${symbol} @ $${execPrice.toFixed(2)} | Total: $${cost.toFixed(2)}`);
      
      eventBus.emit("exchange:order", order);
      return order;
    }
    
    throw new Error("Live trading not implemented — configure API keys and set mode to LIVE");
  }

  getBalance() { 
    return { ...this.paperBalance }; 
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
