<?php
// ============================================================
// WWAS - Retry Failed Sends Script
// Resets failed leads back to pending for retry
// Safe for both cron and manual HTTP execution
// Cron: 0 * * * * php /path/to/scripts/retry_failed.php
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/node_client.php';

$isCli = (php_sapi_name() === 'cli');
if (!$isCli) {
    if (!isLoggedIn()) {
        apiUnauthorized();
    }
}

$maxRetries = (int) getSetting('max_retries', CAMPAIGN_MAX_RETRIES);

// ── Reset leads stuck in 'queued' state for > 30 minutes ─────
// These are leads that were queued but never got a webhook confirmation
$stuckQueued = Database::execute(
    "UPDATE leads
     SET outreach_status = 'pending',
         updated_at = NOW()
     WHERE outreach_status = 'queued'
       AND updated_at < NOW() - INTERVAL 30 MINUTE",
    []
);

// ── Find failed leads eligible for retry ─────────────────────
// Eligible: outreach_status = 'failed' AND retry_count < max_retries
// AND was last attempted > retry_delay seconds ago
$retryDelaySec = (int) getSetting('retry_delay', CAMPAIGN_RETRY_DELAY);

$failedLeads = Database::fetchAll(
    "SELECT id, business_name, phone_number,
            COALESCE(JSON_EXTRACT(tags, '$.retry_count'), 0) as retry_count
     FROM leads
     WHERE outreach_status = 'failed'
       AND whatsapp_status = 'valid'
       AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL ? SECOND)
     HAVING retry_count < ?
     ORDER BY last_contacted_at ASC
     LIMIT 50",
    [$retryDelaySec, $maxRetries]
);

$resetCount = 0;
foreach ($failedLeads as $lead) {
    Database::execute(
        "UPDATE leads
         SET outreach_status = 'pending',
             updated_at = NOW()
         WHERE id = ?",
        [(int) $lead['id']]
    );
    $resetCount++;

    AppLogger::info("Lead #{$lead['id']} reset to pending for retry", [
        'context'     => 'RetryFailed',
        'business'    => $lead['business_name'],
        'retry_count' => (int) $lead['retry_count']
    ]);
}

// ── Also re-validate leads with 'failed' whatsapp_status ─────
// These might now be on WhatsApp after initial check failed
$validationFailed = Database::fetchAll(
    "SELECT id, phone_number FROM leads
     WHERE whatsapp_status = 'failed'
       AND (updated_at < NOW() - INTERVAL 24 HOUR OR updated_at IS NULL)
     LIMIT 20",
    []
);

$revalidated = 0;
foreach ($validationFailed as $lead) {
    Database::execute(
        "UPDATE leads SET whatsapp_status = 'pending', updated_at = NOW() WHERE id = ?",
        [(int) $lead['id']]
    );
    $revalidated++;
}

// ── Summary ───────────────────────────────────────────────────
$summary = [
    'stuck_queued_reset' => $stuckQueued,
    'failed_leads_reset' => $resetCount,
    'revalidation_reset' => $revalidated,
    'timestamp'          => date('Y-m-d H:i:s')
];

AppLogger::db('info', 'RetryFailed', 'Retry script executed', $summary);
AppLogger::info('Retry script executed', array_merge(['context' => 'RetryFailed'], $summary));

if (!$isCli) {
    jsonSuccess($summary);
} else {
    echo "Retry complete: {$resetCount} failed leads reset, {$stuckQueued} stuck-queued leads reset, {$revalidated} re-queued for validation.\n";
}
