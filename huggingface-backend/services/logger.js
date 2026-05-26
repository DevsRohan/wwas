'use strict';

// ============================================================
// WWAS - Winston Logger Service
// Centralized logging for all HF backend modules
// ============================================================

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
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

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Console transport (always on)
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    }),
    // Error log file
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      tailable: true
    }),
    // Combined log file
    new transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    })
  ],
  // Don't exit on uncaught errors
  exitOnError: false
});

/**
 * Create a child logger with a specific context label
 * @param {string} context - Module/service name
 * @returns {object} Child logger with context bound
 */
logger.child = function (context) {
  return {
    info: (msg, meta = {}) => logger.info(msg, { context, ...meta }),
    warn: (msg, meta = {}) => logger.warn(msg, { context, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { context, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { context, ...meta })
  };
};

module.exports = logger;
