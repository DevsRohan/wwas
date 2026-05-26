<?php
define('WWAS_LOADED', true);
require_once __DIR__ . '/config/app.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/auth.php';

// Already logged in → go to dashboard
if (isLoggedIn()) {
    header('Location: /dashboard.php');
    exit;
}

$error   = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = sanitizeString($_POST['username'] ?? '', 100);
    $password = $_POST['password'] ?? '';

    $result = attemptLogin($username, $password);

    if ($result['success']) {
        $redirect = sanitizeString($_GET['redirect'] ?? '/dashboard.php', 200);
        // Only allow relative URLs
        if (!str_starts_with($redirect, '/')) $redirect = '/dashboard.php';
        header('Location: ' . $redirect);
        exit;
    } else {
        $error = $result['error'];
    }
}

$csrfToken = getCsrfToken();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — WWAS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/assets/css/app.css">
  <link rel="stylesheet" href="/assets/css/animations.css">
  <link rel="icon" href="/assets/img/favicon.ico" type="image/x-icon">
</head>
<body style="overflow:auto;">
<div class="login-page">
  <div class="login-card">
    <!-- Brand -->
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;background:var(--color-green-600);border-radius:14px;margin-bottom:14px;box-shadow:0 4px 14px rgba(22,163,74,0.35);">
        <svg viewBox="0 0 24 24" fill="white" style="width:28px;height:28px;">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.558 4.121 1.529 5.852L0 24l6.335-1.617A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.802 9.802 0 01-5.029-1.383l-.361-.214-3.743.955.993-3.636-.235-.374A9.781 9.781 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/>
        </svg>
      </div>
      <h1 style="font-size:22px;font-weight:800;color:var(--color-text-primary);letter-spacing:-0.5px;">WWAS</h1>
      <p style="font-size:13px;color:var(--color-text-faint);margin-top:2px;">WhatsApp Outreach OS</p>
    </div>

    <?php if ($error): ?>
    <div style="background:#FEE2E2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:#991B1B;display:flex;align-items:center;gap:8px;">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;flex-shrink:0;">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>
      </svg>
      <?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?>
    </div>
    <?php endif; ?>

    <form method="POST" action="/login.php<?= isset($_GET['redirect']) ? '?redirect=' . urlencode($_GET['redirect']) : '' ?>">
      <input type="hidden" name="<?= CSRF_TOKEN_NAME ?>" value="<?= htmlspecialchars($csrfToken) ?>">

      <div class="form-group">
        <label class="form-label" for="username">Username</label>
        <input type="text" id="username" name="username" class="form-input" placeholder="admin"
               value="<?= htmlspecialchars(sanitizeString($_POST['username'] ?? '')) ?>"
               autocomplete="username" required autofocus>
      </div>

      <div class="form-group" style="margin-bottom:20px;">
        <label class="form-label" for="password">Password</label>
        <input type="password" id="password" name="password" class="form-input" placeholder="••••••••"
               autocomplete="current-password" required>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">
        Sign in to Dashboard
      </button>
    </form>

    <p style="text-align:center;font-size:11px;color:var(--color-text-faint);margin-top:20px;">
      WWAS v<?= APP_VERSION ?> &nbsp;·&nbsp; Secure Admin Access
    </p>
  </div>
</div>
</body>
</html>
