<?php
// ============================================================
// WWAS API - POST /api/delete_lead.php
// Soft-delete or hard-delete a lead and its messages
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$body   = getJsonBody();
$leadId = sanitizeInt($body['lead_id'] ?? 0);

if ($leadId <= 0) {
    jsonError('lead_id is required', 400);
}

// ── Verify lead exists ────────────────────────────────────────
$lead = Database::fetchOne(
    'SELECT id, business_name, phone_number, outreach_status FROM leads WHERE id = ? LIMIT 1',
    [$leadId]
);

if (!$lead) {
    jsonError('Lead not found', 404);
}

// ── Prevent deletion of leads mid-outreach ───────────────────
if ($lead['outreach_status'] === 'queued') {
    jsonError('Cannot delete a lead that is currently queued for sending. Pause the campaign first.', 409);
}

Database::beginTransaction();
try {
    // Delete messages first (FK cascade would also handle this but explicit is safer)
    $messagesDeleted = Database::execute(
        'DELETE FROM messages WHERE lead_id = ?',
        [$leadId]
    );

    // Delete lead
    Database::execute('DELETE FROM leads WHERE id = ?', [$leadId]);

    Database::commit();
} catch (Exception $e) {
    Database::rollback();
    AppLogger::error('Lead deletion failed', ['lead_id' => $leadId, 'error' => $e->getMessage()]);
    jsonError('Failed to delete lead: ' . $e->getMessage(), 500);
}

AppLogger::db('info', 'DeleteLead', "Lead #{$leadId} deleted: {$lead['business_name']}", [
    'messages_deleted' => $messagesDeleted
]);

jsonSuccess([
    'deleted'          => true,
    'lead_id'          => $leadId,
    'business_name'    => $lead['business_name'],
    'messages_deleted' => $messagesDeleted,
    'message'          => "Lead '{$lead['business_name']}' and its conversation have been deleted."
]);
