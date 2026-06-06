const { EventEmitter } = require("events");
const logger = require("./LoggerService");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this._history = [];
    this._MAX_HISTORY = 200;
    this._listeners = new Map();
    this._debugEvents = new Set(["learning:", "signal", "trade", "improvement:", "agent:profit"]);
  }

  emit(event, data) {
    const entry = { event, data, timestamp: new Date().toISOString() };
    this._history.unshift(entry);
    if (this._history.length > this._MAX_HISTORY) this._history.length = this._MAX_HISTORY;
    
    // Log para eventos importantes
    for (const debugEvent of this._debugEvents) {
      if (event.includes(debugEvent) || debugEvent.includes(event)) {
        logger.debug(`📡 ${event}`, { service: "EventBus" });
        break;
      }
    }
    
    return super.emit(event, data);
  }

  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(listener);
    return super.on(event, listener);
  }

  off(event, listener) {
    if (this._listeners.has(event)) {
      const listeners = this._listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }
    return super.off(event, listener);
  }

  getStats() {
    const eventsByType = {};
    for (const entry of this._history) {
      eventsByType[entry.event] = (eventsByType[entry.event] || 0) + 1;
    }
    
    const listenerCounts = {};
    for (const [event, listeners] of this._listeners.entries()) {
      listenerCounts[event] = listeners.length;
    }
    
    return {
      totalEvents: this._history.length,
      eventTypes: Object.keys(eventsByType).length,
      topEvents: Object.entries(eventsByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([event, count]) => ({ event, count })),
      listenerCount: this.listenerCount(),
      listenersByEvent: Object.entries(listenerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([event, count]) => ({ event, count })),
      maxListeners: this.getMaxListeners()
    };
  }

  clearHistory() {
    const cleared = this._history.length;
    this._history = [];
    logger.info(`EventBus history cleared (${cleared} events)`, { service: "EventBus" });
    return { success: true, cleared };
  }

  getHistory(event, limit = 20) {
    const filtered = event ? this._history.filter(e => e.event === event) : this._history;
    return filtered.slice(0, limit);
  }
  
  // 🔥 PARA DEBUG
  getLastEvent() {
    return this._history[0] || null;
  }
}

module.exports = new EventBus();
