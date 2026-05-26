<?php
// ============================================================
// WWAS - Campaign Runner Script
// Processes leads queue: generate AI messages + send via HF
// Safe for Hostinger shared hosting cron + manual execution
// Cron: */5 * * * * php /path/to/scripts/campaign.php
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/groq.php';
require_once __DIR__ . '/../includes/node_client.php';

// ── Execution Guard: Prevent overlapping cron runs ───────────
$lockFile = sys_get_temp_dir() . '/wwas_campaign.lock';

if (file_exists($lockFile)) {
    $lockAge = time() - (int) file_get_contents($lockFile);
    if ($lockAge < 600) { // 10 minute lock
        $msg = 'Campaign already running (lock age: ' . $lockAge . 's). Exiting.';
        AppLogger::info($msg, ['context' => 'Campaign']);
        exit($msg . "\n");
    }
    // Stale lock — remove it
    unlink($lockFile);
}

// Set lock
file_put_contents($lockFile, time());

// ── Execution from API: auth required ────────────────────────
$isCli = (php_sapi_name() === 'cli');
if (!$isCli) {
    // Called via HTTP (from dashboard or API)
    if (!isLoggedIn()) {
        @unlink($lockFile);
        apiUnauthorized();
    }
}

// Register cleanup to remove lock on exit/crash
register_shutdown_function(function () use ($lockFile) {
    @unlink($lockFile);
});

// ── Load campaign settings ────────────────────────────────────
$settings = getSettings([
    'campaign_status',
    'delay_min',
    'delay_max',
    'daily_send_limit',
    'groq_api_key'
]);

$campaignStatus = $settings['campaign_status'] ?? 'idle';
if ($campaignStatus === 'paused') {
    $msg = 'Campaign is paused. Exiting.';
    AppLogger::info($msg, ['context' => 'Campaign']);
    if (!$isCli) jsonSuccess(['status' => 'paused', 'message' => $msg]);
    exit($msg . "\n");
}

$delayMin   = max(30,  (int) ($settings['delay_min']       ?? CAMPAIGN_DELAY_MIN));
$delayMax   = max(60,  (int) ($settings['delay_max']       ?? CAMPAIGN_DELAY_MAX));
$dailyLimit = max(1,   (int) ($settings['daily_send_limit'] ?? CAMPAIGN_DAILY_LIMIT));

// Ensure min < max
if ($delayMin >= $delayMax) $delayMax = $delayMin + 60;

// ── Check daily send count ────────────────────────────────────
$todaySentCount = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM messages
     WHERE direction = 'outbound'
       AND DATE(timestamp) = CURDATE()",
    []
);

if ($todaySentCount >= $dailyLimit) {
    $msg = "Daily send limit reached ({$todaySentCount}/{$dailyLimit}). Campaign will resume tomorrow.";
    AppLogger::info($msg, ['context' => 'Campaign']);
    AppLogger::db('info', 'Campaign', $msg);
    if (!$isCli) jsonSuccess(['status' => 'limit_reached', 'message' => $msg, 'sent_today' => $todaySentCount]);
    exit($msg . "\n");
}

$remainingToday = $dailyLimit - $todaySentCount;

// ── Fetch leads to process ────────────────────────────────────
$batchSize = min($remainingToday, 10); // Max 10 per cron run to respect shared hosting limits

$leads = Database::fetchAll(
    "SELECT * FROM leads
     WHERE whatsapp_status = 'valid'
       AND outreach_status = 'pending'
     ORDER BY created_at ASC
     LIMIT ?",
    [$batchSize]
);

if (empty($leads)) {
    $msg = 'No leads to process. All valid leads have been contacted or queue is empty.';
    AppLogger::info($msg, ['context' => 'Campaign']);
    if (!$isCli) jsonSuccess(['status' => 'empty', 'message' => $msg]);
    exit($msg . "\n");
}

// ── Set campaign status to running ───────────────────────────
updateSetting('campaign_status', 'running');

$processed = 0;
$sent      = 0;
$failed    = 0;
$skipped   = 0;

foreach ($leads as $lead) {
    $leadId   = (int) $lead['id'];
    $phone    = $lead['phone_number'];
    $bizName  = $lead['business_name'];

    AppLogger::info("Processing lead #{$leadId}: {$bizName}", ['context' => 'Campaign', 'phone' => $phone]);

    // Double-check: skip if already replied
    if ($lead['outreach_status'] === 'replied') {
        $skipped++;
        AppLogger::info("Skipping #{$leadId} - already replied", ['context' => 'Campaign']);
        continue;
    }

    // ── Mark lead as queued ───────────────────────────────────
    Database::execute(
        "UPDATE leads SET outreach_status = 'queued', updated_at = NOW() WHERE id = ?",
        [$leadId]
    );

    // ── Generate or retrieve AI message ──────────────────────
    $messageText = $lead['generated_message'];

    if (empty($messageText)) {
        // Generate fresh AI message
        $groqResult = GroqAI::generateMessage($lead);

        if ($groqResult['success']) {
            $messageText = $groqResult['message'];
            // Cache generated message for this lead
            Database::execute(
                'UPDATE leads SET generated_message = ?, updated_at = NOW() WHERE id = ?',
                [$messageText, $leadId]
            );
        } else {
            // Use fallback message
            AppLogger::warning("Groq failed for lead #{$leadId}, using fallback", [
                'context' => 'Campaign',
                'error'   => $groqResult['error'] ?? 'unknown'
            ]);
            $messageText = GroqAI::generateFallback($lead);
        }
    }

    // ── Calculate randomized delay ────────────────────────────
    // First lead: small delay. Subsequent leads: full randomized delay.
    $delayMs = ($processed === 0) ? 2000 : (rand($delayMin, $delayMax) * 1000);

    // ── Send via Node.js / HF backend ────────────────────────
    $jobId  = 'campaign_' . $leadId . '_' . time();
    $result = NodeClient::sendMessage(
        phoneNumber: $phone,
        message:     $messageText,
        leadId:      (string) $leadId,
        jobId:       $jobId,
        useQueue:    true,
        delayMs:     $delayMs
    );

    if ($result['success'] ?? false) {
        $waMessageId = $result['wa_message_id'] ?? null;

        // Store the outbound message record
        Database::execute(
            "INSERT INTO messages (lead_id, sender, message_text, wa_message_id, direction, status, timestamp)
             VALUES (?, 'user', ?, ?, 'outbound', 'sent', NOW())
             ON DUPLICATE KEY UPDATE status = 'sent'",
            [$leadId, $messageText, $waMessageId]
        );

        // Update lead status
        Database::execute(
            "UPDATE leads
             SET outreach_status = 'sent',
                 last_contacted_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?",
            [$leadId]
        );

        $sent++;
        AppLogger::info("Lead #{$leadId} message queued/sent", [
            'context' => 'Campaign',
            'job_id'  => $jobId,
            'queued'  => $result['queued'] ?? false
        ]);
        AppLogger::db('info', 'Campaign', "Message sent to lead #{$leadId}: {$bizName}", [
            'phone'   => $phone,
            'job_id'  => $jobId
        ]);

    } else {
        $errMsg = $result['error'] ?? 'Unknown error';
        $failed++;

        // Increment retry count or mark as failed
        $retries = (int) Database::fetchValue(
            'SELECT COALESCE(JSON_EXTRACT(tags, "$.retry_count"), 0) FROM leads WHERE id = ?',
            [$leadId]
        );

        if ($retries >= CAMPAIGN_MAX_RETRIES) {
            Database::execute(
                "UPDATE leads SET outreach_status = 'failed', updated_at = NOW() WHERE id = ?",
                [$leadId]
            );
            AppLogger::error("Lead #{$leadId} permanently failed after max retries", [
                'context' => 'Campaign',
                'error'   => $errMsg
            ]);
        } else {
            // Reset to pending for retry
            Database::execute(
                "UPDATE leads
                 SET outreach_status = 'pending',
                     tags = JSON_SET(COALESCE(tags, '{}'), '$.retry_count', ?),
                     updated_at = NOW()
                 WHERE id = ?",
                [$retries + 1, $leadId]
            );
            AppLogger::warning("Lead #{$leadId} failed, will retry (attempt {$retries})", [
                'context' => 'Campaign',
                'error'   => $errMsg
            ]);
        }
    }

    $processed++;
}

// ── Update campaign status back to idle ──────────────────────
// Only set to idle if no more pending leads exist
$pendingCount = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM leads WHERE whatsapp_status = 'valid' AND outreach_status = 'pending'"
);

$newStatus = ($pendingCount > 0) ? 'idle' : 'completed';
updateSetting('campaign_status', $newStatus);

$summary = [
    'status'        => 'processed',
    'processed'     => $processed,
    'sent'          => $sent,
    'failed'        => $failed,
    'skipped'       => $skipped,
    'remaining'     => $pendingCount,
    'sent_today'    => $todaySentCount + $sent,
    'daily_limit'   => $dailyLimit,
    'campaign_status' => $newStatus
];

AppLogger::db('info', 'Campaign', "Campaign batch complete: {$sent} sent, {$failed} failed", $summary);
AppLogger::info('Campaign batch complete', array_merge(['context' => 'Campaign'], $summary));

if (!$isCli) {
    jsonSuccess($summary);
} else {
    echo "Campaign batch complete: {$sent} sent, {$failed} failed, {$pendingCount} remaining.\n";
}
