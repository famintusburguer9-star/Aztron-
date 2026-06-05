const EventBus = require('./EventBus');
const ExchangeAdapterService = require('./ExchangeAdapterService');
const DatabaseService = require('./DatabaseService');
const logger = require('./LoggerService');

class CapitalOrchestratorService {
  constructor() {
    this.logger = logger.child({ service: '💰 CapitalOrchestrator' });
    this.exchange = new ExchangeAdapterService();
    this.db = new DatabaseService();
    
    // Limites padrão (% do saldo total)
    this.limits = {
      strategies: 0.40,    // RSI, MACD, Breakout...
      arbitrage: 0.15,     // ArbitrageService
      hft: 0.10,          // HFTService (se tiver)
      reserve: 0.35       // Reserva de segurança
    };
    
    this.totalCapital = 0;
  }

  async start() {
    this.logger.info('💰 CapitalOrchestratorService iniciado');
    
    // Atualiza saldo a cada 5 minutos
    setInterval(() => this.updateBalance(), 300000);
    
    // Escuta insights pra ajustar limites
    EventBus.on('consciousness:insight', (insight) => this.adjustLimits(insight));
    
    // Escuta resultados das operações
    EventBus.on('trade:executed', (trade) => this.onTradeExecuted(trade));
    
    await this.updateBalance();
  }

  async updateBalance() {
    try {
      const balance = await this.exchange.getBalance();
      this.totalCapital = balance.usdt || 10000;
      this.logger.info(`Saldo total atualizado: $${this.totalCapital}`);
      
      EventBus.emit('capital:total:updated', { total: this.totalCapital, timestamp: Date.now() });
      
      this.distributeCapital();
    } catch (err) {
      this.logger.error('Erro ao atualizar saldo:', err);
    }
  }

  distributeCapital() {
    const allocations = {};
    
    for (const [service, percent] of Object.entries(this.limits)) {
      allocations[service] = this.totalCapital * percent;
    }
    
    this.logger.info(`📊 Distribuição de capital:`, allocations);
    
    // Avisa os serviços
    EventBus.emit('capital:allocated', {
      strategies: allocations.strategies,
      arbitrage: allocations.arbitrage,
      hft: allocations.hft,
      timestamp: Date.now()
    });
    
    this.db.saveData('capital_allocation', allocations);
  }

  adjustLimits(insight) {
    if (!insight) return;
    
    this.logger.info(`🎯 Ajustando limites baseado em insight: ${insight.message}`);
    
    if (insight.recommendedAction === 'EXECUTE_ARBITRAGE' && insight.confidence > 70) {
      // Aumenta limite da arbitragem temporariamente
      this.limits.arbitrage = Math.min(0.25, this.limits.arbitrage + 0.05);
      this.limits.reserve = Math.max(0.25, this.limits.reserve - 0.05);
      this.distributeCapital();
    }
    
    if (insight.recommendedAction === 'SHORT_OR_HOLD') {
      // Reduz exposição das estratégias
      this.limits.strategies = Math.max(0.20, this.limits.strategies * 0.7);
      this.limits.reserve += 0.10;
      this.distributeCapital();
    }
  }

  onTradeExecuted(trade) {
    this.logger.info(`Trade executado: ${trade.side} ${trade.amount} @ ${trade.price}`);
    // Atualiza saldo após trade
    setTimeout(() => this.updateBalance(), 5000);
  }

  stop() {
    this.logger.info('CapitalOrchestratorService parado');
  }
}

module.exports = new CapitalOrchestratorService();