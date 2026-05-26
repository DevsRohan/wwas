'use strict';

// ============================================================
// Logger Service — Winston logging (console + optional file)
// File logging disabled on HF Spaces (ephemeral filesystem)
// ============================================================

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');

// ── Try to create log dir — fail silently on HF ──────────────
const LOG_DIR = process.env.LOG_DIR || './logs';
let fileLoggingEnabled = false;
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fileLoggingEnabled = true;
} catch (_) {
  fileLoggingEnabled = false;
}

// ── Formats ───────────────────────────────────────────────────
const consoleFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ' ' + JSON.stringify(meta)
      : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.json()
);

// ── Build transports ──────────────────────────────────────────
const logTransports = [
  new transports.Console({ format: consoleFormat }),
];

// Add file transports only if directory is writable
if (fileLoggingEnabled) {
  try {
    logTransports.push(
      new transports.File({
        filename: path.join(LOG_DIR, 'error.log'),
        level:    'error',
        format:   fileFormat,
        maxsize:  5 * 1024 * 1024, // 5MB
        maxFiles: 3,
      }),
      new transports.File({
        filename: path.join(LOG_DIR, 'app.log'),
        level:    'info',
        format:   fileFormat,
        maxsize:  10 * 1024 * 1024, // 10MB
        maxFiles: 3,
      })
    );
  } catch (_) {
    fileLoggingEnabled = false;
  }
}

// ── Logger instance ───────────────────────────────────────────
const logger = createLogger({
  level:       process.env.LOG_LEVEL || 'info',
  exitOnError: false,
  transports:  logTransports,
});

// ── In-memory ring buffer ─────────────────────────────────────
const MAX_BUFFER = 100;
const logBuffer  = [];

const _originalLog = logger.log.bind(logger);
logger.log = function(level, message, ...args) {
  logBuffer.unshift({ level, message, ts: Date.now() });
  if (logBuffer.length > MAX_BUFFER) logBuffer.pop();
  return _originalLog(level, message, ...args);
};

const getRecentLogs = (count = 50) => logBuffer.slice(0, count);

module.exports = {
  logger,
  getRecentLogs,
  info:  (msg, meta = {}) => logger.info(msg,  meta),
  warn:  (msg, meta = {}) => logger.warn(msg,  meta),
  error: (msg, meta = {}) => logger.error(msg, meta),
  debug: (msg, meta = {}) => logger.debug(msg, meta),
};
