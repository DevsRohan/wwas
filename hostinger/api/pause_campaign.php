<?php
// ============================================================
// WWAS API - POST /api/pause_campaign.php
// Pause a running campaign
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$currentStatus = getSetting('campaign_status', 'idle');

if ($currentStatus === 'paused') {
    jsonSuccess(['status' => 'already_paused', 'message' => 'Campaign is already paused.']);
}

// ── Pause campaign in settings ────────────────────────────────
updateSetting('campaign_status', 'paused');

// ── Pause the HF queue ────────────────────────────────────────
NodeClient::pauseQueue();

// ── Count remaining leads ─────────────────────────────────────
$remaining = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM leads WHERE whatsapp_status = 'valid' AND outreach_status = 'pending'"
);

AppLogger::db('info', 'Campaign', 'Campaign paused by user', ['remaining' => $remaining]);
AppLogger::info('Campaign paused', ['context' => 'PauseCampaign', 'remaining' => $remaining]);

jsonSuccess([
    'status'            => 'paused',
    'remaining_leads'   => $remaining,
    'message'           => 'Campaign paused. Resume anytime to continue outreach.'
]);
