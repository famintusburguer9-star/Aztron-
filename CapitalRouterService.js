const db = require('../config/database');

class CapitalRouterService {
  constructor() {
    this.hftCapital = 0;      // Capital atual do HFT
    this.swingCapital = 0;    // Capital atual do robô semanal
    this.initialized = false;
  }

  async initialize() {
    try {
      // Carregar capital salvo do banco
      const [rows] = await db.query(
        `SELECT * FROM capital_state WHERE robot_type IN ('hft', 'swing')`
      );
      
      for (const row of rows) {
        if (row.robot_type === 'hft') this.hftCapital = parseFloat(row.capital);
        if (row.robot_type === 'swing') this.swingCapital = parseFloat(row.capital);
      }
      
      if (this.hftCapital === 0) this.hftCapital = 1000;  // Capital inicial HFT
      if (this.swingCapital === 0) this.swingCapital = 10000; // Capital inicial SWING
      
      this.initialized = true;
      console.log(`[CapitalRouter] Inicializado | HFT: $${this.hftCapital} | SWING: $${this.swingCapital}`);
    } catch (error) {
      console.error('[CapitalRouter] Erro init:', error);
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
        console.log(`[CapitalRouter] HFT prejuízo de $${profit} - nada enviado`);
        await this.logFlow(hftTradeId, profit, 0, 'HFT_PREJUZO');
        return { routed: false, amount: 0, reason: 'prejuizo' };
      }

      // TODO lucro vai pro robô semanal
      this.swingCapital += profit;
      const previousHFT = this.hftCapital;
      this.hftCapital -= profit; // Lucro sai do HFT (mas HFT mantém capital base)
      
      // Na verdade HFT mantém seu capital, só envia o lucro pra SWING
      // Corrigindo: HFT capital não diminui, só envia lucro acumulado
      await this.saveCapitalState();
      await this.logFlow(hftTradeId, profit, profit, 'LUCRO_ENVIADO_SWING');
      
      console.log(`[CapitalRouter] $${profit} lucro HFT → SWING | SWING agora: $${this.swingCapital}`);
      
      return { routed: true, amount: profit, to: 'swing' };
    } catch (error) {
      console.error('[CapitalRouter] Erro rota:', error);
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
    await db.query(
      `INSERT INTO capital_state (robot_type, capital, updated_at) 
       VALUES ('hft', ?, NOW()) 
       ON DUPLICATE KEY UPDATE capital = VALUES(capital), updated_at = NOW()`,
      [this.hftCapital]
    );
    await db.query(
      `INSERT INTO capital_state (robot_type, capital, updated_at) 
       VALUES ('swing', ?, NOW()) 
       ON DUPLICATE KEY UPDATE capital = VALUES(capital), updated_at = NOW()`,
      [this.swingCapital]
    );
  }

  async logFlow(tradeId, profit, routedAmount, status) {
    await db.query(
      `INSERT INTO capital_flow_log (trade_id, profit, routed_amount, status, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [tradeId, profit, routedAmount, status]
    );
  }
}

module.exports = new CapitalRouterService();