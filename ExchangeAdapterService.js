
const logger = require("./LoggerService");
const eventBus = require("./EventBus");
const db = require("./DatabaseService");

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
  BTCUSDT: 0.45,   // 45% ao ano
  ETHUSDT: 0.55,   // 55% ao ano
  BNBUSDT: 0.50,
  SOLUSDT: 0.70,
  XRPUSDT: 0.60,
};

// Correlação entre pares (BTC é referência)
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
    this.paperBalance = { USDT: 20000, BTC: 0, ETH: 0, BNB: 0, SOL: 0, XRP: 0 };
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
    
    // Inicia a simulação realista
    this._startRealisticSimulation();
    
    logger.info("ExchangeAdapterService initialized", { 
      service: "ExchangeAdapter", 
      exchange: this.exchange, 
      mode: this.mode,
      status: "SIMULAÇÃO REALISTA ATIVADA"
    });
  }

  /**
   * Gera movimento de preço realista usando distribuição log-normal
   * com correlação entre pares e diferentes volatilidades por horário
   */
  _startRealisticSimulation() {
    setInterval(() => {
      const now = new Date();
      const hour = now.getUTCHours();
      
      // Fator de volatilidade por horário (mercados abertos = maior volatilidade)
      let timeFactor = 0.5; // fora de horário comercial
      
      // NY Session (13h-22h UTC)
      if (hour >= 13 && hour <= 22) timeFactor = 1.5;
      // London Session (8h-17h UTC)
      else if (hour >= 8 && hour <= 17) timeFactor = 1.2;
      // Asia Session (0h-8h UTC)
      else if (hour >= 0 && hour <= 8) timeFactor = 0.8;
      
      // Gera um movimento de mercado "master" (tendência geral)
      const marketTrend = (Math.random() - 0.5) * 0.0003 * timeFactor;
      
      for (const [symbol, data] of Object.entries(this.prices)) {
        const vol = VOLATILITY[symbol] || 0.5;
        const correlation = CORRELATION[symbol] || 0.5;
        
        // Movimento = tendência de mercado + ruído específico do par
        const specificNoise = (Math.random() - 0.5) * 0.0004 * timeFactor * (1 - correlation);
        const deltaPercent = (marketTrend * correlation) + specificNoise;
        
        // Aplica volatilidade anual
        const dailyVol = vol / Math.sqrt(365); // volatilidade diária
        const finalDelta = deltaPercent * dailyVol * timeFactor;
        
        let newPrice = data.price * (1 + finalDelta);
        
        // Garante preço mínimo e máximo realista
        if (symbol === 'BTCUSDT') newPrice = Math.max(30000, Math.min(150000, newPrice));
        if (symbol === 'ETHUSDT') newPrice = Math.max(1500, Math.min(8000, newPrice));
        if (symbol === 'BNBUSDT') newPrice = Math.max(200, Math.min(1200, newPrice));
        if (symbol === 'SOLUSDT') newPrice = Math.max(20, Math.min(500, newPrice));
        if (symbol === 'XRPUSDT') newPrice = Math.max(0.3, Math.min(3, newPrice));
        
        // Atualiza preço
        data.price = newPrice;
        data.bid = newPrice * 0.999;
        data.ask = newPrice * 1.001;
        
        // Atualiza high/low
        if (newPrice > data.high24h) data.high24h = newPrice;
        if (newPrice < data.low24h) data.low24h = newPrice;
        
        // Calcula change24h
        const price24hAgo = data.price24hAgo || newPrice;
        data.change24h = ((newPrice - price24hAgo) / price24hAgo) * 100;
        
        // Atualiza volume simulado (mais volume em horários ativos)
        data.volume24h = Math.floor(Math.random() * 50000000 * timeFactor) + 10000000;
        
        // Salva preço de 24h atrás (a cada 24 horas)
        if (!data.lastReset || Date.now() - data.lastReset > 86400000) {
          data.price24hAgo = newPrice;
          data.lastReset = Date.now();
        }
      }
      
      eventBus.emit("tick", this.prices);
      
    }, 2000); // atualiza a cada 2 segundos
  }

  // ==================== MÉTODOS PRINCIPAIS ====================

  async getPrice(symbol) {
    const ticker = this.prices[symbol];
    if (ticker && ticker.price) {
      return ticker.price;
    }
    logger.warn(`Símbolo ${symbol} não encontrado, usando fallback`);
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

  /**
   * 🔥 GERA OPORTUNIDADE DE ARBITRAGEM SIMULADA REALISTA
   * Baseada na volatilidade atual do mercado
   */
  async getArbitrageOpportunity(symbol = "BTCUSDT") {
    try {
      const realPrice = await this.getPrice(symbol);
      
      if (!realPrice) return null;
      
      // Pega volatilidade atual (baseada no movimento recente)
      const ticker = this.prices[symbol];
      const volatility = Math.abs(ticker.change24h) / 100;
      
      // Spread máximo possível (maior em momentos voláteis)
      const maxSpread = Math.min(2.0, volatility * 0.5 + 0.3);
      
      // Gera spread baseado na volatilidade real
      const simulatedSpread = Math.random() * maxSpread;
      
      // Simula preço da segunda exchange
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
        volatility: parseFloat(volatility.toFixed(4)),
        marketCondition: ticker.change24h > 0 ? "BULLISH" : ticker.change24h < 0 ? "BEARISH" : "NEUTRAL",
        timestamp: Date.now()
      };

      if (simulatedSpread > 0.5) {
        logger.info(`🎯 [SIMULAÇÃO REALISTA] ${symbol} | Spread: ${simulatedSpread}% | Comprar em ${buyExchange} | Vender em ${sellExchange} | Vol: ${volatility}%`);
      }

      return result;
    } catch (error) {
      logger.error(`Erro na análise de arbitragem: ${error.message}`);
      return null;
    }
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
    logger.info(`Exchange changed to ${exchange}`);
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
