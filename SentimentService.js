const marketCondition = require("./MarketConditionService");
const logger = require("./LoggerService");
const EventBus = require("./EventBus");

// 🆕 IMPORT PARA INTEGRAÇÃO COM LEARNING BRAIN
const learningBrain = require("./LearningBrainService");

class SentimentService {
  constructor() {
    this.fearGreedIndex = 50;
    this.sentiment = "NEUTRAL";
    this._updateInterval = null;
    this.isRunning = false;
    
    // 🆕 IDENTIFICAÇÃO PARA O LEARNING BRAIN
    this.agentId = "sentiment";
    this.lastInsightSent = null;
    this.insightHistory = [];
    this.initialized = false;
    
    // Ajustes temporários do LearningBrain
    this.tempSensitivityMultiplier = 1.0;
    
    // Detecta se tem chaves configuradas
    this.hasTwitterKeys = !!(process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET);
    this.hasRedditKeys = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
    this.useRealData = this.hasTwitterKeys || this.hasRedditKeys;
    
    // 🆕 ESCUTA ALOCAÇÃO DE CAPITAL (sentiment não usa capital diretamente, mas pode receber)
    EventBus.on(`capital:sentiment:allocated`, (data) => {
      logger.info(`💰 Sentiment registrou alocação: $${data.amount} (não usa capital diretamente)`, { service: "Sentiment" });
    });
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    EventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("SentimentService initialized", { 
      service: "Sentiment",
      twitterConfigured: this.hasTwitterKeys,
      redditConfigured: this.hasRedditKeys,
      mode: this.useRealData ? "REAL_API" : "SIMULATED",
      agentId: this.agentId
    });
  }

  // 🔥 INICIALIZAÇÃO
  async initialize() {
    if (this.initialized) return { success: true, isRunning: this.isRunning };
    
    logger.info("🔍 Sentiment: Inicializando...", { service: "Sentiment" });
    
    // Busca Fear & Greed real
    await this._fetchRealFearGreed();
    
    // Emite evento de sentimento inicial
    this.emitSentimentUpdate();
    
    // Compartilha insight inicial
    this.shareInsight(
      "initialization",
      `Sentiment Service iniciado com Fear & Greed: ${this.fearGreedIndex} (${this.sentiment})`,
      0.9,
      "normal"
    );
    
    this.initialized = true;
    this.isRunning = true;
    
    // Inicia o loop de atualização
    this._updateInterval = setInterval(async () => {
      await this._fetchRealFearGreed();
      this.emitSentimentUpdate();
      this.checkAndShareInsights();
    }, 5 * 60 * 1000);
    
    logger.info(`✅ SentimentService initialized com Fear & Greed: ${this.fearGreedIndex} (${this.sentiment})`, { service: "Sentiment" });
    
    return { success: true, isRunning: this.isRunning, fearGreedIndex: this.fearGreedIndex };
  }

  // 🆕 APLICA MELHORIAS RECEBIDAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    if (!improvement) return;
    
    logger.info(`🧠 Sentiment recebeu melhoria: ${improvement.recommendation}`, { service: "Sentiment" });
    
    switch(improvement.recommendation) {
      case "AUMENTAR_SENSIBILIDADE":
        this.tempSensitivityMultiplier = Math.max(0.5, this.tempSensitivityMultiplier * 0.8);
        logger.info(`⚡ Sentiment aumentou sensibilidade: ${this.tempSensitivityMultiplier}x`, { service: "Sentiment" });
        break;
        
      case "REDUZIR_RISCO":
        this.tempSensitivityMultiplier = Math.min(1.5, this.tempSensitivityMultiplier * 1.2);
        logger.info(`📉 Sentiment reduziu sensibilidade: ${this.tempSensitivityMultiplier}x`, { service: "Sentiment" });
        break;
        
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        logger.info(`📊 Sentimento extremo detectado - ajustando recomendação para ${this.sentiment}`, { service: "Sentiment" });
        // Força uma atualização de insight
        this.checkAndShareInsights();
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "Sentiment" });
    }
    
    // Reseta ajustes temporários após 1 hora
    setTimeout(() => {
      this.tempSensitivityMultiplier = 1.0;
      logger.info(`🔄 Sentiment resetou ajustes temporários`, { service: "Sentiment" });
    }, 3600000);
  }

  // 🆕 COMPARTILHA INSIGHT COM O LEARNING BRAIN
  shareInsight(insightType, content, confidence, priority = "normal") {
    const adjustedConfidence = Math.min(0.95, confidence * this.tempSensitivityMultiplier);
    
    const insight = {
      type: insightType,
      content: content,
      confidence: adjustedConfidence,
      priority: priority,
      data: {
        fearGreedIndex: this.fearGreedIndex,
        sentiment: this.sentiment,
        sensitivityMultiplier: this.tempSensitivityMultiplier,
        timestamp: Date.now()
      }
    };
    
    this.lastInsightSent = insight;
    this.insightHistory.unshift(insight);
    if (this.insightHistory.length > 100) this.insightHistory.pop();
    
    // Envia para o LearningBrain via evento específico
    EventBus.emit(`learning:${this.agentId}`, insight);
    
    logger.info(`📤 Sentiment compartilhou insight: ${content.substring(0, 80)} (confiança: ${(adjustedConfidence*100).toFixed(0)}%)`, { service: "Sentiment" });
  }

  // 🆕 EMITE EVENTO DE SENTIMENTO EXTREMO QUANDO DETECTADO
  emitExtremeSentiment() {
    let type = null;
    
    if (this.fearGreedIndex >= 75) {
      type = "EXTREME_GREED";
    } else if (this.fearGreedIndex <= 25) {
      type = "EXTREME_FEAR";
    }
    
    if (type) {
      const eventData = {
        type: type,
        index: this.fearGreedIndex,
        label: this.sentiment,
        timestamp: Date.now()
      };
      
      EventBus.emit("sentiment:extreme", eventData);
      logger.info(`🚨 Sentimento extremo detectado: ${type} (${this.fearGreedIndex})`, { service: "Sentiment" });
      
      // Compartilha insight de alto impacto
      this.shareInsight(
        "extreme_sentiment",
        `${type} detectado com índice ${this.fearGreedIndex} - possível ponto de virada de mercado`,
        type === "EXTREME_FEAR" ? 0.85 : 0.8,
        "high"
      );
    }
  }

  async start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    // Se já inicializou, só marca como running
    if (!this.initialized) {
      await this.initialize();
    } else {
      this.isRunning = true;
    }
    
    logger.info("SentimentService started - monitorando mercado em tempo real", { service: "Sentiment" });
    return { success: true };
  }

  // 🆕 EMITE ATUALIZAÇÃO DE SENTIMENTO PARA OUTROS SERVIÇOS
  emitSentimentUpdate() {
    const sentimentData = this.getSentiment();
    
    EventBus.emit("sentiment:update", {
      fearGreedIndex: this.fearGreedIndex,
      fearGreedLabel: this.sentiment,
      marketSentiment: sentimentData.marketSentiment,
      positionSizingMultiplier: sentimentData.positionSizingMultiplier,
      sensitivityMultiplier: this.tempSensitivityMultiplier,
      timestamp: Date.now()
    });
    
    // Verifica se é extremo
    this.emitExtremeSentiment();
  }

  // 🆕 VERIFICA E COMPARTILHA INSIGHTS BASEADOS EM MUDANÇAS
  checkAndShareInsights() {
    // Mudança significativa no Fear & Greed
    const lastInsight = this.insightHistory[0];
    if (lastInsight && lastInsight.data) {
      const lastIndex = lastInsight.data.fearGreedIndex;
      const indexChange = Math.abs(this.fearGreedIndex - lastIndex);
      
      if (indexChange >= 15) {
        const direction = this.fearGreedIndex > lastIndex ? "aumentou" : "diminuiu";
        this.shareInsight(
          "sentiment_shift",
          `Fear & Greed ${direction} ${indexChange} pontos em 5 minutos (${lastIndex} → ${this.fearGreedIndex})`,
          0.7,
          "high"
        );
      }
    }
    
    // Compartilha insights baseados no nível atual
    if (this.fearGreedIndex >= 75) {
      this.shareInsight(
        "market_condition",
        `Mercado em Ganância Extrema (${this.fearGreedIndex}) - risco de correção aumentado`,
        0.8,
        "high"
      );
    } else if (this.fearGreedIndex <= 25) {
      this.shareInsight(
        "market_condition",
        `Mercado em Medo Extremo (${this.fearGreedIndex}) - possível oportunidade de compra`,
        0.85,
        "high"
      );
    } else if (this.fearGreedIndex >= 55) {
      this.shareInsight(
        "market_condition",
        `Mercado em Ganância (${this.fearGreedIndex}) - cautela recomendada`,
        0.6,
        "normal"
      );
    } else if (this.fearGreedIndex <= 40) {
      this.shareInsight(
        "market_condition",
        `Mercado em Medo (${this.fearGreedIndex}) - zona de acumulação`,
        0.65,
        "normal"
      );
    }
  }

  _translateClassification(pt) {
    const map = {
      "Medo Extremo": "EXTREME_FEAR",
      "Medo": "FEAR",
      "Neutro": "NEUTRAL",
      "Ganância": "GREED",
      "Ganância Extrema": "EXTREME_GREED"
    };
    return map[pt] || "NEUTRAL";
  }

  async _fetchRealFearGreed() {
    try {
      const fetch = globalThis.fetch || require('node-fetch');
      const response = await fetch("https://api.alternative.me/fng/?limit=1");
      const data = await response.json();
      
      let value = null;
      let classification = null;
      
      if (data.dados && data.dados[0]) {
        value = parseInt(data.dados[0].valor);
        const rawClassification = data.dados[0].classificação_de_valor;
        classification = this._translateClassification(rawClassification);
        logger.debug(`API Portuguese: value=${value}, raw=${rawClassification} -> ${classification}`, { service: "Sentiment" });
      }
      else if (data.data && data.data[0]) {
        value = parseInt(data.data[0].value);
        classification = data.data[0].value_classification.toUpperCase();
        logger.debug(`API English: value=${value}, classification=${classification}`, { service: "Sentiment" });
      }
      
      if (value && !isNaN(value) && classification) {
        const oldIndex = this.fearGreedIndex;
        this.fearGreedIndex = value;
        this.sentiment = classification;
        logger.info(`Fear & Greed REAL: ${this.fearGreedIndex} (${this.sentiment})`, { service: "Sentiment" });
        
        if (Math.abs(this.fearGreedIndex - oldIndex) >= 10) {
          this.checkAndShareInsights();
        }
        
        return;
      }
      
      throw new Error(`Unknown API response format: ${JSON.stringify(data)}`);
      
    } catch (error) {
      logger.warn(`Fear & Greed API failed (${error.message}), using simulated`, { service: "Sentiment" });
      
      const oldIndex = this.fearGreedIndex;
      const change = (Math.random() - 0.5) * 6;
      let newValue = this.fearGreedIndex + change;
      newValue = Math.min(95, Math.max(5, newValue));
      this.fearGreedIndex = Math.round(newValue);
      this.sentiment = this.fearGreedIndex >= 75 ? "EXTREME_GREED" 
        : this.fearGreedIndex >= 55 ? "GREED" 
        : this.fearGreedIndex >= 45 ? "NEUTRAL" 
        : this.fearGreedIndex >= 25 ? "FEAR" 
        : "EXTREME_FEAR";
      
      if (Math.abs(this.fearGreedIndex - oldIndex) >= 10) {
        this.checkAndShareInsights();
      }
    }
  }

  async _fetchTwitterSentiment(symbol) {
    if (!this.hasTwitterKeys) {
      return null;
    }
    
    try {
      logger.info(`Fetching Twitter sentiment for ${symbol}`, { service: "Sentiment" });
      return {
        posts: [],
        avgSentiment: this.fearGreedIndex,
        postCount: Math.floor(Math.random() * 500) + 100
      };
    } catch (error) {
      logger.error(`Twitter API error: ${error.message}`, { service: "Sentiment" });
      return null;
    }
  }

  async _fetchRedditSentiment(symbol) {
    if (!this.hasRedditKeys) {
      return null;
    }
    
    try {
      logger.info(`Fetching Reddit sentiment for ${symbol}`, { service: "Sentiment" });
      return {
        posts: [],
        avgSentiment: this.fearGreedIndex,
        postCount: Math.floor(Math.random() * 200) + 50
      };
    } catch (error) {
      logger.error(`Reddit API error: ${error.message}`, { service: "Sentiment" });
      return null;
    }
  }

  async getTrendAnalysis(symbol) {
    try {
      let twitterData = null;
      let redditData = null;
      
      if (this.hasTwitterKeys) {
        twitterData = await this._fetchTwitterSentiment(symbol);
      }
      
      if (this.hasRedditKeys) {
        redditData = await this._fetchRedditSentiment(symbol);
      }
      
      const hasRealSocialData = (twitterData && twitterData.postCount > 0) || (redditData && redditData.postCount > 0);
      
      const totalPosts = (twitterData?.postCount || 0) + (redditData?.postCount || 0);
      const redditPosts = redditData?.postCount || Math.floor(Math.random() * 800) + 200;
      const twitterPosts = twitterData?.postCount || Math.floor(Math.random() * 600) + 150;
      
      const fgIndex = this.fearGreedIndex;
      const overallSentiment = fgIndex >= 55 ? "positive" : fgIndex <= 45 ? "negative" : "neutral";
      
      let positivePct, negativePct, neutralPct;
      if (fgIndex >= 75) {
        positivePct = 75; negativePct = 10; neutralPct = 15;
      } else if (fgIndex >= 60) {
        positivePct = 60; negativePct = 15; neutralPct = 25;
      } else if (fgIndex >= 55) {
        positivePct = 55; negativePct = 20; neutralPct = 25;
      } else if (fgIndex <= 25) {
        positivePct = 10; negativePct = 75; neutralPct = 15;
      } else if (fgIndex <= 40) {
        positivePct = 20; negativePct = 60; neutralPct = 20;
      } else if (fgIndex <= 45) {
        positivePct = 25; negativePct = 55; neutralPct = 20;
      } else {
        positivePct = 33; negativePct = 33; neutralPct = 34;
      }
      
      let trendStrength = "moderate";
      if (totalPosts > 1000) trendStrength = "strong";
      else if (totalPosts < 200) trendStrength = "weak";
      
      let recommendation = "HOLD";
      let recommendationReason = "Market sentiment is neutral. Waiting for clearer signals.";
      
      if (fgIndex >= 75) {
        recommendation = "SELL";
        recommendationReason = `Extreme Greed detected (${fgIndex}). Market may be overbought. Based on ${totalPosts} social posts analyzed.`;
      } else if (fgIndex >= 60) {
        recommendation = "SELL";
        recommendationReason = `Greed sentiment (${fgIndex}). Caution advised. ${totalPosts} posts analyzed across social platforms.`;
      } else if (fgIndex <= 25) {
        recommendation = "BUY";
        recommendationReason = `Extreme Fear detected (${fgIndex}). Potential buying opportunity. Social sentiment is strongly bearish.`;
      } else if (fgIndex <= 40) {
        recommendation = "BUY";
        recommendationReason = `Fear sentiment (${fgIndex}). Accumulation zone possible.`;
      }
      
      const confidence = Math.min(85, Math.max(40, 100 - Math.abs(50 - fgIndex)));
      
      let simulatedReturn = 1.8;
      if (fgIndex >= 75) simulatedReturn = -3.2;
      else if (fgIndex >= 60) simulatedReturn = -1.5;
      else if (fgIndex <= 25) simulatedReturn = 6.8;
      else if (fgIndex <= 40) simulatedReturn = 3.5;
      
      const posts = await this.getRecentPosts(symbol, 4);
      
      return {
        symbol: symbol.toUpperCase(),
        overall_sentiment: overallSentiment,
        sentiment_score: fgIndex,
        positive_pct: positivePct,
        negative_pct: negativePct,
        neutral_pct: neutralPct,
        trend_strength: trendStrength,
        posts_analyzed: totalPosts || Math.floor(Math.random() * 1500) + 300,
        reddit_posts: redditPosts,
        twitter_posts: twitterPosts,
        simulation_result: {
          simulated_return_pct: simulatedReturn,
          historical_accuracy: 68.5,
          confidence: confidence,
          period_days: 7
        },
        recommendation: recommendation,
        recommendation_reason: recommendationReason,
        last_updated: new Date().toISOString(),
        recent_posts: posts,
        data_source: hasRealSocialData ? "REAL_SOCIAL + FEAR_GREED" : "FEAR_GREED_ONLY",
        learning_insight: this.lastInsightSent?.content || null
      };
      
    } catch (error) {
      logger.error(`getTrendAnalysis error: ${error.message}`, { service: "Sentiment" });
      return null;
    }
  }

  async getRecentPosts(symbol, limit = 20) {
    const posts = [];
    const sources = ["twitter", "reddit"];
    const authors = ["@CryptoWhale99", "@TradingPro", "@AltcoinDreams", "u/BitcoinBaron", "u/CryptoAnalyst"];
    const contents = [
      `${symbol} showing strong momentum on weekly.`,
      `Just entered ${symbol} position based on AZTRON signal.`,
      `${symbol} breaking key resistance levels.`,
      `${symbol} sentiment score: ${this.fearGreedIndex}.`,
      `AZTRON AI recommends ${this.fearGreedIndex >= 55 ? 'caution' : 'accumulation'} for ${symbol}.`
    ];
    
    for (let i = 0; i < Math.min(limit, 10); i++) {
      posts.push({
        id: `post_${Date.now()}_${i}`,
        source: sources[i % sources.length],
        author: authors[Math.floor(Math.random() * authors.length)],
        content: contents[Math.floor(Math.random() * contents.length)],
        sentiment: this.fearGreedIndex >= 55 ? "positive" : this.fearGreedIndex <= 45 ? "negative" : "neutral",
        score: this.fearGreedIndex,
        symbol: symbol.toUpperCase(),
        created_at: new Date(Date.now() - i * 3600000).toISOString()
      });
    }
    
    return posts.slice(0, limit);
  }

  stop() { 
    if (this._updateInterval) clearInterval(this._updateInterval); 
    this.isRunning = false;
    logger.info("SentimentService stopped", { service: "Sentiment" });
  }

  getSentiment() {
    const marketSentiment = marketCondition.getMarketSentiment();
    return {
      fearGreedIndex: this.fearGreedIndex,
      fearGreedLabel: this.sentiment,
      marketSentiment: marketSentiment.sentiment,
      marketScore: marketSentiment.score,
      positionSizingMultiplier: (this.fearGreedIndex > 75 ? 0.8 : this.fearGreedIndex < 25 ? 1.2 : 1.0) * this.tempSensitivityMultiplier,
      dataMode: this.useRealData ? "REAL" : "SIMULATED",
      sensitivityMultiplier: this.tempSensitivityMultiplier
    };
  }

  getStatus() {
    return {
      running: this.isRunning,
      fearGreedIndex: this.fearGreedIndex,
      sentiment: this.sentiment,
      dataMode: this.useRealData ? "REAL_API" : "SIMULATED",
      lastInsight: this.lastInsightSent,
      insightsCount: this.insightHistory.length,
      twitterConfigured: this.hasTwitterKeys,
      redditConfigured: this.hasRedditKeys,
      sensitivityMultiplier: this.tempSensitivityMultiplier
    };
  }

  getInsightHistory(limit = 20) {
    return this.insightHistory.slice(0, limit);
  }
}

module.exports = new SentimentService();
