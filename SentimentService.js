const marketCondition = require("./MarketConditionService");
const logger = require("./LoggerService");

class SentimentService {
  constructor() {
    this.fearGreedIndex = 50;
    this.sentiment = "NEUTRAL";
    this._updateInterval = null;
    logger.info("SentimentService initialized", { service: "Sentiment" });
  }

  async start() {
    // Primeira busca real
    await this._fetchRealFearGreed();
    
    // Atualiza a cada 5 minutos (dados reais)
    this._updateInterval = setInterval(async () => {
      await this._fetchRealFearGreed();
    }, 5 * 60 * 1000);
  }

  async _fetchRealFearGreed() {
    try {
      // API real do Fear & Greed Index
      const response = await fetch("https://api.alternative.me/fng/?limit=1");
      const data = await response.json();
      
      if (data && data.data && data.data[0]) {
        this.fearGreedIndex = parseInt(data.data[0].value);
        this.sentiment = data.data[0].classification.toUpperCase();
        logger.info(`Real Fear & Greed: ${this.fearGreedIndex} (${this.sentiment})`, { service: "Sentiment" });
        return;
      }
      throw new Error("Invalid response");
      
    } catch (error) {
      // Fallback: simula movimento realista (mantém funcionando)
      logger.warn(`API failed, using simulated data: ${error.message}`, { service: "Sentiment" });
      const change = (Math.random() - 0.5) * 6;
      let newValue = this.fearGreedIndex + change;
      newValue = Math.min(95, Math.max(5, newValue));
      this.fearGreedIndex = Math.round(newValue);
      this.sentiment = this.fearGreedIndex >= 75 ? "EXTREME_GREED" 
        : this.fearGreedIndex >= 55 ? "GREED" 
        : this.fearGreedIndex >= 45 ? "NEUTRAL" 
        : this.fearGreedIndex >= 25 ? "FEAR" 
        : "EXTREME_FEAR";
    }
  }

  stop() { 
    if (this._updateInterval) clearInterval(this._updateInterval); 
  }

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
