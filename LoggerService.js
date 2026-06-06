const { createLogger, format, transports } = require("winston");
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp, service, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}] [${service || "system"}] ${level.toUpperCase()}: ${message}${metaStr}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(timestamp({ format: "HH:mm:ss" }), logFormat),
  transports: [new transports.Console()],
});

const logs = [];
const MAX_LOGS = 500; // 🔥 AUMENTADO de 200 para 500

// 🔥 CONTADORES PARA ESTATÍSTICAS
let stats = {
  info: 0,
  warn: 0,
  error: 0,
  debug: 0,
  lastError: null,
  errorsByService: {}
};

const originalLog = logger.info.bind(logger);
const originalWarn = logger.warn.bind(logger);
const originalError = logger.error.bind(logger);

function pushLog(level, message, service) {
  logs.unshift({ 
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`, 
    level, 
    message, 
    service: service || "system", 
    timestamp: new Date().toISOString() 
  });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  
  // 🔥 ATUALIZA ESTATÍSTICAS
  stats[level] = (stats[level] || 0) + 1;
  
  if (level === "error") {
    stats.lastError = { message, service, timestamp: new Date().toISOString() };
    stats.errorsByService[service || "system"] = (stats.errorsByService[service || "system"] || 0) + 1;
  }
}

logger.info = (message, meta = {}) => { 
  pushLog("info", message, meta.service); 
  originalLog(message, meta); 
};

logger.warn = (message, meta = {}) => { 
  pushLog("warn", message, meta.service); 
  originalWarn(message, meta); 
};

logger.error = (message, meta = {}) => { 
  pushLog("error", message, meta.service); 
  originalError(message, meta); 
};

logger.debug = (message, meta = {}) => { 
  if (process.env.LOG_LEVEL === "debug") {
    pushLog("debug", message, meta.service); 
  }
};

// 🔥 NOVO: OBTÉM ESTATÍSTICAS
logger.getStats = () => {
  return {
    ...stats,
    totalLogs: logs.length,
    logsByLevel: {
      info: stats.info,
      warn: stats.warn,
      error: stats.error,
      debug: stats.debug
    },
    uptime: process.uptime ? Math.floor(process.uptime()) : 0
  };
};

// 🔥 NOVO: LIMPA LOGS
logger.clearLogs = () => {
  const cleared = logs.length;
  logs.length = 0;
  stats = { info: 0, warn: 0, error: 0, debug: 0, lastError: null, errorsByService: {} };
  logger.info(`Logs limpos (${cleared} registros removidos)`);
  return { success: true, cleared };
};

// 🔥 NOVO: FILTRA LOGS POR NÍVEL
logger.getLogsByLevel = (level, limit = 50) => {
  return logs.filter(log => log.level === level).slice(0, limit);
};

// 🔥 NOVO: FILTRA LOGS POR SERVIÇO
logger.getLogsByService = (service, limit = 50) => {
  return logs.filter(log => log.service === service).slice(0, limit);
};

logger.getLogs = (limit = 50) => logs.slice(0, limit);

module.exports = logger;
