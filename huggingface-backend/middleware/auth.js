'use strict';

// ============================================================
// WWAS - API Key Authentication Middleware
// Verifies X-API-Key header on all protected routes
// ============================================================

const logger = require('../services/logger').child('Auth');

/**
 * Express middleware that validates the API key
 * Reads from X-API-Key header or api_key query param
 */
function apiKeyAuth(req, res, next) {
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    logger.error('API_KEY environment variable is not set — rejecting all requests');
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration: API key not set'
    });
  }

  // Accept key from header (preferred) or query param (fallback)
  const providedKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.query.api_key;

  if (!providedKey) {
    logger.warn('Request rejected - no API key provided', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: API key required'
    });
  }

  // Constant-time comparison to prevent timing attacks
  if (!_timingSafeEqual(providedKey, expectedKey)) {
    logger.warn('Request rejected - invalid API key', {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid API key'
    });
  }

  next();
}

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _timingSafeEqual(a, b) {
  const crypto = require('crypto');
  try {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) {
      // Still do the comparison to avoid timing leak on length
      crypto.timingSafeEqual(aBuf, aBuf);
      return false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

module.exports = apiKeyAuth;
