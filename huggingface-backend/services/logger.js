'use strict';

// ============================================================
// WWAS - Winston Logger Service
// Centralized logging for all HF backend modules
// ============================================================

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists — use try/catch so server never crashes on log init
const logsDir = path.join(__dirname, '..', 'logs');
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  // If we can't create logs dir (permission issue on HF), continue anyway
  // Console logging will still work
}

const { combine, timestamp, printf, colorize, errors } = format;

// Custom log format for console
const consoleFormat = printf(({ level, message, timestamp: ts, context, ...meta }) => {
  const ctx = context ? `[${context}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} ${level} ${ctx} ${message}${metaStr}`;
});

// Custom log format for files (JSON structured)
const fileFormat = printf(({ level, message, timestamp: ts, context, ...meta }) => {
  return JSON.stringify({ timestamp: ts, level, context: context || 'app', message, ...meta });
});

// Build file transports only if logs dir is writable
const fileTransports = [];
try {
  fs.accessSync(logsDir, fs.constants.W_OK);
  fileTransports.push(
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true
    }),
    new transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true
    })
  );
} catch (e) {
  // Logs dir not writable — console-only mode
}

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    }),
    ...fileTransports
  ],
  exitOnError: false
});

/**
 * Create a child logger with a specific context label
 */
logger.child = function (context) {
  return {
    info:  (msg, meta = {}) => logger.info(msg,  { context, ...meta }),
    warn:  (msg, meta = {}) => logger.warn(msg,  { context, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { context, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { context, ...meta })
  };
};

module.exports = logger;
