<?php
// ============================================================
// WWAS API - GET /api/get_logs.php
// Returns paginated system logs from DB logs table
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

$level   = sanitizeString($_GET['level']   ?? '', 20);
$context = sanitizeString($_GET['context'] ?? '', 100);
$page    = max(1, sanitizeInt($_GET['page']     ?? 1));
$perPage = max(1, min(200, sanitizeInt($_GET['per_page'] ?? 50)));

// Whitelist levels
$validLevels = ['info', 'warning', 'error', 'debug'];
if ($level && !in_array($level, $validLevels, true)) $level = '';

// ── Build WHERE ───────────────────────────────────────────────
$conditions = [];
$params     = [];

if (!empty($level)) {
    $conditions[] = 'level = ?';
    $params[]     = $level;
}

if (!empty($context)) {
    $conditions[] = 'context LIKE ?';
    $params[]     = '%' . $context . '%';
}

$whereClause = !empty($conditions) ? 'WHERE ' . implode(' AND ', $conditions) : '';

// ── Count ─────────────────────────────────────────────────────
$total = (int) Database::fetchValue("SELECT COUNT(*) FROM logs {$whereClause}", $params);
$pag   = paginate($total, $page, $perPage);

// ── Fetch logs ────────────────────────────────────────────────
$logs = Database::fetchAll(
    "SELECT id, level, context, message, meta, created_at
     FROM logs {$whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?",
    array_merge($params, [$perPage, $pag['offset']])
);

foreach ($logs as &$log) {
    $log['time_ago']  = timeAgo($log['created_at']);
    $log['time_human'] = formatDateTime($log['created_at']);
    $log['meta']      = !empty($log['meta']) ? json_decode($log['meta'], true) : null;
}
unset($log);

// ── Level counts for filter badges ───────────────────────────
$levelCounts = Database::fetchAll(
    "SELECT level, COUNT(*) AS count FROM logs GROUP BY level",
    []
);
$levelCountMap = [];
foreach ($levelCounts as $lc) {
    $levelCountMap[$lc['level']] = (int) $lc['count'];
}

jsonSuccess([
    'logs'         => $logs,
    'pagination'   => $pag,
    'level_counts' => $levelCountMap,
    'filters'      => ['level' => $level, 'context' => $context]
]);
