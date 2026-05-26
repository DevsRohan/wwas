<?php
// ============================================================
// WWAS API - GET /api/get_lead_details.php
// Returns full lead profile with history, analytics, timeline
// Used by the right-panel "Get Details" drawer
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
    jsonError('lead_id is required', 400);
}

// ── Fetch full lead record ────────────────────────────────────
$lead = Database::fetchOne(
    'SELECT * FROM leads WHERE id = ? LIMIT 1',
    [$leadId]
);

if (!$lead) {
    jsonError('Lead not found', 404);
}

// ── Message history summary ───────────────────────────────────
$msgSummary = Database::fetchOne(
    "SELECT
        COUNT(*)                              AS total_messages,
        SUM(direction = 'outbound')           AS sent_count,
        SUM(direction = 'inbound')            AS received_count,
        SUM(is_read = 0 AND direction = 'inbound') AS unread_count,
        MIN(timestamp)                        AS first_contact,
        MAX(timestamp)                        AS last_contact
     FROM messages WHERE lead_id = ?",
    [$leadId]
);

// ── Recent messages (last 10 for timeline) ────────────────────
$recentMessages = Database::fetchAll(
    'SELECT id, sender, message_text, direction, status, is_read, timestamp
     FROM messages
     WHERE lead_id = ?
     ORDER BY timestamp DESC
     LIMIT 10',
    [$leadId]
);

foreach ($recentMessages as &$msg) {
    $msg['time_ago']       = timeAgo($msg['timestamp']);
    $msg['timestamp_human'] = formatDateTime($msg['timestamp']);
    $msg['is_read']        = (bool) $msg['is_read'];
}
unset($msg);

// ── Activity timeline ─────────────────────────────────────────
$timeline = buildTimeline($lead, $recentMessages);

// ── Format lead fields ────────────────────────────────────────
$lead['rating']           = $lead['rating'] !== null ? (float) $lead['rating'] : null;
$lead['review_count']     = (int) $lead['review_count'];
$lead['phone_display']    = formatPhoneDisplay($lead['phone_number']);
$lead['created_human']    = formatDateTime($lead['created_at']);
$lead['updated_human']    = formatDateTime($lead['updated_at']);
$lead['last_contact_human'] = $lead['last_contacted_at'] ? formatDateTime($lead['last_contacted_at']) : 'Never';
$lead['last_contact_ago'] = timeAgo($lead['last_contacted_at']);
$lead['tags']             = !empty($lead['tags']) ? json_decode($lead['tags'], true) : [];

// ── AI reasoning ─────────────────────────────────────────────
$aiReasoning = buildAiReasoning($lead);

// ── Outreach analytics ────────────────────────────────────────
$analytics = [
    'response_rate'   => calculateResponseRate($msgSummary),
    'days_since_contact' => $lead['last_contacted_at']
        ? floor((time() - strtotime($lead['last_contacted_at'])) / 86400)
        : null,
    'is_active'       => in_array($lead['outreach_status'], ['sent', 'replied'], true),
    'engagement_level' => getEngagementLevel($lead, $msgSummary),
];

jsonSuccess([
    'lead'             => $lead,
    'message_summary'  => [
        'total'         => (int) ($msgSummary['total_messages'] ?? 0),
        'sent'          => (int) ($msgSummary['sent_count']     ?? 0),
        'received'      => (int) ($msgSummary['received_count'] ?? 0),
        'unread'        => (int) ($msgSummary['unread_count']   ?? 0),
        'first_contact' => $msgSummary['first_contact'] ? formatDateTime($msgSummary['first_contact']) : null,
        'last_contact'  => $msgSummary['last_contact']  ? formatDateTime($msgSummary['last_contact'])  : null,
    ],
    'recent_messages'  => array_reverse($recentMessages), // chronological order
    'timeline'         => $timeline,
    'ai_reasoning'     => $aiReasoning,
    'analytics'        => $analytics,
]);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Build a chronological activity timeline for the lead.
 */
function buildTimeline(array $lead, array $messages): array
{
    $events = [];

    // Lead created
    $events[] = [
        'type'      => 'created',
        'label'     => 'Lead imported',
        'detail'    => 'Lead added to CRM from CSV import',
        'timestamp' => $lead['created_at'],
        'time_ago'  => timeAgo($lead['created_at']),
        'icon'      => 'plus',
        'color'     => 'green'
    ];

    // Validation events
    if (in_array($lead['whatsapp_status'], ['valid', 'invalid', 'not_on_whatsapp'], true)) {
        $label = match($lead['whatsapp_status']) {
            'valid'            => 'WhatsApp number verified',
            'invalid'          => 'Number marked invalid',
            'not_on_whatsapp'  => 'Not on WhatsApp',
            default            => 'Validation completed'
        };
        $events[] = [
            'type'      => 'validated',
            'label'     => $label,
            'detail'    => 'Phone: ' . formatPhoneDisplay($lead['phone_number']),
            'timestamp' => $lead['updated_at'],
            'time_ago'  => timeAgo($lead['updated_at']),
            'icon'      => 'shield-check',
            'color'     => $lead['whatsapp_status'] === 'valid' ? 'green' : 'red'
        ];
    }

    // Message events (from recent messages, reversed to chronological)
    foreach (array_reverse($messages) as $msg) {
        if ($msg['direction'] === 'outbound') {
            $events[] = [
                'type'      => 'message_sent',
                'label'     => 'Outreach message sent',
                'detail'    => truncate($msg['message_text'], 80),
                'timestamp' => $msg['timestamp'],
                'time_ago'  => $msg['time_ago'],
                'icon'      => 'send',
                'color'     => 'blue'
            ];
        } else {
            $events[] = [
                'type'      => 'message_received',
                'label'     => 'Lead replied',
                'detail'    => truncate($msg['message_text'], 80),
                'timestamp' => $msg['timestamp'],
                'time_ago'  => $msg['time_ago'],
                'icon'      => 'message-circle',
                'color'     => 'green'
            ];
        }
    }

    // Sort by timestamp descending (newest first)
    usort($events, fn($a, $b) => strtotime($b['timestamp']) - strtotime($a['timestamp']));

    return $events;
}

/**
 * Build AI reasoning text explaining why services were suggested.
 */
function buildAiReasoning(array $lead): array
{
    $pitchType   = $lead['pitch_type'];
    $rating      = (float) ($lead['rating'] ?? 0);
    $reviews     = (int)   ($lead['review_count'] ?? 0);
    $hasWebsite  = $lead['website_status'] === 'yes';
    $city        = $lead['city'] ?? 'their city';
    $state       = $lead['state'] ?? '';
    $lang        = $lead['language_pref'] ?? 'english';

    $reasons = [];
    $opportunities = [];

    if ($hasWebsite) {
        $reasons[] = "Business has an existing website ({$lead['website_url']})";
        $opportunities[] = 'Website optimization & conversion improvement';
        if ($rating >= 4.0) {
            $opportunities[] = 'AI automation to scale proven reputation';
        }
        if ($reviews > 50) {
            $opportunities[] = 'Leverage high review count for digital marketing';
        }
    } else {
        $reasons[] = 'Business has no website — high digital opportunity';
        $opportunities[] = 'Build first professional web presence';
        $opportunities[] = 'WhatsApp enquiry system for immediate leads';
        if ($reviews > 0) {
            $reasons[] = "Has {$reviews} Google reviews showing active customer base";
        }
    }

    if ($rating >= 4.0 && $reviews >= 20) {
        $reasons[] = "Strong reputation: {$rating}★ with {$reviews} reviews in {$city}";
    }

    $langNote = match($lang) {
        'hinglish' => "Message sent in Hinglish for better local connection",
        'gujarati' => "Message adapted for Gujarati business culture",
        'marathi'  => "Message adapted for Maharashtra business tone",
        'punjabi'  => "Message adapted for Punjab business culture",
        default    => "Message sent in professional English"
    };

    return [
        'pitch_type'    => $pitchType === 'A' ? 'Type A (Has Website)' : 'Type B (No Website)',
        'language_used' => ucfirst($lang),
        'language_note' => $langNote,
        'reasons'       => $reasons,
        'opportunities' => $opportunities,
        'region'        => trim("{$city}, {$state}"),
    ];
}

/**
 * Calculate response rate as percentage.
 */
function calculateResponseRate(array $msgSummary): ?float
{
    $sent     = (int) ($msgSummary['sent_count']     ?? 0);
    $received = (int) ($msgSummary['received_count'] ?? 0);
    if ($sent === 0) return null;
    return round(($received / $sent) * 100, 1);
}

/**
 * Determine engagement level label.
 */
function getEngagementLevel(array $lead, array $msgSummary): string
{
    $received = (int) ($msgSummary['received_count'] ?? 0);
    return match(true) {
        $received >= 3                          => 'High',
        $received >= 1                          => 'Medium',
        $lead['outreach_status'] === 'sent'     => 'Awaiting Reply',
        $lead['outreach_status'] === 'pending'  => 'Not Contacted',
        default                                  => 'None'
    };
}
