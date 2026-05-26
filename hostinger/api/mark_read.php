<?php
// ============================================================
// WWAS API - POST /api/mark_read.php
// Mark messages as read for a lead or a specific message
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$body = getJsonBody();

$leadId    = sanitizeInt($body['lead_id']    ?? 0);
$messageId = sanitizeInt($body['message_id'] ?? 0);

if ($leadId <= 0 && $messageId <= 0) {
    jsonError('Either lead_id or message_id is required', 400);
}

if ($messageId > 0) {
    // Mark a single specific message as read
    $affected = Database::execute(
        'UPDATE messages SET is_read = 1 WHERE id = ? AND is_read = 0',
        [$messageId]
    );
    jsonSuccess([
        'marked'   => $affected,
        'scope'    => 'single',
        'message'  => $affected > 0 ? 'Message marked as read' : 'Message was already read'
    ]);
}

// Mark all inbound messages for a lead as read
$lead = Database::fetchOne('SELECT id FROM leads WHERE id = ? LIMIT 1', [$leadId]);
if (!$lead) {
    jsonError('Lead not found', 404);
}

$affected = Database::execute(
    "UPDATE messages SET is_read = 1 WHERE lead_id = ? AND direction = 'inbound' AND is_read = 0",
    [$leadId]
);

jsonSuccess([
    'marked'  => $affected,
    'lead_id' => $leadId,
    'scope'   => 'lead',
    'message' => "{$affected} message(s) marked as read"
]);
