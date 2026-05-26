<?php
// ============================================================
// WWAS - Webhook Receiver
// Receives signed events from HF Node.js engine
// Stores messages, updates lead status, prevents duplicates
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/config/app.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/auth.php';

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method Not Allowed');
}

// Read raw body before any parsing
$rawBody = file_get_contents('php://input');

if (empty($rawBody)) {
    http_response_code(400);
    exit('Empty body');
}

// ── Verify HMAC Signature ─────────────────────────────────────
$signature = $_SERVER['HTTP_X_WWAS_SIGNATURE'] ?? '';

if (!verifyWebhookSignature($rawBody, $signature)) {
    AppLogger::webhook('warning', 'Webhook rejected - invalid signature', [
        'ip'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'signature' => substr($signature, 0, 20)
    ]);
    http_response_code(403);
    exit('Invalid signature');
}

// ── Parse payload ─────────────────────────────────────────────
$payload = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE || !isset($payload['event'])) {
    http_response_code(400);
    exit('Invalid JSON');
}

$event      = sanitizeString($payload['event']      ?? '', 50);
$data       = $payload['payload']   ?? [];
$deliveryId = sanitizeString($payload['delivery_id'] ?? '', 100);

AppLogger::webhook('info', "Received webhook event: {$event}", ['delivery_id' => $deliveryId]);

// ── Idempotency: skip duplicate deliveries ────────────────────
// Use a dedicated settings key per delivery_id for fast O(1) dedup
// Avoids full-table LIKE scan on the logs table
if (!empty($deliveryId)) {
    $dedupKey = 'wh_dedup_' . md5($deliveryId);
    $exists = Database::fetchValue(
        "SELECT 1 FROM settings WHERE key_name = ? LIMIT 1",
        [$dedupKey]
    );
    if ($exists) {
        http_response_code(200);
        exit(json_encode(['status' => 'duplicate', 'delivery_id' => $deliveryId]));
    }
    // Mark as received immediately (before processing) to prevent race conditions
    Database::execute(
        "INSERT IGNORE INTO settings (key_name, key_value) VALUES (?, ?)",
        [$dedupKey, date('Y-m-d H:i:s')]
    );
}

// ── Route event ───────────────────────────────────────────────
try {
    switch ($event) {
        case 'inbound_message':
            handleInboundMessage($data);
            break;

        case 'outbound_message':
        case 'message_sent':
            handleOutboundConfirm($data);
            break;

        case 'message_failed':
            handleMessageFailed($data);
            break;

        default:
            AppLogger::webhook('debug', "Unhandled event: {$event}");
            break;
    }

    // Log the processed delivery ID for audit trail
    if (!empty($deliveryId)) {
        AppLogger::db('info', 'Webhook', "Processed event: {$event} | {$deliveryId}");
    }

    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'event' => $event]);

} catch (Exception $e) {
    AppLogger::webhook('error', "Webhook handler error for {$event}", ['error' => $e->getMessage()]);
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}

// ============================================================
// EVENT HANDLERS
// ============================================================

/**
 * Handle inbound message from a lead
 */
function handleInboundMessage(array $data): void
{
    $phone      = sanitizeString($data['phone_number'] ?? '', 25);
    $msgText    = sanitizeString($data['message_text'] ?? '', 4096);
    $waId       = sanitizeString($data['wa_message_id'] ?? '', 150);
    $timestampMs = (int) ($data['timestamp'] ?? (time() * 1000));

    if (empty($phone) || empty($msgText)) {
        AppLogger::webhook('warning', 'Inbound message missing required fields', $data);
        return;
    }

    // Find lead by phone number
    $lead = Database::fetchOne(
        'SELECT id, outreach_status FROM leads WHERE phone_number = ? LIMIT 1',
        [$phone]
    );

    if (!$lead) {
        AppLogger::webhook('warning', "Inbound message from unknown lead: {$phone}");
        return;
    }

    $leadId    = (int) $lead['id'];
    $timestamp = date('Y-m-d H:i:s', (int) ($timestampMs / 1000));

    // Store message (prevent duplicate by wa_message_id)
    Database::execute(
        "INSERT INTO messages (lead_id, sender, message_text, wa_message_id, direction, is_read, status, timestamp)
         VALUES (?, 'lead', ?, ?, 'inbound', 0, 'received', ?)
         ON DUPLICATE KEY UPDATE is_read = 0",
        [$leadId, $msgText, $waId ?: null, $timestamp]
    );

    // Mark lead as replied — STOP automation
    if ($lead['outreach_status'] !== 'replied') {
        Database::execute(
            "UPDATE leads SET outreach_status = 'replied', updated_at = NOW() WHERE id = ?",
            [$leadId]
        );
        AppLogger::webhook('info', "Lead #{$leadId} replied — automation stopped", ['phone' => $phone]);
    }

    AppLogger::webhook('info', "Inbound message stored for lead #{$leadId}", ['phone' => $phone]);
}

/**
 * Handle outbound message delivery confirmation
 */
function handleOutboundConfirm(array $data): void
{
    $phone    = sanitizeString($data['phone_number'] ?? '', 25);
    $waId     = sanitizeString($data['wa_message_id'] ?? '', 150);
    $leadId   = sanitizeInt($data['lead_id'] ?? 0);

    if ($leadId <= 0 && empty($phone)) return;

    // Update message status to 'sent' by wa_message_id
    if (!empty($waId)) {
        Database::execute(
            "UPDATE messages SET status = 'sent' WHERE wa_message_id = ?",
            [$waId]
        );
    }

    // If lead_id provided, update last_contacted_at
    if ($leadId > 0) {
        Database::execute(
            "UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ?",
            [$leadId]
        );
    }

    AppLogger::webhook('info', "Outbound confirmed for lead #{$leadId}", ['wa_id' => $waId]);
}

/**
 * Handle message send failure
 */
function handleMessageFailed(array $data): void
{
    $leadId  = sanitizeInt($data['lead_id'] ?? 0);
    $phone   = sanitizeString($data['phone_number'] ?? '', 25);
    $error   = sanitizeString($data['error'] ?? 'unknown', 200);

    if ($leadId <= 0) return;

    // Reset lead back to pending for retry eligibility
    Database::execute(
        "UPDATE leads SET outreach_status = 'failed', updated_at = NOW() WHERE id = ? AND outreach_status = 'queued'",
        [$leadId]
    );

    AppLogger::webhook('error', "Message failed for lead #{$leadId}", ['error' => $error, 'phone' => $phone]);
    AppLogger::db('error', 'Webhook', "Send failed for lead #{$leadId}: {$error}");
}
