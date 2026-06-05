const EventBus = require('./EventBus');
const DatabaseService = require('./DatabaseService');
const logger = require('./LoggerService');

class ConsciousnessBridgeService {
  constructor() {
    this.logger = logger.child({ service: '🧠 ConsciousnessBridge' });
    this.db = new DatabaseService();
    this.eventMemory = []; // memória dos últimos 500 eventos
    this.insightHistory = [];
  }

  start() {
    this.logger.info('🧠 ConsciousnessBridgeService iniciado - O CÉREBRO ACORDOU');
    
    this.listenToAllEvents();
    
    // Processa insights a cada 2 minutos
    setInterval(() => this.processInsights(), 120000);
  }

  listenToAllEvents() {
    // Estratégias (já existem)
    EventBus.on('strategy:signal', (signal) => this.remember('strategy', signal));
    EventBus.on('multi:strategy:decision', (decision) => this.remember('multiStrategy', decision));
    
    // Risco (já existem)
    EventBus.on('risk:alert', (alert) => this.remember('risk', alert));
    EventBus.on('risk:position:adjusted', (adj) => this.remember('risk', adj));
    
    // Sentimento (já existe)
    EventBus.on('sentiment:update', (sentiment) => this.remember('sentiment', sentiment));
    
    // Mercado (já existe)
    EventBus.on('market:condition:change', (condition) => this.remember('market', condition));
    
    // IA (já existe)
    EventBus.on('ai:learning:update', (update) => this.remember('ai', update));
    
    // Novos serviços
    EventBus.on('arbitrage:opportunity', (opp) => this.remember('arbitrage', opp));
    EventBus.on('capital:allocated', (cap) => this.remember('capital', cap));
    EventBus.on('capital:total:updated', (total) => this.remember('capital', total));
  }

  remember(source, data) {
    this.eventMemory.unshift({
      source,
      data,
      timestamp: Date.now()
    });
    
    // Mantém só últimas 500 memórias
    if (this.eventMemory.length > 500) {
      this.eventMemory.pop();
    }
  }

  processInsights() {
    const insights = [];
    
    // Insight 1: Sentimento + Mercado alinhados?
    const lastSentiment = this.eventMemory.find(e => e.source === 'sentiment');
    const lastMarket = this.eventMemory.find(e => e.source === 'market');
    
    if (lastSentiment && lastMarket) {
      const sentimentScore = lastSentiment.data.fearGreedIndex || 50;
      const marketTrend = lastMarket.data.trend || 'neutral';
      
      if (sentimentScore > 65 && marketTrend === 'uptrend') {
        insights.push({
          type: 'alignment',
          message: '📈 Sentimento altista + Mercado em uptrend = Oportunidade de compra',
          confidence: 85,
          recommendedAction: 'LONG'
        });
      } else if (sentimentScore < 35 && marketTrend === 'downtrend') {
        insights.push({
          type: 'alignment',
          message: '📉 Sentimento baixista + Mercado em downtrend = Evitar compras',
          confidence: 80,
          recommendedAction: 'SHORT_OR_HOLD'
        });
      }
    }
    
    // Insight 2: Arbitragem + Sentimento
    const lastArbitrage = this.eventMemory.find(e => e.source === 'arbitrage');
    if (lastArbitrage && lastSentiment && lastSentiment.data.fearGreedIndex < 40) {
      insights.push({
        type: 'opportunity',
        message: '💡 Arbitragem disponível em momento de medo - maior chance de sucesso',
        confidence: 70,
        recommendedAction: 'EXECUTE_ARBITRAGE'
      });
    }
    
    // Emite insights encontrados
    insights.forEach(insight => {
      this.insightHistory.push(insight);
      EventBus.emit('consciousness:insight', insight);
      this.logger.info(`🧠 Insight: ${insight.message}`);
    });
    
    // Salva no banco
    if (insights.length > 0) {
      this.db.saveData('insights', insights);
    }
  }

  getMemory() {
    return this.eventMemory;
  }

  stop() {
    this.logger.info('ConsciousnessBridgeService parado');
  }
}

module.exports = new ConsciousnessBridgeService();