<?php
// ============================================================
// WWAS API - GET /api/settings.php
// Returns all current settings for the Settings panel
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requireGet();

// ── Fetch all settings from DB ────────────────────────────────
$rows = Database::fetchAll('SELECT key_name, key_value FROM settings ORDER BY key_name ASC', []);

$settings = [];
foreach ($rows as $row) {
    $settings[$row['key_name']] = $row['key_value'];
}

// ── Mask sensitive keys before returning ─────────────────────
$masked = $settings;
$sensitiveKeys = ['groq_api_key', 'hf_api_key', 'webhook_secret'];
foreach ($sensitiveKeys as $key) {
    if (!empty($masked[$key])) {
        $val = $masked[$key];
        // Show first 4 chars then mask rest
        $masked[$key] = strlen($val) > 8
            ? substr($val, 0, 4) . str_repeat('*', min(20, strlen($val) - 4))
            : str_repeat('*', strlen($val));
    }
}

// ── Runtime info ─────────────────────────────────────────────
$runtimeInfo = [
    'php_version'    => PHP_VERSION,
    'max_upload'     => ini_get('upload_max_filesize'),
    'max_post'       => ini_get('post_max_size'),
    'memory_limit'   => ini_get('memory_limit'),
    'curl_enabled'   => function_exists('curl_init'),
    'json_enabled'   => function_exists('json_encode'),
    'pdo_mysql'      => in_array('mysql', PDO::getAvailableDrivers()),
    'timezone'       => date_default_timezone_get(),
    'server_time'    => date('Y-m-d H:i:s'),
];

jsonSuccess([
    'settings'     => $masked,
    'runtime'      => $runtimeInfo,
    'has_settings' => count($settings),
]);
