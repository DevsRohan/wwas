'use strict';

// ============================================================
// WWAS - Phone Number Validator Service
// Validates WhatsApp registration for phone numbers
// Handles batch validation with rate limiting
// ============================================================

const logger = require('./logger').child('Validator');

// Delay between individual validations (ms) to avoid WA rate limiting
const VALIDATION_DELAY_MS = 3000;

/**
 * Normalize a phone number to E.164 format (digits only, no +)
 * Handles Indian numbers with/without country code
 * @param {string} raw - Raw phone number string
 * @returns {string|null} Normalized number or null if invalid
 */
function normalizePhone(raw) {
  if (!raw) return null;

  // Strip everything except digits
  let digits = String(raw).replace(/\D/g, '');

  if (digits.length === 0) return null;

  // Handle Indian numbers
  if (digits.startsWith('91') && digits.length === 12) {
    return digits; // Already has country code
  }
  if (digits.length === 10 && !digits.startsWith('0')) {
    return `91${digits}`; // Add India country code
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `91${digits.slice(1)}`; // Replace leading 0 with 91
  }

  // International: if >= 10 digits and no leading 0, return as-is
  if (digits.length >= 10) {
    return digits;
  }

  return null;
}

/**
 * Validate a single phone number against WhatsApp
 * @param {string} phoneNumber - Normalized phone number (digits only)
 * @returns {Promise<{phone: string, status: string, registered: boolean}>}
 */
async function validateSingle(phoneNumber) {
  const whatsappService = require('./whatsapp');
  const status = whatsappService.getStatus();

  if (!status.isReady) {
    return {
      phone: phoneNumber,
      status: 'failed',
      registered: false,
      error: 'WhatsApp not ready'
    };
  }

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    return {
      phone: phoneNumber,
      status: 'invalid',
      registered: false,
      error: 'Invalid phone number format'
    };
  }

  try {
    const result = await whatsappService.checkNumber(normalized);

    if (result.error) {
      return {
        phone: normalized,
        status: 'failed',
        registered: false,
        error: result.error
      };
    }

    return {
      phone: normalized,
      status: result.registered ? 'valid' : 'not_on_whatsapp',
      registered: result.registered
    };

  } catch (err) {
    logger.error('Validation error', { phone: normalized, error: err.message });
    return {
      phone: normalized,
      status: 'failed',
      registered: false,
      error: err.message
    };
  }
}

/**
 * Validate a batch of phone numbers with rate limiting
 * Emits progress events via Socket.io
 * @param {string[]} phoneNumbers - Array of raw phone numbers
 * @param {import('socket.io').Server} io - Socket.io for progress events
 * @returns {Promise<Array>} Array of validation results
 */
async function validateBatch(phoneNumbers, io) {
  const results = [];
  const total = phoneNumbers.length;

  logger.info('Starting batch validation', { total });

  for (let i = 0; i < total; i++) {
    const phone = phoneNumbers[i];
    const result = await validateSingle(phone);
    results.push(result);

    logger.debug('Validated', { phone: result.phone, status: result.status });

    // Emit progress to frontend
    if (io) {
      io.emit('number_validated', {
        phone: result.phone,
        status: result.status,
        registered: result.registered,
        progress: { current: i + 1, total },
        timestamp: Date.now()
      });
    }

    // Rate limit: wait between validations (except last one)
    if (i < total - 1) {
      await _sleep(VALIDATION_DELAY_MS);
    }
  }

  const validCount = results.filter(r => r.registered).length;
  const invalidCount = results.filter(r => r.status === 'not_on_whatsapp').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  logger.info('Batch validation complete', { total, valid: validCount, invalid: invalidCount, failed: failedCount });

  if (io) {
    io.emit('validation_complete', {
      total,
      valid: validCount,
      invalid: invalidCount,
      failed: failedCount,
      timestamp: Date.now()
    });
  }

  return results;
}

/**
 * Promise-based sleep
 * @param {number} ms
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { validateSingle, validateBatch, normalizePhone };
