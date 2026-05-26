'use strict';

// ============================================================
// WWAS - POST /send-message Route
// Accepts message send requests from Hostinger PHP
// Validates input, queues or sends directly via WhatsApp
// ============================================================

const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp');
const queueService = require('../services/queue');
const { normalizePhone } = require('../services/validator');
const logger = require('../services/logger').child('Route:Send');

/**
 * POST /send-message
 *
 * Body (JSON):
 *   phone_number  {string}  Required. Raw phone number (will be normalized)
 *   message       {string}  Required. Message text to send
 *   lead_id       {string}  Optional. PHP lead ID for webhook correlation
 *   job_id        {string}  Optional. Unique job ID for deduplication
 *   use_queue     {boolean} Optional. Default true. If false, sends immediately (for manual sends)
 *   delay_ms      {number}  Optional. Delay before sending (ms). Used for campaign pacing.
 *
 * Response:
 *   200 { success: true, queued: true, job_id, message: "Queued" }
 *   200 { success: true, queued: false, wa_message_id, message: "Sent" }
 *   400 { success: false, error: "validation error" }
 *   503 { success: false, error: "WhatsApp not ready" }
 */
router.post('/', async (req, res) => {
  const { phone_number, message, lead_id, job_id, use_queue = true, delay_ms = 0 } = req.body;

  // ── Input Validation ──────────────────────────────────────
  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({ success: false, error: 'phone_number is required and must be a string' });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'message is required and must be a non-empty string' });
  }

  if (message.length > 4096) {
    return res.status(400).json({ success: false, error: 'message exceeds maximum length of 4096 characters' });
  }

  // ── Normalize Phone ───────────────────────────────────────
  const normalizedPhone = normalizePhone(phone_number);
  if (!normalizedPhone) {
    return res.status(400).json({ success: false, error: `Invalid phone number format: ${phone_number}` });
  }

  // ── Check WA Status ───────────────────────────────────────
  const waStatus = whatsappService.getStatus();
  if (!waStatus.isReady) {
    logger.warn('Send request rejected - WhatsApp not ready', { phone: normalizedPhone });
    return res.status(503).json({
      success: false,
      error: 'WhatsApp client is not ready. Please ensure WhatsApp is connected.',
      wa_status: waStatus
    });
  }

  // ── Build Job ID ──────────────────────────────────────────
  const effectiveJobId = job_id || `job_${normalizedPhone}_${Date.now()}`;

  logger.info('Send message request received', {
    phone: normalizedPhone,
    jobId: effectiveJobId,
    useQueue: use_queue,
    delayMs: delay_ms
  });

  // ── Queue Mode (default for campaigns) ───────────────────
  if (use_queue) {
    const queued = queueService.enqueue({
      id: effectiveJobId,
      phoneNumber: normalizedPhone,
      message: message.trim(),
      leadId: lead_id || null,
      delayMs: Math.max(0, parseInt(delay_ms, 10) || 0)
    });

    if (!queued) {
      return res.status(200).json({
        success: true,
        queued: false,
        job_id: effectiveJobId,
        message: 'Job already queued or sent (duplicate prevented)',
        duplicate: true
      });
    }

    return res.status(200).json({
      success: true,
      queued: true,
      job_id: effectiveJobId,
      message: 'Message queued successfully'
    });
  }

  // ── Direct Send Mode (for manual replies) ────────────────
  const result = await whatsappService.sendMessage(normalizedPhone, message.trim());

  if (!result.success) {
    logger.error('Direct send failed', { phone: normalizedPhone, error: result.error });
    return res.status(500).json({
      success: false,
      error: result.error || 'Failed to send message'
    });
  }

  logger.info('Direct send successful', { phone: normalizedPhone, waId: result.wa_message_id });

  return res.status(200).json({
    success: true,
    queued: false,
    wa_message_id: result.wa_message_id,
    message: 'Message sent successfully'
  });
});

module.exports = router;
