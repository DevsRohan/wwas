'use strict';

// ============================================================
// WWAS WhatsApp CRM - Main Server Entry Point
// Express + Socket.io + WhatsApp Engine
// Designed for Hugging Face Spaces (port 7860)
// ============================================================

require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');

const logger = require('./services/logger').child('Server');
const whatsappService = require('./services/whatsapp');
const queueService = require('./services/queue');

const apiKeyAuth = require('./middleware/auth');
const { apiLimiter, sendMessageLimiter } = require('./middleware/ratelimit');

const sendRoute = require('./routes/send');
const checkRoute = require('./routes/check');
const healthRoute = require('./routes/health');

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = parseInt(process.env.PORT || '7860', 10);
const NODE_ENV = process.env.NODE_ENV || 'production';

// Parse allowed CORS origins from env (comma-separated)
const rawOrigins = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = rawOrigins
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// In development, allow all origins
const corsOrigin = NODE_ENV === 'development'
  ? '*'
  : (allowedOrigins.length > 0 ? allowedOrigins : '*');

logger.info('Starting WWAS WhatsApp Engine', { port: PORT, env: NODE_ENV, corsOrigin });

// ============================================================
// EXPRESS APP SETUP
// ============================================================

const app = express();

// ── Security Headers ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP — not serving HTML
  crossOriginEmbedderPolicy: false
}));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
  credentials: false
}));

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Trust Proxy (needed for correct IP behind HF reverse proxy) ──
app.set('trust proxy', 1);

// ============================================================
// HTTP SERVER + SOCKET.IO
// ============================================================

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  },
  // Allow both WebSocket and polling (polling fallback for HF)
  transports: ['websocket', 'polling'],
  // Ping settings for connection health monitoring
  pingTimeout: 60000,
  pingInterval: 25000,
  // Reconnection handled on client side
  allowEIO3: true
});

// Expose io on app so routes can access it via req.app.get('io')
app.set('io', io);

// ============================================================
// SOCKET.IO CONNECTION HANDLING
// ============================================================

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  logger.info('Client connected via Socket.io', { socketId: socket.id, ip: clientIp });

  // Send current system state immediately on connect
  const waStatus = whatsappService.getStatus();
  const queueState = queueService.getState();

  socket.emit('connection_ack', {
    socketId: socket.id,
    wa_status: waStatus,
    queue_state: queueState,
    server_time: Date.now()
  });

  // If QR is available (WA awaiting scan), send it to this new client
  const currentQR = whatsappService.getQR();
  if (currentQR) {
    socket.emit('qr_code', { qr: currentQR, timestamp: Date.now() });
  }

  // If WA is already ready, inform this client
  if (waStatus.isReady) {
    socket.emit('whatsapp_ready', { timestamp: Date.now(), status: 'connected' });
  }

  // Handle client-side queue control events
  socket.on('queue_pause', () => {
    logger.info('Queue pause requested via socket', { socketId: socket.id });
    queueService.pause();
  });

  socket.on('queue_resume', () => {
    logger.info('Queue resume requested via socket', { socketId: socket.id });
    queueService.resume();
  });

  socket.on('queue_clear', () => {
    logger.info('Queue clear requested via socket', { socketId: socket.id });
    queueService.clear();
  });

  // Heartbeat — client pings, server responds
  socket.on('ping_server', () => {
    socket.emit('pong_server', { timestamp: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    logger.info('Client disconnected', { socketId: socket.id, reason });
  });

  socket.on('error', (err) => {
    logger.error('Socket error', { socketId: socket.id, error: err.message });
  });
});

// ============================================================
// HEARTBEAT BROADCAST
// Sends periodic heartbeat to all connected clients
// so frontend can detect connection health
// ============================================================

setInterval(() => {
  const waStatus = whatsappService.getStatus();
  const queueState = queueService.getState();
  io.emit('heartbeat', {
    timestamp: Date.now(),
    wa_ready: waStatus.isReady,
    queue_size: queueState.size,
    queue_processing: queueState.processing
  });
}, 30000); // Every 30 seconds

// ============================================================
// ROUTES
// ============================================================

// Health check - NO auth (needed for Docker HEALTHCHECK + PHP polling)
app.use('/health', healthRoute);

// Protected routes - require API key
app.use('/send-message', apiKeyAuth, sendMessageLimiter, sendRoute);
app.use('/check-number', apiKeyAuth, apiLimiter, checkRoute);

// Queue control via REST (alternative to socket events)
app.post('/queue/pause', apiKeyAuth, (req, res) => {
  queueService.pause();
  res.json({ success: true, message: 'Queue paused' });
});

app.post('/queue/resume', apiKeyAuth, (req, res) => {
  queueService.resume();
  res.json({ success: true, message: 'Queue resumed' });
});

app.post('/queue/clear', apiKeyAuth, (req, res) => {
  queueService.clear();
  res.json({ success: true, message: 'Queue cleared' });
});

app.get('/queue/state', apiKeyAuth, (req, res) => {
  res.json({ success: true, state: queueService.getState() });
});

// WhatsApp status via REST
app.get('/wa/status', apiKeyAuth, (req, res) => {
  res.json({ success: true, status: whatsappService.getStatus() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled Express error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================
// INITIALIZE SERVICES & START SERVER
// ============================================================

async function bootstrap() {
  try {
    // Initialize queue with Socket.io
    queueService.init(io);
    logger.info('Queue service ready');

    // Initialize WhatsApp client with Socket.io
    whatsappService.init(io);
    logger.info('WhatsApp service initializing...');

    // Start HTTP server
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`WWAS Engine listening on port ${PORT}`);
      logger.info(`Health endpoint: http://0.0.0.0:${PORT}/health`);
      logger.info(`Environment: ${NODE_ENV}`);
    });

  } catch (err) {
    logger.error('Bootstrap failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });

  // Pause queue to prevent new sends
  queueService.pause();

  // Destroy WhatsApp client
  try {
    await whatsappService.destroy();
    logger.info('WhatsApp client shut down');
  } catch (err) {
    logger.warn('Error shutting down WhatsApp', { error: err.message });
  }

  // Disconnect all sockets
  io.disconnectSockets(true);

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Uncaught exception handlers (prevent crash on unhandled errors) ──
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', { error: err.message, stack: err.stack });
  // Don't exit — log and continue (WA session would be lost on restart)
});

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

// ── Start ─────────────────────────────────────────────────────
bootstrap();
