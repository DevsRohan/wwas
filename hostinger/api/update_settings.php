<?php
// ============================================================
// WWAS API - POST /api/update_settings.php
// Update one or multiple settings values
// Validates input before saving
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

if (!isLoggedIn()) apiUnauthorized();
requirePost();

$body = getJsonBody();

// ── Extract updates object ────────────────────────────────────
// Accepts: { "updates": { "key": "value", ... } }
// OR flat: { "groq_api_key": "xxx", "delay_min": "120" }
$updates = $body['updates'] ?? $body;

if (empty($updates) || !is_array($updates)) {
    jsonError('No settings provided. Send { "updates": { "key": "value" } }', 400);
}

// ── Allowed settings keys with validation rules ───────────────
$allowedKeys = [
    'groq_api_key'        => ['type' => 'string', 'max' => 300],
    'hf_api_url'          => ['type' => 'url',    'max' => 500],
    'hf_api_key'          => ['type' => 'string', 'max' => 300],
    'webhook_secret'      => ['type' => 'string', 'max' => 200],
    'socket_url'          => ['type' => 'url',    'max' => 500],
    'delay_min'           => ['type' => 'int',    'min' => 30,   'max_val' => 3600],
    'delay_max'           => ['type' => 'int',    'min' => 60,   'max_val' => 7200],
    'daily_send_limit'    => ['type' => 'int',    'min' => 1,    'max_val' => 500],
    'max_retries'         => ['type' => 'int',    'min' => 0,    'max_val' => 10],
    'retry_delay'         => ['type' => 'int',    'min' => 60,   'max_val' => 86400],
    'groq_model'          => ['type' => 'string', 'max' => 100],
    'groq_temperature'    => ['type' => 'float',  'min' => 0.0,  'max_val' => 2.0],
    'groq_max_tokens'     => ['type' => 'int',    'min' => 100,  'max_val' => 2000],
    'app_name'            => ['type' => 'string', 'max' => 100],
    'app_tagline'         => ['type' => 'string', 'max' => 200],
    'notification_sound'  => ['type' => 'bool'],
    'dark_mode'           => ['type' => 'bool'],
    'logging_enabled'     => ['type' => 'bool'],
];

$errors  = [];
$saved   = [];

foreach ($updates as $key => $value) {
    // Skip unknown keys
    if (!array_key_exists($key, $allowedKeys)) {
        $errors[] = "Unknown setting key: '{$key}'";
        continue;
    }

    $rule = $allowedKeys[$key];
    $type = $rule['type'];

    // ── Type validation ───────────────────────────────────────
    $validated = null;

    switch ($type) {
        case 'string':
            $validated = sanitizeString((string) $value, $rule['max'] ?? 500);
            break;

        case 'url':
            if (empty($value)) {
                $validated = '';
                break;
            }
            $validated = sanitizeUrl($value);
            if ($validated === '') {
                $errors[] = "'{$key}' must be a valid URL (e.g. https://example.com)";
                continue 2;
            }
            $validated = rtrim($validated, '/');
            break;

        case 'int':
            $validated = sanitizeInt($value, 0);
            if (isset($rule['min']) && $validated < $rule['min']) {
                $errors[] = "'{$key}' must be at least {$rule['min']}";
                continue 2;
            }
            if (isset($rule['max_val']) && $validated > $rule['max_val']) {
                $errors[] = "'{$key}' must be at most {$rule['max_val']}";
                continue 2;
            }
            break;

        case 'float':
            $validated = sanitizeFloat($value, 0.0);
            if (isset($rule['min']) && $validated < $rule['min']) {
                $errors[] = "'{$key}' must be at least {$rule['min']}";
                continue 2;
            }
            if (isset($rule['max_val']) && $validated > $rule['max_val']) {
                $errors[] = "'{$key}' must be at most {$rule['max_val']}";
                continue 2;
            }
            break;

        case 'bool':
            $validated = ($value === true || $value === '1' || $value === 1 || $value === 'true') ? '1' : '0';
            break;
    }

    // ── Cross-validation: delay_min must be < delay_max ───────
    if ($key === 'delay_min' && isset($updates['delay_max'])) {
        $newMax = sanitizeInt($updates['delay_max'], 300);
        if ($validated >= $newMax) {
            $errors[] = "'delay_min' ({$validated}) must be less than 'delay_max' ({$newMax})";
            continue;
        }
    }

    // ── Save to DB ────────────────────────────────────────────
    try {
        Database::execute(
            'INSERT INTO settings (key_name, key_value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)',
            [$key, (string) $validated]
        );
        $saved[] = $key;
    } catch (PDOException $e) {
        $errors[] = "Failed to save '{$key}': " . $e->getMessage();
    }
}

if (!empty($errors) && empty($saved)) {
    jsonError('Settings update failed: ' . implode(', ', $errors), 400);
}

AppLogger::db('info', 'UpdateSettings', 'Settings updated', ['keys' => $saved]);
AppLogger::info('Settings updated', ['context' => 'UpdateSettings', 'keys' => $saved]);

jsonSuccess([
    'saved'   => $saved,
    'errors'  => $errors,
    'message' => count($saved) . ' setting(s) saved successfully' . (count($errors) > 0 ? ', ' . count($errors) . ' error(s)' : '')
]);
