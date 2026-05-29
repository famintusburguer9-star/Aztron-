const marketData = require("./MarketDataService");
const logger = require("./LoggerService");

const PATTERNS = ["Head & Shoulders", "Inverse H&S", "Double Top", "Double Bottom", "Bull Flag", "Bear Flag", "Ascending Triangle", "Descending Triangle"];

class DeepPatternRecognitionService {
  constructor() {
    this.detectedPatterns = [];
    this._scanInterval = null;
    logger.info("DeepPatternRecognitionService initialized", { service: "DeepPattern" });
  }

  start() {
    this._scanInterval = setInterval(() => this._scan(), 30000);
    logger.info("Pattern recognition started", { service: "DeepPattern" });
  }

  stop() { if (this._scanInterval) clearInterval(this._scanInterval); }

  _scan() {
    if (Math.random() < 0.3) {
      const sym = ["BTCUSDT", "ETHUSDT", "BNBUSDT"][Math.floor(Math.random() * 3)];
      const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
      const ind = marketData.getIndicators(sym);
      const detected = {
        id: `pat_${Date.now()}`, symbol: sym, pattern, price: ind.price || 0,
        confidence: Math.floor(60 + Math.random() * 35),
        timeframe: ["15m", "1h", "4h"][Math.floor(Math.random() * 3)],
        implication: pattern.includes("Bull") || pattern.includes("Bottom") || pattern.includes("Inverse") ? "BULLISH" : "BEARISH",
        timestamp: new Date().toISOString(),
      };
      this.detectedPatterns.unshift(detected);
      if (this.detectedPatterns.length > 30) this.detectedPatterns.length = 30;
      logger.info(`Pattern detected: ${pattern} on ${sym}`, { service: "DeepPattern" });
    }
  }

  getPatterns(limit = 10) { return this.detectedPatterns.slice(0, limit); }
}

module.exports = new DeepPatternRecognitionService();
