const marketCondition = require("./MarketConditionService");
const logger = require("./LoggerService");

class SentimentService {
  constructor() {
    this.fearGreedIndex = 62;
    this.sentiment = "GREED";
    this._updateInterval = null;
    logger.info("SentimentService initialized", { service: "Sentiment" });
  }

  start() {
    this._updateInterval = setInterval(() => {
      this.fearGreedIndex = Math.min(95, Math.max(5, this.fearGreedIndex + (Math.random() - 0.5) * 4));
      this.fearGreedIndex = Math.round(this.fearGreedIndex);
      this.sentiment = this.fearGreedIndex >= 75 ? "EXTREME_GREED" : this.fearGreedIndex >= 55 ? "GREED" : this.fearGreedIndex >= 45 ? "NEUTRAL" : this.fearGreedIndex >= 25 ? "FEAR" : "EXTREME_FEAR";
    }, 60000);
  }

  stop() { if (this._updateInterval) clearInterval(this._updateInterval); }

  getSentiment() {
    const marketSentiment = marketCondition.getMarketSentiment();
    return {
      fearGreedIndex: this.fearGreedIndex,
      fearGreedLabel: this.sentiment,
      marketSentiment: marketSentiment.sentiment,
      marketScore: marketSentiment.score,
      positionSizingMultiplier: this.fearGreedIndex > 75 ? 0.8 : this.fearGreedIndex < 25 ? 1.2 : 1.0,
    };
  }
}

module.exports = new SentimentService();
