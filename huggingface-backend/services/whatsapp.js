'use strict';

// ============================================================
// WWAS - WhatsApp Client Manager Service
// Manages whatsapp-web.js client lifecycle, QR, reconnect
// ============================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const logger = require('./logger').child('WhatsApp');

let _io = null;
let _client = null;
let _isReady = false;
let _isInitializing = false;
let _qrData = null;
let _reconnectTimer = null;
let _reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 15000;

function init(io) {
  _io = io;
  logger.info('WhatsApp service initialized');
  _startClient();
}

function _emit(event, data) {
  if (_io) _io.emit(event, data);
}

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
    '--safebrowsing-disable-auto-update',
    '--disable-features=VizDisplayCompositor'
  ];
}

function _startClient() {
  if (_isInitializing) {
    logger.warn('Client already initializing, skipping');
    return;
  }

  _isInitializing = true;
  _isReady = false;
  _qrData = null;

  const sessionDir = process.env.WA_SESSION_DIR || path.join(__dirname, '..', 'wa_session');
  const clientId   = process.env.WA_CLIENT_ID   || 'wwas-client';

  logger.info('Starting WhatsApp client', { sessionDir, clientId });

  // Determine chromium executable
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

  _client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      executablePath,
      args: _getPuppeteerArgs(),
      timeout: 120000
      // NOTE: Do NOT set userDataDir — LocalAuth manages its own data dir
      // and throws "LocalAuth is not compatible with a user-supplied userDataDir"
    },
    webVersionCache: { type: 'none' }
  });

  _client.on('qr', async (qr) => {
    logger.info('QR code received');
    try {
      const qrBase64 = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'M', width: 300 });
      _qrData = qrBase64;
      _emit('qr_code', { qr: qrBase64, timestamp: Date.now() });
    } catch (err) {
      logger.error('QR base64 conversion failed', { error: err.message });
      _emit('qr_code', { qr_raw: qr, timestamp: Date.now() });
    }
  });

  _client.on('authenticated', () => {
    logger.info('WhatsApp authenticated');
    _emit('whatsapp_authenticated', { timestamp: Date.now() });
  });

  _client.on('ready', () => {
    _isReady        = true;
    _isInitializing = false;
    _reconnectAttempts = 0;
    _qrData         = null;
    logger.info('WhatsApp client READY');
    _emit('whatsapp_ready', { timestamp: Date.now(), status: 'connected' });
  });

  _client.on('disconnected', (reason) => {
    _isReady        = false;
    _isInitializing = false;
    logger.warn('WhatsApp disconnected', { reason });
    _emit('whatsapp_disconnected', { reason, timestamp: Date.now() });
    _scheduleReconnect();
  });

  _client.on('auth_failure', (msg) => {
    _isReady        = false;
    _isInitializing = false;
    logger.error('WhatsApp auth failure', { msg });
    _emit('whatsapp_auth_failure', { message: msg, timestamp: Date.now() });
    _scheduleReconnect(true);
  });

  _client.on('message', async (msg) => {
    try { await _handleInboundMessage(msg); }
    catch (err) { logger.error('Inbound message error', { error: err.message }); }
  });

  _client.on('message_create', async (msg) => {
    if (msg.fromMe) {
      try { await _handleOutboundConfirmation(msg); }
      catch (err) { logger.error('Outbound confirm error', { error: err.message }); }
    }
  });

  _client.on('message_ack', (msg, ack) => {
    const statusMap = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
    _emit('message_ack', {
      wa_message_id: msg.id._serialized,
      status: statusMap[ack] || 'unknown',
      timestamp: Date.now()
    });
  });

  _client.initialize().catch((err) => {
    _isInitializing = false;
    logger.error('Client init error', { error: err.message });
    _scheduleReconnect();
  });
}

async function _handleInboundMessage(msg) {
  if (msg.fromMe) return;
  if (msg.from.includes('@g.us')) return; // skip groups

  const from = msg.from.replace('@c.us', '');
  const payload = {
    phone_number:  from,
    wa_message_id: msg.id._serialized,
    message_text:  msg.body,
    direction:     'inbound',
    timestamp:     msg.timestamp * 1000
  };

  logger.info('Inbound message', { from, msgId: msg.id._serialized });
  _emit('message_received', payload);

  const webhookService = require('./webhook');
  await webhookService.deliver('inbound_message', payload);
}

async function _handleOutboundConfirmation(msg) {
  const to = msg.to.replace('@c.us', '');
  const payload = {
    phone_number:  to,
    wa_message_id: msg.id._serialized,
    message_text:  msg.body,
    direction:     'outbound',
    status:        'sent',
    timestamp:     Date.now()
  };
  logger.debug('Outbound confirmed', { to });
  _emit('message_sent', payload);

  const webhookService = require('./webhook');
  await webhookService.deliver('outbound_message', payload);
}

function _scheduleReconnect(clearSession = false) {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);

  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error('Max reconnect attempts reached');
    _emit('whatsapp_reconnect_failed', { attempts: _reconnectAttempts });
    return;
  }

  _reconnectAttempts++;
  const delay = Math.min(RECONNECT_DELAY_MS * _reconnectAttempts, 120000);
  logger.info(`Reconnect #${_reconnectAttempts} in ${delay}ms`);
  _emit('whatsapp_reconnecting', { attempt: _reconnectAttempts, delay_ms: delay });

  _reconnectTimer = setTimeout(async () => {
    if (_client) {
      try {
        if (clearSession) await _client.logout();
        await _client.destroy();
      } catch (e) {
        logger.warn('Destroy error before reconnect', { error: e.message });
      }
      _client = null;
    }
    _startClient();
  }, delay);
}

async function sendMessage(phoneNumber, messageText) {
  if (!_isReady || !_client)
    return { success: false, error: 'WhatsApp not ready' };
  if (!phoneNumber || !messageText)
    return { success: false, error: 'Missing phone or message' };

  try {
    const sent = await _client.sendMessage(`${phoneNumber}@c.us`, messageText);
    logger.info('Message sent', { to: phoneNumber, msgId: sent.id._serialized });
    return { success: true, wa_message_id: sent.id._serialized };
  } catch (err) {
    logger.error('Send failed', { to: phoneNumber, error: err.message });
    return { success: false, error: err.message };
  }
}

async function checkNumber(phoneNumber) {
  if (!_isReady || !_client)
    return { registered: false, error: 'WhatsApp not ready' };
  if (!phoneNumber)
    return { registered: false, error: 'No phone number' };

  try {
    const ok = await _client.isRegisteredUser(`${phoneNumber}@c.us`);
    return { registered: ok };
  } catch (err) {
    logger.error('Check number failed', { error: err.message });
    return { registered: false, error: err.message };
  }
}

function getStatus() {
  return {
    isReady:           _isReady,
    isInitializing:    _isInitializing,
    qrAvailable:       !!_qrData,
    reconnectAttempts: _reconnectAttempts
  };
}

function getQR() { return _qrData; }

async function destroy() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_client) {
    try { await _client.destroy(); }
    catch (err) { logger.warn('Destroy error', { error: err.message }); }
    _client = null;
  }
  _isReady        = false;
  _isInitializing = false;
}

module.exports = { init, sendMessage, checkNumber, getStatus, getQR, destroy };
