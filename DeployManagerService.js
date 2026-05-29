const db = require("./DatabaseService");
const logger = require("./LoggerService");

class DeployManagerService {
  constructor() { logger.info("DeployManagerService initialized", { service: "DeployManager" }); }

  getHistory() { return db.getDeployHistory(); }

  deploy(notes = "Manual deploy") {
    const history = db.getDeployHistory();
    const lastVersion = history[0]?.version || "v4.0.0";
    const parts = lastVersion.replace("v", "").split(".").map(Number);
    parts[2]++;
    const newVersion = `v${parts.join(".")}`;
    const deploy = { id: `d_${Date.now()}`, version: newVersion, status: "Success", date: new Date().toISOString(), deployedBy: "admin", notes };
    db.addDeploy(deploy);
    logger.info(`Deployed ${newVersion}: ${notes}`, { service: "DeployManager" });
    return deploy;
  }

  rollback(version) {
    const history = db.getDeployHistory();
    const target = history.find(d => d.version === version);
    if (!target) return { success: false, reason: "Version not found" };
    const rollbackEntry = { id: `d_rb_${Date.now()}`, version: target.version, status: "Rollback", date: new Date().toISOString(), deployedBy: "admin", notes: `Rolled back to ${version}` };
    db.addDeploy(rollbackEntry);
    logger.warn(`Rolled back to ${version}`, { service: "DeployManager" });
    return { success: true, deploy: rollbackEntry };
  }
}

module.exports = new DeployManagerService();
