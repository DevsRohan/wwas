<?php
// ============================================================
// WWAS API - POST /api/send_manual.php
// Send a manual reply message to a lead
// Bypasses queue — sends immediately (direct mode)
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$body = getJsonBody();

$leadId  = sanitizeInt($body['lead_id'] ?? 0);
$message = sanitizeString($body['message'] ?? '', 4096);

if ($leadId <= 0) {
    jsonError('lead_id is required', 400);
}
if (empty($message)) {
    jsonError('message is required and cannot be empty', 400);
}
if (mb_strlen($message) > 4096) {
    jsonError('Message exceeds maximum length of 4096 characters', 400);
}

// ── Verify lead exists and is on WhatsApp ─────────────────────
$lead = Database::fetchOne(
    'SELECT id, business_name, phone_number, whatsapp_status, outreach_status FROM leads WHERE id = ? LIMIT 1',
    [$leadId]
);

if (!$lead) {
    jsonError('Lead not found', 404);
}

if ($lead['whatsapp_status'] !== 'valid') {
    jsonError('Cannot send message: WhatsApp number is not verified as valid', 422);
}

// ── Send via Node.js (direct, no queue) ──────────────────────
$jobId  = 'manual_' . $leadId . '_' . time();
$result = NodeClient::sendMessage(
    phoneNumber: $lead['phone_number'],
    message:     $message,
    leadId:      (string) $leadId,
    jobId:       $jobId,
    useQueue:    false,   // manual sends bypass queue
    delayMs:     0
);

if (!($result['success'] ?? false)) {
    $errMsg = $result['error'] ?? 'Failed to send message';
    AppLogger::error('Manual send failed', [
        'lead_id' => $leadId,
        'phone'   => $lead['phone_number'],
        'error'   => $errMsg
    ]);
    AppLogger::db('error', 'SendManual', "Failed to send manual message to lead #{$leadId}", ['error' => $errMsg]);
    jsonError($errMsg, 500);
}

$waMessageId = $result['wa_message_id'] ?? null;

// ── Store message in DB ───────────────────────────────────────
Database::execute(
    "INSERT INTO messages (lead_id, sender, message_text, wa_message_id, direction, status, timestamp)
     VALUES (?, 'user', ?, ?, 'outbound', 'sent', NOW())",
    [$leadId, $message, $waMessageId]
);

$newMessageId = (int) Database::lastInsertId();

// ── Update lead last_contacted_at ─────────────────────────────
Database::execute(
    'UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ?',
    [$leadId]
);

AppLogger::info('Manual message sent', [
    'lead_id'      => $leadId,
    'phone'        => $lead['phone_number'],
    'wa_message_id' => $waMessageId
]);
AppLogger::db('info', 'SendManual', "Manual message sent to lead #{$leadId}: {$lead['business_name']}");

jsonSuccess([
    'message_id'    => $newMessageId,
    'wa_message_id' => $waMessageId,
    'lead_id'       => $leadId,
    'sent_at'       => date('Y-m-d H:i:s'),
    'message'       => 'Message sent successfully'
]);
