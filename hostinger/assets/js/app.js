/**
 * WWAS - Main Application Entry Point
 * Bootstraps all modules, connects Socket.io, handles global state
 */

(function () {
  'use strict';

  // ── Global App State ─────────────────────────────────────────
  window.WWAS_STATE = {
    waReady: false,
    campaignStatus: 'idle',
    currentLeadId: null,
    unreadCount: 0
  };

  // ── Boot ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    _initModules();
    _connectSocket();
    _bindGlobalEvents();
    _startHeartbeatCheck();
  });

  // ── Initialize All Modules ────────────────────────────────────
  function _initModules() {
    if (window.LeadsModule)    LeadsModule.init();
    if (window.ChatModule)     ChatModule.init();
    if (window.CampaignModule) CampaignModule.init();
    if (window.SettingsModule) SettingsModule.init();
    if (window.ImportModule)   ImportModule.init();
    if (window.DetailsModule)  DetailsModule.init();
  }

  // ── Socket Connection ─────────────────────────────────────────
  function _connectSocket() {
    const socketUrl = window.WWAS_CONFIG?.socket_url;
    if (!socketUrl) {
      console.warn('[App] No socket URL — configure in Settings');
      return;
    }
    SocketManager.connect(socketUrl);

    // Re-sync state after reconnect
    SocketManager.on('_reconnected', () => {
      setTimeout(() => {
        CampaignModule?.loadStats();
        if (WWAS_STATE.currentLeadId) {
          ChatModule?.loadConversation(WWAS_STATE.currentLeadId);
        }
      }, 500);
    });

    // WA ready/disconnect → update global state
    SocketManager.on('whatsapp_ready', () => {
      WWAS_STATE.waReady = true;
    });
    SocketManager.on('whatsapp_disconnected', () => {
      WWAS_STATE.waReady = false;
    });

    // Inbound message → update unread badge in page title
    SocketManager.on('message_received', (data) => {
      WWAS_STATE.unreadCount++;
      _updatePageTitle();
    });
  }

  // ── Global UI Events ──────────────────────────────────────────
  function _bindGlobalEvents() {
    // QR Modal
    const qrBtn   = document.getElementById('btn-show-qr');
    const qrClose = document.getElementById('qr-modal-close');
    qrBtn?.addEventListener('click', _showQRModal);
    qrClose?.addEventListener('click', _closeQRModal);
    document.getElementById('qr-overlay')?.addEventListener('click', _closeQRModal);

    // SocketManager QR event
    SocketManager.on('qr_code', (data) => {
      const img = document.getElementById('qr-image');
      if (img && data.qr) {
        img.src = data.qr;
        _showQRModal();
      }
    });

    SocketManager.on('whatsapp_ready', () => {
      _closeQRModal();
    });

    // Refresh sync button
    document.getElementById('btn-refresh-sync')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh-sync');
      const restore = Skeleton.btn(btn, '');
      const res = await Utils.get('/api/refresh_sync.php');
      restore();
      if (res.success) {
        CampaignModule?.loadStats();
        Toast.success('Synced', 'Dashboard refreshed');
      }
    });

    // Nav items
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        _switchView(view);
      });
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape — close modals
      if (e.key === 'Escape') {
        SettingsModule?.close();
        ImportModule?.close();
        _closeQRModal();
      }
      // Ctrl+K — focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('leads-search')?.focus();
      }
    });

    // Mark page as read when user focuses
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        WWAS_STATE.unreadCount = 0;
        _updatePageTitle();
      }
    });
  }

  // ── View Switcher ─────────────────────────────────────────────
  function _switchView(view) {
    const views = document.querySelectorAll('[data-view-panel]');
    views.forEach(v => {
      v.classList.toggle('hidden', v.dataset.viewPanel !== view);
    });

    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
  }

  // ── QR Modal ──────────────────────────────────────────────────
  async function _showQRModal() {
    const overlay = document.getElementById('qr-overlay');
    const modal   = document.getElementById('qr-modal');
    const img     = document.getElementById('qr-image');
    const status  = document.getElementById('qr-status');

    if (!overlay || !modal) return;

    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');

    // Fetch QR from HF
    if (img) {
      img.src = '';
      if (status) status.textContent = 'Loading QR code...';
      const res = await Utils.get('/api/refresh_sync.php');
      if (res.success && res.data?.whatsapp?.qr) {
        img.src = res.data.whatsapp.qr;
        if (status) status.textContent = 'Scan with WhatsApp to connect';
      } else if (res.data?.whatsapp?.ready) {
        _closeQRModal();
        Toast.success('Already Connected', 'WhatsApp is already connected');
      } else {
        if (status) status.textContent = 'QR not available. Engine may be starting up...';
      }
    }
  }

  function _closeQRModal() {
    document.getElementById('qr-overlay')?.classList.add('hidden');
    document.getElementById('qr-modal')?.classList.add('hidden');
  }

  // ── Page Title Unread Badge ───────────────────────────────────
  function _updatePageTitle() {
    const count = WWAS_STATE.unreadCount;
    document.title = count > 0 ? `(${count}) WWAS Dashboard` : 'WWAS Dashboard';
  }

  // ── Heartbeat Health Check ────────────────────────────────────
  function _startHeartbeatCheck() {
    setInterval(() => {
      const last = SocketManager.getLastHeartbeat();
      if (!last) return;
      const age = Date.now() - last;
      // If no heartbeat for 90 seconds, connection may be stale
      if (age > 90000) {
        const dot = document.getElementById('socket-dot');
        if (dot) dot.className = 'live-dot yellow';
      }
    }, 15000);
  }

  // ── Lead Details Module (inline, no separate file needed) ─────
  window.DetailsModule = (() => {
    function init() {
      document.getElementById('details-drawer-close')?.addEventListener('click', close);
      document.getElementById('details-overlay')?.addEventListener('click', close);
    }

    async function load(leadId) {
      const overlay = document.getElementById('details-overlay');
      const drawer  = document.getElementById('details-drawer');

      if (!overlay || !drawer) return;
      overlay.classList.remove('hidden');
      drawer.classList.remove('hidden');

      const body = document.getElementById('details-body');
      if (body) Skeleton.details(body);

      const res = await Utils.get('/api/get_lead_details.php', { lead_id: leadId });
      if (!res.success) { Toast.error('Failed to load details'); return; }

      const d = res.data;
      if (body) body.innerHTML = _renderDetails(d);

      // Bind Generate Message button
      document.getElementById('btn-gen-message')?.addEventListener('click', () => _generateMessage(leadId, d.lead));
    }

    function close() {
      document.getElementById('details-overlay')?.classList.add('hidden');
      document.getElementById('details-drawer')?.classList.add('hidden');
    }

    function _renderDetails(d) {
      const lead = d.lead;
      const ms   = d.message_summary;
      const ai   = d.ai_reasoning;
      const an   = d.analytics;

      return `
        <!-- Lead Header -->
        <div style="padding:20px 24px;border-bottom:1px solid var(--color-border-soft);">
          <div class="flex items-center gap-3 mb-3">
            <div class="lead-avatar" style="width:48px;height:48px;font-size:18px;">${Utils.escHtml(Utils.initials(lead.business_name))}</div>
            <div>
              <div style="font-size:16px;font-weight:700;color:var(--color-text-primary);">${Utils.escHtml(lead.business_name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);">${Utils.escHtml(lead.phone_display||lead.phone_number)}</div>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${Utils.waBadge(lead.whatsapp_status)}
            ${Utils.outreachBadge(lead.outreach_status)}
            <span class="badge ${lead.pitch_type==='A'?'badge-blue':'badge-orange'}">${lead.pitch_type==='A'?'Has Website':'No Website'}</span>
          </div>
        </div>

        <!-- Contact Info -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--color-border-soft);">
          <h4 style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">Contact Details</h4>
          ${_infoRow('Address', lead.address || '—')}
          ${_infoRow('Location', [lead.locality, lead.city, lead.state].filter(Boolean).join(', ') || '—')}
          ${lead.website_url ? _infoRow('Website', `<a href="${Utils.escHtml(lead.website_url)}" target="_blank" style="color:var(--color-green-600);">${Utils.escHtml(lead.website_url)}</a>`) : _infoRow('Website', 'No website')}
          ${lead.rating ? _infoRow('Rating', `${lead.rating}★ (${lead.review_count} reviews)`) : ''}
          ${_infoRow('Last Contact', lead.last_contact_human || 'Never')}
        </div>

        <!-- Analytics -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--color-border-soft);">
          <h4 style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">Engagement</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            ${_statBox('Messages Sent', ms.sent || 0)}
            ${_statBox('Replies', ms.received || 0)}
            ${_statBox('Engagement', an.engagement_level || '—')}
          </div>
        </div>

        <!-- AI Reasoning -->
        <div style="padding:16px 24px;border-bottom:1px solid var(--color-border-soft);">
          <h4 style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">AI Outreach Insight</h4>
          <div style="font-size:12px;color:var(--color-text-muted);">
            <div style="margin-bottom:6px;"><strong>Pitch:</strong> ${Utils.escHtml(ai.pitch_type||'')}</div>
            <div style="margin-bottom:6px;"><strong>Language:</strong> ${Utils.escHtml(ai.language_note||'')}</div>
            ${ai.opportunities?.length ? `<div><strong>Opportunities:</strong><ul style="margin:4px 0 0 16px;">${ai.opportunities.map(o=>`<li>${Utils.escHtml(o)}</li>`).join('')}</ul></div>` : ''}
          </div>
          <button id="btn-gen-message" class="btn btn-outline btn-sm" style="margin-top:12px;width:100%;">
            <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
            Generate AI Message
          </button>
        </div>

        <!-- Generated Message -->
        <div id="generated-msg-area" style="padding:0 24px 20px;display:none;">
          <h4 style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 8px;">Generated Message</h4>
          <div id="generated-msg-text" style="background:var(--color-bg-soft);border:1px solid var(--color-border);border-radius:10px;padding:12px;font-size:12.5px;line-height:1.6;color:var(--color-text-body);white-space:pre-wrap;"></div>
          <button id="btn-copy-msg" class="btn btn-ghost btn-sm" style="margin-top:8px;">Copy Message</button>
        </div>`;
    }

    function _infoRow(label, value) {
      return `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:12px;">
        <span style="color:var(--color-text-faint);min-width:80px;flex-shrink:0;">${Utils.escHtml(label)}</span>
        <span style="color:var(--color-text-body);">${value}</span>
      </div>`;
    }

    function _statBox(label, value) {
      return `<div style="text-align:center;padding:10px;background:var(--color-bg-soft);border-radius:8px;border:1px solid var(--color-border-soft);">
        <div style="font-size:18px;font-weight:700;color:var(--color-text-primary);">${Utils.escHtml(String(value))}</div>
        <div style="font-size:10px;color:var(--color-text-faint);margin-top:2px;">${Utils.escHtml(label)}</div>
      </div>`;
    }

    async function _generateMessage(leadId, lead) {
      const btn     = document.getElementById('btn-gen-message');
      const area    = document.getElementById('generated-msg-area');
      const textEl  = document.getElementById('generated-msg-text');
      const copyBtn = document.getElementById('btn-copy-msg');
      const restore  = Skeleton.btn(btn, 'Generating...');

      const res = await Utils.post('/api/generate_message.php', { lead_id: leadId, save: true, force: true });
      restore();

      if (!res.success) { Toast.error('Generation failed', res.error || ''); return; }

      if (area)   area.style.display = 'block';
      if (textEl) textEl.textContent = res.data?.message || '';

      copyBtn?.addEventListener('click', async () => {
        await Utils.copyText(textEl?.textContent || '');
        Toast.success('Copied!', 'Message copied to clipboard');
      });
    }

    return { init, load, close };
  })();

})();
