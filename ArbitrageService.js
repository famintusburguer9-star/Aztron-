const EventBus = require('./EventBus');
const ExchangeAdapterService = require('./ExchangeAdapterService');
const DatabaseService = require('./DatabaseService');
const logger = require('./LoggerService');

class ArbitrageService {
  constructor() {
    this.logger = logger.child({ service: 'ArbitrageService' });
    this.exchange = new ExchangeAdapterService();
    this.db = new DatabaseService();
    this.isRunning = false;
    this.availableCapital = 0;
    this.minSpread = 1.2; // % mínimo pra considerar arbitragem
  }

  start() {
    this.isRunning = true;
    this.logger.info('🚀 ArbitrageService iniciado');
    
    // Escuta eventos
    EventBus.on('capital:allocated', (data) => {
      this.availableCapital = data.arbitrage || 0;
      this.logger.info(`Capital alocado para arbitragem: $${this.availableCapital}`);
    });
    
    EventBus.on('market:data:ticker', (data) => {
      this.checkOpportunity(data);
    });
    
    this.scanLoop();
  }

  async scanLoop() {
    while (this.isRunning) {
      try {
        await this.scanArbitrageOpportunities();
        await this.sleep(30000); // a cada 30 segundos
      } catch (err) {
        this.logger.error('Erro no scan de arbitragem:', err);
      }
    }
  }

  async scanArbitrageOpportunities() {
    // Pega preços de diferentes pares/exchanges
    const btcPrice = await this.exchange.getPrice('BTCUSDT');
    
    // Mock: verifica spread entre CEX e DEX
    // Na prática, você usaria o ExchangeAdapterService pra pegar preços reais
    const simulatedSpread = (Math.random() * 2); // 0-2% simulados
    
    if (simulatedSpread > this.minSpread && this.availableCapital > 100) {
      this.logger.info(`💰 Oportunidade de arbitragem: ${simulatedSpread}%`);
      
      EventBus.emit('arbitrage:opportunity', {
        spread: simulatedSpread,
        pair: 'BTC/USDT',
        action: 'buy_low_sell_high',
        estimatedProfit: (this.availableCapital * simulatedSpread / 100),
        timestamp: Date.now()
      });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    this.logger.info('ArbitrageService parado');
  }
}

module.exports = new ArbitrageService();