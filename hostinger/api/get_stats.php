<?php
// ============================================================
// WWAS API - GET /api/get_stats.php
// Returns dashboard KPI statistics
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

// ── Lead statistics ───────────────────────────────────────────
$leadStats = Database::fetchOne(
    "SELECT
        COUNT(*)                                                          AS total_leads,
        SUM(whatsapp_status = 'valid')                                   AS valid_leads,
        SUM(whatsapp_status = 'invalid' OR whatsapp_status = 'not_on_whatsapp') AS invalid_leads,
        SUM(whatsapp_status = 'pending')                                 AS pending_validation,
        SUM(outreach_status = 'sent')                                    AS sent_count,
        SUM(outreach_status = 'replied')                                 AS replied_count,
        SUM(outreach_status = 'failed')                                  AS failed_count,
        SUM(outreach_status = 'pending' AND whatsapp_status = 'valid')   AS queue_pending,
        SUM(pitch_type = 'A')                                            AS type_a_leads,
        SUM(pitch_type = 'B')                                            AS type_b_leads
     FROM leads",
    []
);

// ── Message statistics ────────────────────────────────────────
$msgStats = Database::fetchOne(
    "SELECT
        COUNT(*)                            AS total_messages,
        SUM(direction = 'outbound')         AS outbound_count,
        SUM(direction = 'inbound')          AS inbound_count,
        SUM(is_read = 0 AND direction = 'inbound') AS unread_count
     FROM messages",
    []
);

// ── Today's activity ──────────────────────────────────────────
$todayStats = Database::fetchOne(
    "SELECT
        SUM(direction = 'outbound' AND DATE(timestamp) = CURDATE()) AS sent_today,
        SUM(direction = 'inbound'  AND DATE(timestamp) = CURDATE()) AS received_today
     FROM messages",
    []
);

// ── Campaign settings ─────────────────────────────────────────
$campaignSettings = getSettings(['campaign_status', 'daily_send_limit']);
$dailyLimit  = (int) ($campaignSettings['daily_send_limit'] ?? 50);
$sentToday   = (int) ($todayStats['sent_today'] ?? 0);

// ── Recent activity (last 5 leads with activity) ──────────────
$recentActivity = Database::fetchAll(
    "SELECT l.id, l.business_name, l.city, l.outreach_status,
            l.whatsapp_status, l.last_contacted_at, l.phone_number,
            (SELECT message_text FROM messages
             WHERE lead_id = l.id
             ORDER BY timestamp DESC LIMIT 1) AS last_message
     FROM leads l
     WHERE l.last_contacted_at IS NOT NULL
     ORDER BY l.last_contacted_at DESC
     LIMIT 5",
    []
);

// Format recent activity
foreach ($recentActivity as &$act) {
    $act['time_ago']       = timeAgo($act['last_contacted_at']);
    $act['last_message']   = truncate($act['last_message'] ?? '', 60);
    $act['phone_display']  = formatPhoneDisplay($act['phone_number']);
}
unset($act);

// ── WhatsApp engine health (cached, non-blocking) ────────────
$waHealth = ['status' => 'unknown', 'whatsapp' => ['ready' => false]];
try {
    $healthResult = NodeClient::getHealth();
    if (isset($healthResult['status'])) {
        $waHealth = $healthResult;
    }
} catch (Exception $e) {
    AppLogger::warning('Health check failed in get_stats', ['error' => $e->getMessage()]);
}

jsonSuccess([
    'leads' => [
        'total'              => (int) ($leadStats['total_leads']      ?? 0),
        'valid'              => (int) ($leadStats['valid_leads']       ?? 0),
        'invalid'            => (int) ($leadStats['invalid_leads']     ?? 0),
        'pending_validation' => (int) ($leadStats['pending_validation'] ?? 0),
        'sent'               => (int) ($leadStats['sent_count']        ?? 0),
        'replied'            => (int) ($leadStats['replied_count']     ?? 0),
        'failed'             => (int) ($leadStats['failed_count']      ?? 0),
        'queue_pending'      => (int) ($leadStats['queue_pending']     ?? 0),
        'type_a'             => (int) ($leadStats['type_a_leads']      ?? 0),
        'type_b'             => (int) ($leadStats['type_b_leads']      ?? 0),
    ],
    'messages' => [
        'total'    => (int) ($msgStats['total_messages'] ?? 0),
        'outbound' => (int) ($msgStats['outbound_count'] ?? 0),
        'inbound'  => (int) ($msgStats['inbound_count']  ?? 0),
        'unread'   => (int) ($msgStats['unread_count']   ?? 0),
    ],
    'today' => [
        'sent'       => $sentToday,
        'received'   => (int) ($todayStats['received_today'] ?? 0),
        'daily_limit' => $dailyLimit,
        'limit_pct'  => $dailyLimit > 0 ? round(($sentToday / $dailyLimit) * 100) : 0,
    ],
    'campaign' => [
        'status'      => $campaignSettings['campaign_status'] ?? 'idle',
        'daily_limit' => $dailyLimit,
        'sent_today'  => $sentToday,
    ],
    'whatsapp' => [
        'engine_status' => $waHealth['status']               ?? 'unknown',
        'ready'         => $waHealth['whatsapp']['ready']    ?? false,
        'queue_size'    => $waHealth['queue']['size']        ?? 0,
        'processing'    => $waHealth['queue']['processing']  ?? false,
    ],
    'recent_activity' => $recentActivity,
    'generated_at'    => date('Y-m-d H:i:s'),
]);
