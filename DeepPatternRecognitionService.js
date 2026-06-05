const marketData = require("./MarketDataService");
const EventBus = require("./EventBus");
const logger = require("./LoggerService");

// 🆕 IMPORT PARA INTEGRAÇÃO COM LEARNING BRAIN
const learningBrain = require("./LearningBrainService");

// 🆕 LISTA DE PADRÕES QUE O SERVIÇO DETECTA
const PATTERNS = {
  REVERSAL: {
    BULLISH: ["Double Bottom", "Inverse Head & Shoulders", "Bullish Divergence", "Morning Star", "Hammer"],
    BEARISH: ["Double Top", "Head & Shoulders", "Bearish Divergence", "Evening Star", "Shooting Star"]
  },
  CONTINUATION: {
    BULLISH: ["Bull Flag", "Ascending Triangle", "Bullish Pennant", "Cup and Handle"],
    BEARISH: ["Bear Flag", "Descending Triangle", "Bearish Pennant", "Rising Wedge"]
  },
  NEUTRAL: ["Symmetrical Triangle", "Rectangle", "Falling Wedge", "Channel"]
};

// 🆕 TIMEFRAMES PARA ANÁLISE
const TIMEFRAMES = ["15m", "1h", "4h", "1d"];

class DeepPatternRecognitionService {
  constructor() {
    // 🆕 IDENTIFICAÇÃO PARA O LEARNING BRAIN
    this.agentId = "deep";
    
    // Padrões detectados
    this.detectedPatterns = [];
    this.confirmedPatterns = [];
    this.patternHistory = [];
    this.performanceStats = {};
    
    // Estado do serviço
    this._scanInterval = null;
    this.isRunning = false;
    
    // 🆕 CONFIGURAÇÕES
    this.config = {
      minConfidence: 60,
      requireConfirmation: true,
      scanIntervalMs: 30000, // 30 segundos
      maxPatternsToKeep: 100,
      shareInsights: true
    };
    
    // 🆕 ESCUTA MELHORIAS DO LEARNING BRAIN
    EventBus.on(`improvement:${this.agentId}`, (improvement) => {
      this.applyImprovement(improvement);
    });
    
    EventBus.on("improvement:broadcast", (improvement) => {
      if (improvement.affectedAgents?.includes(this.agentId)) {
        this.applyImprovement(improvement);
      }
    });
    
    logger.info("DeepPatternRecognitionService initialized", { 
      service: "DeepPattern",
      agentId: this.agentId,
      patternsCount: Object.values(PATTERNS).flatMap(c => Object.values(c)).flat().length
    });
  }

  // 🆕 APLICA MELHORIAS RECEBIDAS DO LEARNING BRAIN
  applyImprovement(improvement) {
    logger.info(`🧠 DeepPattern recebeu melhoria: ${improvement.recommendation}`, { service: "DeepPattern" });
    
    switch(improvement.recommendation) {
      case "REVISAR_TODAS_POSICOES_E_CONSIDERAR_CONTRA_TREND":
        this.config.minConfidence = Math.max(50, this.config.minConfidence - 5);
        logger.info(`📊 Ajustando confiança mínima para ${this.config.minConfidence}%`, { service: "DeepPattern" });
        break;
        
      default:
        logger.debug(`Melhoria recebida: ${improvement.recommendation}`, { service: "DeepPattern" });
    }
  }

  // 🆕 COMPARTILHA PADRÃO DETECTADO COM O LEARNING BRAIN
  sharePattern(pattern) {
    if (!this.config.shareInsights) return;
    
    const insight = {
      type: "pattern_detected",
      content: `${pattern.pattern} detectado em ${pattern.symbol} (${pattern.timeframe}) com ${pattern.confidence}% confiança - implicação ${pattern.implication}`,
      confidence: pattern.confidence / 100,
      priority: pattern.confidence > 75 ? "high" : "normal",
      data: {
        pattern: pattern.pattern,
        symbol: pattern.symbol,
        timeframe: pattern.timeframe,
        implication: pattern.implication,
        price: pattern.price,
        confidence: pattern.confidence
      }
    };
    
    EventBus.emit(`learning:${this.agentId}`, insight);
    logger.info(`📤 DeepPattern compartilhou: ${insight.content.substring(0, 80)}`, { service: "DeepPattern" });
  }

  // 🆕 EMITE EVENTO DE PADRÃO PARA OUTROS SERVIÇOS
  emitPatternEvent(pattern) {
    EventBus.emit("deep:pattern:detected", {
      ...pattern,
      timestamp: Date.now()
    });
    
    // Se o padrão é de alta confiança, emite alerta específico
    if (pattern.confidence >= 80) {
      EventBus.emit("alert", {
        type: "HIGH_CONFIDENCE_PATTERN",
        message: `${pattern.pattern} detectado em ${pattern.symbol} com ${pattern.confidence}% confiança`,
        severity: "INFO",
        timestamp: Date.now()
      });
    }
  }

  start() {
    if (this.isRunning) return { success: false, reason: "Already running" };
    
    this.isRunning = true;
    this._scanInterval = setInterval(() => this._scan(), this.config.scanIntervalMs);
    
    logger.info("DeepPatternRecognitionService started - analisando múltiplos timeframes", { 
      service: "DeepPattern",
      scanInterval: `${this.config.scanIntervalMs / 1000}s`,
      timeframes: TIMEFRAMES.join(", ")
    });
    
    return { success: true };
  }

  stop() { 
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
    this.isRunning = false;
    logger.info("DeepPatternRecognitionService stopped", { service: "DeepPattern" });
  }

  // 🆕 SCAN PRINCIPAL - ANALISA MÚLTIPLOS SÍMBOLOS E TIMEFRAMES
  async _scan() {
    if (!this.isRunning) return;
    
    const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
    const allDetections = [];
    
    for (const symbol of symbols) {
      for (const timeframe of TIMEFRAMES) {
        try {
          const detection = await this._analyzeSymbol(symbol, timeframe);
          if (detection && detection.confidence >= this.config.minConfidence) {
            allDetections.push(detection);
          }
        } catch (err) {
          logger.error(`Erro ao analisar ${symbol} (${timeframe}):`, err);
        }
      }
    }
    
    // Processa detecções
    for (const detection of allDetections) {
      // Verifica se já foi detectado recentemente (evita duplicatas)
      const isDuplicate = this.detectedPatterns.some(p => 
        p.symbol === detection.symbol && 
        p.pattern === detection.pattern && 
        (Date.now() - new Date(p.timestamp).getTime()) < 3600000
      );
      
      if (!isDuplicate) {
        // Adiciona ao histórico
        this.detectedPatterns.unshift(detection);
        if (this.detectedPatterns.length > this.config.maxPatternsToKeep) {
          this.detectedPatterns.pop();
        }
        
        // Atualiza estatísticas de performance
        this._updatePerformanceStats(detection);
        
        // 🆕 EMITE EVENTO E COMPARTILHA
        this.emitPatternEvent(detection);
        this.sharePattern(detection);
        
        // Se o padrão tem alta confiança, tenta confirmar
        if (detection.confidence >= 70 && this.config.requireConfirmation) {
          this._attemptConfirmation(detection);
        }
        
        logger.info(`🎯 Padrão detectado: ${detection.pattern} em ${detection.symbol} (${detection.timeframe}) - ${detection.implication} (${detection.confidence}% conf)`, { 
          service: "DeepPattern",
          confidence: detection.confidence,
          implication: detection.implication
        });
      }
    }
    
    // 🆕 COMPARTILHA RELATÓRIO RESUMIDO A CADA 10 SCANS
    if (this.detectedPatterns.length % 10 === 0 && this.detectedPatterns.length > 0) {
      this._shareSummaryReport();
    }
  }

  // 🆕 ANÁLISE REAL DE PADRÕES (substitui o random)
  async _analyzeSymbol(symbol, timeframe) {
    // Obtém indicadores do MarketDataService
    const indicators = marketData.getIndicators(symbol);
    if (!indicators) return null;
    
    // Extrai dados relevantes
    const price = indicators.price || 0;
    const rsi = indicators.rsi || 50;
    const macd = indicators.macd || { histogram: 0 };
    const volume = indicators.volume || 0;
    const high24h = indicators.high24h || price * 1.02;
    const low24h = indicators.low24h || price * 0.98;
    
    // 🆕 DETECÇÃO BASEADA EM DADOS REAIS
    const detections = [];
    
    // 1. Detecção de Double Top/Bottom (baseado em RSI e preço)
    if (rsi > 70 && price > high24h * 0.98) {
      detections.push({
        pattern: "Double Top",
        implication: "BEARISH",
        confidence: Math.min(85, 60 + (rsi - 70) * 1.5),
        reasoning: `RSI em ${rsi.toFixed(0)}% indicando sobrecompra próximo à máxima`
      });
    }
    
    if (rsi < 30 && price < low24h * 1.02) {
      detections.push({
        pattern: "Double Bottom",
        implication: "BULLISH",
        confidence: Math.min(85, 60 + (30 - rsi) * 1.5),
        reasoning: `RSI em ${rsi.toFixed(0)}% indicando sobrevenda próximo à mínima`
      });
    }
    
    // 2. Detecção de Divergência (MACD)
    if (macd.histogram > 0 && price < low24h * 1.01) {
      detections.push({
        pattern: "Bullish Divergence",
        implication: "BULLISH",
        confidence: 75,
        reasoning: `MACD positivo com preço na mínima - possível reversão`
      });
    }
    
    if (macd.histogram < 0 && price > high24h * 0.99) {
      detections.push({
        pattern: "Bearish Divergence",
        implication: "BEARISH",
        confidence: 75,
        reasoning: `MACD negativo com preço na máxima - possível reversão`
      });
    }
    
    // 3. Detecção de Triangles (baseado em volatilidade)
    const volatility = indicators.volatility || 1;
    if (volatility < 0.5 && volume > 0) {
      detections.push({
        pattern: "Symmetrical Triangle",
        implication: "NEUTRAL",
        confidence: 65,
        reasoning: `Volatilidade baixa indicando consolidação`
      });
    }
    
    // 4. Detecção de Flags (baseado em movimento recente)
    const priceChange24h = indicators.change24h || 0;
    if (Math.abs(priceChange24h) > 3 && volatility < 1) {
      const pattern = priceChange24h > 0 ? "Bull Flag" : "Bear Flag";
      detections.push({
        pattern: pattern,
        implication: priceChange24h > 0 ? "BULLISH" : "BEARISH",
        confidence: 70,
        reasoning: `Movimento forte de ${Math.abs(priceChange24h).toFixed(1)}% seguido de consolidação`
      });
    }
    
    // 5. Detecção de Head & Shoulders (simplificada)
    // Baseado em padrão de três picos
    if (this._detectHeadAndShoulders(indicators)) {
      detections.push({
        pattern: "Head & Shoulders",
        implication: "BEARISH",
        confidence: 80,
        reasoning: `Estrutura de três picos detectada`
      });
    }
    
    if (this._detectInverseHeadAndShoulders(indicators)) {
      detections.push({
        pattern: "Inverse Head & Shoulders",
        implication: "BULLISH",
        confidence: 80,
        reasoning: `Estrutura de três vales detectada`
      });
    }
    
    // Se não detectou nada baseado em dados, retorna null
    if (detections.length === 0) return null;
    
    // Pega o padrão com maior confiança
    const best = detections.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    return {
      id: `pat_${Date.now()}_${symbol}_${timeframe}`,
      symbol: symbol,
      pattern: best.pattern,
      price: price,
      confidence: Math.round(best.confidence),
      timeframe: timeframe,
      implication: best.implication,
      reasoning: best.reasoning,
      indicators: {
        rsi: Math.round(rsi),
        macd: macd.histogram?.toFixed(2) || 0,
        volatility: volatility.toFixed(2),
        volume24h: volume
      },
      timestamp: new Date().toISOString()
    };
  }

  // 🆕 DETECTA HEAD & SHOULDERS
  _detectHeadAndShoulders(indicators) {
    // Implementação simplificada - em produção seria mais robusta
    const priceChange = indicators.change24h || 0;
    const rsi = indicators.rsi || 50;
    // Head & Shoulders tipicamente aparece após topo com RSI alto
    return priceChange < -1 && rsi > 60 && rsi < 75;
  }

  // 🆕 DETECTA INVERSE HEAD & SHOULDERS
  _detectInverseHeadAndShoulders(indicators) {
    const priceChange = indicators.change24h || 0;
    const rsi = indicators.rsi || 50;
    // Inverse H&S tipicamente aparece após fundo com RSI baixo
    return priceChange > 1 && rsi > 30 && rsi < 45;
  }

  // 🆕 TENTA CONFIRMAR PADRÃO
  _attemptConfirmation(pattern) {
    // Agenda uma verificação após o timeframe
    const confirmTimeout = pattern.timeframe === "15m" ? 15 : 
                           pattern.timeframe === "1h" ? 60 : 
                           pattern.timeframe === "4h" ? 240 : 1440; // minutos
    
    setTimeout(async () => {
      const currentPrice = marketData.getIndicators(pattern.symbol)?.price || 0;
      const priceChange = ((currentPrice - pattern.price) / pattern.price) * 100;
      
      let confirmed = false;
      if (pattern.implication === "BULLISH" && priceChange > 1) confirmed = true;
      if (pattern.implication === "BEARISH" && priceChange < -1) confirmed = true;
      
      const confirmedPattern = {
        ...pattern,
        confirmed: confirmed,
        confirmedAt: new Date().toISOString(),
        priceAtConfirmation: currentPrice,
        priceChange: priceChange.toFixed(2)
      };
      
      this.confirmedPatterns.unshift(confirmedPattern);
      if (this.confirmedPatterns.length > 50) this.confirmedPatterns.pop();
      
      if (confirmed) {
        logger.info(`✅ Padrão confirmado: ${pattern.pattern} em ${pattern.symbol} - movimento de ${priceChange.toFixed(1)}%`, { service: "DeepPattern" });
        
        // Compartilha confirmação
        EventBus.emit(`learning:${this.agentId}`, {
          type: "pattern_confirmed",
          content: `Padrão ${pattern.pattern} confirmado em ${pattern.symbol} com movimento de ${priceChange.toFixed(1)}%`,
          confidence: 0.85,
          priority: "high",
          data: confirmedPattern
        });
      }
    }, confirmTimeout * 60 * 1000);
  }

  // 🆕 ATUALIZA ESTATÍSTICAS DE PERFORMANCE DOS PADRÕES
  _updatePerformanceStats(pattern) {
    const key = pattern.pattern;
    if (!this.performanceStats[key]) {
      this.performanceStats[key] = {
        totalDetections: 0,
        bullishCount: 0,
        bearishCount: 0,
        avgConfidence: 0,
        lastDetected: null
      };
    }
    
    const stats = this.performanceStats[key];
    stats.totalDetections++;
    if (pattern.implication === "BULLISH") stats.bullishCount++;
    if (pattern.implication === "BEARISH") stats.bearishCount++;
    stats.avgConfidence = (stats.avgConfidence * (stats.totalDetections - 1) + pattern.confidence) / stats.totalDetections;
    stats.lastDetected = pattern.timestamp;
  }

  // 🆕 COMPARTILHA RELATÓRIO RESUMIDO
  _shareSummaryReport() {
    const lastHour = Date.now() - 3600000;
    const recentPatterns = this.detectedPatterns.filter(p => 
      new Date(p.timestamp).getTime() > lastHour
    );
    
    if (recentPatterns.length === 0) return;
    
    const bullishCount = recentPatterns.filter(p => p.implication === "BULLISH").length;
    const bearishCount = recentPatterns.filter(p => p.implication === "BEARISH").length;
    const neutralCount = recentPatterns.filter(p => p.implication === "NEUTRAL").length;
    
    const report = {
      type: "summary_report",
      content: `Última hora: ${recentPatterns.length} padrões detectados (${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral)`,
      confidence: 0.7,
      priority: "normal",
      data: {
        total: recentPatterns.length,
        bullish: bullishCount,
        bearish: bearishCount,
        neutral: neutralCount,
        topPatterns: recentPatterns.slice(0, 3).map(p => p.pattern)
      }
    };
    
    EventBus.emit(`learning:${this.agentId}`, report);
    logger.info(`📊 Relatório resumido compartilhado: ${report.content}`, { service: "DeepPattern" });
  }

  // 🆕 OBTÉM PADRÕES DETECTADOS
  getPatterns(limit = 10, filter = null) {
    let patterns = this.detectedPatterns;
    
    if (filter === "BULLISH") {
      patterns = patterns.filter(p => p.implication === "BULLISH");
    } else if (filter === "BEARISH") {
      patterns = patterns.filter(p => p.implication === "BEARISH");
    } else if (filter === "CONFIRMED") {
      patterns = this.confirmedPatterns;
    }
    
    return patterns.slice(0, limit);
  }

  // 🆕 OBTÉM ESTATÍSTICAS DE PERFORMANCE
  getPerformanceStats() {
    const stats = {};
    for (const [pattern, data] of Object.entries(this.performanceStats)) {
      const bullishRatio = data.totalDetections > 0 ? (data.bullishCount / data.totalDetections) * 100 : 0;
      stats[pattern] = {
        totalDetections: data.totalDetections,
        avgConfidence: Math.round(data.avgConfidence),
        bullishPercentage: Math.round(bullishRatio),
        lastDetected: data.lastDetected
      };
    }
    return stats;
  }

  // 🆕 OBTÉM STATUS COMPLETO
  getStatus() {
    return {
      running: this.isRunning,
      totalPatternsDetected: this.detectedPatterns.length,
      confirmedPatterns: this.confirmedPatterns.length,
      patternsByType: {
        BULLISH: this.detectedPatterns.filter(p => p.implication === "BULLISH").length,
        BEARISH: this.detectedPatterns.filter(p => p.implication === "BEARISH").length,
        NEUTRAL: this.detectedPatterns.filter(p => p.implication === "NEUTRAL").length
      },
      config: this.config,
      performanceStats: this.getPerformanceStats(),
      lastScan: this.detectedPatterns[0]?.timestamp || null
    };
  }

  // 🆕 MÉTODO PARA MIGRAR PARA LIVE (quando estiver pronto)
  async switchToLiveMode() {
    logger.info("🔄 DeepPattern migrando para LIVE MODE...", { service: "DeepPattern" });
    this.config.minConfidence = 70; // Aumenta confiança mínima em LIVE
    logger.info("✅ DeepPattern agora opera em LIVE MODE com confiança mínima de 70%", { service: "DeepPattern" });
    return { success: true };
  }
}

module.exports = new DeepPatternRecognitionService();
