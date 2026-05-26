'use strict';

// ============================================================
// Queue Service — Outbound message queue with anti-ban pacing
// Handles: randomized delays, daily limits, retry, dedup,
//          pause/resume, graceful drain, per-lead locking
// ============================================================

const { logger }        = require('./logger.service');
const { emit }          = require('./socket.service');
const webhookService    = require('./webhook.service');

// ── Config ────────────────────────────────────────────────────
const DEFAULT_DELAY_MIN  = parseInt(process.env.QUEUE_DELAY_MIN  || '120',  10) * 1000; // ms
const DEFAULT_DELAY_MAX  = parseInt(process.env.QUEUE_DELAY_MAX  || '300',  10) * 1000; // ms
const DAILY_MAX          = parseInt(process.env.QUEUE_DAILY_MAX  || '100',  10);
const MAX_RETRIES        = parseInt(process.env.QUEUE_MAX_RETRIES || '3',   10);

// ── State ─────────────────────────────────────────────────────
let queue          = [];          // Array of job objects
let isRunning      = false;       // Queue processing loop active
let isPaused       = false;       // Paused by user/system
let currentJob     = null;        // Job currently being processed
let sendCount      = 0;           // Messages sent today
let sendDate       = _todayStr(); // Date string for daily reset
let sendFn         = null;        // Injected WA send function
let processingLoop = null;        // setTimeout handle

// Dedup: track queued phoneNumbers to prevent double-queuing
const queuedPhones = new Set();

// Per-lead lock: prevent concurrent sends to same lead
const lockedLeads  = new Set();

// ── Helpers ───────────────────────────────────────────────────
function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function _randomDelay(minMs = DEFAULT_DELAY_MIN, maxMs = DEFAULT_DELAY_MAX) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _resetDailyCountIfNeeded() {
  const today = _todayStr();
  if (today !== sendDate) {
    logger.info('Daily send count reset', {
      source: 'queue', prevDate: sendDate, count: sendCount,
    });
    sendCount = 0;
    sendDate  = today;
  }
}

function _broadcastQueueState() {
  emit.queueUpdated({
    queueLength:  queue.length,
    isRunning,
    isPaused,
    sendCount,
    dailyLimit:   DAILY_MAX,
    currentJobId: currentJob?.id || null,
  });
}

// ── Inject WA send function (from whatsapp.service) ──────────
/**
 * Must be called at startup to wire the actual send function
 * @param {Function} fn - async (phone, message) => { waMessageId }
 */
const setSendFunction = (fn) => {
  sendFn = fn;
  logger.info('Queue send function registered', { source: 'queue' });
};

// ── Add a job to the queue ────────────────────────────────────
/**
 * @param {object} job
 * @param {string} job.id          - Unique job ID (e.g. lead ID)
 * @param {number} job.leadId      - DB lead ID
 * @param {string} job.phone       - Normalized phone (e.g. 919876543210)
 * @param {string} job.message     - Pre-generated message text
 * @param {string} job.businessName
 * @param {number} [job.delayMin]  - Override min delay (ms)
 * @param {number} [job.delayMax]  - Override max delay (ms)
 * @param {number} [job.retries]   - Current retry count
 * @returns {{ queued: boolean, reason?: string }}
 */
const addJob = (job) => {
  _resetDailyCountIfNeeded();

  if (!job.id || !job.phone || !job.message) {
    return { queued: false, reason: 'Missing required job fields (id, phone, message)' };
  }

  // Dedup: already in queue?
  if (queuedPhones.has(job.phone)) {
    logger.warn('Job already in queue — skipped', {
      source: 'queue', phone: job.phone, jobId: job.id,
    });
    return { queued: false, reason: 'already_queued' };
  }

  // Daily limit check
  if (sendCount >= DAILY_MAX) {
    logger.warn('Daily send limit reached — job rejected', {
      source: 'queue', limit: DAILY_MAX, phone: job.phone,
    });
    return { queued: false, reason: 'daily_limit_reached' };
  }

  const enrichedJob = {
    id:           job.id,
    leadId:       job.leadId,
    phone:        job.phone,
    message:      job.message,
    businessName: job.businessName || '',
    delayMin:     job.delayMin || DEFAULT_DELAY_MIN,
    delayMax:     job.delayMax || DEFAULT_DELAY_MAX,
    retries:      job.retries  || 0,
    addedAt:      Date.now(),
    status:       'queued',
  };

  queue.push(enrichedJob);
  queuedPhones.add(job.phone);

  logger.info('Job added to queue', {
    source:      'queue',
    jobId:       enrichedJob.id,
    phone:       enrichedJob.phone,
    queueLength: queue.length,
  });

  _broadcastQueueState();

  // Auto-start processing if not already running
  if (!isRunning && !isPaused) {
    startProcessing();
  }

  return { queued: true };
};

// ── Add multiple jobs at once ─────────────────────────────────
const addBatch = (jobs = []) => {
  const results = jobs.map((job) => ({ id: job.id, ...addJob(job) }));
  const queued  = results.filter((r) => r.queued).length;
  logger.info('Batch added to queue', {
    source: 'queue', total: jobs.length, queued,
  });
  return results;
};

// ── Remove a specific job by lead ID ─────────────────────────
const removeJob = (leadId) => {
  const before = queue.length;
  const job    = queue.find((j) => j.leadId === leadId);
  if (job) {
    queue = queue.filter((j) => j.leadId !== leadId);
    queuedPhones.delete(job.phone);
    logger.info('Job removed from queue', {
      source: 'queue', leadId, queueLength: queue.length,
    });
    _broadcastQueueState();
    return true;
  }
  return false;
};

// ── Process a single job ──────────────────────────────────────
const _processJob = async (job) => {
  if (!sendFn) {
    logger.error('No send function registered — cannot process job', {
      source: 'queue', jobId: job.id,
    });
    return { success: false, error: 'send_function_not_registered' };
  }

  if (lockedLeads.has(job.leadId)) {
    logger.warn('Lead locked — skipping job', {
      source: 'queue', leadId: job.leadId,
    });
    return { success: false, error: 'lead_locked' };
  }

  lockedLeads.add(job.leadId);

  try {
    logger.info('Sending message via queue', {
      source:  'queue',
      jobId:   job.id,
      leadId:  job.leadId,
      phone:   job.phone,
    });

    const result = await sendFn(job.phone, job.message);

    sendCount++;
    queuedPhones.delete(job.phone);

    logger.info('Queue job sent successfully', {
      source:       'queue',
      jobId:        job.id,
      leadId:       job.leadId,
      waMessageId:  result?.waMessageId,
      sendCount,
    });

    // Notify PHP via webhook
    await webhookService.sendMessageSent({
      leadId:      job.leadId,
      phone:       job.phone,
      message:     job.message,
      waMessageId: result?.waMessageId || null,
      timestamp:   new Date().toISOString(),
    });

    // Broadcast socket event
    emit.messageSent({
      leadId:      job.leadId,
      phone:       job.phone,
      message:     job.message,
      waMessageId: result?.waMessageId || null,
      timestamp:   new Date().toISOString(),
    });

    emit.outreachStopped({
      leadId:  job.leadId,
      reason:  'sent — awaiting reply',
    });

    return { success: true, waMessageId: result?.waMessageId };

  } catch (err) {
    logger.error('Queue job send failed', {
      source:  'queue',
      jobId:   job.id,
      leadId:  job.leadId,
      error:   err.message,
      retries: job.retries,
    });

    queuedPhones.delete(job.phone);

    // Retry logic
    if (job.retries < MAX_RETRIES) {
      const retryJob = { ...job, retries: job.retries + 1, status: 'retry' };
      queue.unshift(retryJob); // put back at front
      queuedPhones.add(job.phone);
      logger.info('Job re-queued for retry', {
        source:  'queue',
        jobId:   job.id,
        attempt: retryJob.retries,
      });
    } else {
      logger.error('Job exceeded max retries — marking failed', {
        source: 'queue', jobId: job.id, leadId: job.leadId,
      });

      // Notify PHP of failure
      await webhookService.deliver('message.failed', {
        leadId:  job.leadId,
        phone:   job.phone,
        error:   err.message,
        retries: job.retries,
      });
    }

    return { success: false, error: err.message };

  } finally {
    lockedLeads.delete(job.leadId);
  }
};

// ── Main processing loop ──────────────────────────────────────
const startProcessing = () => {
  if (isRunning) return;
  isRunning = true;
  isPaused  = false;

  logger.info('Queue processing started', {
    source: 'queue', queueLength: queue.length,
  });

  emit.outreachStarted({ queueLength: queue.length, timestamp: new Date().toISOString() });
  _broadcastQueueState();

  _runNext();
};

const _runNext = async () => {
  if (isPaused || !isRunning) {
    logger.info('Queue loop halted', { source: 'queue', isPaused, isRunning });
    _broadcastQueueState();
    return;
  }

  _resetDailyCountIfNeeded();

  if (sendCount >= DAILY_MAX) {
    logger.warn('Daily limit hit — pausing queue until tomorrow', {
      source: 'queue', sendCount, limit: DAILY_MAX,
    });
    isRunning = false;
    _broadcastQueueState();
    return;
  }

  if (queue.length === 0) {
    logger.info('Queue empty — processing complete', {
      source: 'queue', totalSent: sendCount,
    });
    isRunning  = false;
    currentJob = null;

    emit.campaignComplete({ totalSent: sendCount, timestamp: new Date().toISOString() });
    _broadcastQueueState();
    return;
  }

  // Dequeue next job
  currentJob = queue.shift();

  logger.info('Processing next job', {
    source:      'queue',
    jobId:       currentJob.id,
    remaining:   queue.length,
    sendCount,
  });

  _broadcastQueueState();

  // Process it
  await _processJob(currentJob);
  currentJob = null;

  // Anti-ban: randomized delay before next message
  const delay = _randomDelay(
    queue[0]?.delayMin || DEFAULT_DELAY_MIN,
    queue[0]?.delayMax || DEFAULT_DELAY_MAX,
  );

  logger.info(`Waiting ${Math.round(delay / 1000)}s before next message`, {
    source: 'queue', delaySeconds: Math.round(delay / 1000),
  });

  _broadcastQueueState();

  // Schedule next job after delay
  processingLoop = setTimeout(_runNext, delay);
};

// ── Pause queue ───────────────────────────────────────────────
const pause = () => {
  if (!isRunning) return { paused: false, reason: 'not_running' };
  isPaused = true;
  if (processingLoop) {
    clearTimeout(processingLoop);
    processingLoop = null;
  }
  logger.info('Queue paused', { source: 'queue', remaining: queue.length });
  emit.campaignPaused({ remaining: queue.length, timestamp: new Date().toISOString() });
  _broadcastQueueState();
  return { paused: true };
};

// ── Resume queue ──────────────────────────────────────────────
const resume = () => {
  if (!isPaused) return { resumed: false, reason: 'not_paused' };
  isPaused  = false;
  isRunning = true;
  logger.info('Queue resumed', { source: 'queue', remaining: queue.length });
  emit.campaignResumed({ remaining: queue.length, timestamp: new Date().toISOString() });
  _runNext();
  return { resumed: true };
};

// ── Stop and clear queue ──────────────────────────────────────
const stop = () => {
  isRunning  = false;
  isPaused   = false;
  currentJob = null;
  if (processingLoop) {
    clearTimeout(processingLoop);
    processingLoop = null;
  }
  const cleared = queue.length;
  queue = [];
  queuedPhones.clear();

  logger.info('Queue stopped and cleared', {
    source: 'queue', clearedJobs: cleared,
  });

  emit.outreachStopped({ reason: 'manual_stop', cleared, timestamp: new Date().toISOString() });
  _broadcastQueueState();
  return { stopped: true, cleared };
};

// ── Get queue state (for /health + API) ──────────────────────
const getState = () => ({
  queueLength:  queue.length,
  isRunning,
  isPaused,
  sendCount,
  dailyLimit:   DAILY_MAX,
  sendDate,
  currentJobId: currentJob?.id || null,
  jobs:         queue.map((j) => ({
    id:       j.id,
    leadId:   j.leadId,
    phone:    j.phone,
    retries:  j.retries,
    addedAt:  j.addedAt,
    status:   j.status,
  })),
});

module.exports = {
  setSendFunction,
  addJob,
  addBatch,
  removeJob,
  startProcessing,
  pause,
  resume,
  stop,
  getState,
};
