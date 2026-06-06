const exchange = require("./ExchangeAdapterService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class MarketMultiplexerService {
  constructor() {
    this.subscribers = new Map();
    this.symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
    this.subscriptionHistory = [];
    this.stats = {
      totalSubscriptions: 0,
      totalUnsubscriptions: 0,
      eventsBroadcast: 0,
      lastBroadcast: null,
      errorsCount: 0
    };
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA LEARNING BRAIN
    this.agentId = "market_mux";
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      maxSubscribersPerSymbol: 100,
      broadcastThrottleMs: 100,
      enableMetrics: true,
      logLevel: "info"
    };
    
    // 🆕 FILA DE BROADCAST PARA THROTTLE
    this._broadcastQueue = new Map();
    this._broadcastInterval = null;
    
    eventBus.on("tick", prices => this._queueBroadcast(prices));
    logger.info("MarketMultiplexerService initialized", { service: "MarketMux" });
  }

  // 🆕 FILA PARA EVITAR SOBRECARGA
  _queueBroadcast(prices) {
    for (const [sym, data] of Object.entries(prices)) {
      if (!this._broadcastQueue.has(sym)) {
        this._broadcastQueue.set(sym, { data, timestamp: Date.now() });
      } else {
        const queued = this._broadcastQueue.get(sym);
        queued.data = data;
        queued.timestamp = Date.now();
      }
    }
    
    if (!this._broadcastInterval) {
      this._broadcastInterval = setInterval(() => this._processQueue(), this.config.broadcastThrottleMs);
    }
  }

  _processQueue() {
    const now = Date.now();
    
    for (const [sym, queued] of this._broadcastQueue.entries()) {
      // Só processa se não for muito antigo
      if (now - queued.timestamp < this.config.broadcastThrottleMs * 2) {
        this._broadcast({ [sym]: queued.data });
      }
    }
    
    this._broadcastQueue.clear();
  }

  _broadcast(prices) {
    for (const [sym, handlers] of this.subscribers.entries()) {
      if (prices[sym]) {
        const data = prices[sym];
        
        handlers.forEach(fn => { 
          try { 
            fn(data);
            this.stats.eventsBroadcast++;
          } catch (err) { 
            logger.error(`Erro no handler do subscriber para ${sym}: ${err.message}`, { service: "MarketMux" });
            this.stats.errorsCount++;
          } 
        });
      }
    }
    this.stats.lastBroadcast = new Date().toISOString();
  }

  // 🆕 ASSINA COM VALIDAÇÃO
  subscribe(symbol, handler, clientId = "unknown") {
    if (!this.symbols.includes(symbol)) {
      logger.warn(`Tentativa de assinar símbolo não monitorado: ${symbol}`, { service: "MarketMux" });
      return { success: false, reason: "Symbol not monitored" };
    }
    
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, []);
    }
    
    const currentSubscribers = this.subscribers.get(symbol).length;
    if (currentSubscribers >= this.config.maxSubscribersPerSymbol) {
      logger.warn(`Limite de assinantes atingido para ${symbol} (${currentSubscribers}/${this.config.maxSubscribersPerSymbol})`, { service: "MarketMux" });
      return { success: false, reason: "Max subscribers reached" };
    }
    
    this.subscribers.get(symbol).push(handler);
    this.stats.totalSubscriptions++;
    
    // Registra histórico
    this.subscriptionHistory.unshift({
      type: "subscribe",
      symbol,
      clientId,
      timestamp: new Date().toISOString(),
      totalSubscribers: this.subscribers.get(symbol).length
    });
    
    if (this.subscriptionHistory.length > 500) this.subscriptionHistory = this.subscriptionHistory.slice(0, 500);
    
    // 🆕 COMPARTILHA COM LEARNING BRAIN
    if (this.config.enableMetrics) {
      eventBus.emit(`learning:${this.agentId}`, {
        type: "subscription_event",
        content: `Novo assinante para ${symbol}. Total: ${this.subscribers.get(symbol).length}`,
        confidence: 0.9,
        data: { symbol, totalSubscribers: this.subscribers.get(symbol).length }
      });
    }
    
    logger.info(`📡 Novo assinante para ${symbol} (total: ${this.subscribers.get(symbol).length})`, { service: "MarketMux" });
    
    return { success: true, symbol, totalSubscribers: this.subscribers.get(symbol).length };
  }

  // 🆕 DESASSINA
  unsubscribe(symbol, handler, clientId = "unknown") {
    if (!this.subscribers.has(symbol)) {
      return { success: false, reason: "Symbol not subscribed" };
    }
    
    const handlers = this.subscribers.get(symbol);
    const index = handlers.indexOf(handler);
    
    if (index !== -1) {
      handlers.splice(index, 1);
      this.stats.totalUnsubscriptions++;
      
      this.subscriptionHistory.unshift({
        type: "unsubscribe",
        symbol,
        clientId,
        timestamp: new Date().toISOString(),
        remainingSubscribers: handlers.length
      });
      
      if (handlers.length === 0) {
        this.subscribers.delete(symbol);
      }
      
      logger.info(`📡 Assinante removido de ${symbol} (restam: ${handlers.length})`, { service: "MarketMux" });
      
      return { success: true, symbol, remainingSubscribers: handlers.length };
    }
    
    return { success: false, reason: "Handler not found" };
  }

  // 🆕 OBTÉM ASSINANTES POR SÍMBOLO
  getSubscribers(symbol) {
    if (symbol) {
      return {
        symbol,
        count: this.subscribers.get(symbol)?.length || 0
      };
    }
    
    const result = {};
    for (const [sym, handlers] of this.subscribers.entries()) {
      result[sym] = handlers.length;
    }
    return result;
  }

  // 🆕 OBTÉM HISTÓRICO DE ASSINATURAS
  getSubscriptionHistory(limit = 50) {
    return this.subscriptionHistory.slice(0, limit);
  }

  getStatus() {
    const totalSubscribers = [...this.subscribers.values()].reduce((a, v) => a + v.length, 0);
    
    return {
      running: this.isRunning,
      activeSymbols: this.symbols,
      subscriberCount: totalSubscribers,
      subscribersBySymbol: this.getSubscribers(),
      lastBroadcast: this.stats.lastBroadcast,
      wsConnected: exchange.isConnected(),
      stats: {
        totalSubscriptions: this.stats.totalSubscriptions,
        totalUnsubscriptions: this.stats.totalUnsubscriptions,
        eventsBroadcast: this.stats.eventsBroadcast,
        errorsCount: this.stats.errorsCount
      },
      config: this.config,
      queueSize: this._broadcastQueue.size
    };
  }
  
  // 🆕 OBTÉM ESTATÍSTICAS
  getStats() {
    return {
      ...this.stats,
      activeSubscribers: [...this.subscribers.values()].reduce((a, v) => a + v.length, 0),
      uniqueSymbolsWithSubscribers: this.subscribers.size,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }
  
  // 🆕 LIMPA HISTÓRICO
  clearHistory() {
    this.subscriptionHistory = [];
    this.stats = {
      totalSubscriptions: 0,
      totalUnsubscriptions: 0,
      eventsBroadcast: 0,
      lastBroadcast: null,
      errorsCount: 0
    };
    logger.info("MarketMultiplexerService history cleared", { service: "MarketMux" });
    return { success: true };
  }
  
  // 🆕 ATUALIZA CONFIGURAÇÃO
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Ajusta throttle se necessário
    if (newConfig.broadcastThrottleMs && this._broadcastInterval) {
      clearInterval(this._broadcastInterval);
      this._broadcastInterval = setInterval(() => this._processQueue(), this.config.broadcastThrottleMs);
    }
    
    logger.info("MarketMultiplexerService config updated", { service: "MarketMux", config: this.config });
    return { success: true, config: this.config };
  }
  
  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    this.isRunning = true;
    this.startTime = Date.now();
    logger.info("MarketMultiplexerService started", { service: "MarketMux" });
    return { success: true };
  }
  
  stop() {
    this.isRunning = false;
    if (this._broadcastInterval) {
      clearInterval(this._broadcastInterval);
      this._broadcastInterval = null;
    }
    logger.info("MarketMultiplexerService stopped", { service: "MarketMux" });
    return { success: true };
  }
}

module.exports = new MarketMultiplexerService();
