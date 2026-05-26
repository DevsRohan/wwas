<?php
// ============================================================
// WWAS API - GET /api/get_messages.php
// Returns conversation messages for a specific lead
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

$leadId = sanitizeInt($_GET['lead_id'] ?? 0);
if ($leadId <= 0) {
    jsonError('lead_id is required and must be a positive integer', 400);
}

$page    = max(1, sanitizeInt($_GET['page']     ?? 1));
$perPage = max(1, min(100, sanitizeInt($_GET['per_page'] ?? 50)));

// ── Verify lead exists ────────────────────────────────────────
$lead = Database::fetchOne(
    'SELECT id, business_name, phone_number, outreach_status, whatsapp_status FROM leads WHERE id = ? LIMIT 1',
    [$leadId]
);

if (!$lead) {
    jsonError('Lead not found', 404);
}

// ── Count total messages ──────────────────────────────────────
$total = (int) Database::fetchValue(
    'SELECT COUNT(*) FROM messages WHERE lead_id = ?',
    [$leadId]
);

$pag    = paginate($total, $page, $perPage);
$offset = $pag['offset'];

// ── Fetch messages ────────────────────────────────────────────
$messages = Database::fetchAll(
    'SELECT id, sender, message_text, wa_message_id, direction, is_read, status, timestamp
     FROM messages
     WHERE lead_id = ?
     ORDER BY timestamp ASC
     LIMIT ? OFFSET ?',
    [$leadId, $perPage, $offset]
);

// ── Mark inbound messages as read ────────────────────────────
Database::execute(
    "UPDATE messages SET is_read = 1 WHERE lead_id = ? AND direction = 'inbound' AND is_read = 0",
    [$leadId]
);

// ── Format messages ───────────────────────────────────────────
foreach ($messages as &$msg) {
    $msg['is_read']        = (bool) $msg['is_read'];
    $msg['timestamp_human'] = formatDateTime($msg['timestamp'], 'd M Y, h:i A');
    $msg['time_display']   = formatDateTime($msg['timestamp'], 'h:i A');
    $msg['date_display']   = formatDateTime($msg['timestamp'], 'd M Y');
}
unset($msg);

// ── Group messages by date for UI rendering ──────────────────
$grouped = [];
foreach ($messages as $msg) {
    $dateKey = date('Y-m-d', strtotime($msg['timestamp']));
    $label   = match(true) {
        $dateKey === date('Y-m-d')                          => 'Today',
        $dateKey === date('Y-m-d', strtotime('-1 day'))     => 'Yesterday',
        default                                              => formatDateTime($msg['timestamp'], 'd M Y')
    };
    $grouped[$dateKey]['label']    = $label;
    $grouped[$dateKey]['messages'][] = $msg;
}

jsonSuccess([
    'lead'       => [
        'id'              => (int) $lead['id'],
        'business_name'   => $lead['business_name'],
        'phone_number'    => $lead['phone_number'],
        'phone_display'   => formatPhoneDisplay($lead['phone_number']),
        'outreach_status' => $lead['outreach_status'],
        'whatsapp_status' => $lead['whatsapp_status'],
    ],
    'messages'   => $messages,
    'grouped'    => array_values($grouped),
    'pagination' => $pag,
]);
