<?php
// ============================================================
// WWAS - Helper Functions & Utilities
// Sanitization, JSON responses, phone cleaning,
// logging, parsing, and shared utilities
// ============================================================

if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

// ============================================================
// JSON RESPONSE HELPERS
// ============================================================

/**
 * Send a JSON success response and exit.
 *
 * @param mixed  $data
 * @param int    $statusCode
 */
function jsonSuccess($data = [], int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: ' . JSON_CONTENT_TYPE);
    header('X-Content-Type-Options: nosniff');
    echo json_encode(['success' => true, 'data' => $data], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Send a JSON error response and exit.
 *
 * @param string $error
 * @param int    $statusCode
 * @param array  $extra  Additional fields to merge into response
 */
function jsonError(string $error, int $statusCode = 400, array $extra = []): void
{
    http_response_code($statusCode);
    header('Content-Type: ' . JSON_CONTENT_TYPE);
    header('X-Content-Type-Options: nosniff');
    $payload = array_merge(['success' => false, 'error' => $error], $extra);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Require POST method or send 405 error.
 */
function requirePost(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('Method not allowed. Use POST.', 405);
    }
}

/**
 * Require GET method or send 405 error.
 */
function requireGet(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        jsonError('Method not allowed. Use GET.', 405);
    }
}

/**
 * Parse JSON request body and return as array.
 * Returns empty array if body is empty or invalid.
 *
 * @return array
 */
function getJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

// ============================================================
// INPUT SANITIZATION
// ============================================================

/**
 * Sanitize a string — strip tags, trim, encode special chars.
 *
 * @param mixed $value
 * @param int   $maxLen  Maximum allowed length (0 = no limit)
 * @return string
 */
function sanitizeString($value, int $maxLen = 0): string
{
    $str = trim(strip_tags((string) $value));
    if ($maxLen > 0 && mb_strlen($str) > $maxLen) {
        $str = mb_substr($str, 0, $maxLen);
    }
    return $str;
}

/**
 * Sanitize an integer value.
 *
 * @param mixed $value
 * @param int   $default
 * @return int
 */
function sanitizeInt($value, int $default = 0): int
{
    $filtered = filter_var($value, FILTER_VALIDATE_INT);
    return ($filtered !== false) ? (int) $filtered : $default;
}

/**
 * Sanitize a float value.
 *
 * @param mixed $value
 * @param float $default
 * @return float
 */
function sanitizeFloat($value, float $default = 0.0): float
{
    $filtered = filter_var($value, FILTER_VALIDATE_FLOAT);
    return ($filtered !== false) ? (float) $filtered : $default;
}

/**
 * Sanitize a URL — returns empty string if invalid.
 *
 * @param mixed $value
 * @return string
 */
function sanitizeUrl($value): string
{
    $url = trim((string) $value);
    if (empty($url)) return '';
    $filtered = filter_var($url, FILTER_VALIDATE_URL);
    return $filtered !== false ? $filtered : '';
}

/**
 * Sanitize email.
 *
 * @param mixed $value
 * @return string
 */
function sanitizeEmail($value): string
{
    $filtered = filter_var(trim((string) $value), FILTER_VALIDATE_EMAIL);
    return $filtered !== false ? $filtered : '';
}

// ============================================================
// PHONE NUMBER UTILITIES
// ============================================================

/**
 * Clean and normalize a phone number to E.164 format (digits only, no +).
 * Handles Indian numbers with or without country code.
 *
 * @param string $raw
 * @return string|null  Normalized phone or null if invalid
 */
function normalizePhone(string $raw): ?string
{
    // Strip all non-digit characters
    $digits = preg_replace('/\D/', '', $raw);

    if (empty($digits)) return null;

    // Handle Indian numbers
    if (strlen($digits) === 10 && !str_starts_with($digits, '0')) {
        return '91' . $digits;
    }

    if (strlen($digits) === 11 && str_starts_with($digits, '0')) {
        return '91' . substr($digits, 1);
    }

    if (strlen($digits) === 12 && str_starts_with($digits, '91')) {
        return $digits;
    }

    // International: accept if 10-15 digits
    if (strlen($digits) >= 10 && strlen($digits) <= 15) {
        return $digits;
    }

    return null;
}

/**
 * Format phone number for display: +91 98765 43210
 *
 * @param string $phone  Normalized phone number
 * @return string
 */
function formatPhoneDisplay(string $phone): string
{
    if (strlen($phone) === 12 && str_starts_with($phone, '91')) {
        $number = substr($phone, 2);
        return '+91 ' . substr($number, 0, 5) . ' ' . substr($number, 5);
    }
    return '+' . $phone;
}

// ============================================================
// ADDRESS PARSING
// ============================================================

/**
 * Parse an address string to extract locality, city, and state.
 * Uses comma-based splitting — common in Google Maps exports.
 *
 * Example: "Shop 4, MG Road, Koramangala, Bengaluru, Karnataka 560034, India"
 * → locality: "Koramangala", city: "Bengaluru", state: "Karnataka"
 *
 * @param string $address
 * @return array{locality: string, city: string, state: string}
 */
function parseAddress(string $address): array
{
    $result = ['locality' => '', 'city' => '', 'state' => ''];

    if (empty($address)) return $result;

    $parts = array_map('trim', explode(',', $address));
    $parts = array_values(array_filter($parts)); // Remove empty

    $count = count($parts);
    if ($count === 0) return $result;

    // Remove "India" and PIN codes from end
    $filtered = [];
    foreach ($parts as $part) {
        $clean = trim($part);
        if (strcasecmp($clean, 'India') === 0) continue;
        if (preg_match('/^\d{6}$/', $clean)) continue;       // PIN code
        if (preg_match('/\d{6}/', $clean)) {
            // Remove PIN from part like "Karnataka 560034"
            $clean = trim(preg_replace('/\s*\d{6}/', '', $clean));
        }
        if (!empty($clean)) {
            $filtered[] = $clean;
        }
    }

    $count = count($filtered);
    if ($count === 0) return $result;

    // Assign from end:  [..., locality, city, state]
    if ($count >= 3) {
        $result['state']    = $filtered[$count - 1];
        $result['city']     = $filtered[$count - 2];
        $result['locality'] = $filtered[$count - 3];
    } elseif ($count === 2) {
        $result['city']  = $filtered[$count - 2];
        $result['state'] = $filtered[$count - 1];
    } elseif ($count === 1) {
        $result['city'] = $filtered[0];
    }

    return $result;
}

/**
 * Determine language preference from state name.
 *
 * @param string $state
 * @return string  Language key: 'hinglish' | 'gujarati' | 'marathi' | 'punjabi' | 'tamil' | 'telugu' | 'kannada' | 'english'
 */
function getLanguageFromState(string $state): string
{
    $state = strtolower(trim($state));

    $map = [
        'hinglish' => ['bihar', 'jharkhand', 'uttar pradesh', 'up', 'madhya pradesh', 'mp', 'uttarakhand', 'rajasthan', 'delhi', 'haryana', 'himachal pradesh', 'chhattisgarh'],
        'gujarati' => ['gujarat'],
        'marathi'  => ['maharashtra'],
        'punjabi'  => ['punjab'],
        'tamil'    => ['tamil nadu'],
        'telugu'   => ['andhra pradesh', 'telangana'],
        'kannada'  => ['karnataka'],
        'bengali'  => ['west bengal'],
    ];

    foreach ($map as $lang => $states) {
        foreach ($states as $s) {
            if (str_contains($state, $s) || str_contains($s, $state)) {
                return $lang;
            }
        }
    }

    return 'english';
}

/**
 * Determine pitch type (A or B) based on website presence.
 *
 * @param string|null $websiteUrl
 * @return string  'A' = has website, 'B' = no website
 */
function getPitchType(?string $websiteUrl): string
{
    return (!empty($websiteUrl) && filter_var($websiteUrl, FILTER_VALIDATE_URL)) ? 'A' : 'B';
}

// ============================================================
// SETTINGS HELPER
// ============================================================

/**
 * Get a single setting value from the settings table.
 * Returns default if key not found.
 *
 * @param string $key
 * @param mixed  $default
 * @return mixed
 */
function getSetting(string $key, $default = null)
{
    static $cache = [];

    if (!isset($cache[$key])) {
        $val = Database::fetchValue(
            'SELECT key_value FROM settings WHERE key_name = ? LIMIT 1',
            [$key]
        );
        $cache[$key] = ($val !== null) ? $val : $default;
    }

    return $cache[$key];
}

/**
 * Get multiple settings at once as an associative array.
 *
 * @param array $keys
 * @return array
 */
function getSettings(array $keys): array
{
    if (empty($keys)) return [];

    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    $rows = Database::fetchAll(
        "SELECT key_name, key_value FROM settings WHERE key_name IN ({$placeholders})",
        $keys
    );

    $result = array_fill_keys($keys, null);
    foreach ($rows as $row) {
        $result[$row['key_name']] = $row['key_value'];
    }
    return $result;
}

/**
 * Update a setting value in the database.
 *
 * @param string $key
 * @param mixed  $value
 * @return bool
 */
function updateSetting(string $key, $value): bool
{
    $affected = Database::execute(
        'INSERT INTO settings (key_name, key_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE key_value = VALUES(key_value)',
        [$key, (string) $value]
    );
    return $affected > 0;
}

// ============================================================
// APP LOGGER CLASS
// ============================================================

class AppLogger
{
    /**
     * Write a log entry to the app log file.
     *
     * @param string $level    'info' | 'warning' | 'error' | 'debug'
     * @param string $message
     * @param array  $context
     */
    public static function write(string $level, string $message, array $context = []): void
    {
        if (!defined('LOG_ENABLED') || !LOG_ENABLED) return;
        if (!defined('LOG_FILE')) return;

        // Ensure log directory exists
        $logDir = dirname(LOG_FILE);
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }

        $contextStr = !empty($context) ? ' ' . json_encode($context, JSON_UNESCAPED_UNICODE) : '';
        $entry = sprintf(
            "[%s] [%s] %s%s\n",
            date('Y-m-d H:i:s'),
            strtoupper($level),
            $message,
            $contextStr
        );

        @file_put_contents(LOG_FILE, $entry, FILE_APPEND | LOCK_EX);
    }

    public static function info(string $msg, array $ctx = []): void    { self::write('info', $msg, $ctx); }
    public static function warning(string $msg, array $ctx = []): void { self::write('warning', $msg, $ctx); }
    public static function error(string $msg, array $ctx = []): void   { self::write('error', $msg, $ctx); }
    public static function debug(string $msg, array $ctx = []): void   { self::write('debug', $msg, $ctx); }

    /**
     * Write to the webhook-specific log file.
     */
    public static function webhook(string $level, string $message, array $context = []): void
    {
        if (!defined('WEBHOOK_LOG')) return;
        $logDir = dirname(WEBHOOK_LOG);
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0755, true);
        }
        $contextStr = !empty($context) ? ' ' . json_encode($context, JSON_UNESCAPED_UNICODE) : '';
        $entry = sprintf("[%s] [%s] %s%s\n", date('Y-m-d H:i:s'), strtoupper($level), $message, $contextStr);
        @file_put_contents(WEBHOOK_LOG, $entry, FILE_APPEND | LOCK_EX);
    }

    /**
     * Write a log entry to the database logs table.
     */
    public static function db(string $level, string $context, string $message, array $meta = []): void
    {
        try {
            Database::execute(
                'INSERT INTO logs (level, context, message, meta) VALUES (?, ?, ?, ?)',
                [
                    $level,
                    substr($context, 0, 100),
                    $message,
                    !empty($meta) ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null
                ]
            );
        } catch (Exception $e) {
            // If DB log fails, fallback to file log silently
            self::error('DB log failed: ' . $e->getMessage());
        }
    }
}

// ============================================================
// PAGINATION HELPER
// ============================================================

/**
 * Build pagination metadata.
 *
 * @param int $total    Total records
 * @param int $page     Current page (1-based)
 * @param int $perPage  Records per page
 * @return array{total: int, page: int, per_page: int, total_pages: int, offset: int}
 */
function paginate(int $total, int $page = 1, int $perPage = 20): array
{
    $page = max(1, $page);
    $perPage = max(1, min(100, $perPage));
    $totalPages = max(1, (int) ceil($total / $perPage));
    $page = min($page, $totalPages);
    $offset = ($page - 1) * $perPage;

    return [
        'total'       => $total,
        'page'        => $page,
        'per_page'    => $perPage,
        'total_pages' => $totalPages,
        'offset'      => $offset
    ];
}

// ============================================================
// GENERAL UTILITIES
// ============================================================

/**
 * Generate a short random token (for job IDs, delivery IDs etc.)
 *
 * @param int $length
 * @return string
 */
function generateToken(int $length = 16): string
{
    return bin2hex(random_bytes((int) ceil($length / 2)));
}

/**
 * Format a datetime string for display.
 *
 * @param string|null $datetime   MySQL DATETIME string
 * @param string      $format
 * @return string
 */
function formatDateTime(?string $datetime, string $format = 'd M Y, h:i A'): string
{
    if (empty($datetime)) return 'Never';
    try {
        $dt = new DateTime($datetime, new DateTimeZone(APP_TIMEZONE));
        return $dt->format($format);
    } catch (Exception $e) {
        return $datetime;
    }
}

/**
 * Return a relative time string: "2 hours ago", "just now", etc.
 *
 * @param string|null $datetime
 * @return string
 */
function timeAgo(?string $datetime): string
{
    if (empty($datetime)) return 'Never';

    try {
        $now = new DateTime('now', new DateTimeZone(APP_TIMEZONE));
        $then = new DateTime($datetime, new DateTimeZone(APP_TIMEZONE));
        $diff = $now->getTimestamp() - $then->getTimestamp();

        if ($diff < 60)        return 'just now';
        if ($diff < 3600)      return floor($diff / 60) . 'm ago';
        if ($diff < 86400)     return floor($diff / 3600) . 'h ago';
        if ($diff < 604800)    return floor($diff / 86400) . 'd ago';
        return $then->format('d M Y');
    } catch (Exception $e) {
        return $datetime;
    }
}

/**
 * Truncate a string with ellipsis.
 *
 * @param string $str
 * @param int    $length
 * @return string
 */
function truncate(string $str, int $length = 100): string
{
    if (mb_strlen($str) <= $length) return $str;
    return mb_substr($str, 0, $length - 3) . '...';
}
