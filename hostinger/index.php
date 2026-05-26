<?php
// ============================================================
// WWAS - Root Index
// Redirect to dashboard or login
// ============================================================
define('WWAS_LOADED', true);
require_once __DIR__ . '/config/app.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/auth.php';

if (isLoggedIn()) {
    header('Location: /dashboard.php');
} else {
    header('Location: /login.php');
}
exit;
