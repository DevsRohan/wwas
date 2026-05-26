'use strict';

// ============================================================
// WhatsApp Service — whatsapp-web.js client management
// Handles: QR generation, auth, reconnect, send, validate,
//          inbound message routing, session persistence,
//          health monitoring, graceful shutdown
// ============================================================

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode         = require('qrcode');
const { logger }     = require('./logger.service');
const { emit }       = require('./socket.service');
const webhookService = require('./webhook.service');
const queueService   = require('./queue.service');

// ── Config ────────────────────────────────────────────────────
const SESSION_PATH    = process.env.WA_SESSION_PATH  || './wa_session';
const SESSION_ID      = process.env.WA_SESSION_ID    || 'whatsapp-crm-default';
const AUTO_RESTART    = process.env.WA_AUTO_RESTART  !== 'false';
const HEALTH_INTERVAL = parseInt(process.env.WA_HEALTH_CHECK_INTERVAL || '30000', 10);

// Use system chromium installed via apt in Dockerfile
const CHROMIUM_PATH   = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

// ── State ─────────────────────────────────────────────────────
let client          = null;
let clientStatus    = 'disconnected'; // disconnected|connecting|qr_ready|connected|auth_failure
let currentQR       = null;
let connectedPhone  = null;
let connectedName   = null;
let lastPing        = null;
let healthTimer     = null;
let restartTimer    = null;
let isDestroying    = false;

// Stats
const stats = {
  messagesSent:     0,
  messagesReceived: 0,
  validationChecks: 0,
  reconnectCount:   0,
  startedAt:        null,
};

// ── Build Puppeteer launch args (HF Spaces compatible) ────────
const _puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--metrics-recording-only',
  '--mute-audio',
  '--safebrowsing-disable-auto-update',
  '--single-process',
];

// ── Create client instance ────────────────────────────────────
const _createClient = () => {
  return new Client({
    authStrategy: new LocalAuth({
      clientId:   SESSION_ID,
      dataPath:   SESSION_PATH,
    }),
    puppeteer: {
      headless:               true,
      executablePath:         CHROMIUM_PATH,
      args:                   _puppeteerArgs,
      timeout:                60000,
      protocolTimeout:        120000,
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs:  10000,
  });
};

// ── Register all client event listeners ──────────────────────
const _bindEvents = (c) => {

  // ── QR Code ───────────────────────────────────────────────
  c.on('qr', async (qr) => {
    clientStatus = 'qr_ready';
    currentQR    = qr;

    logger.info('QR code generated — scan with WhatsApp', { source: 'whatsapp' });

    // Convert to base64 PNG for easy frontend display
    try {
      const qrBase64 = await qrcode.toDataURL(qr);
      emit.waQR(qrBase64);

      // Also notify PHP
      await webhookService.sendWAStatus({
        status:    'qr_ready',
        qrBase64,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('QR encode failed', { source: 'whatsapp', error: err.message });
      emit.waQR(qr); // fallback: send raw QR string
    }
  });

  // ── Loading screen ────────────────────────────────────────
  c.on('loading_screen', (percent, message) => {
    clientStatus = 'connecting';
    logger.info(`WA loading: ${percent}% — ${message}`, { source: 'whatsapp' });
    emit.broadcast('whatsapp:loading', { percent, message });
  });

  // ── Authenticated ─────────────────────────────────────────
  c.on('authenticated', () => {
    clientStatus = 'connecting';
    currentQR    = null;
    logger.info('WhatsApp authenticated successfully', { source: 'whatsapp' });
  });

  // ── Auth failure ──────────────────────────────────────────
  c.on('auth_failure', async (msg) => {
    clientStatus = 'auth_failure';
    logger.error('WhatsApp auth failure', { source: 'whatsapp', message: msg });

    emit.waAuthFailure(msg);

    await webhookService.sendWAStatus({
      status:    'auth_failure',
      message:   msg,
      timestamp: new Date().toISOString(),
    });

    // Auto-restart after auth failure
    if (AUTO_RESTART && !isDestroying) {
      logger.info('Scheduling restart after auth failure (15s)', { source: 'whatsapp' });
      restartTimer = setTimeout(() => initialize(), 15000);
    }
  });

  // ── Ready ─────────────────────────────────────────────────
  c.on('ready', async () => {
    clientStatus = 'connected';
    currentQR    = null;
    lastPing     = new Date().toISOString();
    stats.startedAt = stats.startedAt || new Date().toISOString();

    try {
      const info       = c.info;
      connectedPhone   = info?.wid?.user   || null;
      connectedName    = info?.pushname    || null;

      logger.info('WhatsApp client READY', {
        source: 'whatsapp',
        phone:  connectedPhone,
        name:   connectedName,
      });

      const payload = {
        status:    'connected',
        phone:     connectedPhone,
        name:      connectedName,
        timestamp: new Date().toISOString(),
      };

      emit.waReady(payload);

      await webhookService.sendWAStatus(payload);

    } catch (err) {
      logger.error('Error reading WA info on ready', {
        source: 'whatsapp', error: err.message,
      });
    }

    // Wire queue send function
    queueService.setSendFunction(sendMessage);

    // Start health monitoring
    _startHealthCheck();
  });

  // ── Disconnected ──────────────────────────────────────────
  c.on('disconnected', async (reason) => {
    clientStatus   = 'disconnected';
    connectedPhone = null;
    connectedName  = null;
    currentQR      = null;

    logger.warn('WhatsApp disconnected', { source: 'whatsapp', reason });

    emit.waDisconnected(reason);

    await webhookService.sendWAStatus({
      status:    'disconnected',
      reason,
      timestamp: new Date().toISOString(),
    });

    _stopHealthCheck();

    if (AUTO_RESTART && !isDestroying) {
      stats.reconnectCount++;
      logger.info('Scheduling WA restart (10s)', {
        source: 'whatsapp', reconnectCount: stats.reconnectCount,
      });
      emit.waReconnecting();
      restartTimer = setTimeout(() => initialize(), 10000);
    }
  });

  // ── Inbound message ───────────────────────────────────────
  c.on('message', async (msg) => {
    // Ignore group messages, status broadcasts, non-text for now
    if (msg.isGroupMsg || msg.from === 'status@broadcast') return;
    if (msg.type !== 'chat' && msg.type !== 'image' && msg.type !== 'document') {
      // Still track it but mark type
    }

    stats.messagesReceived++;

    // Extract phone number (remove @c.us suffix)
    const phone = msg.from.replace('@c.us', '').replace(/\D/g, '');

    const messageData = {
      waMessageId: msg.id?.id  || msg.id?._serialized || null,
      phone,
      from:        msg.from,
      body:        msg.body,
      type:        msg.type,
      timestamp:   new Date(msg.timestamp * 1000).toISOString(),
      isForwarded: msg.isForwarded || false,
    };

    logger.info('Inbound message received', {
      source: 'whatsapp',
      phone,
      msgId:  messageData.waMessageId,
      type:   msg.type,
    });

    // Broadcast to socket clients
    emit.messageReceived(messageData);

    // Deliver to PHP via webhook
    await webhookService.sendMessageReceived(messageData);

    // Remove from queue if this lead was in outreach
    // (PHP webhook.php will update DB — queue removal is safety net)
    queueService.removeJob(phone);
  });

  // ── Outbound message ack ──────────────────────────────────
  c.on('message_create', async (msg) => {
    if (!msg.fromMe) return;

    const phone = msg.to.replace('@c.us', '').replace(/\D/g, '');

    const statusData = {
      waMessageId: msg.id?.id || msg.id?._serialized || null,
      phone,
      status:      'sent',
      timestamp:   new Date().toISOString(),
    };

    await webhookService.sendMessageStatus(statusData);
    emit.messageStatus(statusData);
  });

  // ── Message ACK (delivered / read) ───────────────────────
  c.on('message_ack', async (msg, ack) => {
    // ack: 1=sent, 2=delivered, 3=read, 4=played
    const ackMap = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
    const status = ackMap[ack] || 'unknown';

    const phone = msg.to?.replace('@c.us', '').replace(/\D/g, '') || '';

    const statusData = {
      waMessageId: msg.id?.id || msg.id?._serialized || null,
      phone,
      status,
      ack,
      timestamp: new Date().toISOString(),
    };

    await webhookService.sendMessageStatus(statusData);
    emit.messageStatus(statusData);
  });
};

// ── Health check loop ─────────────────────────────────────────
const _startHealthCheck = () => {
  _stopHealthCheck();
  healthTimer = setInterval(async () => {
    try {
      if (!client || clientStatus !== 'connected') return;
      const state = await client.getState();
      lastPing    = new Date().toISOString();

      if (state !== 'CONNECTED') {
        logger.warn('WA health check: not connected', { source: 'whatsapp', state });
        if (AUTO_RESTART && !isDestroying) {
          await client.destroy().catch(() => {});
        }
      }
    } catch (err) {
      logger.error('WA health check error', { source: 'whatsapp', error: err.message });
    }
  }, HEALTH_INTERVAL);
};

const _stopHealthCheck = () => {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
};

// ── Initialize / restart client ───────────────────────────────
const initialize = async () => {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  // Destroy existing client first
  if (client) {
    isDestroying = true;
    try {
      await client.destroy();
    } catch (_) {}
    client       = null;
    isDestroying = false;
  }

  clientStatus = 'connecting';
  logger.info('Initializing WhatsApp client', { source: 'whatsapp', sessionId: SESSION_ID });

  try {
    client = _createClient();
    _bindEvents(client);
    await client.initialize();
  } catch (err) {
    clientStatus = 'disconnected';
    logger.error('WA client initialization failed', {
      source: 'whatsapp', error: err.message,
    });

    if (AUTO_RESTART && !isDestroying) {
      logger.info('Retry initialization in 20s', { source: 'whatsapp' });
      restartTimer = setTimeout(() => initialize(), 20000);
    }
  }
};

// ── Send a message ────────────────────────────────────────────
/**
 * @param {string} phone   - Normalized phone without + (e.g. 919876543210)
 * @param {string} message - Message text
 * @returns {{ waMessageId: string|null }}
 */
const sendMessage = async (phone, message) => {
  if (!client || clientStatus !== 'connected') {
    throw new Error('WhatsApp client not connected');
  }

  if (!phone || !message) {
    throw new Error('Phone and message are required');
  }

  const chatId = `${phone}@c.us`;

  try {
    const sentMsg = await client.sendMessage(chatId, message);
    stats.messagesSent++;

    const waMessageId = sentMsg?.id?.id || sentMsg?.id?._serialized || null;

    logger.info('Message sent successfully', {
      source: 'whatsapp',
      phone,
      waMessageId,
    });

    return { waMessageId };

  } catch (err) {
    logger.error('Failed to send message', {
      source: 'whatsapp',
      phone,
      error:  err.message,
    });
    throw err;
  }
};

// ── Check if number is on WhatsApp ────────────────────────────
/**
 * @param {string} phone - Normalized phone (e.g. 919876543210)
 * @returns {{ phone, isRegistered: boolean, status: string }}
 */
const checkNumber = async (phone) => {
  if (!client || clientStatus !== 'connected') {
    throw new Error('WhatsApp client not connected');
  }

  if (!phone) {
    throw new Error('Phone number required');
  }

  stats.validationChecks++;

  const chatId = `${phone}@c.us`;

  try {
    const isRegistered = await client.isRegisteredUser(chatId);

    logger.info('Number validation result', {
      source: 'whatsapp',
      phone,
      isRegistered,
    });

    return {
      phone,
      isRegistered,
      status: isRegistered ? 'valid' : 'not_on_whatsapp',
    };

  } catch (err) {
    logger.error('Number validation failed', {
      source: 'whatsapp',
      phone,
      error:  err.message,
    });

    return {
      phone,
      isRegistered: false,
      status:       'failed',
      error:        err.message,
    };
  }
};

// ── Validate a batch of numbers ───────────────────────────────
/**
 * @param {string[]} phones
 * @param {number}   delayMs - delay between checks (default 1500ms)
 */
const checkNumberBatch = async (phones = [], delayMs = 1500) => {
  const results = [];

  for (const phone of phones) {
    const result = await checkNumber(phone);
    results.push(result);

    // Notify PHP + socket per validation
    await webhookService.sendLeadValidated(result);
    emit.leadValidated(result);

    // Small delay between checks to avoid rate limits
    if (phones.indexOf(phone) < phones.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logger.info('Batch validation complete', {
    source: 'whatsapp',
    total:  phones.length,
    valid:  results.filter((r) => r.isRegistered).length,
  });

  return results;
};

// ── Get current status ────────────────────────────────────────
const getStatus = () => ({
  status:        clientStatus,
  phone:         connectedPhone,
  name:          connectedName,
  hasQR:         currentQR !== null,
  lastPing,
  stats,
  queueState:    queueService.getState(),
});

// ── Get current QR (base64 or raw string) ────────────────────
const getQR = () => currentQR;

// ── Graceful shutdown ─────────────────────────────────────────
const shutdown = async () => {
  logger.info('WhatsApp service shutting down gracefully', { source: 'whatsapp' });

  isDestroying = true;
  _stopHealthCheck();

  if (restartTimer) clearTimeout(restartTimer);

  queueService.stop();

  if (client) {
    try {
      await client.destroy();
    } catch (err) {
      logger.warn('Error during WA destroy', { source: 'whatsapp', error: err.message });
    }
    client = null;
  }

  clientStatus = 'disconnected';
  logger.info('WhatsApp service shutdown complete', { source: 'whatsapp' });
};

// ── Logout and clear session ──────────────────────────────────
const logout = async () => {
  if (!client) throw new Error('No active client');

  try {
    await client.logout();
    logger.info('WhatsApp logged out', { source: 'whatsapp' });
  } catch (err) {
    logger.error('Logout error', { source: 'whatsapp', error: err.message });
    throw err;
  }
};

module.exports = {
  initialize,
  sendMessage,
  checkNumber,
  checkNumberBatch,
  getStatus,
  getQR,
  shutdown,
  logout,
};
