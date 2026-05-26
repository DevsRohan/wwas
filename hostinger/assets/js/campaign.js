/**
 * WWAS - Campaign Module
 * Handles campaign start/pause/status + KPI updates
 */

const CampaignModule = (() => {
  let _status     = 'idle';
  let _stats      = {};
  let _pollTimer  = null;

  function init() {
    _bindSocketEvents();
    _bindUIEvents();
    loadStats();
    _startPolling();
  }

  function _bindUIEvents() {
    const startBtn  = document.getElementById('btn-start-campaign');
    const pauseBtn  = document.getElementById('btn-pause-campaign');
    const validateBtn = document.getElementById('btn-validate-numbers');
    const retryBtn  = document.getElementById('btn-retry-failed');

    startBtn?.addEventListener('click', startCampaign);
    pauseBtn?.addEventListener('click', pauseCampaign);
    validateBtn?.addEventListener('click', validateNumbers);
    retryBtn?.addEventListener('click', retryFailed);
  }

  function _bindSocketEvents() {
    SocketManager.on('campaign_progress', (data) => {
      _updateQueueCounter(data.queueSize || 0);
    });

    SocketManager.on('outreach_started', () => {
      _setStatus('running');
    });

    SocketManager.on('outreach_stopped', (data) => {
      _setStatus(data.reason === 'paused' ? 'paused' : 'idle');
    });

    SocketManager.on('heartbeat', (data) => {
      _updateQueueCounter(data.queue_size || 0);
    });
  }

  async function loadStats() {
    const res = await Utils.get('/api/get_stats.php');
    if (!res.success) return;

    const d = res.data;
    _stats  = d;
    _status = d.campaign?.status || 'idle';

    _renderKPIs(d);
    _setStatus(_status);
    _updateCampaignStatus(d.whatsapp);
  }

  function _renderKPIs(d) {
    const kpiMap = {
      'kpi-total-leads':   Utils.formatNum(d.leads?.total || 0),
      'kpi-valid-leads':   Utils.formatNum(d.leads?.valid || 0),
      'kpi-sent-count':    Utils.formatNum(d.leads?.sent || 0),
      'kpi-replied-count': Utils.formatNum(d.leads?.replied || 0),
      'kpi-queue-pending': Utils.formatNum(d.leads?.queue_pending || 0),
      'kpi-unread':        Utils.formatNum(d.messages?.unread || 0),
      'kpi-sent-today':    (d.today?.sent || 0) + ' / ' + (d.today?.daily_limit || 50),
      'kpi-wa-status':     d.whatsapp?.ready ? 'Connected' : 'Offline'
    };

    for (const [id, val] of Object.entries(kpiMap)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val;
        el.classList.add('animate-bounceIn');
        setTimeout(() => el.classList.remove('animate-bounceIn'), 400);
      }
    }

    // Daily limit progress bar
    const pct = d.today?.limit_pct || 0;
    const bar = document.getElementById('daily-limit-bar');
    if (bar) bar.style.width = pct + '%';
    const pctEl = document.getElementById('daily-limit-pct');
    if (pctEl) pctEl.textContent = pct + '%';

    // Recent activity
    _renderRecentActivity(d.recent_activity || []);
  }

  function _renderRecentActivity(activities) {
    const el = document.getElementById('recent-activity');
    if (!el) return;
    if (!activities.length) { el.innerHTML = '<p class="text-xs text-gray-400 px-2 py-3">No recent activity</p>'; return; }

    el.innerHTML = activities.map(a => `
      <div class="flex items-start gap-2 py-2.5 border-b border-gray-50 last:border-0">
        <div class="lead-avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0;">${Utils.escHtml(Utils.initials(a.business_name))}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--color-text-primary);">${Utils.escHtml(a.business_name)}</div>
          <div style="font-size:11px;color:var(--color-text-muted);">${Utils.escHtml(a.last_message || '')}</div>
        </div>
        <span style="font-size:10px;color:var(--color-text-faint);flex-shrink:0;">${Utils.escHtml(a.time_ago || '')}</span>
      </div>`).join('');
  }

  function _setStatus(status) {
    _status = status;
    const statusEl = document.getElementById('campaign-status-text');
    const dotEl    = document.getElementById('campaign-status-dot');
    const startBtn = document.getElementById('btn-start-campaign');
    const pauseBtn = document.getElementById('btn-pause-campaign');

    const map = {
      running:   { text: 'Running',   dotClass: 'green',  showStart: false, showPause: true },
      paused:    { text: 'Paused',    dotClass: 'yellow', showStart: true,  showPause: false },
      idle:      { text: 'Idle',      dotClass: 'gray',   showStart: true,  showPause: false },
      completed: { text: 'Completed', dotClass: 'green',  showStart: true,  showPause: false },
      failed:    { text: 'Failed',    dotClass: 'red',    showStart: true,  showPause: false },
    };
    const s = map[status] || map.idle;

    if (statusEl) statusEl.textContent = s.text;
    if (dotEl)    dotEl.className = `live-dot ${s.dotClass}`;
    if (startBtn) startBtn.style.display = s.showStart ? '' : 'none';
    if (pauseBtn) pauseBtn.style.display = s.showPause ? '' : 'none';
  }

  function _updateCampaignStatus(waStatus) {
    const waEl    = document.getElementById('wa-engine-status');
    const waKpiEl = document.getElementById('kpi-wa-status');
    const isReady = waStatus?.ready;
    if (waEl) {
      waEl.innerHTML = isReady
        ? '<span class="badge badge-green"><span class="dot ping"></span>Connected</span>'
        : '<span class="badge badge-red"><span class="dot"></span>Offline</span>';
    }
    if (waKpiEl) {
      waKpiEl.textContent = isReady ? 'Connected' : 'Offline';
      waKpiEl.style.color = isReady ? 'var(--color-green-600)' : 'var(--color-error)';
    }
  }

  function _updateQueueCounter(size) {
    const el = document.getElementById('kpi-queue-pending');
    if (el) el.textContent = Utils.formatNum(size);
  }

  async function startCampaign() {
    const btn    = document.getElementById('btn-start-campaign');
    const restore = Skeleton.btn(btn, 'Starting...');

    const res = await Utils.post('/api/start_campaign.php');
    restore();

    if (!res.success) {
      Toast.error('Cannot start campaign', res.error || '');
      return;
    }

    if (res.data?.status === 'nothing_to_do') {
      Toast.warning('Nothing to do', res.data.message || 'No valid pending leads');
      return;
    }

    _setStatus('running');
    Toast.success('Campaign Started! 🚀', `${res.data?.pending_leads || 0} leads in queue`);

    // Trigger first batch run via campaign script
    setTimeout(async () => {
      try {
        const res = await Utils.get('/scripts/campaign.php');
        // campaign.php returns JSON on HTTP but plain text on CLI early-exit
        // success check is safe either way
      } catch (e) { /* non-critical */ }
    }, 500);
  }

  async function pauseCampaign() {
    const btn     = document.getElementById('btn-pause-campaign');
    const restore  = Skeleton.btn(btn, 'Pausing...');

    const res = await Utils.post('/api/pause_campaign.php');
    restore();

    if (!res.success) { Toast.error('Pause failed', res.error || ''); return; }

    _setStatus('paused');
    Toast.info('Campaign Paused', `${res.data?.remaining_leads || 0} leads remaining`);
  }

  async function validateNumbers() {
    const btn     = document.getElementById('btn-validate-numbers');
    const restore  = Skeleton.btn(btn, 'Validating...');

    const res = await Utils.post('/api/validate_numbers.php', { batch_size: 20 });
    restore();

    if (!res.success) { Toast.error('Validation failed', res.error || ''); return; }

    const d = res.data;
    Toast.success('Validation Complete', `${d.valid} valid, ${d.not_on_whatsapp} not on WA, ${d.failed} failed`);
    setTimeout(loadStats, 500);
  }

  async function retryFailed() {
    const btn     = document.getElementById('btn-retry-failed');
    const restore  = Skeleton.btn(btn, 'Retrying...');

    const res = await Utils.get('/scripts/retry_failed.php');
    restore();

    if (!res.success) { Toast.error('Retry failed', res.error || ''); return; }

    Toast.success('Retry Complete', `${res.data?.failed_leads_reset || 0} leads reset for retry`);
    setTimeout(loadStats, 500);
  }

  function _startPolling() {
    // Poll stats every 60 seconds
    _pollTimer = setInterval(loadStats, 60000);
  }

  return { init, loadStats, startCampaign, pauseCampaign, validateNumbers };
})();

window.CampaignModule = CampaignModule;
