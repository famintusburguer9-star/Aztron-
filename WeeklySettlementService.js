const db = require("./DatabaseService");
const logger = require("./LoggerService");
const tokenomics = require("./TokenomicsService");

class WeeklySettlementService {
  constructor() {
    this.savingsRate = 0.30; // 30% vai pro cofre
    this.reinvestRate = 0.70; // 70% reinvestido
  }

  async settleWeekly(swingProfit) {
    try {
      if (swingProfit <= 0) {
        logger.info(`[WeeklySettlement] Sem lucro semanal ($${swingProfit}) - nada a liquidar`);
        return { settled: false, amount: 0, reason: 'sem_lucro' };
      }

      const toSavings = swingProfit * this.savingsRate;
      const toReinvest = swingProfit * this.reinvestRate;

      // Adicionar ao cofre (savings)
      const result = tokenomics.addToSavings(toSavings);
      
      if (!result.success) {
        logger.error(`[WeeklySettlement] Falha ao adicionar ao savings: ${result.error}`);
        return { settled: false, error: result.error };
      }

      // Log da liquidação usando DatabaseService
      db.addWeeklySettlement({
        swing_profit: swingProfit,
        to_savings: toSavings,
        to_reinvest: toReinvest
      });

      logger.info(`[WeeklySettlement] LIQUIDAÇÃO: $${swingProfit} lucro | ${this.savingsRate*100}% ($${toSavings}) → Cofre | ${this.reinvestRate*100}% ($${toReinvest}) reinvestido`);
      
      return {
        settled: true,
        swingProfit,
        toSavings,
        toReinvest,
        savingsRate: this.savingsRate,
        reinvestRate: this.reinvestRate
      };
    } catch (error) {
      logger.error(`[WeeklySettlement] Erro: ${error.message}`);
      return { settled: false, error: error.message };
    }
  }

  async getLastSettlement() {
    return db.getLastSettlement();
  }

  async getSettlementHistory(limit = 10) {
    return db.getWeeklySettlements(limit);
  }
}

module.exports = new WeeklySettlementService();
