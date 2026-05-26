'use strict';

// ============================================================
// WWAS - WhatsApp Client Manager Service
// Manages whatsapp-web.js client lifecycle, QR, reconnect
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const logger = require('./logger').child('WhatsApp');

let _io = null;         // Socket.io server instance
let _client = null;     // WhatsApp client instance
let _isReady = false;   // Whether WA is authenticated and ready
let _isInitializing = false;
let _qrData = null;     // Latest QR code (base64 PNG)
let _reconnectTimer = null;
let _reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 15000; // 15 seconds between reconnect tries

/**
 * Initialize the WhatsApp service with the Socket.io instance
 * @param {import('socket.io').Server} io
 */
function init(io) {
  _io = io;
  logger.info('WhatsApp service initialized');
  _startClient();
}

/**
 * Emit an event to all connected Socket.io clients
 * @param {string} event
 * @param {*} data
 */
function _emit(event, data) {
  if (_io) {
    _io.emit(event, data);
  }
}

/**
 * Build Puppeteer args safe for Hugging Face / headless Linux containers
 */
function _getPuppeteerArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--safebrowsing-disable-auto-update'
  ];
}

/**
 * Start (or restart) the WhatsApp client
 */
function _startClient() {
  if (_isInitializing) {
    logger.warn('Client already initializing, skipping duplicate start');
    return;
  }

  _isInitializing = true;
  _isReady = false;
  _qrData = null;

  const sessionDir = process.env.WA_SESSION_DIR || path.join(__dirname, '..', 'wa_session');
  const clientId = process.env.WA_CLIENT_ID || 'wwas-client';

  logger.info('Starting WhatsApp client', { sessionDir, clientId });

  _client = new Client({
    authStrategy: new LocalAuth({
      clientId,
      dataPath: sessionDir
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: _getPuppeteerArgs(),
      timeout: 120000
    },
    // Reduce memory by not keeping old messages in RAM
    webVersionCache: {
      type: 'none'
    }
  });

  // ── QR Code ──────────────────────────────────────────────
  _client.on('qr', async (qr) => {
    logger.info('QR code received, broadcasting to clients');
    try {
      // Convert QR string to base64 PNG for easy frontend display
      const qrBase64 = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'M', width: 300 });
      _qrData = qrBase64;
      _emit('qr_code', { qr: qrBase64, timestamp: Date.now() });
    } catch (err) {
      logger.error('Failed to convert QR to base64', { error: err.message });
      // Fallback: send raw QR string
      _emit('qr_code', { qr_raw: qr, timestamp: Date.now() });
    }
  });

  // ── Authenticated ─────────────────────────────────────────
  _client.on('authenticated', () => {
    logger.info('WhatsApp authenticated successfully');
    _emit('whatsapp_authenticated', { timestamp: Date.now() });
  });

  // ── Ready ─────────────────────────────────────────────────
  _client.on('ready', () => {
    _isReady = true;
    _isInitializing = false;
    _reconnectAttempts = 0;
    _qrData = null;
    logger.info('WhatsApp client is READY');
    _emit('whatsapp_ready', { timestamp: Date.now(), status: 'connected' });
  });

  // ── Disconnected ──────────────────────────────────────────
  _client.on('disconnected', (reason) => {
    _isReady = false;
    _isInitializing = false;
    logger.warn('WhatsApp disconnected', { reason });
    _emit('whatsapp_disconnected', { reason, timestamp: Date.now() });
    _scheduleReconnect();
  });

  // ── Auth Failure ──────────────────────────────────────────
  _client.on('auth_failure', (msg) => {
    _isReady = false;
    _isInitializing = false;
    logger.error('WhatsApp auth failure', { msg });
    _emit('whatsapp_auth_failure', { message: msg, timestamp: Date.now() });
    // Auth failure usually means session is invalid; try fresh
    _scheduleReconnect(true);
  });

  // ── Incoming Message ──────────────────────────────────────
  _client.on('message', async (msg) => {
    try {
      await _handleInboundMessage(msg, 'message');
    } catch (err) {
      logger.error('Error handling inbound message', { error: err.message });
    }
  });

  // ── Message Create (outbound confirmation) ────────────────
  _client.on('message_create', async (msg) => {
    if (msg.fromMe) {
      try {
        await _handleOutboundConfirmation(msg);
      } catch (err) {
        logger.error('Error handling outbound message_create', { error: err.message });
      }
    }
  });

  // ── Message ACK (delivered/read status) ──────────────────
  _client.on('message_ack', (msg, ack) => {
    // ack: 1=sent, 2=delivered, 3=read, 4=played
    const statusMap = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
    const status = statusMap[ack] || 'unknown';
    _emit('message_ack', {
      wa_message_id: msg.id._serialized,
      status,
      timestamp: Date.now()
    });
  });

  // Initialize the client
  _client.initialize().catch((err) => {
    _isInitializing = false;
    logger.error('Client initialization error', { error: err.message });
    _scheduleReconnect();
  });
}

/**
 * Handle incoming WhatsApp messages (from leads)
 * @param {import('whatsapp-web.js').Message} msg
 * @param {string} eventType
 */
async function _handleInboundMessage(msg, eventType) {
  if (msg.fromMe) return; // Skip messages sent by us

  // Extract phone number (strip @c.us suffix)
  const from = msg.from.replace('@c.us', '').replace('@g.us', '');

  // Skip group messages
  if (msg.from.includes('@g.us')) {
    logger.debug('Skipping group message', { from });
    return;
  }

  const payload = {
    phone_number: from,
    wa_message_id: msg.id._serialized,
    message_text: msg.body,
    direction: 'inbound',
    timestamp: msg.timestamp * 1000 // convert to ms
  };

  logger.info('Inbound message received', { from, msgId: msg.id._serialized });

  // Emit to frontend via Socket.io
  _emit('message_received', payload);

  // Deliver webhook to Hostinger PHP backend
  const webhookService = require('./webhook');
  await webhookService.deliver('inbound_message', payload);
}

/**
 * Handle outbound message confirmation
 * @param {import('whatsapp-web.js').Message} msg
 */
async function _handleOutboundConfirmation(msg) {
  const to = msg.to.replace('@c.us', '');
  const payload = {
    phone_number: to,
    wa_message_id: msg.id._serialized,
    message_text: msg.body,
    direction: 'outbound',
    status: 'sent',
    timestamp: Date.now()
  };

  logger.debug('Outbound message confirmed', { to, msgId: msg.id._serialized });
  _emit('message_sent', payload);

  const webhookService = require('./webhook');
  await webhookService.deliver('outbound_message', payload);
}

/**
 * Schedule a reconnect attempt with exponential backoff cap
 * @param {boolean} clearSession - Whether to destroy session before reconnect
 */
function _scheduleReconnect(clearSession = false) {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
  }

  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('Max reconnect attempts reached. Manual intervention required.');
    _emit('whatsapp_reconnect_failed', { attempts: _reconnectAttempts });
    return;
  }

  _reconnectAttempts++;
  const delay = Math.min(RECONNECT_DELAY_MS * _reconnectAttempts, 120000); // cap at 2 min
  logger.info(`Scheduling reconnect attempt ${_reconnectAttempts} in ${delay}ms`);
  _emit('whatsapp_reconnecting', { attempt: _reconnectAttempts, delay_ms: delay });

  _reconnectTimer = setTimeout(async () => {
    logger.info(`Reconnect attempt ${_reconnectAttempts} starting`);

    if (_client) {
      try {
        if (clearSession) {
          await _client.logout();
        }
        await _client.destroy();
      } catch (destroyErr) {
        logger.warn('Error destroying client before reconnect', { error: destroyErr.message });
      }
      _client = null;
    }

    _startClient();
  }, delay);
}

/**
 * Send a WhatsApp message
 * @param {string} phoneNumber - E.164 without +, e.g. "919876543210"
 * @param {string} messageText
 * @returns {Promise<{success: boolean, wa_message_id?: string, error?: string}>}
 */
async function sendMessage(phoneNumber, messageText) {
  if (!_isReady || !_client) {
    return { success: false, error: 'WhatsApp client is not ready' };
  }

  if (!phoneNumber || !messageText) {
    return { success: false, error: 'Phone number and message text are required' };
  }

  const chatId = `${phoneNumber}@c.us`;

  try {
    const sentMsg = await _client.sendMessage(chatId, messageText);
    logger.info('Message sent successfully', { to: phoneNumber, msgId: sentMsg.id._serialized });
    return { success: true, wa_message_id: sentMsg.id._serialized };
  } catch (err) {
    logger.error('Failed to send message', { to: phoneNumber, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Check if a phone number is registered on WhatsApp
 * @param {string} phoneNumber - E.164 without +, e.g. "919876543210"
 * @returns {Promise<{registered: boolean, error?: string}>}
 */
async function checkNumber(phoneNumber) {
  if (!_isReady || !_client) {
    return { registered: false, error: 'WhatsApp client is not ready' };
  }

  if (!phoneNumber) {
    return { registered: false, error: 'Phone number is required' };
  }

  try {
    const isRegistered = await _client.isRegisteredUser(`${phoneNumber}@c.us`);
    logger.debug('Number check', { phone: phoneNumber, registered: isRegistered });
    return { registered: isRegistered };
  } catch (err) {
    logger.error('Failed to check number', { phone: phoneNumber, error: err.message });
    return { registered: false, error: err.message };
  }
}

/**
 * Get current WhatsApp connection status
 * @returns {{isReady: boolean, isInitializing: boolean, qrAvailable: boolean, reconnectAttempts: number}}
 */
function getStatus() {
  return {
    isReady: _isReady,
    isInitializing: _isInitializing,
    qrAvailable: !!_qrData,
    reconnectAttempts: _reconnectAttempts
  };
}

/**
 * Get the latest QR code (base64 PNG) if available
 * @returns {string|null}
 */
function getQR() {
  return _qrData;
}

/**
 * Gracefully destroy the client (used on server shutdown)
 */
async function destroy() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
  }
  if (_client) {
    try {
      await _client.destroy();
      logger.info('WhatsApp client destroyed gracefully');
    } catch (err) {
      logger.warn('Error during client destroy', { error: err.message });
    }
    _client = null;
  }
  _isReady = false;
  _isInitializing = false;
}

module.exports = { init, sendMessage, checkNumber, getStatus, getQR, destroy };
