'use strict';

// ============================================================
// WWAS - Webhook Delivery Service
// Delivers events from HF Node.js engine to Hostinger PHP
// Includes HMAC signing, retry logic, and deduplication
// ============================================================

const axios = require('axios');
const crypto = require('crypto');
const logger = require('./logger').child('Webhook');

// Delivery tracking to prevent duplicate webhooks
const _deliveredIds = new Set();
const MAX_DELIVERED_CACHE = 5000; // Prevent unbounded growth

/**
 * Deliver a webhook event to the Hostinger PHP backend
 * @param {string} eventType - Event name e.g. 'inbound_message', 'message_sent'
 * @param {object} payload   - Event data
 * @returns {Promise<boolean>} Whether delivery succeeded
 */
async function deliver(eventType, payload) {
  const webhookUrl = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl) {
    logger.warn('WEBHOOK_URL not configured, skipping delivery', { eventType });
    return false;
  }

  // Build delivery ID for deduplication
  const deliveryId = _buildDeliveryId(eventType, payload);

  if (_deliveredIds.has(deliveryId)) {
    logger.debug('Duplicate webhook delivery skipped', { deliveryId, eventType });
    return true;
  }

  const body = {
    event: eventType,
    payload,
    delivered_at: new Date().toISOString(),
    delivery_id: deliveryId
  };

  const maxAttempts = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3', 10);
  const retryDelay = parseInt(process.env.WEBHOOK_RETRY_DELAY_MS || '2000', 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const bodyStr = JSON.stringify(body);
      const headers = {
        'Content-Type': 'application/json',
        'X-WWAS-Event': eventType,
        'X-WWAS-Delivery': deliveryId,
        'User-Agent': 'WWAS-HF-Engine/1.0'
      };

      // Add HMAC signature if secret is configured
      if (secret) {
        const sig = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
        headers['X-WWAS-Signature'] = `sha256=${sig}`;
      }

      const response = await axios.post(webhookUrl, body, {
        headers,
        timeout: 10000, // 10 second timeout
        validateStatus: (status) => status >= 200 && status < 300
      });

      // Mark as delivered to prevent duplicates
      _deliveredIds.add(deliveryId);
      if (_deliveredIds.size > MAX_DELIVERED_CACHE) {
        // Remove oldest entries (Set preserves insertion order)
        const first = _deliveredIds.values().next().value;
        _deliveredIds.delete(first);
      }

      logger.info('Webhook delivered successfully', {
        eventType,
        deliveryId,
        attempt,
        statusCode: response.status
      });
      return true;

    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      const statusCode = err.response ? err.response.status : null;

      logger.warn(`Webhook delivery attempt ${attempt}/${maxAttempts} failed`, {
        eventType,
        deliveryId,
        error: err.message,
        statusCode
      });

      if (!isLastAttempt) {
        await _sleep(retryDelay * attempt); // Exponential-ish backoff
      } else {
        logger.error('Webhook delivery exhausted all retries', { eventType, deliveryId });
      }
    }
  }

  return false;
}

/**
 * Build a deterministic delivery ID for deduplication
 * @param {string} eventType
 * @param {object} payload
 * @returns {string}
 */
function _buildDeliveryId(eventType, payload) {
  // Use wa_message_id if available (most reliable dedup key)
  if (payload.wa_message_id) {
    return `${eventType}:${payload.wa_message_id}`;
  }
  // Fall back to phone + timestamp window (5-second bucket)
  const timeBucket = Math.floor(Date.now() / 5000);
  const key = `${eventType}:${payload.phone_number || 'unknown'}:${timeBucket}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

/**
 * Promise-based sleep
 * @param {number} ms
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { deliver };
