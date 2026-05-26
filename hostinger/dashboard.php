<?php
define('WWAS_LOADED', true);
require_once __DIR__ . '/config/app.php';
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/auth.php';
requireLogin();

$socketUrl    = getSetting('socket_url',    SOCKET_URL);
$hfApiUrl     = getSetting('hf_api_url',    HF_API_URL);
$appName      = getSetting('app_name',      APP_NAME);
$appTagline   = getSetting('app_tagline',   APP_TAGLINE);
$notifSound   = getSetting('notification_sound', '1');
$username     = $_SESSION['wwas_username'] ?? 'Admin';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WWAS Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <link rel="stylesheet" href="/assets/css/app.css">
  <link rel="stylesheet" href="/assets/css/animations.css">
  <link rel="icon" href="/assets/img/favicon.ico" type="image/x-icon">
  <script>
    window.WWAS_CONFIG = {
      socket_url: <?= json_encode($socketUrl) ?>,
      hf_api_url: <?= json_encode($hfApiUrl) ?>,
      app_name:   <?= json_encode($appName) ?>,
      notification_sound: <?= json_encode($notifSound) ?>
    };
  </script>
</head>
<body>
<div id="toast-container"></div>


<!-- ════════════════════════════════════════════════════════
     APP SHELL
     ════════════════════════════════════════════════════════ -->
<div class="app-shell">

<!-- ══════════════════════════════════════════════════════════
     LEFT SIDEBAR
     ══════════════════════════════════════════════════════════ -->
<aside class="sidebar">

  <!-- Brand -->
  <div class="brand">
    <div class="brand-logo">
      <svg viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.558 4.121 1.529 5.852L0 24l6.335-1.617A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.802 9.802 0 01-5.029-1.383l-.361-.214-3.743.955.993-3.636-.235-.374A9.781 9.781 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
    </div>
    <div>
      <div class="brand-name"><?= htmlspecialchars($appName) ?></div>
      <div class="brand-tag"><?= htmlspecialchars($appTagline) ?></div>
    </div>
  </div>

  <!-- WA Status Bar -->
  <div id="wa-status-bar" class="wa-status-bar unknown" style="margin:8px 10px;">
    <span class="live-dot gray" id="socket-dot"></span>
    <span style="flex:1;font-size:12px;" id="socket-text">Connecting...</span>
    <button id="btn-show-qr" title="Scan QR Code" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--color-green-600);">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1zM7 7h2v2H7V7zm0 4h2v2H7v-2zm4 0h2v2h-2v-2zm4 4h-2v-2h2v2zM7 15h2v2H7v-2zm4 0h2v2h-2v-2z" clip-rule="evenodd"/></svg>
    </button>
  </div>

  <!-- Navigation -->
  <nav class="nav-section">
    <div class="nav-label">Workspace</div>
    <a class="nav-item active" data-view="dashboard" href="#">
      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>
      Dashboard
    </a>
    <a class="nav-item" data-view="leads" href="#">
      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>
      Leads
      <span class="nav-badge" id="sidebar-total-leads">0</span>
    </a>
    <a class="nav-item" data-view="logs" href="#">
      <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4a1 1 0 000 2h10a1 1 0 100-2H3zm0 4a1 1 0 000 2h10a1 1 0 100-2H3zm0 4a1 1 0 100 2h7a1 1 0 100-2H3z" clip-rule="evenodd"/></svg>
      Logs
    </a>
  </nav>


  <!-- Campaign Controls -->
  <div class="nav-section" style="border-top:1px solid var(--color-border-soft);margin-top:4px;padding-top:12px;">
    <div class="nav-label">Campaign</div>
    <div style="padding:0 10px;display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--color-bg-soft);border-radius:var(--radius-md);border:1px solid var(--color-border-soft);">
        <span class="live-dot gray" id="campaign-status-dot"></span>
        <span style="font-size:12.5px;font-weight:600;color:var(--color-text-body);flex:1;" id="campaign-status-text">Idle</span>
        <div id="wa-engine-status"></div>
      </div>
      <button id="btn-start-campaign" class="btn btn-primary btn-sm" style="justify-content:center;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg>
        Start Campaign
      </button>
      <button id="btn-pause-campaign" class="btn btn-ghost btn-sm" style="justify-content:center;display:none;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        Pause Campaign
      </button>
    </div>
  </div>

  <!-- Quick Actions -->
  <div class="nav-section" style="border-top:1px solid var(--color-border-soft);margin-top:4px;padding-top:12px;">
    <div class="nav-label">Quick Actions</div>
    <div style="padding:0 10px;display:flex;flex-direction:column;gap:5px;">
      <button id="btn-import-csv" class="btn btn-outline btn-sm" style="justify-content:center;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
        Import CSV
      </button>
      <button id="btn-validate-numbers" class="btn btn-ghost btn-sm" style="justify-content:center;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
        Validate Numbers
      </button>
      <button id="btn-retry-failed" class="btn btn-ghost btn-sm" style="justify-content:center;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
        Retry Failed
      </button>
      <button id="btn-refresh-sync" class="btn btn-ghost btn-sm" style="justify-content:center;">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
        Refresh Sync
      </button>
    </div>
  </div>

  <!-- Today Stats -->
  <div style="padding:12px 14px;border-top:1px solid var(--color-border-soft);margin-top:auto;">
    <div style="font-size:10px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">Today's Progress</div>
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px;display:flex;justify-content:space-between;">
      <span>Daily Limit</span>
      <span id="kpi-sent-today" style="font-weight:600;color:var(--color-text-primary);">0 / 50</span>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" id="daily-limit-bar" style="width:0%;"></div>
    </div>
    <div style="font-size:10px;color:var(--color-text-faint);margin-top:4px;text-align:right;" id="daily-limit-pct">0%</div>
    <div style="font-size:10px;color:var(--color-text-faint);margin-top:6px;display:flex;justify-content:space-between;">
      <span>WA Engine</span>
      <span id="kpi-wa-status" style="font-weight:600;color:var(--color-text-muted);">Offline</span>
    </div>
    <div style="font-size:10px;color:var(--color-text-faint);margin-top:3px;display:flex;justify-content:space-between;">
      <span>Last heartbeat</span>
      <span id="heartbeat-time">—</span>
    </div>
  </div>

  <!-- User + Settings -->
  <div style="padding:10px 14px;border-top:1px solid var(--color-border-soft);display:flex;align-items:center;gap:8px;">
    <div style="width:30px;height:30px;background:var(--color-green-100);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--color-green-700);flex-shrink:0;"><?= strtoupper(substr($username, 0, 1)) ?></div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:12px;font-weight:600;color:var(--color-text-primary);"><?= htmlspecialchars($username) ?></div>
      <div style="font-size:10px;color:var(--color-text-faint);">Administrator</div>
    </div>
    <button id="btn-open-settings" title="Settings" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--color-text-faint);border-radius:6px;" onmouseover="this.style.background='var(--color-bg-muted)'" onmouseout="this.style.background='none'">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>
    </button>
    <a href="/logout.php" title="Logout" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--color-text-faint);border-radius:6px;text-decoration:none;" onmouseover="this.style.background='#fee2e2';this.style.color='#991b1b'" onmouseout="this.style.background='none';this.style.color='var(--color-text-faint)'">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>
    </a>
  </div>

</aside>
<!-- END SIDEBAR -->


<!-- ══════════════════════════════════════════════════════════
     MIDDLE COLUMN — LEADS LIST
     ══════════════════════════════════════════════════════════ -->
<div class="midcol">

  <!-- Header -->
  <div class="section-header">
    <div>
      <div class="section-title">Leads</div>
      <div style="font-size:11px;color:var(--color-text-faint);margin-top:1px;"><span id="leads-total">0</span> total</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <button id="sidebar-total-leads-refresh" onclick="LeadsModule.refresh()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--color-text-faint);border-radius:6px;" title="Refresh leads">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  </div>

  <!-- Search -->
  <div style="padding:10px 12px;border-bottom:1px solid var(--color-border-soft);background:var(--color-surface);">
    <div class="search-wrap">
      <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg>
      <input type="text" id="leads-search" class="search-input" placeholder="Search leads, cities, phones...">
    </div>
  </div>

  <!-- Filter Chips -->
  <div style="padding:8px 12px;border-bottom:1px solid var(--color-border-soft);background:var(--color-surface);display:flex;flex-wrap:wrap;gap:5px;">
    <button class="btn btn-xs btn-ghost" data-filter="outreach_status" data-value="replied" style="font-size:11px;">Replied</button>
    <button class="btn btn-xs btn-ghost" data-filter="outreach_status" data-value="sent" style="font-size:11px;">Sent</button>
    <button class="btn btn-xs btn-ghost" data-filter="outreach_status" data-value="pending" style="font-size:11px;">Pending</button>
    <button class="btn btn-xs btn-ghost" data-filter="whatsapp_status" data-value="valid" style="font-size:11px;">WA Valid</button>
    <button class="btn btn-xs btn-ghost" data-filter="pitch_type" data-value="A" style="font-size:11px;">Has Website</button>
    <button class="btn btn-xs btn-ghost" data-filter="pitch_type" data-value="B" style="font-size:11px;">No Website</button>
    <select id="filter-city" class="form-select" style="font-size:11px;padding:3px 8px;height:28px;flex:1;min-width:80px;"></select>
    <select id="filter-state" class="form-select" style="font-size:11px;padding:3px 8px;height:28px;flex:1;min-width:80px;"></select>
  </div>

  <!-- Leads List -->
  <div id="leads-list" class="scroll-area" style="flex:1;">
    <!-- Populated by leads.js -->
  </div>

</div>
<!-- END MIDDLE COLUMN -->


<!-- ══════════════════════════════════════════════════════════
     RIGHT PANEL — CHAT + KPIs
     ══════════════════════════════════════════════════════════ -->
<div class="rightpanel">

  <!-- KPI Row (top of right panel) -->
  <div style="padding:12px 16px;border-bottom:1px solid var(--color-border-soft);background:var(--color-surface);display:grid;grid-template-columns:repeat(6,1fr);gap:10px;">
    <div class="kpi-card">
      <div class="kpi-label">Total Leads</div>
      <div class="kpi-value" id="kpi-total-leads">0</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Valid WA</div>
      <div class="kpi-value" id="kpi-valid-leads">0</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">In Queue</div>
      <div class="kpi-value" id="kpi-queue-pending">0</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Sent</div>
      <div class="kpi-value" id="kpi-sent-count">0</div>
    </div>
    <div class="kpi-card" style="--before-color:var(--color-green-500);">
      <div class="kpi-label">Replied</div>
      <div class="kpi-value" id="kpi-replied-count" style="color:var(--color-green-600);">0</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Unread</div>
      <div class="kpi-value" id="kpi-unread" style="color:var(--color-info);">0</div>
    </div>
  </div>

  <!-- Chat Header -->
  <div id="chat-header" style="padding:12px 16px;border-bottom:1px solid var(--color-border-soft);background:var(--color-surface);min-height:60px;">
    <!-- Populated by chat.js -->
  </div>

  <!-- Chat Empty State -->
  <div id="chat-empty" style="flex:1;display:flex;align-items:center;justify-content:center;">
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
      <p class="empty-state-title">Select a lead to view conversation</p>
      <p class="empty-state-sub">Click any lead in the middle column to open their chat</p>
    </div>
  </div>

  <!-- Chat Wrap (hidden until lead selected) -->
  <div id="chat-wrap" style="display:none;flex-direction:column;flex:1;overflow:hidden;">
    <div id="chat-area" class="chat-area"></div>
    <div class="chat-input-area">
      <textarea id="chat-input" class="chat-input" rows="1" placeholder="Select a lead to send a message..." disabled></textarea>
      <button id="chat-send-btn" class="send-btn" disabled>
        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
      </button>
    </div>
  </div>

  <!-- Recent Activity (shown when no lead selected, bottom area) -->
  <div style="padding:0 16px 16px;border-top:1px solid var(--color-border-soft);max-height:220px;overflow-y:auto;" id="recent-activity-wrap">
    <div style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;padding:12px 0 6px;">Recent Activity</div>
    <div id="recent-activity">
      <!-- Populated by campaign.js -->
    </div>
  </div>

</div>
<!-- END RIGHT PANEL -->

</div>
<!-- END APP SHELL -->


<!-- ══════════════════════════════════════════════════════════
     MODALS & DRAWERS
     ══════════════════════════════════════════════════════════ -->

<!-- QR Code Modal -->
<div id="qr-overlay" class="modal-overlay hidden">
  <div id="qr-modal" class="modal" style="max-width:360px;">
    <div class="modal-header">
      <span class="modal-title">Scan WhatsApp QR</span>
      <button id="qr-modal-close" style="background:none;border:none;cursor:pointer;color:var(--color-text-faint);">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
      </button>
    </div>
    <div class="modal-body qr-container">
      <img id="qr-image" src="" alt="QR Code" style="width:240px;height:240px;border:2px solid var(--color-border);border-radius:12px;padding:12px;">
      <div id="qr-status" style="font-size:13px;color:var(--color-text-muted);text-align:center;">Loading QR code...</div>
      <div style="font-size:11px;color:var(--color-text-faint);text-align:center;max-width:240px;">Open WhatsApp → Linked Devices → Link a Device → Scan this code</div>
    </div>
  </div>
</div>

<!-- CSV Import Modal -->
<div id="import-overlay" class="modal-overlay hidden">
  <div id="import-modal" class="modal">
    <div class="modal-header">
      <span class="modal-title">Import CSV Leads</span>
      <button id="import-modal-close" style="background:none;border:none;cursor:pointer;color:var(--color-text-faint);">
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
      </button>
    </div>
    <div class="modal-body">
      <div id="csv-dropzone" style="border:2px dashed var(--color-border);border-radius:12px;padding:32px 20px;text-align:center;cursor:pointer;transition:all 150ms;background:var(--color-bg-soft);" onmouseover="this.style.borderColor='var(--color-green-400)';this.style.background='var(--color-green-50)'" onmouseout="this.style.borderColor='var(--color-border)';this.style.background='var(--color-bg-soft)'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;color:var(--color-text-faint);margin:0 auto 10px;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.026 11.095"/></svg>
        <div style="font-size:14px;font-weight:600;color:var(--color-text-primary);margin-bottom:4px;">Drop CSV file here</div>
        <div style="font-size:12px;color:var(--color-text-faint);">or click to browse &nbsp;·&nbsp; Max 10MB</div>
        <input type="file" id="csv-file-input" accept=".csv,.txt" style="display:none;">
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--color-text-muted);font-weight:500;" id="import-filename">No file selected</div>
      <div id="import-status"></div>
      <div style="margin-top:12px;font-size:11px;color:var(--color-text-faint);background:var(--color-bg-soft);border-radius:8px;padding:10px;">
        <strong>Expected CSV columns:</strong> Business Name, Address, Phone, Website, Rating, Reviews<br>
        Column names are flexible — the system auto-detects them.
      </div>
    </div>
    <div class="modal-footer">
      <button id="import-modal-close2" class="btn btn-ghost" onclick="ImportModule.close()">Cancel</button>
      <button id="import-confirm-btn" class="btn btn-primary" disabled>
        <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
        Import Leads
      </button>
    </div>
  </div>
</div>

<!-- Settings Drawer -->
<div id="settings-overlay" class="drawer-overlay hidden"></div>
<div id="settings-drawer" class="drawer hidden">
  <div style="padding:18px 24px 14px;border-bottom:1px solid var(--color-border-soft);display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:16px;font-weight:700;color:var(--color-text-primary);">Settings</div>
      <div style="font-size:11px;color:var(--color-text-faint);">Configure WWAS system settings</div>
    </div>
    <button id="btn-close-settings" style="background:none;border:none;cursor:pointer;color:var(--color-text-faint);padding:4px;">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
    </button>
  </div>
  <div id="settings-body" class="scroll-area" style="flex:1;">
    <!-- Populated by settings.js -->
  </div>
  <div style="padding:14px 24px;border-top:1px solid var(--color-border-soft);display:flex;justify-content:flex-end;gap:10px;">
    <button id="btn-close-settings-2" class="btn btn-ghost" onclick="SettingsModule.close()">Cancel</button>
    <button id="settings-save-btn" class="btn btn-primary">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h1a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h1v5.586l-1.293-1.293z"/></svg>
      Save Settings
    </button>
  </div>
</div>

<!-- Lead Details Drawer -->
<div id="details-overlay" class="drawer-overlay hidden"></div>
<div id="details-drawer" class="drawer hidden">
  <div style="padding:18px 24px 14px;border-bottom:1px solid var(--color-border-soft);display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:16px;font-weight:700;color:var(--color-text-primary);">Lead Details</div>
    <button id="details-drawer-close" style="background:none;border:none;cursor:pointer;color:var(--color-text-faint);padding:4px;">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
    </button>
  </div>
  <div id="details-body" class="scroll-area" style="flex:1;">
    <!-- Populated by app.js DetailsModule -->
  </div>
</div>



<!-- ══════════════════════════════════════════════════════════
     SCRIPTS — Load order matters
     ══════════════════════════════════════════════════════════ -->
<script src="/assets/js/utils.js"></script>
<script src="/assets/js/toast.js"></script>
<script src="/assets/js/skeleton.js"></script>
<script src="/assets/js/socket.js"></script>
<script src="/assets/js/leads.js"></script>
<script src="/assets/js/chat.js"></script>
<script src="/assets/js/campaign.js"></script>
<script src="/assets/js/settings.js"></script>
<script src="/assets/js/import.js"></script>
<script src="/assets/js/app.js"></script>

<!-- Update sidebar leads count after load -->
<script>
document.addEventListener('DOMContentLoaded', function() {
  // Keep sidebar badge in sync with leads total
  const observer = new MutationObserver(() => {
    const total = document.getElementById('leads-total')?.textContent || '0';
    const badge = document.getElementById('sidebar-total-leads');
    if (badge) badge.textContent = total;
  });
  const totalEl = document.getElementById('leads-total');
  if (totalEl) observer.observe(totalEl, { childList: true, characterData: true, subtree: true });

  // Hide recent activity when chat is visible
  document.addEventListener('click', function(e) {
    if (e.target.closest('.lead-card')) {
      const wrap = document.getElementById('recent-activity-wrap');
      if (wrap) wrap.style.display = 'none';
    }
  });
});
</script>
</body>
</html>
