const db = require("./DatabaseService");
const logger = require("./LoggerService");

class CapitalRouterService {
  constructor() {
    this.hftCapital = 0;      // Capital atual do HFT
    this.swingCapital = 0;    // Capital atual do robô semanal
    this.initialized = false;
  }

  async initialize() {
    try {
      // Carregar capital salvo do banco (usando o método do DatabaseService)
      const capitalState = db.getCapitalState();
      
      this.hftCapital = capitalState.hft || 1000;
      this.swingCapital = capitalState.swing || 10000;
      
      this.initialized = true;
      logger.info(`[CapitalRouter] Inicializado | HFT: $${this.hftCapital} | SWING: $${this.swingCapital}`);
    } catch (error) {
      logger.error(`[CapitalRouter] Erro init: ${error.message}`);
      this.hftCapital = 1000;
      this.swingCapital = 10000;
      this.initialized = true;
    }
  }

  async routeHFTProfit(profit, hftTradeId) {
    if (!this.initialized) await this.initialize();
    
    try {
      // Só envia se for lucro positivo
      if (profit <= 0) {
        logger.info(`[CapitalRouter] HFT prejuízo de $${profit} - nada enviado`);
        await this.logFlow(hftTradeId, profit, 0, 'HFT_PREJUZO');
        return { routed: false, amount: 0, reason: 'prejuizo' };
      }

      // TODO lucro vai pro robô semanal
      this.swingCapital += profit;
      
      // Salva o estado atualizado
      await this.saveCapitalState();
      await this.logFlow(hftTradeId, profit, profit, 'LUCRO_ENVIADO_SWING');
      
      logger.info(`[CapitalRouter] $${profit} lucro HFT → SWING | SWING agora: $${this.swingCapital}`);
      
      return { routed: true, amount: profit, to: 'swing' };
    } catch (error) {
      logger.error(`[CapitalRouter] Erro rota: ${error.message}`);
      return { routed: false, amount: 0, error: error.message };
    }
  }

  async getCapitals() {
    if (!this.initialized) await this.initialize();
    return {
      hft: this.hftCapital,
      swing: this.swingCapital
    };
  }

  async saveCapitalState() {
    // Usando os métodos do DatabaseService
    db.updateCapitalState('hft', this.hftCapital);
    db.updateCapitalState('swing', this.swingCapital);
  }

  async logFlow(tradeId, profit, routedAmount, status) {
    // Usando o método do DatabaseService
    db.addCapitalFlowLog({
      trade_id: tradeId,
      profit: profit,
      routed_amount: routedAmount,
      status: status,
      created_at: new Date().toISOString()
    });
  }
}

module.exports = new CapitalRouterService();
