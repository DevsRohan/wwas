'use strict';

// ============================================================
// WWAS WhatsApp CRM - Main Server Entry Point
// Express + Socket.io + WhatsApp Engine
// Hugging Face Spaces (port 7860)
// ============================================================

require('dotenv').config();

const http    = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const helmet  = require('helmet');
const cors    = require('cors');

const logger           = require('./services/logger').child('Server');
const whatsappService  = require('./services/whatsapp');
const queueService     = require('./services/queue');
const apiKeyAuth       = require('./middleware/auth');
const { apiLimiter, sendMessageLimiter } = require('./middleware/ratelimit');
const sendRoute        = require('./routes/send');
const checkRoute       = require('./routes/check');
const healthRoute      = require('./routes/health');

// ── Configuration ─────────────────────────────────────────────
const PORT     = parseInt(process.env.PORT || '7860', 10);
const NODE_ENV = process.env.NODE_ENV || 'production';

const rawOrigins   = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);
const corsOrigin   = allowedOrigins.length > 0 ? allowedOrigins : '*';

logger.info('Starting WWAS Engine', { port: PORT, env: NODE_ENV });

// ── Express ───────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'], credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.set('trust proxy', 1);

// ── HTTP + Socket.io ──────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors:          { origin: corsOrigin, methods: ['GET', 'POST'] },
  transports:    ['websocket', 'polling'],
  pingTimeout:   60000,
  pingInterval:  25000,
  allowEIO3:     true
});

app.set('io', io);

// ── Socket.io events ──────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info('Socket connected', { id: socket.id });

  socket.emit('connection_ack', {
    socketId:    socket.id,
    wa_status:   whatsappService.getStatus(),
    queue_state: queueService.getState(),
    server_time: Date.now()
  });

  const currentQR = whatsappService.getQR();
  if (currentQR) socket.emit('qr_code', { qr: currentQR, timestamp: Date.now() });

  if (whatsappService.getStatus().isReady)
    socket.emit('whatsapp_ready', { timestamp: Date.now(), status: 'connected' });

  socket.on('queue_pause',  () => { logger.info('queue_pause via socket'); queueService.pause(); });
  socket.on('queue_resume', () => { logger.info('queue_resume via socket'); queueService.resume(); });
  socket.on('queue_clear',  () => { logger.info('queue_clear via socket'); queueService.clear(); });
  socket.on('ping_server',  () => socket.emit('pong_server', { timestamp: Date.now() }));
  socket.on('disconnect',   (r)  => logger.info('Socket disconnected', { id: socket.id, reason: r }));
  socket.on('error',        (e)  => logger.error('Socket error', { id: socket.id, error: e.message }));
});

// ── Heartbeat ─────────────────────────────────────────────────
setInterval(() => {
  const ws = whatsappService.getStatus();
  const qs = queueService.getState();
  io.emit('heartbeat', {
    timestamp:       Date.now(),
    wa_ready:        ws.isReady,
    queue_size:      qs.size,
    queue_processing: qs.processing
  });
}, 30000);

// ── Routes ────────────────────────────────────────────────────
app.use('/health',        healthRoute);
app.use('/send-message',  apiKeyAuth, sendMessageLimiter, sendRoute);
app.use('/check-number',  apiKeyAuth, apiLimiter, checkRoute);

app.post('/queue/pause',  apiKeyAuth, (req, res) => { queueService.pause();   res.json({ success: true, message: 'Queue paused' }); });
app.post('/queue/resume', apiKeyAuth, (req, res) => { queueService.resume();  res.json({ success: true, message: 'Queue resumed' }); });
app.post('/queue/clear',  apiKeyAuth, (req, res) => { queueService.clear();   res.json({ success: true, message: 'Queue cleared' }); });
app.get( '/queue/state',  apiKeyAuth, (req, res) => res.json({ success: true, state: queueService.getState() }));
app.get( '/wa/status',    apiKeyAuth, (req, res) => res.json({ success: true, status: whatsappService.getStatus() }));

app.use((req, res) => res.status(404).json({ success: false, error: `Not found: ${req.method} ${req.path}` }));
app.use((err, req, res, _next) => {
  logger.error('Express error', { error: err.message, path: req.path });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Bootstrap ─────────────────────────────────────────────────
async function bootstrap() {
  try {
    queueService.init(io);
    logger.info('Queue ready');

    // Start HTTP server FIRST so /health responds immediately
    await new Promise((resolve, reject) => {
      httpServer.listen(PORT, '0.0.0.0', (err) => {
        if (err) return reject(err);
        logger.info(`WWAS listening on port ${PORT}`);
        resolve();
      });
    });

    // Start WhatsApp AFTER HTTP is up (so HF health check passes during WA init)
    whatsappService.init(io);
    logger.info('WhatsApp initializing in background...');

  } catch (err) {
    logger.error('Bootstrap failed', { error: err.message });
    process.exit(1);
  }
}

// ── Shutdown ──────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  httpServer.close();
  queueService.pause();
  try { await whatsappService.destroy(); } catch (e) { /* ignore */ }
  io.disconnectSockets(true);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException',  (err) => logger.error('UNCAUGHT EXCEPTION',  { error: err.message, stack: err.stack }));
process.on('unhandledRejection', (reason) => logger.error('UNHANDLED REJECTION', { reason: String(reason) }));

bootstrap();
