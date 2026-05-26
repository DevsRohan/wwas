<?php
// ============================================================
// WWAS API - POST /api/validate_numbers.php
// Trigger WhatsApp number validation for pending leads
// Batches to HF /check-number endpoint
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

// Optional: validate specific lead IDs, or all pending
$specificIds = $body['lead_ids'] ?? [];
$batchSize   = max(1, min(50, sanitizeInt($body['batch_size'] ?? 20)));
$revalidate  = (bool) ($body['revalidate'] ?? false); // re-check already validated numbers

// ── Build query ───────────────────────────────────────────────
$conditions = [];
$params     = [];

if (!empty($specificIds) && is_array($specificIds)) {
    $ids          = array_map('intval', array_filter($specificIds));
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $conditions[] = "id IN ({$placeholders})";
    $params       = $ids;
} elseif ($revalidate) {
    $conditions[] = "whatsapp_status IN ('pending', 'failed')";
} else {
    $conditions[] = "whatsapp_status = 'pending'";
}

$whereClause = 'WHERE ' . implode(' AND ', $conditions);

$leads = Database::fetchAll(
    "SELECT id, phone_number FROM leads {$whereClause} ORDER BY created_at ASC LIMIT ?",
    array_merge($params, [$batchSize])
);

if (empty($leads)) {
    jsonSuccess([
        'validated'    => 0,
        'valid'        => 0,
        'invalid'      => 0,
        'failed'       => 0,
        'message'      => 'No leads found matching validation criteria'
    ]);
}

// ── Validate in batch via HF ──────────────────────────────────
$phoneNumbers = array_column($leads, 'phone_number');
$phoneToId    = array_combine($phoneNumbers, array_column($leads, 'id'));

$result = NodeClient::checkNumbers($phoneNumbers);

if (!($result['success'] ?? false)) {
    $errMsg = $result['error'] ?? 'Validation service unavailable';
    AppLogger::error('Batch validation failed', ['error' => $errMsg]);
    jsonError($errMsg, 503);
}

$results  = $result['results'] ?? [];
$summary  = $result['summary'] ?? ['valid' => 0, 'not_on_whatsapp' => 0, 'invalid' => 0, 'failed' => 0];

// ── Update DB for each result ─────────────────────────────────
$updated = 0;
foreach ($results as $res) {
    $phone    = $res['phone'] ?? '';
    $status   = $res['status'] ?? 'failed';
    $leadId   = $phoneToId[$phone] ?? null;

    if (!$leadId) continue;

    // Map validation status to DB enum
    $dbStatus = match($status) {
        'valid'           => 'valid',
        'not_on_whatsapp' => 'not_on_whatsapp',
        'invalid'         => 'invalid',
        'failed'          => 'failed',
        default           => 'failed'
    };

    // Skip leads that were already valid and set to valid again (no write needed)
    // For invalid/not_on_whatsapp — also skip from outreach
    $skipOutreach = in_array($dbStatus, ['not_on_whatsapp', 'invalid'], true) ? "'skipped'" : 'outreach_status';

    Database::execute(
        "UPDATE leads
         SET whatsapp_status = ?,
             outreach_status = CASE WHEN ? IN ('not_on_whatsapp', 'invalid') THEN 'skipped' ELSE outreach_status END,
             updated_at = NOW()
         WHERE id = ?",
        [$dbStatus, $dbStatus, (int) $leadId]
    );

    $updated++;
}

AppLogger::db('info', 'ValidateNumbers', "Batch validation complete: {$updated} updated", $summary);
AppLogger::info('Validation batch complete', array_merge(['context' => 'ValidateNumbers', 'updated' => $updated], $summary));

jsonSuccess([
    'validated'        => $updated,
    'valid'            => (int) ($summary['valid']            ?? 0),
    'not_on_whatsapp'  => (int) ($summary['not_on_whatsapp']  ?? 0),
    'invalid'          => (int) ($summary['invalid']          ?? 0),
    'failed'           => (int) ($summary['failed']           ?? 0),
    'total_checked'    => count($results),
    'message'          => "Validation complete: {$updated} leads updated"
]);
