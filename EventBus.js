const { EventEmitter } = require("events");

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._history = [];
    this._MAX_HISTORY = 100;
  }

  emit(event, data) {
    const entry = { event, data, timestamp: new Date().toISOString() };
    this._history.unshift(entry);
    if (this._history.length > this._MAX_HISTORY) this._history.length = this._MAX_HISTORY;
    return super.emit(event, data);
  }

  getHistory(event, limit = 20) {
    const filtered = event ? this._history.filter(e => e.event === event) : this._history;
    return filtered.slice(0, limit);
  }
}

module.exports = new EventBus();
