/**
 * WWAS - Leads Module
 * Handles middle column: lead list, search, filters, pagination
 */

const LeadsModule = (() => {
  let _leads = [];
  let _pagination = {};
  let _filters = { search: '', whatsapp_status: '', outreach_status: '', pitch_type: '', city: '', state: '', page: 1 };
  let _selectedLeadId = null;
  let _searchDebounce = null;

  // DOM refs (set on init)
  let _listEl = null;
  let _searchEl = null;
  let _totalEl = null;

  function init() {
    _listEl   = document.getElementById('leads-list');
    _searchEl = document.getElementById('leads-search');
    _totalEl  = document.getElementById('leads-total');

    _bindEvents();
    load();
  }

  function _bindEvents() {
    // Search input
    if (_searchEl) {
      _searchEl.addEventListener('input', () => {
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(() => {
          _filters.search = _searchEl.value.trim();
          _filters.page = 1;
          load();
        }, 350);
      });
    }

    // Filter chips
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.filter;
        const val = btn.dataset.value;
        _filters[key] = _filters[key] === val ? '' : val;
        _filters.page = 1;
        _updateFilterUI();
        load();
      });
    });

    // Socket: live updates
    SocketManager.on('message_received', (data) => {
      _onInboundMessage(data);
    });
    SocketManager.on('number_validated', (data) => {
      _updateLeadCardBadge(data.phone, 'wa', data.status);
    });
    SocketManager.on('message_sent', (data) => {
      _updateLeadCardBadge(data.phone_number, 'outreach', 'sent');
    });
    SocketManager.on('_reconnected', () => load());
  }

  async function load() {
    if (!_listEl) return;
    Skeleton.leads(_listEl, 6);

    const params = {
      search:          _filters.search,
      whatsapp_status: _filters.whatsapp_status,
      outreach_status: _filters.outreach_status,
      pitch_type:      _filters.pitch_type,
      page:            _filters.page,
      per_page:        30,
      sort:            'last_contacted_at',
      dir:             'DESC'
    };

    // Remove empty params
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });

    const res = await Utils.get('/api/get_leads.php', params);

    if (!res.success) {
      _listEl.innerHTML = `<div class="empty-state"><p class="empty-state-title">Failed to load leads</p><p class="empty-state-sub">${Utils.escHtml(res.error || '')}</p></div>`;
      return;
    }

    _leads = res.data.leads || [];
    _pagination = res.data.pagination || {};

    _render();
    _updateTotalCount();
    _populateFilterDropdowns(res.data.filters || {});
  }

  function _render() {
    if (!_listEl) return;

    if (_leads.length === 0) {
      _listEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>
          <p class="empty-state-title">No leads found</p>
          <p class="empty-state-sub">Import a CSV or adjust your filters</p>
        </div>`;
      return;
    }

    _listEl.innerHTML = _leads.map(lead => _renderCard(lead)).join('');

    // Bind click handlers
    _listEl.querySelectorAll('.lead-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.leadId);
        selectLead(id);
      });
    });

    // Restore selected state
    if (_selectedLeadId) {
      const active = _listEl.querySelector(`[data-lead-id="${_selectedLeadId}"]`);
      if (active) active.classList.add('active');
    }
  }

  function _renderCard(lead) {
    const initials = Utils.initials(lead.business_name);
    const unread   = lead.unread_count > 0;
    const preview  = Utils.truncate(lead.last_message || lead.phone_display || '', 55);
    const timeAgo  = lead.last_msg_ago || lead.time_ago || '';

    const waBadge = {
      valid: '<span class="badge badge-green" style="font-size:10px;padding:2px 6px;">WA ✓</span>',
      not_on_whatsapp: '<span class="badge badge-yellow" style="font-size:10px;padding:2px 6px;">No WA</span>',
      invalid: '<span class="badge badge-red" style="font-size:10px;padding:2px 6px;">Invalid</span>',
      pending: '<span class="badge badge-gray" style="font-size:10px;padding:2px 6px;">Pending</span>',
    }[lead.whatsapp_status] || '';

    const outBadge = lead.outreach_status === 'replied'
      ? '<span class="badge badge-green" style="font-size:10px;padding:2px 6px;">Replied</span>'
      : lead.outreach_status === 'sent'
      ? '<span class="badge" style="font-size:10px;padding:2px 6px;background:#dbeafe;color:#1e40af;">Sent</span>'
      : '';

    const websiteIcon = lead.website_status === 'yes'
      ? `<span title="Has website" style="color:var(--color-green-600);font-size:10px;">🌐</span>`
      : `<span title="No website" style="color:var(--color-text-faint);font-size:10px;">○</span>`;

    return `
      <div class="lead-card${unread ? ' unread' : ''}" data-lead-id="${lead.id}" data-phone="${Utils.escHtml(lead.phone_number)}">
        <div class="flex items-center gap-3">
          <div class="lead-avatar">${Utils.escHtml(initials)}</div>
          <div style="flex:1;min-width:0;">
            <div class="flex items-center gap-1 mb-0.5">
              <span class="lead-name">${Utils.escHtml(lead.business_name)}</span>
              ${unread ? `<span style="width:7px;height:7px;background:var(--color-green-500);border-radius:50%;flex-shrink:0;margin-left:2px;"></span>` : ''}
            </div>
            <div class="lead-preview">${Utils.escHtml(preview) || '<span style="color:var(--color-text-faint)">No messages yet</span>'}</div>
            <div class="flex items-center gap-1.5 mt-1">
              ${waBadge} ${outBadge} ${websiteIcon}
              <span class="lead-meta" style="margin-left:auto;">${Utils.escHtml(lead.city || '')}${lead.city && lead.state ? ', ' : ''}${Utils.escHtml(lead.state || '')}</span>
            </div>
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div class="lead-meta mb-1">${Utils.escHtml(timeAgo)}</div>
            ${unread ? `<span style="background:var(--color-green-600);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;">${lead.unread_count}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  function selectLead(leadId) {
    _selectedLeadId = leadId;

    // Update active state in list
    _listEl?.querySelectorAll('.lead-card').forEach(c => c.classList.remove('active'));
    _listEl?.querySelector(`[data-lead-id="${leadId}"]`)?.classList.add('active');

    // Trigger chat + details load
    if (window.ChatModule) ChatModule.loadConversation(leadId);
    if (window.DetailsModule) DetailsModule.load(leadId);
  }

  function _onInboundMessage(data) {
    const phone = data.phone_number;
    const card  = _listEl?.querySelector(`[data-phone="${phone}"]`);

    if (card) {
      // Update preview text
      const previewEl = card.querySelector('.lead-preview');
      if (previewEl) previewEl.textContent = Utils.truncate(data.message_text || '', 55);

      // Add unread indicator
      card.classList.add('unread');
      const timeEl = card.querySelector('.lead-meta');
      if (timeEl) timeEl.textContent = 'just now';

      // Move card to top
      _listEl.prepend(card);
      card.classList.add('animate-fadeInDown');
      setTimeout(() => card.classList.remove('animate-fadeInDown'), 300);
    } else {
      // Unknown lead — reload list
      setTimeout(() => load(), 1000);
    }
  }

  function _updateLeadCardBadge(phone, type, status) {
    const card = _listEl?.querySelector(`[data-phone="${phone}"]`);
    if (!card) return;
    // Visual flash on update
    card.style.transition = 'background 300ms';
    card.style.background = 'var(--color-green-50)';
    setTimeout(() => { card.style.background = ''; }, 600);
  }

  function _updateTotalCount() {
    if (_totalEl) {
      _totalEl.textContent = Utils.formatNum(_pagination.total || 0);
    }
  }

  function _updateFilterUI() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
      const isActive = _filters[btn.dataset.filter] === btn.dataset.value;
      btn.classList.toggle('active', isActive);
      btn.style.background   = isActive ? 'var(--color-green-600)' : '';
      btn.style.color        = isActive ? '#fff' : '';
      btn.style.borderColor  = isActive ? 'var(--color-green-600)' : '';
    });
  }

  function _populateFilterDropdowns(filters) {
    const citySelect  = document.getElementById('filter-city');
    const stateSelect = document.getElementById('filter-state');

    if (citySelect && filters.cities) {
      const current = citySelect.value;
      citySelect.innerHTML = '<option value="">All Cities</option>' +
        (filters.cities || []).map(c => `<option value="${Utils.escHtml(c)}" ${c === current ? 'selected' : ''}>${Utils.escHtml(c)}</option>`).join('');
      citySelect.onchange = () => { _filters.city = citySelect.value; _filters.page = 1; load(); };
    }
    if (stateSelect && filters.states) {
      const current = stateSelect.value;
      stateSelect.innerHTML = '<option value="">All States</option>' +
        (filters.states || []).map(s => `<option value="${Utils.escHtml(s)}" ${s === current ? 'selected' : ''}>${Utils.escHtml(s)}</option>`).join('');
      stateSelect.onchange = () => { _filters.state = stateSelect.value; _filters.page = 1; load(); };
    }
  }

  function getSelectedLeadId() { return _selectedLeadId; }
  function refresh() { load(); }

  return { init, load, selectLead, getSelectedLeadId, refresh };
})();

window.LeadsModule = LeadsModule;
