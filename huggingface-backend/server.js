'use strict';

// ============================================================
// WhatsApp CRM Engine — Main Server
// Express + Socket.io + WhatsApp Engine
// Optimized for Hugging Face Spaces (port 7860)
// ============================================================

require('dotenv').config();

const http        = require('http');
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const { logger }     = require('./services/logger.service');
const socketService  = require('./services/socket.service');
const waService      = require('./services/whatsapp.service');
const queueService   = require('./services/queue.service');
const webhookService = require('./services/webhook.service');

// ── Config ────────────────────────────────────────────────────
// HF Spaces injects PORT env var — always use it, fallback to 7860
const PORT       = parseInt(process.env.PORT || '7860', 10);
const HOST       = '0.0.0.0'; // Must bind to all interfaces on HF
const NODE_ENV   = process.env.NODE_ENV  || 'production';
const API_KEY    = process.env.NODE_API_KEY || '';

const corsOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Express app ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Allow Socket.io
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin:      corsOrigins.includes('*') ? '*' : corsOrigins,
  methods:     ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Webhook-Signature',
                   'X-Webhook-Id', 'X-Timestamp', 'X-Webhook-Source'],
  credentials: true,
}));
app.options('*', cors());

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Compression ───────────────────────────────────────────────
app.use(compression());

// ── HTTP request logging ──────────────────────────────────────
if (NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (msg) => logger.info(msg.trim(), { source: 'http' }),
    },
    skip: (req) => req.url === '/health' || req.url === '/ping',
  }));
}

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs:         parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:              parseInt(process.env.RATE_LIMIT_MAX        || '100',   10),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { success: false, error: 'Too many requests — please slow down' },
  skip: (req)    => req.url === '/health' || req.url === '/ping',
});
app.use(limiter);

// ── Request ID middleware ─────────────────────────────────────
app.use((req, _res, next) => {
  req.id = uuidv4();
  next();
});

// ── API Key authentication middleware ─────────────────────────
const requireApiKey = (req, res, next) => {
  // Skip auth if no key configured (dev mode)
  if (!API_KEY || API_KEY.trim() === '') {
    logger.warn('API key auth skipped — NODE_API_KEY not set', {
      source: 'auth', path: req.path,
    });
    return next();
  }

  const provided = req.headers['x-api-key']
    || req.query.api_key
    || '';

  if (provided !== API_KEY) {
    logger.warn('API auth failed — invalid key', {
      source: 'auth',
      path:   req.path,
      ip:     req.ip,
    });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  next();
};

// ── Helpers ───────────────────────────────────────────────────
const ok  = (res, data = {})         => res.json({ success: true,  ...data });
const err = (res, msg, code = 500)   => res.status(code).json({ success: false, error: msg });

// ============================================================
// ROUTES
// ============================================================

// ── GET /ping — public liveness ───────────────────────────────
app.get('/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

// ── GET /health — detailed health (auth required) ────────────
app.get('/health', requireApiKey, (_req, res) => {
  const waStatus    = waService.getStatus();
  const queueState  = queueService.getState();
  const socketStats = socketService.getStats();

  ok(res, {
    status:   'ok',
    uptime:   process.uptime(),
    memory:   process.memoryUsage(),
    env:      NODE_ENV,
    whatsapp: waStatus,
    queue:    queueState,
    sockets:  socketStats,
    ts:       new Date().toISOString(),
  });
});

// ── POST /send-message ────────────────────────────────────────
// Body: { phone, message, leadId, immediate? }
app.post('/send-message', requireApiKey, async (req, res) => {
  const { phone, message, leadId, immediate = false,
          delayMin, delayMax, businessName } = req.body;

  if (!phone || !message) {
    return err(res, 'phone and message are required', 400);
  }

  // Normalize phone
  const normalizedPhone = String(phone).replace(/\D/g, '');
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return err(res, 'Invalid phone number format', 400);
  }

  logger.info('Send message request received', {
    source: 'api',
    phone:  normalizedPhone,
    leadId,
    immediate,
  });

  try {
    if (immediate) {
      // Direct send — bypass queue (for manual messages)
      const waStatus = waService.getStatus();
      if (waStatus.status !== 'connected') {
        return err(res, 'WhatsApp not connected', 503);
      }

      const result = await waService.sendMessage(normalizedPhone, message);
      return ok(res, { waMessageId: result.waMessageId, queued: false });

    } else {
      // Queue-based send (outreach automation)
      const jobId = leadId ? `lead-${leadId}` : `msg-${Date.now()}`;

      const queued = queueService.addJob({
        id:           jobId,
        leadId:       leadId ? parseInt(leadId, 10) : null,
        phone:        normalizedPhone,
        message,
        businessName: businessName || '',
        delayMin:     delayMin ? parseInt(delayMin, 10) * 1000 : undefined,
        delayMax:     delayMax ? parseInt(delayMax, 10) * 1000 : undefined,
      });

      if (!queued.queued) {
        return err(res, queued.reason || 'Could not queue message', 409);
      }

      return ok(res, {
        queued:      true,
        jobId,
        queueLength: queueService.getState().queueLength,
      });
    }

  } catch (e) {
    logger.error('Send message error', { source: 'api', error: e.message });
    return err(res, e.message);
  }
});

// ── POST /check-number ────────────────────────────────────────
// Body: { phone } OR { phones: [] }
app.post('/check-number', requireApiKey, async (req, res) => {
  const { phone, phones } = req.body;

  try {
    const waStatus = waService.getStatus();
    if (waStatus.status !== 'connected') {
      return err(res, 'WhatsApp not connected', 503);
    }

    // Batch mode
    if (phones && Array.isArray(phones)) {
      if (phones.length > 50) {
        return err(res, 'Maximum 50 numbers per batch request', 400);
      }

      const normalized = phones
        .map((p) => String(p).replace(/\D/g, ''))
        .filter((p) => p.length >= 10 && p.length <= 15);

      logger.info('Batch number check started', {
        source: 'api', count: normalized.length,
      });

      // Start async batch — return immediately, results via webhook+socket
      waService.checkNumberBatch(normalized, 1500).catch((e) => {
        logger.error('Batch check error', { source: 'api', error: e.message });
      });

      return ok(res, {
        message: 'Batch validation started',
        total:   normalized.length,
        note:    'Results delivered via webhook and socket events',
      });
    }

    // Single number
    if (!phone) {
      return err(res, 'phone or phones[] required', 400);
    }

    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
      return err(res, 'Invalid phone number format', 400);
    }

    const result = await waService.checkNumber(normalizedPhone);
    return ok(res, result);

  } catch (e) {
    logger.error('Check number error', { source: 'api', error: e.message });
    return err(res, e.message);
  }
});

// ── POST /queue/pause ─────────────────────────────────────────
app.post('/queue/pause', requireApiKey, (_req, res) => {
  const result = queueService.pause();
  ok(res, result);
});

// ── POST /queue/resume ────────────────────────────────────────
app.post('/queue/resume', requireApiKey, (_req, res) => {
  const result = queueService.resume();
  ok(res, result);
});

// ── POST /queue/stop ──────────────────────────────────────────
app.post('/queue/stop', requireApiKey, (_req, res) => {
  const result = queueService.stop();
  ok(res, result);
});

// ── GET /queue/state ──────────────────────────────────────────
app.get('/queue/state', requireApiKey, (_req, res) => {
  ok(res, queueService.getState());
});

// ── POST /queue/remove ────────────────────────────────────────
// Body: { leadId }
app.post('/queue/remove', requireApiKey, (req, res) => {
  const { leadId } = req.body;
  if (!leadId) return err(res, 'leadId required', 400);
  const removed = queueService.removeJob(parseInt(leadId, 10));
  ok(res, { removed });
});

// ── GET /whatsapp/status ──────────────────────────────────────
app.get('/whatsapp/status', requireApiKey, (_req, res) => {
  ok(res, waService.getStatus());
});

// ── GET /whatsapp/qr ──────────────────────────────────────────
app.get('/whatsapp/qr', requireApiKey, (_req, res) => {
  const qr = waService.getQR();
  if (!qr) {
    return err(res, 'No QR code available — client may already be connected', 404);
  }
  ok(res, { qr });
});

// ── POST /whatsapp/restart ────────────────────────────────────
app.post('/whatsapp/restart', requireApiKey, async (_req, res) => {
  logger.info('WA restart requested via API', { source: 'api' });
  ok(res, { message: 'WhatsApp restart initiated' });
  // Restart after response sent
  setTimeout(() => waService.initialize(), 500);
});

// ── POST /whatsapp/logout ─────────────────────────────────────
app.post('/whatsapp/logout', requireApiKey, async (_req, res) => {
  try {
    await waService.logout();
    ok(res, { message: 'Logged out successfully' });
  } catch (e) {
    err(res, e.message);
  }
});

// ── GET /socket/stats ─────────────────────────────────────────
app.get('/socket/stats', requireApiKey, (_req, res) => {
  ok(res, socketService.getStats());
});

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  logger.warn('404 Not Found', { source: 'http', path: req.path, method: req.method });
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ── Global error handler ──────────────────────────────────────
app.use((error, req, res, _next) => {
  logger.error('Unhandled express error', {
    source: 'http',
    path:   req.path,
    error:  error.message,
    stack:  NODE_ENV === 'development' ? error.stack : undefined,
  });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================
// STARTUP
// ============================================================

const start = async () => {
  try {
    // ── Initialize Socket.io ───────────────────────────────
    socketService.init(server);
    logger.info('Socket.io initialized', { source: 'startup' });

    // ── Start HTTP server FIRST — HF Spaces needs port 7860
    //    to respond BEFORE anything else, or it shows "refused to connect"
    await new Promise((resolve) => {
      server.listen(PORT, HOST, () => {
        logger.info(`WhatsApp CRM Engine running`, {
          source: 'startup',
          port:   PORT,
          host:   HOST,
          env:    NODE_ENV,
          url:    `http://${HOST}:${PORT}`,
        });
        resolve();
      });
    });

    // ── Initialize WhatsApp client AFTER server is up ──────
    // Non-blocking: WA errors must NOT crash the HTTP server
    logger.info('Initializing WhatsApp client...', { source: 'startup' });
    waService.initialize().catch((e) => {
      logger.error('WhatsApp init error (non-fatal) — will auto-retry', {
        source: 'startup', error: e.message,
      });
    });

    // ── Periodic system stats broadcast (every 60s) ────────
    setInterval(() => {
      const waStatus   = waService.getStatus();
      const queueState = queueService.getState();
      socketService.emit.systemStats({
        whatsapp: {
          status: waStatus.status,
          phone:  waStatus.phone,
        },
        queue: {
          length:    queueState.queueLength,
          isRunning: queueState.isRunning,
          isPaused:  queueState.isPaused,
          sendCount: queueState.sendCount,
        },
        uptime:   process.uptime(),
        memory:   process.memoryUsage().heapUsed,
        ts:       Date.now(),
      });
    }, 60000);

  } catch (err) {
    logger.error('Fatal startup error', { source: 'startup', error: err.message });
    // Don't exit — keep server alive so HF doesn't show "refused to connect"
    // WA service has its own auto-restart logic
  }
};

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`, { source: 'shutdown' });

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed', { source: 'shutdown' });
  });

  try {
    queueService.stop();
    await waService.shutdown();
    logger.info('Graceful shutdown complete', { source: 'shutdown' });
    process.exit(0);
  } catch (e) {
    logger.error('Error during shutdown', { source: 'shutdown', error: e.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Unhandled rejection safety net ───────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    source: 'process',
    reason: reason?.message || String(reason),
    promise: String(promise),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', {
    source: 'process',
    error:  err.message,
    stack:  err.stack,
  });
  // On HF Spaces: do NOT exit — let the server stay alive
  // WA service errors are non-fatal; HTTP server must keep running
});

// ── Start ─────────────────────────────────────────────────────
start();
