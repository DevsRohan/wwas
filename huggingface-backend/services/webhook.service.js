'use strict';

// ============================================================
// Webhook Service — Delivers events from HF Node → Hostinger PHP
// Handles: retry logic, HMAC signing, deduplication, queue
// ============================================================

const axios       = require('axios');
const crypto      = require('crypto');
const { logger }  = require('./logger.service');

// ── Config ────────────────────────────────────────────────────
const HOSTINGER_WEBHOOK_URL  = process.env.HOSTINGER_WEBHOOK_URL  || '';
const WEBHOOK_SECRET         = process.env.WEBHOOK_SECRET         || '';
const RETRY_ATTEMPTS         = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3', 10);
const RETRY_DELAY_MS         = parseInt(process.env.WEBHOOK_RETRY_DELAY    || '2000', 10);
const REQUEST_TIMEOUT_MS     = 10000;

// ── Deduplication: track recently sent webhook IDs ───────────
const sentWebhooks = new Set();
const DEDUP_TTL_MS = 30000; // 30 seconds

const trackWebhook = (id) => {
  sentWebhooks.add(id);
  setTimeout(() => sentWebhooks.delete(id), DEDUP_TTL_MS);
};

const isDuplicate = (id) => sentWebhooks.has(id);

// ── Generate HMAC-SHA256 signature ───────────────────────────
const generateSignature = (payload) => {
  if (!WEBHOOK_SECRET) return null;
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
};

// ── Sleep helper ──────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Core delivery function (single attempt) ──────────────────
const deliverOnce = async (event, data, webhookId) => {
  if (!HOSTINGER_WEBHOOK_URL) {
    throw new Error('HOSTINGER_WEBHOOK_URL not configured');
  }

  // ── Payload structure matched to PHP webhook.php expectations ──
  // PHP reads: $payload['event'], $payload['payload'], $payload['delivery_id']
  // PHP signature header: HTTP_X_WWAS_SIGNATURE
  const payload = {
    event,
    payload:     data,          // PHP uses $data = $payload['payload']
    delivery_id: webhookId,     // PHP uses $deliveryId = $payload['delivery_id']
    timestamp:   new Date().toISOString(),
  };

  const body      = JSON.stringify(payload);
  const signature = generateSignature(body);

  const headers = {
    'Content-Type':     'application/json',
    'X-Webhook-Source': 'whatsapp-crm-engine',
    'X-Webhook-Id':     webhookId,
    'X-Timestamp':      Date.now().toString(),
  };

  // PHP reads: $_SERVER['HTTP_X_WWAS_SIGNATURE']
  // (HTTP header X-Wwas-Signature → PHP converts to HTTP_X_WWAS_SIGNATURE)
  if (signature) {
    headers['X-Wwas-Signature'] = `sha256=${signature}`;
  }

  const response = await axios.post(HOSTINGER_WEBHOOK_URL, body, {
    headers,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  return response;
};

// ── Deliver with retry logic ──────────────────────────────────
/**
 * @param {string} event  - e.g. 'message.received', 'lead.replied'
 * @param {object} data   - event payload
 * @param {string} [id]   - optional idempotency key
 */
const deliver = async (event, data = {}, id = null) => {
  const webhookId = id || `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Deduplication check
  if (isDuplicate(webhookId)) {
    logger.warn('Webhook duplicate skipped', { source: 'webhook', event, webhookId });
    return { success: true, duplicate: true };
  }

  trackWebhook(webhookId);

  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await deliverOnce(event, data, webhookId);

      logger.info('Webhook delivered', {
        source:    'webhook',
        event,
        webhookId,
        attempt,
        status:    response.status,
      });

      return { success: true, attempt, status: response.status, webhookId };

    } catch (err) {
      lastError = err;
      const isLast = attempt === RETRY_ATTEMPTS;

      logger.warn(`Webhook attempt ${attempt}/${RETRY_ATTEMPTS} failed`, {
        source:    'webhook',
        event,
        webhookId,
        attempt,
        error:     err.message,
        status:    err.response?.status,
      });

      if (!isLast) {
        // Exponential backoff: 2s, 4s, 8s...
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  logger.error('Webhook delivery failed after all retries', {
    source:    'webhook',
    event,
    webhookId,
    attempts:  RETRY_ATTEMPTS,
    error:     lastError?.message,
  });

  return {
    success:   false,
    webhookId,
    attempts:  RETRY_ATTEMPTS,
    error:     lastError?.message,
  };
};

// ── Named event senders ───────────────────────────────────────
// NOTE: event names matched to PHP webhook.php switch() cases:
//   'inbound_message'  → handleInboundMessage()
//   'message_sent'     → handleOutboundConfirm()
//   'message_failed'   → handleMessageFailed()
const sendMessageReceived = (messageData) =>
  deliver('inbound_message', {
    phone_number:   messageData.phone,
    message_text:   messageData.body,
    wa_message_id:  messageData.waMessageId,
    timestamp:      messageData.timestamp ? new Date(messageData.timestamp).getTime() : Date.now(),
  }, `msg-in-${messageData.waMessageId || Date.now()}`);

const sendMessageSent = (messageData) =>
  deliver('message_sent', {
    phone_number:   messageData.phone,
    wa_message_id:  messageData.waMessageId,
    lead_id:        messageData.leadId,
  }, `msg-out-${messageData.waMessageId || Date.now()}`);

const sendMessageStatus = (statusData) =>
  deliver('message_sent', {
    phone_number:   statusData.phone,
    wa_message_id:  statusData.waMessageId,
    lead_id:        statusData.leadId || null,
    status:         statusData.status,
  }, `msg-status-${statusData.waMessageId}-${statusData.status}`);

const sendLeadReplied = (leadData) =>
  deliver('inbound_message', leadData, `lead-replied-${leadData.leadId || leadData.phone}`);

const sendLeadValidated = (validationData) =>
  deliver('lead.validated', validationData, `lead-validated-${validationData.phone}-${Date.now()}`);

const sendWAStatus = (statusData) =>
  deliver('whatsapp.status', statusData, `wa-status-${statusData.status}-${Date.now()}`);

const sendQueueUpdate = (queueData) =>
  deliver('queue.update', queueData, `queue-${Date.now()}`);

module.exports = {
  deliver,
  sendMessageReceived,
  sendMessageSent,
  sendMessageStatus,
  sendLeadReplied,
  sendLeadValidated,
  sendWAStatus,
  sendQueueUpdate,
};
