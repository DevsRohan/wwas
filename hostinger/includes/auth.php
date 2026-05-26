<?php
// ============================================================
// WWAS - Authentication & Security Include
// Session auth for dashboard + HMAC webhook verification
// ============================================================

if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

// ── Session Configuration ─────────────────────────────────────
if (session_status() === PHP_SESSION_NONE) {
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => SESSION_LIFETIME,
        'path'     => '/',
        'domain'   => '',
        'secure'   => isset($_SERVER['HTTPS']),
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    session_start();
}

// ============================================================
// DASHBOARD SESSION AUTH
// ============================================================

/**
 * Check if current user is logged in.
 * Validates session + regeneration token.
 *
 * @return bool
 */
function isLoggedIn(): bool
{
    return isset($_SESSION['wwas_user_id'])
        && isset($_SESSION['wwas_logged_in'])
        && $_SESSION['wwas_logged_in'] === true
        && isset($_SESSION['wwas_ip'])
        && $_SESSION['wwas_ip'] === ($_SERVER['REMOTE_ADDR'] ?? '');
}

/**
 * Require login — redirect to login.php if not authenticated.
 * Call at top of every protected page.
 */
function requireLogin(): void
{
    if (!isLoggedIn()) {
        $redirect = urlencode($_SERVER['REQUEST_URI'] ?? '/dashboard.php');
        header("Location: /login.php?redirect={$redirect}");
        exit;
    }
}

/**
 * Attempt login with username + password.
 * On success: sets session, regenerates session ID.
 *
 * @param string $username
 * @param string $password
 * @return array{success: bool, error?: string}
 */
function attemptLogin(string $username, string $password): array
{
    if (empty($username) || empty($password)) {
        return ['success' => false, 'error' => 'Username and password are required'];
    }

    $username = trim(strtolower($username));

    $user = Database::fetchOne(
        'SELECT id, username, password_hash FROM admin_users WHERE username = ? LIMIT 1',
        [$username]
    );

    if (!$user) {
        // Timing-safe: still verify a dummy hash to prevent user enumeration
        password_verify($password, '$2y$12$dummyhashtopreventtimingattacks000000000000000000000');
        AppLogger::warning('Login failed - unknown user', ['username' => $username]);
        return ['success' => false, 'error' => 'Invalid credentials'];
    }

    if (!password_verify($password, $user['password_hash'])) {
        AppLogger::warning('Login failed - wrong password', ['username' => $username]);
        return ['success' => false, 'error' => 'Invalid credentials'];
    }

    // Successful login — regenerate session ID to prevent fixation
    session_regenerate_id(true);

    $_SESSION['wwas_user_id']   = (int) $user['id'];
    $_SESSION['wwas_username']  = $user['username'];
    $_SESSION['wwas_logged_in'] = true;
    $_SESSION['wwas_ip']        = $_SERVER['REMOTE_ADDR'] ?? '';
    $_SESSION['wwas_login_at']  = time();

    // Update last login timestamp
    Database::execute(
        'UPDATE admin_users SET last_login = NOW() WHERE id = ?',
        [$user['id']]
    );

    AppLogger::info('User logged in', ['username' => $username]);
    return ['success' => true];
}

/**
 * Destroy session and log out.
 */
function logout(): void
{
    AppLogger::info('User logged out', ['username' => $_SESSION['wwas_username'] ?? 'unknown']);
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }
    session_destroy();
}

// ============================================================
// CSRF PROTECTION
// ============================================================

/**
 * Generate or retrieve CSRF token for current session.
 *
 * @return string
 */
function getCsrfToken(): string
{
    if (empty($_SESSION[CSRF_TOKEN_NAME])) {
        $_SESSION[CSRF_TOKEN_NAME] = bin2hex(random_bytes(32));
    }
    return $_SESSION[CSRF_TOKEN_NAME];
}

/**
 * Validate a submitted CSRF token.
 *
 * @param string $token
 * @return bool
 */
function verifyCsrfToken(string $token): bool
{
    $stored = $_SESSION[CSRF_TOKEN_NAME] ?? '';
    return hash_equals($stored, $token);
}

// ============================================================
// WEBHOOK HMAC VERIFICATION
// ============================================================

/**
 * Verify that an incoming webhook request from HF Node.js
 * has a valid HMAC-SHA256 signature.
 *
 * @param string $rawBody    Raw POST body (before json_decode)
 * @param string $signature  Value of X-WWAS-Signature header
 * @return bool
 */
function verifyWebhookSignature(string $rawBody, string $signature): bool
{
    $secret = WEBHOOK_SECRET;

    if (empty($secret)) {
        // If no secret configured, skip verification (warn in logs)
        AppLogger::warning('WEBHOOK_SECRET not configured — signature verification skipped');
        return true;
    }

    if (empty($signature)) {
        return false;
    }

    // Expected format: "sha256=<hex>"
    if (!str_starts_with($signature, 'sha256=')) {
        return false;
    }

    $expectedHash = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);

    return hash_equals($expectedHash, $signature);
}

/**
 * Verify API key for internal PHP API endpoints (optional extra layer).
 * Used by AJAX endpoints that need lightweight auth check.
 *
 * @return bool
 */
function verifyApiSession(): bool
{
    return isLoggedIn();
}

/**
 * Send JSON error response and exit. Used in API endpoints.
 *
 * @param string $message
 * @param int    $code
 */
function apiUnauthorized(string $message = 'Unauthorized', int $code = 401): void
{
    http_response_code($code);
    header('Content-Type: ' . JSON_CONTENT_TYPE);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}
