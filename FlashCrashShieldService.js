const exchange = require("./ExchangeAdapterService");
const risk = require("./RiskManagementService");
const db = require("./DatabaseService");
const eventBus = require("./EventBus");
const logger = require("./LoggerService");

class FlashCrashShieldService {
  constructor() {
    this.active = true;
    this.events = [];
    this._priceHistory = {};
    this._monitoring = false;
    this.agentId = "flashcrash";
    
    // 🆕 CONFIGURAÇÕES AJUSTÁVEIS
    this.config = {
      threshold1s: 2.0,
      threshold5s: 3.0,
      threshold15s: 5.0,
      pauseDuration: 300000, // 5 minutos
      recoveryCheckInterval: 60000, // 1 minuto
      minRecoveryTime: 120000 // 2 minutos antes de tentar recuperar
    };
    
    // 🆕 ESTATÍSTICAS
    this.stats = {
      totalEvents: 0,
      uniqueSymbolsPaused: [],
      lastEvent: null,
      recoveryAttempts: 0,
      successfulRecoveries: 0
    };
    
    // 🆕 SÍMBOLOS EM RECUPERAÇÃO
    this._recoveringSymbols = new Map(); // symbol -> timestamp de quando pode recuperar
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    eventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("FlashCrashShieldService initialized", { service: "FlashCrashShield" });
  }

  // 🆕 APLICA MELHORIAS
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 FlashCrashShield recebeu melhoria: ${improvement.recommendation}`, { service: "FlashCrashShield" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.config.threshold1s = Math.max(0.5, this.config.threshold1s - 0.3);
        this.config.threshold5s = Math.max(1.0, this.config.threshold5s - 0.5);
        this.config.threshold15s = Math.max(2.0, this.config.threshold15s - 1.0);
        logger.info(`⚡ FlashCrashShield aumentou sensibilidade: 1s=${this.config.threshold1s}%, 5s=${this.config.threshold5s}%, 15s=${this.config.threshold15s}%`, { service: "FlashCrashShield" });
        break;
        
      case "REDUZIR_RISCO":
        this.config.threshold1s = Math.min(5.0, this.config.threshold1s + 0.5);
        this.config.threshold5s = Math.min(8.0, this.config.threshold5s + 1.0);
        this.config.threshold15s = Math.min(12.0, this.config.threshold15s + 2.0);
        logger.info(`📉 FlashCrashShield reduziu sensibilidade: 1s=${this.config.threshold1s}%, 5s=${this.config.threshold5s}%, 15s=${this.config.threshold15s}%`, { service: "FlashCrashShield" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        this.active = true;
        logger.info(`⚠️ FlashCrashShield ativado por alerta de mercado`, { service: "FlashCrashShield" });
        break;
    }
  }

  start() {
    if (this._monitoring) return;
    this._monitoring = true;
    this._intervalId = setInterval(() => this._check(), 1000);
    
    // 🆕 VERIFICA RECUPERAÇÃO A CADA MINUTO
    this._recoveryIntervalId = setInterval(() => this._checkRecovery(), this.config.recoveryCheckInterval);
    
    logger.info("Flash Crash Shield monitoring started", { service: "FlashCrashShield" });
  }

  stop() {
    this._monitoring = false;
    if (this._intervalId) clearInterval(this._intervalId);
    if (this._recoveryIntervalId) clearInterval(this._recoveryIntervalId);
    logger.info("Flash Crash Shield monitoring stopped", { service: "FlashCrashShield" });
  }

  _check() {
    if (!this.active) return;
    
    const cfg = db.getConfig();
    const tickers = exchange.getAllTickers();
    const now = Date.now();

    for (const [sym, ticker] of Object.entries(tickers)) {
      if (!ticker || !ticker.price) continue;
      
      // Inicializa histórico
      if (!this._priceHistory[sym]) this._priceHistory[sym] = [];
      
      this._priceHistory[sym].push({ price: ticker.price, ts: now });
      
      // Mantém apenas últimos 60 segundos
      this._priceHistory[sym] = this._priceHistory[sym].filter(p => now - p.ts < 60000);

      // Busca preços em diferentes janelas
      const oldest1s = this._getPriceAtTime(sym, now - 1000);
      const oldest5s = this._getPriceAtTime(sym, now - 5000);
      const oldest15s = this._getPriceAtTime(sym, now - 15000);

      const check = (refPrice, thresholdPct, window, refTime) => {
        if (!refPrice || refPrice === 0) return;
        const drop = ((refPrice - ticker.price) / refPrice) * 100;
        if (drop >= thresholdPct) {
          this._handleFlashCrash(sym, drop, window, refPrice, ticker.price);
        }
      };
      
      check(oldest1s, this.config.threshold1s, "1", now - 1000);
      check(oldest5s, this.config.threshold5s, "5", now - 5000);
      check(oldest15s, this.config.threshold15s, "15", now - 15000);
    }
  }

  _getPriceAtTime(symbol, targetTime) {
    const history = this._priceHistory[symbol];
    if (!history || history.length === 0) return null;
    
    // Encontra o preço mais próximo do tempo alvo
    let closest = null;
    let minDiff = Infinity;
    
    for (const entry of history) {
      const diff = Math.abs(entry.ts - targetTime);
      if (diff < minDiff && diff < 500) { // tolerância de 500ms
        minDiff = diff;
        closest = entry.price;
      }
    }
    
    return closest;
  }

  _handleFlashCrash(symbol, dropPercent, windowSec, startPrice, endPrice) {
    // Evita eventos duplicados no mesmo símbolo
    const lastEvent = this.events[0];
    if (lastEvent && lastEvent.pair === symbol && (Date.now() - new Date(lastEvent.timestamp).getTime()) < 5000) {
      return;
    }
    
    const event = {
      id: `fc_${Date.now()}`,
      pair: symbol,
      triggerType: `${windowSec}s drop`,
      priceChange: -Math.round(dropPercent * 10) / 10,
      startPrice: Math.round(startPrice * 100) / 100,
      endPrice: Math.round(endPrice * 100) / 100,
      action: "Paused positions",
      timestamp: new Date().toISOString()
    };
    
    this.events.unshift(event);
    if (this.events.length > 100) this.events.pop();
    
    // Atualiza estatísticas
    this.stats.totalEvents++;
    this.stats.lastEvent = event;
    if (!this.stats.uniqueSymbolsPaused.includes(symbol)) {
      this.stats.uniqueSymbolsPaused.push(symbol);
    }
    
    // Pausa o símbolo
    const pauseDuration = this.config.pauseDuration;
    risk.pauseSymbol(symbol, pauseDuration);
    
    // Marca para recuperação após o tempo de pausa
    this._recoveringSymbols.set(symbol, Date.now() + pauseDuration);
    
    // Alerta no banco
    db.addAlert({
      id: `al_fc_${Date.now()}`,
      severity: "critical",
      message: `Flash Crash Shield: ${symbol} dropped ${dropPercent.toFixed(2)}% in ${windowSec}s. Positions paused for ${pauseDuration/1000}s.`,
      timestamp: new Date().toISOString(),
      read: false
    });
    
    // Emite eventos
    eventBus.emit("alert", { severity: "critical", message: `Flash Crash Shield triggered: ${symbol} dropped ${dropPercent.toFixed(2)}%` });
    eventBus.emit("flashcrash:triggered", event);
    
    // 🆕 COMPARTILHA COM LEARNING BRAIN
    eventBus.emit(`learning:${this.agentId}`, {
      type: "flash_crash",
      content: `${symbol} caiu ${dropPercent.toFixed(1)}% em ${windowSec}s`,
      confidence: 0.9,
      priority: "high",
      data: event
    });
    
    logger.warn(`🚨 FLASH CRASH em ${symbol}: ${dropPercent.toFixed(2)}% em ${windowSec}s ($${startPrice.toFixed(2)} → $${endPrice.toFixed(2)})`, { service: "FlashCrashShield" });
  }

  // 🆕 VERIFICA RECUPERAÇÃO DE SÍMBOLOS PAUSADOS
  _checkRecovery() {
    const now = Date.now();
    const recovered = [];
    
    for (const [symbol, recoverTime] of this._recoveringSymbols.entries()) {
      if (now >= recoverTime) {
        // Verifica se o preço se estabilizou
        const history = this._priceHistory[symbol];
        if (history && history.length > 10) {
          const recentPrices = history.slice(-10).map(p => p.price);
          const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
          const volatility = this._calculateVolatility(recentPrices);
          
          // Se volatilidade normalizou, permite recuperação
          if (volatility < 1.5) {
            this._recoveringSymbols.delete(symbol);
            recovered.push(symbol);
            this.stats.successfulRecoveries++;
            
            logger.info(`✅ Símbolo ${symbol} recuperado após flash crash`, { service: "FlashCrashShield" });
            
            eventBus.emit("flashcrash:recovered", {
              symbol,
              timestamp: new Date().toISOString(),
              volatility: volatility
            });
          } else {
            // Ainda volátil, estende pausa
            this._recoveringSymbols.set(symbol, now + 60000);
            logger.debug(`⏳ ${symbol} ainda volátil (${volatility.toFixed(1)}%), estendendo pausa`, { service: "FlashCrashShield" });
          }
        }
      }
    }
    
    if (recovered.length > 0) {
      this.stats.recoveryAttempts++;
    }
  }

  _calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }

  // 🆕 OBTÉM STATUS COMPLETO
  getStatus() {
    const pausedSymbols = risk.getPausedSymbols();
    const recoveringSymbols = Array.from(this._recoveringSymbols.keys());
    
    return {
      active: this.active,
      monitoring: this._monitoring,
      pausedSymbols: pausedSymbols,
      recoveringSymbols: recoveringSymbols,
      events: this.events.slice(0, 10),
      config: {
        threshold1s: this.config.threshold1s,
        threshold5s: this.config.threshold5s,
        threshold15s: this.config.threshold15s,
        pauseDuration: this.config.pauseDuration
      },
      stats: {
        totalEvents: this.stats.totalEvents,
        uniqueSymbolsPaused: this.stats.uniqueSymbolsPaused.length,
        lastEvent: this.stats.lastEvent,
        recoveryAttempts: this.stats.recoveryAttempts,
        successfulRecoveries: this.stats.successfulRecoveries
      }
    };
  }

  setActive(active) { 
    this.active = active;
    logger.info(`Flash Crash Shield ${active ? "ativado" : "desativado"}`, { service: "FlashCrashShield" });
  }
  
  updateConfig(patch) { 
    Object.assign(this.config, patch);
    db.updateConfig(patch);
    logger.info("FlashCrashShield config atualizada", { service: "FlashCrashShield", config: this.config });
  }
  
  getEvents() { 
    return this.events; 
  }
  
  // 🆕 RESETA ESTATÍSTICAS
  resetStats() {
    this.stats = {
      totalEvents: 0,
      uniqueSymbolsPaused: [],
      lastEvent: null,
      recoveryAttempts: 0,
      successfulRecoveries: 0
    };
    logger.info("FlashCrashShield stats reset", { service: "FlashCrashShield" });
    return { success: true };
  }
}

module.exports = new FlashCrashShieldService();
