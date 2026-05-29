const storage = require("./storage");
const logger = require("./LoggerService");

class GoalTrackerService {
  constructor() {
    this.goals = storage.get("goals", [{ id: "g1", label: "Monthly ROI", target: 10, current: 8.4, unit: "%" }, { id: "g2", label: "Win Rate", target: 75, current: 73.5, unit: "%" }, { id: "g3", label: "Max Drawdown", target: 5, current: 3.8, unit: "%" }]);
    logger.info("GoalTrackerService initialized", { service: "GoalTracker" });
  }

  getGoals() { return this.goals; }
  updateGoal(id, current) {
    const goal = this.goals.find(g => g.id === id);
    if (goal) { goal.current = current; storage.set("goals", this.goals); }
    return goal;
  }

  addGoal(goal) {
    const g = { id: `g_${Date.now()}`, ...goal };
    this.goals.push(g);
    storage.set("goals", this.goals);
    return g;
  }
}

module.exports = new GoalTrackerService();
