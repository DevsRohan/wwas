<?php
// ============================================================
// WWAS API - GET /api/get_leads.php
// Returns paginated, filterable, searchable leads list
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

// ── Query parameters ──────────────────────────────────────────
$search          = sanitizeString($_GET['search']           ?? '', 100);
$whatsappStatus  = sanitizeString($_GET['whatsapp_status']  ?? '', 30);
$outreachStatus  = sanitizeString($_GET['outreach_status']  ?? '', 30);
$pitchType       = sanitizeString($_GET['pitch_type']       ?? '', 5);
$city            = sanitizeString($_GET['city']             ?? '', 80);
$state           = sanitizeString($_GET['state']            ?? '', 80);
$sortBy          = sanitizeString($_GET['sort']             ?? 'created_at', 30);
$sortDir         = strtoupper(sanitizeString($_GET['dir']   ?? 'DESC', 5));
$page            = max(1, sanitizeInt($_GET['page']         ?? 1));
$perPage         = max(1, min(100, sanitizeInt($_GET['per_page'] ?? 25)));

// ── Whitelist sort columns ────────────────────────────────────
$allowedSorts = ['created_at', 'updated_at', 'business_name', 'city', 'rating', 'review_count', 'last_contacted_at'];
if (!in_array($sortBy, $allowedSorts, true)) $sortBy = 'created_at';
if (!in_array($sortDir, ['ASC', 'DESC'], true)) $sortDir = 'DESC';

// ── Whitelist enum filters ────────────────────────────────────
$validWaStatuses      = ['pending', 'valid', 'invalid', 'not_on_whatsapp', 'failed'];
$validOutreachStatuses = ['pending', 'queued', 'sent', 'replied', 'failed', 'skipped'];
$validPitchTypes       = ['A', 'B'];

if ($whatsappStatus && !in_array($whatsappStatus, $validWaStatuses, true))    $whatsappStatus  = '';
if ($outreachStatus && !in_array($outreachStatus, $validOutreachStatuses, true)) $outreachStatus = '';
if ($pitchType      && !in_array($pitchType, $validPitchTypes, true))          $pitchType       = '';

// ── Build WHERE clause ────────────────────────────────────────
$conditions = [];
$params     = [];

if (!empty($search)) {
    $conditions[] = '(l.business_name LIKE ? OR l.phone_number LIKE ? OR l.city LIKE ? OR l.locality LIKE ?)';
    $like = '%' . $search . '%';
    $params = array_merge($params, [$like, $like, $like, $like]);
}

if (!empty($whatsappStatus)) {
    $conditions[] = 'l.whatsapp_status = ?';
    $params[]     = $whatsappStatus;
}

if (!empty($outreachStatus)) {
    $conditions[] = 'l.outreach_status = ?';
    $params[]     = $outreachStatus;
}

if (!empty($pitchType)) {
    $conditions[] = 'l.pitch_type = ?';
    $params[]     = $pitchType;
}

if (!empty($city)) {
    $conditions[] = 'l.city LIKE ?';
    $params[]     = '%' . $city . '%';
}

if (!empty($state)) {
    $conditions[] = 'l.state LIKE ?';
    $params[]     = '%' . $state . '%';
}

$whereClause = !empty($conditions) ? 'WHERE ' . implode(' AND ', $conditions) : '';

// ── Count total matching records ──────────────────────────────
$total = (int) Database::fetchValue(
    "SELECT COUNT(*) FROM leads l {$whereClause}",
    $params
);

$pag    = paginate($total, $page, $perPage);
$offset = $pag['offset'];

// ── Fetch leads with unread message count ─────────────────────
$leads = Database::fetchAll(
    "SELECT
        l.id, l.business_name, l.phone_number, l.locality, l.city, l.state,
        l.website_url, l.website_status, l.rating, l.review_count,
        l.whatsapp_status, l.outreach_status, l.pitch_type, l.language_pref,
        l.tags, l.notes, l.last_contacted_at, l.created_at,
        (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.is_read = 0 AND m.direction = 'inbound') AS unread_count,
        (SELECT message_text FROM messages m WHERE m.lead_id = l.id ORDER BY m.timestamp DESC LIMIT 1) AS last_message,
        (SELECT timestamp FROM messages m WHERE m.lead_id = l.id ORDER BY m.timestamp DESC LIMIT 1) AS last_message_at
     FROM leads l
     {$whereClause}
     ORDER BY l.{$sortBy} {$sortDir}
     LIMIT ? OFFSET ?",
    array_merge($params, [$perPage, $offset])
);

// ── Format response ───────────────────────────────────────────
foreach ($leads as &$lead) {
    $lead['phone_display']   = formatPhoneDisplay($lead['phone_number']);
    $lead['last_message']    = truncate($lead['last_message'] ?? '', 80);
    $lead['time_ago']        = timeAgo($lead['last_contacted_at']);
    $lead['last_msg_ago']    = timeAgo($lead['last_message_at'] ?? null);
    $lead['created_human']   = formatDateTime($lead['created_at']);
    $lead['unread_count']    = (int) $lead['unread_count'];
    $lead['rating']          = $lead['rating'] !== null ? (float) $lead['rating'] : null;
    $lead['review_count']    = (int) $lead['review_count'];
    // Decode JSON tags safely
    $lead['tags'] = !empty($lead['tags']) ? json_decode($lead['tags'], true) : [];
}
unset($lead);

// ── Available filter options (for frontend dropdowns) ─────────
$cities = Database::fetchAll(
    "SELECT DISTINCT city FROM leads WHERE city != '' AND city IS NOT NULL ORDER BY city LIMIT 100",
    []
);
$states = Database::fetchAll(
    "SELECT DISTINCT state FROM leads WHERE state != '' AND state IS NOT NULL ORDER BY state LIMIT 50",
    []
);

jsonSuccess([
    'leads'      => $leads,
    'pagination' => $pag,
    'filters'    => [
        'cities' => array_column($cities, 'city'),
        'states' => array_column($states, 'state'),
    ],
    'applied_filters' => [
        'search'          => $search,
        'whatsapp_status' => $whatsappStatus,
        'outreach_status' => $outreachStatus,
        'pitch_type'      => $pitchType,
        'city'            => $city,
        'state'           => $state,
        'sort'            => $sortBy,
        'dir'             => $sortDir,
    ]
]);
