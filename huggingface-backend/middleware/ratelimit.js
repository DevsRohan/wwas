'use strict';

// ============================================================
// WWAS - Rate Limiter Middleware
// Protects API endpoints from abuse using express-rate-limit
// ============================================================

const rateLimit = require('express-rate-limit');
const logger = require('../services/logger').child('RateLimit');

/**
 * General API rate limiter
 * Applied to all /send-message and /check-number routes
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute window
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),       // 60 requests/min
  standardHeaders: true,   // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,    // Disable X-RateLimit-* legacy headers
  keyGenerator: (req) => {
    // Use X-Forwarded-For for clients behind proxies (HF Spaces uses proxies)
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.headers['x-forwarded-for'] || req.ip,
      path: req.path
    });
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please slow down.',
      retry_after: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

/**
 * Strict limiter for send-message endpoint
 * More conservative to protect WhatsApp account
 */
const sendMessageLimiter = rateLimit({
  windowMs: 60000,   // 1 minute window
  max: 10,           // Max 10 send requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  },
  handler: (req, res) => {
    logger.warn('Send message rate limit exceeded', {
      ip: req.headers['x-forwarded-for'] || req.ip
    });
    res.status(429).json({
      success: false,
      error: 'Send rate limit exceeded. Max 10 messages per minute.',
      retry_after: 60
    });
  }
});

module.exports = { apiLimiter, sendMessageLimiter };
