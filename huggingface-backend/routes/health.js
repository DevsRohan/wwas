'use strict';

// ============================================================
// WWAS - GET /health Route
// Returns full system health status (public, no auth required)
// Used by Hostinger PHP to poll engine status
// Used by Docker HEALTHCHECK
// ============================================================

const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp');
const queueService = require('../services/queue');
const logger = require('../services/logger').child('Route:Health');
const os = require('os');

// Track server start time
const SERVER_START_TIME = Date.now();

/**
 * GET /health
 *
 * Response:
 *   200 { status: "ok"|"degraded", whatsapp: {...}, queue: {...}, system: {...}, uptime_ms: number }
 */
router.get('/', (req, res) => {
  const waStatus = whatsappService.getStatus();
  const queueState = queueService.getState();

  const uptimeMs = Date.now() - SERVER_START_TIME;

  // Determine overall health status
  const isHealthy = waStatus.isReady;
  const status = isHealthy ? 'ok' : (waStatus.isInitializing ? 'initializing' : 'degraded');

  const healthPayload = {
    status,
    version: '1.0.0',
    uptime_ms: uptimeMs,
    uptime_human: _formatUptime(uptimeMs),
    timestamp: new Date().toISOString(),
    whatsapp: {
      ready: waStatus.isReady,
      initializing: waStatus.isInitializing,
      qr_available: waStatus.qrAvailable,
      reconnect_attempts: waStatus.reconnectAttempts
    },
    queue: {
      size: queueState.size,
      processing: queueState.processing,
      paused: queueState.paused,
      stats: queueState.stats
    },
    system: {
      node_version: process.version,
      platform: process.platform,
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      load_avg: os.loadavg()[0].toFixed(2),
      free_memory_mb: Math.round(os.freemem() / 1024 / 1024)
    }
  };

  // Log degraded state
  if (status !== 'ok' && status !== 'initializing') {
    logger.warn('Health check returned degraded status', { waStatus });
  }

  return res.status(200).json(healthPayload);
});

/**
 * GET /health/qr
 * Returns the current QR code if WhatsApp is awaiting scan
 * No auth required so dashboard can show QR without backend
 */
router.get('/qr', (req, res) => {
  const qr = whatsappService.getQR();
  const waStatus = whatsappService.getStatus();

  if (!qr) {
    return res.status(200).json({
      success: false,
      qr_available: false,
      wa_ready: waStatus.isReady,
      message: waStatus.isReady
        ? 'WhatsApp is already connected, no QR needed'
        : 'QR not yet available, WhatsApp is initializing'
    });
  }

  return res.status(200).json({
    success: true,
    qr_available: true,
    qr: qr,
    wa_ready: false,
    message: 'Scan this QR code with your WhatsApp'
  });
});

/**
 * Format milliseconds into human-readable uptime string
 * @param {number} ms
 * @returns {string}
 */
function _formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

module.exports = router;
