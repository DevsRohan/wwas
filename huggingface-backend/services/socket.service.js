'use strict';

// ============================================================
// Socket.io Service — Real-time event broadcasting
// Handles: connection auth, room management, event emission,
//          heartbeat, reconnect sync, client tracking
// ============================================================

const { Server }  = require('socket.io');
const { logger }  = require('./logger.service');

// ── Module state ──────────────────────────────────────────────
let io            = null;
let connectedCount = 0;

// ── Connected clients registry: socketId → { userId, connectedAt } ─
const clients = new Map();

// ── Event name constants ──────────────────────────────────────
const EVENTS = {
  // WhatsApp engine
  WA_QR:              'whatsapp:qr',
  WA_READY:           'whatsapp:ready',
  WA_DISCONNECTED:    'whatsapp:disconnected',
  WA_AUTH_FAILURE:    'whatsapp:auth_failure',
  WA_LOADING:         'whatsapp:loading',
  WA_RECONNECTING:    'whatsapp:reconnecting',

  // Messages
  MSG_RECEIVED:       'message:received',
  MSG_SENT:           'message:sent',
  MSG_STATUS:         'message:status',
  MSG_READ:           'message:read',

  // Lead
  LEAD_REPLIED:       'lead:replied',
  LEAD_VALIDATED:     'lead:validated',
  LEAD_UPDATED:       'lead:updated',

  // Campaign / outreach
  OUTREACH_STARTED:   'outreach:started',
  OUTREACH_STOPPED:   'outreach:stopped',
  CAMPAIGN_PAUSED:    'campaign:paused',
  CAMPAIGN_RESUMED:   'campaign:resumed',
  CAMPAIGN_COMPLETE:  'campaign:completed',

  // AI
  AI_GENERATED:       'ai:generated',

  // Queue
  QUEUE_UPDATED:      'queue:updated',

  // System
  SYSTEM_STATS:       'system:stats',
  HEARTBEAT:          'heartbeat',
  ERROR:              'error',
};

// ── Initialize Socket.io server ───────────────────────────────
/**
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
const init = (httpServer) => {
  const corsOrigins = (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin:      corsOrigins.includes('*') ? '*' : corsOrigins,
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:   60000,
    pingInterval:  25000,
    transports:    ['websocket', 'polling'],
    // Limit payload size
    maxHttpBufferSize: 1e6, // 1 MB
  });

  // ── Authentication middleware ─────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.query?.token;

    const expectedToken = process.env.NODE_API_KEY;

    // If no key configured, allow all (dev mode)
    if (!expectedToken || expectedToken.trim() === '') {
      logger.warn('Socket auth skipped — NODE_API_KEY not set', {
        source: 'socket',
        socketId: socket.id,
      });
      return next();
    }

    if (!token || token !== expectedToken) {
      logger.warn('Socket auth failed — invalid token', {
        source:   'socket',
        socketId: socket.id,
        ip:       socket.handshake.address,
      });
      return next(new Error('Authentication failed'));
    }

    next();
  });

  // ── Connection handler ────────────────────────────────────
  io.on('connection', (socket) => {
    connectedCount++;
    clients.set(socket.id, {
      connectedAt: new Date().toISOString(),
      ip:          socket.handshake.address,
    });

    logger.info('Socket client connected', {
      source:    'socket',
      socketId:  socket.id,
      total:     connectedCount,
      ip:        socket.handshake.address,
    });

    // ── Send initial state on connect ─────────────────────
    socket.emit('connected', {
      socketId:    socket.id,
      serverTime:  new Date().toISOString(),
      message:     'Connected to WhatsApp CRM Engine',
    });

    // ── Join rooms (lead-specific updates) ────────────────
    socket.on('join:lead', (leadId) => {
      if (leadId) {
        socket.join(`lead:${leadId}`);
        logger.debug(`Socket joined room lead:${leadId}`, {
          source: 'socket', socketId: socket.id,
        });
      }
    });

    socket.on('leave:lead', (leadId) => {
      if (leadId) {
        socket.leave(`lead:${leadId}`);
      }
    });

    // ── Client heartbeat response ─────────────────────────
    socket.on('pong:client', () => {
      clients.set(socket.id, {
        ...clients.get(socket.id),
        lastPong: new Date().toISOString(),
      });
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      connectedCount = Math.max(0, connectedCount - 1);
      clients.delete(socket.id);

      logger.info('Socket client disconnected', {
        source:   'socket',
        socketId: socket.id,
        reason,
        remaining: connectedCount,
      });
    });

    // ── Error ─────────────────────────────────────────────
    socket.on('error', (err) => {
      logger.error('Socket error', {
        source:   'socket',
        socketId: socket.id,
        error:    err.message,
      });
    });
  });

  // ── Server-side heartbeat: ping all clients every 30s ────
  setInterval(() => {
    if (io && connectedCount > 0) {
      io.emit(EVENTS.HEARTBEAT, {
        ts:      Date.now(),
        clients: connectedCount,
      });
    }
  }, 30000);

  logger.info('Socket.io server initialized', { source: 'socket' });
  return io;
};

// ── Broadcast to ALL connected clients ───────────────────────
const broadcast = (event, data = {}) => {
  if (!io) return;
  io.emit(event, { ...data, _ts: Date.now() });
};

// ── Emit to a specific lead room ─────────────────────────────
const emitToLead = (leadId, event, data = {}) => {
  if (!io) return;
  io.to(`lead:${leadId}`).emit(event, { ...data, _ts: Date.now() });
};

// ── Typed emitter helpers ─────────────────────────────────────
const emit = {
  waQR: (qrData)          => broadcast(EVENTS.WA_QR,           { qr: qrData }),
  waReady: (info)         => broadcast(EVENTS.WA_READY,         info),
  waDisconnected: (reason)=> broadcast(EVENTS.WA_DISCONNECTED,  { reason }),
  waAuthFailure: (msg)    => broadcast(EVENTS.WA_AUTH_FAILURE,  { message: msg }),
  waReconnecting: ()      => broadcast(EVENTS.WA_RECONNECTING,  {}),

  messageReceived: (msg)  => {
    broadcast(EVENTS.MSG_RECEIVED, msg);
    if (msg.leadId) emitToLead(msg.leadId, EVENTS.MSG_RECEIVED, msg);
  },
  messageSent: (msg)      => {
    broadcast(EVENTS.MSG_SENT, msg);
    if (msg.leadId) emitToLead(msg.leadId, EVENTS.MSG_SENT, msg);
  },
  messageStatus: (data)   => {
    broadcast(EVENTS.MSG_STATUS, data);
    if (data.leadId) emitToLead(data.leadId, EVENTS.MSG_STATUS, data);
  },

  leadReplied: (data)     => broadcast(EVENTS.LEAD_REPLIED,     data),
  leadValidated: (data)   => broadcast(EVENTS.LEAD_VALIDATED,   data),
  leadUpdated: (data)     => broadcast(EVENTS.LEAD_UPDATED,     data),

  outreachStarted: (data) => broadcast(EVENTS.OUTREACH_STARTED, data),
  outreachStopped: (data) => broadcast(EVENTS.OUTREACH_STOPPED, data),
  campaignPaused: (data)  => broadcast(EVENTS.CAMPAIGN_PAUSED,  data),
  campaignResumed: (data) => broadcast(EVENTS.CAMPAIGN_RESUMED, data),
  campaignComplete:(data) => broadcast(EVENTS.CAMPAIGN_COMPLETE,data),

  aiGenerated: (data)     => broadcast(EVENTS.AI_GENERATED,     data),
  queueUpdated: (data)    => broadcast(EVENTS.QUEUE_UPDATED,     data),

  systemStats: (data)     => broadcast(EVENTS.SYSTEM_STATS,     data),
  error: (data)           => broadcast(EVENTS.ERROR,             data),
};

// ── Stats getter ─────────────────────────────────────────────
const getStats = () => ({
  connectedClients: connectedCount,
  clients:          Array.from(clients.entries()).map(([id, info]) => ({
    socketId: id,
    ...info,
  })),
});

module.exports = {
  init,
  broadcast,
  emitToLead,
  emit,
  getStats,
  EVENTS,
  getIO: () => io,
};
