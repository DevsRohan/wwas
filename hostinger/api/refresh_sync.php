<?php
// ============================================================
// WWAS API - GET /api/refresh_sync.php
// Force-sync latest state from HF Node.js engine
// Returns WA status, queue state, and DB summary
// Called by frontend after reconnect or manual refresh
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

// ── Fetch HF engine health ────────────────────────────────────
$engineHealth = ['status' => 'unreachable', 'whatsapp' => ['ready' => false], 'queue' => ['size' => 0]];
$engineError  = null;

try {
    $healthResult = NodeClient::getHealth();
    if (isset($healthResult['status'])) {
        $engineHealth = $healthResult;
    }
} catch (Exception $e) {
    $engineError = $e->getMessage();
    AppLogger::warning('refresh_sync: Health check failed', ['error' => $e->getMessage()]);
}

// ── QR code (if WA is awaiting scan) ─────────────────────────
$qrData = null;
if (!($engineHealth['whatsapp']['ready'] ?? false)) {
    try {
        $qrResult = NodeClient::getQR();
        if ($qrResult['qr_available'] ?? false) {
            $qrData = $qrResult['qr'] ?? null;
        }
    } catch (Exception $e) {
        // Non-critical — don't fail the whole sync
    }
}

// ── DB quick counts ───────────────────────────────────────────
// Leads stats (no join needed)
$leadCounts = Database::fetchOne(
    "SELECT
        SUM(outreach_status = 'pending' AND whatsapp_status = 'valid') AS queue_pending,
        SUM(outreach_status = 'sent')    AS sent_count,
        SUM(outreach_status = 'replied') AS replied_count
     FROM leads",
    []
);
// Unread messages (separate query to avoid join inflation)
$unreadCount = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM messages WHERE is_read = 0 AND direction = 'inbound'",
    []
);
$counts = array_merge($leadCounts ?? [], ['unread_messages' => $unreadCount]);

// ── Campaign status ───────────────────────────────────────────
$campaignStatus = getSetting('campaign_status', 'idle');

jsonSuccess([
    'engine'  => [
        'status'      => $engineHealth['status']             ?? 'unknown',
        'uptime'      => $engineHealth['uptime_human']       ?? null,
        'version'     => $engineHealth['version']            ?? '1.0.0',
        'error'       => $engineError,
    ],
    'whatsapp' => [
        'ready'            => $engineHealth['whatsapp']['ready']            ?? false,
        'initializing'     => $engineHealth['whatsapp']['initializing']     ?? false,
        'qr_available'     => $engineHealth['whatsapp']['qr_available']     ?? false,
        'qr'               => $qrData,
        'reconnect_attempts' => $engineHealth['whatsapp']['reconnect_attempts'] ?? 0,
    ],
    'queue' => [
        'size'       => $engineHealth['queue']['size']       ?? 0,
        'processing' => $engineHealth['queue']['processing'] ?? false,
        'paused'     => $engineHealth['queue']['paused']     ?? false,
        'stats'      => $engineHealth['queue']['stats']      ?? [],
    ],
    'db' => [
        'queue_pending'   => (int) ($counts['queue_pending']   ?? 0),
        'sent_count'      => (int) ($counts['sent_count']      ?? 0),
        'replied_count'   => (int) ($counts['replied_count']   ?? 0),
        'unread_messages' => (int) ($counts['unread_messages'] ?? 0),
    ],
    'campaign_status' => $campaignStatus,
    'synced_at'       => date('Y-m-d H:i:s'),
    'timestamp'       => time() * 1000
]);
