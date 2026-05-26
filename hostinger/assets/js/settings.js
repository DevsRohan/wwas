/**
 * WWAS - Settings Module
 * Handles Settings panel: load, display, save all settings
 */

const SettingsModule = (() => {
  let _settings = {};

  function init() {
    document.getElementById('btn-open-settings')?.addEventListener('click', open);
    document.getElementById('btn-close-settings')?.addEventListener('click', close);
    document.getElementById('settings-overlay')?.addEventListener('click', close);
    document.getElementById('settings-save-btn')?.addEventListener('click', save);
  }

  async function open() {
    const overlay = document.getElementById('settings-overlay');
    const drawer  = document.getElementById('settings-drawer');
    if (!overlay || !drawer) return;

    overlay.classList.remove('hidden');
    drawer.classList.remove('hidden');
    drawer.classList.add('animate-drawerIn');

    await load();
  }

  function close() {
    const overlay = document.getElementById('settings-overlay');
    const drawer  = document.getElementById('settings-drawer');
    if (overlay) overlay.classList.add('hidden');
    if (drawer)  drawer.classList.add('hidden');
  }

  async function load() {
    const body = document.getElementById('settings-body');
    if (body) Skeleton.spinner(body);

    const res = await Utils.get('/api/settings.php');
    if (!res.success) { Toast.error('Failed to load settings'); return; }

    _settings = res.data.settings || {};
    const runtime = res.data.runtime || {};

    if (body) {
      body.innerHTML = _renderForm(_settings, runtime);
      _bindToggleEvents(body);
    }
  }

  function _renderForm(s, rt) {
    return `
    <div style="display:flex;flex-direction:column;gap:0;">

      <!-- API KEYS -->
      <div style="padding:20px 24px;border-bottom:1px solid var(--color-border-soft);">
        <h4 style="font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:14px;">API Configuration</h4>
        <div class="form-group">
          <label class="form-label">Groq API Key</label>
          <input type="password" class="form-input" id="s-groq_api_key" value="${Utils.escHtml(s.groq_api_key||'')}" placeholder="gsk_...">
          <p class="form-hint">Get your key at <a href="https://console.groq.com" target="_blank" style="color:var(--color-green-600);">console.groq.com</a></p>
        </div>
        <div class="form-group">
          <label class="form-label">HF Node.js API URL</label>
          <input type="url" class="form-input" id="s-hf_api_url" value="${Utils.escHtml(s.hf_api_url||'')}" placeholder="https://your-space.hf.space">
        </div>
        <div class="form-group">
          <label class="form-label">HF API Key</label>
          <input type="password" class="form-input" id="s-hf_api_key" value="${Utils.escHtml(s.hf_api_key||'')}" placeholder="Your Node.js API key">
        </div>
        <div class="form-group">
          <label class="form-label">Socket.io URL</label>
          <input type="url" class="form-input" id="s-socket_url" value="${Utils.escHtml(s.socket_url||'')}" placeholder="https://your-space.hf.space">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Webhook Secret</label>
          <input type="password" class="form-input" id="s-webhook_secret" value="${Utils.escHtml(s.webhook_secret||'')}" placeholder="HMAC secret (min 32 chars)">
          <p class="form-hint">Must match WEBHOOK_SECRET in HF .env</p>
        </div>
      </div>

      <!-- CAMPAIGN -->
      <div style="padding:20px 24px;border-bottom:1px solid var(--color-border-soft);">
        <h4 style="font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:14px;">Campaign Settings</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Min Delay (seconds)</label>
            <input type="number" class="form-input" id="s-delay_min" value="${Utils.escHtml(s.delay_min||'120')}" min="30" max="3600">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Max Delay (seconds)</label>
            <input type="number" class="form-input" id="s-delay_max" value="${Utils.escHtml(s.delay_max||'300')}" min="60" max="7200">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Daily Send Limit</label>
            <input type="number" class="form-input" id="s-daily_send_limit" value="${Utils.escHtml(s.daily_send_limit||'50')}" min="1" max="500">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Max Retries</label>
            <input type="number" class="form-input" id="s-max_retries" value="${Utils.escHtml(s.max_retries||'3')}" min="0" max="10">
          </div>
        </div>
      </div>

      <!-- AI MODEL -->
      <div style="padding:20px 24px;border-bottom:1px solid var(--color-border-soft);">
        <h4 style="font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:14px;">AI Model Settings</h4>
        <div class="form-group">
          <label class="form-label">Groq Model</label>
          <select class="form-select" id="s-groq_model">
            <option value="llama3-70b-8192" ${s.groq_model==='llama3-70b-8192'?'selected':''}>llama3-70b-8192 (Recommended)</option>
            <option value="llama3-8b-8192"  ${s.groq_model==='llama3-8b-8192'?'selected':''}>llama3-8b-8192 (Faster)</option>
            <option value="mixtral-8x7b-32768" ${s.groq_model==='mixtral-8x7b-32768'?'selected':''}>mixtral-8x7b-32768</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Temperature (0–2)</label>
            <input type="number" class="form-input" id="s-groq_temperature" value="${Utils.escHtml(s.groq_temperature||'0.7')}" min="0" max="2" step="0.1">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Max Tokens</label>
            <input type="number" class="form-input" id="s-groq_max_tokens" value="${Utils.escHtml(s.groq_max_tokens||'600')}" min="100" max="2000">
          </div>
        </div>
      </div>

      <!-- UI PREFERENCES -->
      <div style="padding:20px 24px;">
        <h4 style="font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:14px;">Preferences</h4>
        <div style="display:flex;flex-direction:column;gap:14px;">
          ${_renderToggle('notification_sound', s.notification_sound, 'Notification Sounds', 'Play sound on new messages')}
          ${_renderToggle('logging_enabled', s.logging_enabled, 'Enable Logging', 'Log events to database')}
        </div>
      </div>

      <!-- RUNTIME INFO -->
      <div style="padding:16px 24px;background:var(--color-bg-soft);border-top:1px solid var(--color-border-soft);">
        <h4 style="font-size:11px;font-weight:600;color:var(--color-text-faint);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">Server Runtime</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          ${Object.entries({ 'PHP': rt.php_version, 'Timezone': rt.timezone, 'Max Upload': rt.max_upload, 'Memory': rt.memory_limit })
            .map(([k,v]) => `<div style="font-size:11px;color:var(--color-text-muted);"><span style="font-weight:600;">${Utils.escHtml(k)}:</span> ${Utils.escHtml(v||'-')}</div>`).join('')}
        </div>
      </div>
    </div>`;
  }

  function _renderToggle(key, value, label, hint) {
    const checked = value === '1' || value === 'true' || value === true;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:500;color:var(--color-text-primary);">${Utils.escHtml(label)}</div>
        <div style="font-size:11px;color:var(--color-text-faint);">${Utils.escHtml(hint)}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="s-${key}" ${checked ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>`;
  }

  function _bindToggleEvents(container) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (window.WWAS_CONFIG) {
          const key = cb.id.replace('s-', '');
          window.WWAS_CONFIG[key] = cb.checked ? '1' : '0';
        }
      });
    });
  }

  async function save() {
    const btn     = document.getElementById('settings-save-btn');
    const restore  = Skeleton.btn(btn, 'Saving...');

    const updates = {};
    const fields  = ['groq_api_key','hf_api_url','hf_api_key','socket_url','webhook_secret',
                     'delay_min','delay_max','daily_send_limit','max_retries','groq_model',
                     'groq_temperature','groq_max_tokens'];
    const bools   = ['notification_sound','logging_enabled'];

    fields.forEach(key => {
      const el = document.getElementById(`s-${key}`);
      if (el && el.value !== '') updates[key] = el.value;
    });
    bools.forEach(key => {
      const el = document.getElementById(`s-${key}`);
      if (el) updates[key] = el.checked ? '1' : '0';
    });

    const res = await Utils.post('/api/update_settings.php', { updates });
    restore();

    if (!res.success) { Toast.error('Save failed', res.error || ''); return; }

    Toast.success('Settings saved!', `${res.data?.saved?.length || 0} settings updated`);

    // Update socket URL if changed
    const newSocketUrl = updates.socket_url || updates.hf_api_url;
    if (newSocketUrl && newSocketUrl !== window.WWAS_CONFIG?.socket_url) {
      Toast.info('Restart required', 'Reload page to apply new socket URL');
    }

    close();
  }

  return { init, open, close, load, save };
})();

window.SettingsModule = SettingsModule;
