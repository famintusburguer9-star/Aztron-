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
const MAX_LOGS = 200;

const originalLog = logger.info.bind(logger);
const originalWarn = logger.warn.bind(logger);
const originalError = logger.error.bind(logger);

function pushLog(level, message, service) {
  logs.unshift({ id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`, level, message, service: service || "system", timestamp: new Date().toISOString() });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

logger.info = (message, meta = {}) => { pushLog("info", message, meta.service); originalLog(message, meta); };
logger.warn = (message, meta = {}) => { pushLog("warn", message, meta.service); originalWarn(message, meta); };
logger.error = (message, meta = {}) => { pushLog("error", message, meta.service); originalError(message, meta); };
logger.debug = (message, meta = {}) => { pushLog("debug", message, meta.service); };

logger.getLogs = (limit = 50) => logs.slice(0, limit);

module.exports = logger;
