const db = require('../config/database');
const tokenomicsService = require('./TokenomicsService');

class WeeklySettlementService {
  constructor() {
    this.savingsRate = 0.30; // 30% vai pro cofre
    this.reinvestRate = 0.70; // 70% reinvestido
  }

  async settleWeekly(swingProfit) {
    try {
      if (swingProfit <= 0) {
        console.log(`[WeeklySettlement] Sem lucro semanal ($${swingProfit}) - nada a liquidar`);
        return { settled: false, amount: 0, reason: 'sem_lucro' };
      }

      const toSavings = swingProfit * this.savingsRate;
      const toReinvest = swingProfit * this.reinvestRate;

      // Adicionar ao cofre (savings)
      const currentBalance = tokenomicsService.getBalance();
      tokenomicsService.addToSavings(toSavings); // Método do TokenomicsService

      // Log da liquidação
      await db.query(
        `INSERT INTO weekly_settlements (swing_profit, to_savings, to_reinvest, settled_at)
         VALUES (?, ?, ?, NOW())`,
        [swingProfit, toSavings, toReinvest]
      );

      console.log(`[WeeklySettlement] LIQUIDAÇÃO: $${swingProfit} lucro | ${this.savingsRate*100}% ($${toSavings}) → Cofre | ${this.reinvestRate*100}% ($${toReinvest}) reinvestido`);
      
      return {
        settled: true,
        swingProfit,
        toSavings,
        toReinvest,
        savingsRate: this.savingsRate,
        reinvestRate: this.reinvestRate
      };
    } catch (error) {
      console.error('[WeeklySettlement] Erro:', error);
      return { settled: false, error: error.message };
    }
  }

  async getLastSettlement() {
    const [rows] = await db.query(
      `SELECT * FROM weekly_settlements ORDER BY settled_at DESC LIMIT 1`
    );
    return rows[0] || null;
  }

  async getSettlementHistory(limit = 10) {
    const [rows] = await db.query(
      `SELECT * FROM weekly_settlements ORDER BY settled_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  }
}

module.exports = new WeeklySettlementService();