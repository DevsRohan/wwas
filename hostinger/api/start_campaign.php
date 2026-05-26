<?php
// ============================================================
// WWAS API - POST /api/start_campaign.php
// Start or resume a campaign run
// Triggers campaign.php logic inline (no separate process)
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

// ── Check WA is ready before starting ────────────────────────
$health = NodeClient::getHealth();
$waReady = $health['whatsapp']['ready'] ?? false;

if (!$waReady) {
    jsonError('WhatsApp is not connected. Please scan QR code first.', 503);
}

// ── Check if already running ──────────────────────────────────
$currentStatus = getSetting('campaign_status', 'idle');
if ($currentStatus === 'running') {
    jsonError('Campaign is already running.', 409);
}

// ── Check pending leads exist ─────────────────────────────────
$pendingCount = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM leads WHERE whatsapp_status = 'valid' AND outreach_status = 'pending'"
);

if ($pendingCount === 0) {
    jsonSuccess([
        'status'  => 'nothing_to_do',
        'message' => 'No valid pending leads in queue. Import leads and validate numbers first.',
        'pending' => 0
    ]);
}

// ── Set campaign status to running ───────────────────────────
updateSetting('campaign_status', 'running');
AppLogger::db('info', 'Campaign', "Campaign started by user. {$pendingCount} leads pending.");
AppLogger::info('Campaign started', ['context' => 'StartCampaign', 'pending' => $pendingCount]);

// ── Resume queue on HF engine ─────────────────────────────────
NodeClient::resumeQueue();

jsonSuccess([
    'status'        => 'started',
    'pending_leads' => $pendingCount,
    'message'       => "Campaign started. {$pendingCount} leads will be processed.",
    'note'          => 'Campaign processes leads in batches via cron. If no cron, trigger manually.'
]);
