'use strict';

// ============================================================
// WWAS - Outbound Message Queue Service
// In-memory queue with rate limiting and deduplication
// ============================================================

const logger = require('./logger').child('Queue');

// Queue state
let _queue = [];            // Array of pending job objects
let _processing = false;    // Whether the processor loop is running
let _paused = false;        // Whether queue is paused
let _io = null;             // Socket.io for broadcasting progress

// Track sent message IDs to prevent duplicate sends
const _sentIds = new Set();

// Stats
let _stats = {
  totalQueued: 0,
  totalSent: 0,
  totalFailed: 0,
  totalSkipped: 0
};

/**
 * Initialize queue with Socket.io instance
 * @param {import('socket.io').Server} io
 */
function init(io) {
  _io = io;
  logger.info('Queue service initialized');
}

/**
 * Emit event to all connected clients
 */
function _emit(event, data) {
  if (_io) {
    _io.emit(event, data);
  }
}

/**
 * Add a message job to the queue
 * @param {object} job
 * @param {string} job.id          - Unique job ID (used for dedup)
 * @param {string} job.phoneNumber - Destination phone
 * @param {string} job.message     - Message text
 * @param {string} job.leadId      - PHP lead ID (for webhook correlation)
 * @param {number} [job.delayMs]   - Delay before sending (ms)
 * @returns {boolean} Whether the job was queued (false if duplicate)
 */
function enqueue(job) {
  if (!job.id || !job.phoneNumber || !job.message) {
    logger.warn('Invalid job - missing required fields', { job });
    return false;
  }

  // Deduplication check
  if (_sentIds.has(job.id)) {
    logger.warn('Duplicate job ignored', { jobId: job.id });
    _stats.totalSkipped++;
    return false;
  }

  // Check if already in queue
  const alreadyQueued = _queue.some(q => q.id === job.id);
  if (alreadyQueued) {
    logger.warn('Job already in queue', { jobId: job.id });
    return false;
  }

  _queue.push({
    id: job.id,
    phoneNumber: job.phoneNumber,
    message: job.message,
    leadId: job.leadId || null,
    delayMs: job.delayMs || 0,
    retries: 0,
    maxRetries: 3,
    enqueuedAt: Date.now()
  });

  _stats.totalQueued++;
  logger.info('Job enqueued', { jobId: job.id, phone: job.phoneNumber, queueSize: _queue.length });
  _emit('campaign_progress', { ..._stats, queueSize: _queue.length });

  // Start processor if not running
  if (!_processing && !_paused) {
    _startProcessor();
  }

  return true;
}

/**
 * Start the async queue processor loop
 */
async function _startProcessor() {
  if (_processing) return;
  _processing = true;
  logger.info('Queue processor started');

  const whatsappService = require('./whatsapp');
  const webhookService = require('./webhook');

  while (_queue.length > 0 && !_paused) {
    const job = _queue[0]; // Peek at next job

    // Wait for any delay on this job
    if (job.delayMs > 0) {
      logger.debug(`Waiting ${job.delayMs}ms before sending job`, { jobId: job.id });
      await _sleep(job.delayMs);
      // IMPORTANT: Reset delayMs to 0 after sleeping so re-queued retries
      // don't sleep the same duration again on the next loop iteration.
      job.delayMs = 0;
    }

    // After sleep, check if queue was paused or job was removed
    if (_paused) break;
    if (_queue.length === 0 || _queue[0].id !== job.id) continue;

    // Check if WhatsApp is ready
    const status = whatsappService.getStatus();
    if (!status.isReady) {
      logger.warn('WhatsApp not ready, pausing queue processor for 30s');
      await _sleep(30000);
      continue;
    }

    // Remove from queue (process it)
    _queue.shift();

    logger.info('Processing job', { jobId: job.id, phone: job.phoneNumber });
    _emit('outreach_started', { jobId: job.id, phone: job.phoneNumber, timestamp: Date.now() });

    const result = await whatsappService.sendMessage(job.phoneNumber, job.message);

    if (result.success) {
      _sentIds.add(job.id);
      _stats.totalSent++;
      logger.info('Job sent successfully', { jobId: job.id, waId: result.wa_message_id });

      await webhookService.deliver('message_sent', {
        job_id: job.id,
        lead_id: job.leadId,
        phone_number: job.phoneNumber,
        wa_message_id: result.wa_message_id,
        status: 'sent',
        timestamp: Date.now()
      });

    } else {
      job.retries++;
      _stats.totalFailed++;
      logger.error('Job failed', { jobId: job.id, error: result.error, retries: job.retries });

      if (job.retries < job.maxRetries) {
        // Re-queue with backoff delay
        const retryDelay = job.retries * 60000; // 1min, 2min, 3min
        job.delayMs = retryDelay;
        _queue.unshift(job); // Put back at front
        logger.info(`Job re-queued for retry ${job.retries}/${job.maxRetries}`, { jobId: job.id, retryDelay });
      } else {
        logger.error('Job exhausted all retries', { jobId: job.id });
        await webhookService.deliver('message_failed', {
          job_id: job.id,
          lead_id: job.leadId,
          phone_number: job.phoneNumber,
          error: result.error,
          timestamp: Date.now()
        });
      }
    }

    _emit('campaign_progress', { ..._stats, queueSize: _queue.length });
  }

  _processing = false;

  if (_queue.length === 0 && !_paused) {
    logger.info('Queue fully processed', { stats: _stats });
    _emit('outreach_stopped', { reason: 'completed', stats: _stats, timestamp: Date.now() });
  } else if (_paused) {
    logger.info('Queue paused', { remaining: _queue.length });
    _emit('outreach_stopped', { reason: 'paused', queueSize: _queue.length, timestamp: Date.now() });
  }
}

/**
 * Pause the queue (current job completes, next ones wait)
 */
function pause() {
  _paused = true;
  logger.info('Queue paused by user');
  _emit('outreach_stopped', { reason: 'paused', queueSize: _queue.length, timestamp: Date.now() });
}

/**
 * Resume a paused queue
 */
function resume() {
  _paused = false;
  logger.info('Queue resumed');
  _emit('outreach_started', { reason: 'resumed', queueSize: _queue.length, timestamp: Date.now() });
  if (!_processing && _queue.length > 0) {
    _startProcessor();
  }
}

/**
 * Clear the entire queue
 */
function clear() {
  const cleared = _queue.length;
  _queue = [];
  _paused = false;
  logger.info('Queue cleared', { cleared });
  _emit('campaign_progress', { ..._stats, queueSize: 0 });
}

/**
 * Get current queue state
 */
function getState() {
  return {
    size: _queue.length,
    processing: _processing,
    paused: _paused,
    stats: { ..._stats }
  };
}

/**
 * Reset stats counters
 */
function resetStats() {
  _stats = { totalQueued: 0, totalSent: 0, totalFailed: 0, totalSkipped: 0 };
  _sentIds.clear();
}

/**
 * Promise-based sleep helper
 * @param {number} ms
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { init, enqueue, pause, resume, clear, getState, resetStats };
