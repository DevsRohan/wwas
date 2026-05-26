<?php
// ============================================================
// WWAS API - POST /api/generate_message.php
// Generate or regenerate AI outreach message for a lead
// Optionally saves to DB (preview mode or save mode)
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/groq.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$body = getJsonBody();

$leadId   = sanitizeInt($body['lead_id'] ?? 0);
$save     = (bool) ($body['save'] ?? false);      // Save to DB or just preview
$force    = (bool) ($body['force'] ?? false);     // Force regenerate even if cached

if ($leadId <= 0) {
    jsonError('lead_id is required', 400);
}

// ── Fetch lead ────────────────────────────────────────────────
$lead = Database::fetchOne('SELECT * FROM leads WHERE id = ? LIMIT 1', [$leadId]);

if (!$lead) {
    jsonError('Lead not found', 404);
}

// ── Return cached message if exists and not forced ────────────
if (!$force && !empty($lead['generated_message'])) {
    jsonSuccess([
        'lead_id'  => $leadId,
        'message'  => $lead['generated_message'],
        'cached'   => true,
        'saved'    => true,
        'language' => $lead['language_pref'],
        'pitch_type' => $lead['pitch_type']
    ]);
}

// ── Generate new message via Groq ─────────────────────────────
$result = GroqAI::generateMessage($lead);

if (!$result['success']) {
    // Return fallback message — never fail completely
    $fallback = GroqAI::generateFallback($lead);
    AppLogger::warning('Using fallback message for lead', [
        'lead_id' => $leadId,
        'error'   => $result['error'] ?? 'unknown'
    ]);

    if ($save) {
        Database::execute(
            'UPDATE leads SET generated_message = ?, updated_at = NOW() WHERE id = ?',
            [$fallback, $leadId]
        );
    }

    jsonSuccess([
        'lead_id'    => $leadId,
        'message'    => $fallback,
        'cached'     => false,
        'saved'      => $save,
        'fallback'   => true,
        'error'      => $result['error'] ?? null,
        'language'   => $lead['language_pref'],
        'pitch_type' => $lead['pitch_type']
    ]);
}

$messageText = $result['message'];

// ── Optionally save to DB ─────────────────────────────────────
if ($save) {
    Database::execute(
        'UPDATE leads SET generated_message = ?, updated_at = NOW() WHERE id = ?',
        [$messageText, $leadId]
    );
}

AppLogger::info('Message generated', [
    'lead_id'    => $leadId,
    'pitch_type' => $lead['pitch_type'],
    'chars'      => strlen($messageText),
    'saved'      => $save
]);

jsonSuccess([
    'lead_id'    => $leadId,
    'message'    => $messageText,
    'cached'     => false,
    'saved'      => $save,
    'fallback'   => false,
    'language'   => $lead['language_pref'],
    'pitch_type' => $lead['pitch_type'],
    'char_count' => strlen($messageText)
]);
