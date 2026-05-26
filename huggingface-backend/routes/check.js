'use strict';

// ============================================================
// WWAS - POST /check-number Route
// Validates whether phone numbers are registered on WhatsApp
// Supports single and batch validation
// ============================================================

const express = require('express');
const router = express.Router();
const { validateSingle, validateBatch, normalizePhone } = require('../services/validator');
const whatsappService = require('../services/whatsapp');
const logger = require('../services/logger').child('Route:Check');

/**
 * POST /check-number
 *
 * Body (JSON) - Single mode:
 *   phone_number  {string}  Required (if not using batch mode)
 *
 * Body (JSON) - Batch mode:
 *   phone_numbers {string[]} Array of phone numbers (max 100)
 *
 * Response (single):
 *   200 { success: true, phone: "919...", status: "valid"|"not_on_whatsapp"|"invalid"|"failed", registered: bool }
 *
 * Response (batch):
 *   200 { success: true, results: [{phone, status, registered},...], summary: {total, valid, invalid, failed} }
 *
 * Error:
 *   400 { success: false, error: "..." }
 *   503 { success: false, error: "WhatsApp not ready" }
 */
router.post('/', async (req, res) => {
  const { phone_number, phone_numbers } = req.body;

  // ── Check WA Status ───────────────────────────────────────
  const waStatus = whatsappService.getStatus();
  if (!waStatus.isReady) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not ready',
      wa_status: waStatus
    });
  }

  // ── Batch Mode ────────────────────────────────────────────
  if (Array.isArray(phone_numbers)) {
    if (phone_numbers.length === 0) {
      return res.status(400).json({ success: false, error: 'phone_numbers array is empty' });
    }
    if (phone_numbers.length > 100) {
      return res.status(400).json({ success: false, error: 'Batch limit is 100 numbers per request' });
    }

    logger.info('Batch check-number request', { count: phone_numbers.length });

    // Get the Socket.io instance from app locals for progress events
    const io = req.app.get('io');
    const results = await validateBatch(phone_numbers, io);

    const summary = {
      total: results.length,
      valid: results.filter(r => r.status === 'valid').length,
      not_on_whatsapp: results.filter(r => r.status === 'not_on_whatsapp').length,
      invalid: results.filter(r => r.status === 'invalid').length,
      failed: results.filter(r => r.status === 'failed').length
    };

    return res.status(200).json({
      success: true,
      results,
      summary
    });
  }

  // ── Single Mode ───────────────────────────────────────────
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'phone_number (string) or phone_numbers (array) is required'
    });
  }

  const normalized = normalizePhone(phone_number);
  if (!normalized) {
    return res.status(200).json({
      success: true,
      phone: phone_number,
      normalized: null,
      status: 'invalid',
      registered: false,
      error: 'Invalid phone number format'
    });
  }

  logger.info('Single check-number request', { phone: normalized });

  const result = await validateSingle(normalized);

  return res.status(200).json({
    success: true,
    phone: normalized,
    status: result.status,
    registered: result.registered,
    error: result.error || null
  });
});

module.exports = router;
