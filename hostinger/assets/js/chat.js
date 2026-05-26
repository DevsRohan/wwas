/**
 * WWAS - Chat Module
 * Handles right panel: conversation timeline, bubbles, manual send
 */

const ChatModule = (() => {
  let _currentLeadId  = null;
  let _currentLead    = null;
  let _messages       = [];
  let _sending        = false;

  // DOM refs
  let _chatAreaEl     = null;
  let _inputEl        = null;
  let _sendBtnEl      = null;
  let _chatHeaderEl   = null;
  let _emptyStateEl   = null;
  let _chatWrapEl     = null;

  function init() {
    _chatAreaEl   = document.getElementById('chat-area');
    _inputEl      = document.getElementById('chat-input');
    _sendBtnEl    = document.getElementById('chat-send-btn');
    _chatHeaderEl = document.getElementById('chat-header');
    _emptyStateEl = document.getElementById('chat-empty');
    _chatWrapEl   = document.getElementById('chat-wrap');

    _bindEvents();
  }

  function _bindEvents() {
    // Send on button click
    _sendBtnEl?.addEventListener('click', sendMessage);

    // Send on Ctrl+Enter
    _inputEl?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    _inputEl?.addEventListener('input', () => {
      _inputEl.style.height = 'auto';
      _inputEl.style.height = Math.min(_inputEl.scrollHeight, 120) + 'px';
    });

    // Socket events
    SocketManager.on('message_received', (data) => {
      if (_currentLead && data.phone_number === _currentLead.phone_number) {
        _appendBubble({
          sender: 'lead',
          message_text: data.message_text,
          wa_message_id: data.wa_message_id,
          direction: 'inbound',
          timestamp: new Date(data.timestamp).toISOString().replace('T', ' ').slice(0, 19),
          status: 'received'
        }, true);
        // Mark as read immediately
        Utils.post('/api/mark_read.php', { lead_id: _currentLeadId });
      }
    });

    SocketManager.on('message_sent', (data) => {
      if (_currentLead && data.phone_number === _currentLead.phone_number) {
        // Update pending bubble to confirmed sent
        const pending = _chatAreaEl?.querySelector('.bubble-pending');
        if (pending) {
          pending.classList.remove('bubble-pending');
          const statusEl = pending.closest('.bubble-wrap')?.querySelector('.bubble-status');
          if (statusEl) statusEl.innerHTML = _statusIcon('sent');
        }
      }
    });

    SocketManager.on('message_ack', (data) => {
      const bubble = _chatAreaEl?.querySelector(`[data-wa-id="${Utils.escHtml(data.wa_message_id)}"]`);
      if (bubble) {
        const statusEl = bubble.closest('.bubble-wrap')?.querySelector('.bubble-status');
        if (statusEl) statusEl.innerHTML = _statusIcon(data.status);
        if (data.status === 'read') statusEl?.classList.add('read');
      }
    });
  }

  async function loadConversation(leadId) {
    _currentLeadId = leadId;

    // Show chat wrap, hide empty state
    if (_emptyStateEl) _emptyStateEl.style.display = 'none';
    if (_chatWrapEl)   _chatWrapEl.style.display = 'flex';

    // Show skeleton
    if (_chatAreaEl) Skeleton.messages(_chatAreaEl);

    const res = await Utils.get('/api/get_messages.php', { lead_id: leadId, per_page: 50 });

    if (!res.success) {
      Toast.error('Failed to load conversation', res.error || '');
      return;
    }

    _currentLead = res.data.lead;
    _messages    = res.data.messages || [];

    _renderHeader();
    _renderMessages(res.data.grouped || []);
    _enableInput(_currentLead.whatsapp_status === 'valid');
    _scrollToBottom();
  }

  function _renderHeader() {
    if (!_chatHeaderEl || !_currentLead) return;
    const statusHtml = Utils.waBadge(_currentLead.whatsapp_status);
    const outHtml    = Utils.outreachBadge(_currentLead.outreach_status);

    _chatHeaderEl.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="lead-avatar" style="width:40px;height:40px;font-size:14px;">${Utils.escHtml(Utils.initials(_currentLead.business_name))}</div>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--color-text-primary);">${Utils.escHtml(_currentLead.business_name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted);">${Utils.escHtml(_currentLead.phone_display || _currentLead.phone_number)}</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
          ${statusHtml} ${outHtml}
          <button onclick="DetailsModule.load(${_currentLeadId})" class="btn btn-ghost btn-sm">Details</button>
        </div>
      </div>`;
  }

  function _renderMessages(grouped) {
    if (!_chatAreaEl) return;
    _chatAreaEl.innerHTML = '';

    if (grouped.length === 0) {
      _chatAreaEl.innerHTML = `
        <div class="empty-state" style="flex:1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:36px;height:36px;"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
          <p class="empty-state-title">No messages yet</p>
          <p class="empty-state-sub">Send the first outreach message to start the conversation</p>
        </div>`;
      return;
    }

    grouped.forEach(group => {
      // Date divider
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = group.label;
      _chatAreaEl.appendChild(divider);

      group.messages.forEach(msg => _appendBubble(msg, false));
    });
  }

  function _appendBubble(msg, animate = false) {
    if (!_chatAreaEl) return;

    const isOut = msg.direction === 'outbound';
    const timeStr = Utils.formatTime(msg.timestamp);

    const wrap = document.createElement('div');
    wrap.className = `bubble-wrap ${isOut ? 'outbound' : 'inbound'}${animate ? ' animate-bubbleIn' : ''}`;

    const statusHtml = isOut ? `<div class="bubble-status">${_statusIcon(msg.status)}</div>` : '';

    // Only add data-wa-id attribute when wa_message_id actually exists
    // An empty data-wa-id="" would cause false querySelector matches
    const waIdAttr = msg.wa_message_id
      ? `data-wa-id="${Utils.escHtml(msg.wa_message_id)}"`
      : '';

    wrap.innerHTML = `
      <div class="bubble ${isOut ? 'outbound' : 'inbound'}${msg.status === 'pending' ? ' bubble-pending' : ''}"
           ${waIdAttr}>
        ${Utils.nl2br(msg.message_text)}
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span class="bubble-time">${Utils.escHtml(timeStr)}</span>
        ${statusHtml}
      </div>`;

    _chatAreaEl.appendChild(wrap);

    if (animate) _scrollToBottom();
  }

  function _statusIcon(status) {
    const icons = {
      pending:   `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px;"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd"/></svg>`,
      sent:      `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px;"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`,
      delivered: `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px;color:var(--color-green-500);"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`,
      read:      `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px;color:var(--color-green-600);"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd"/></svg>`,
      failed:    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px;color:var(--color-error);"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/></svg>`
    };
    return icons[status] || icons.sent;
  }

  async function sendMessage() {
    if (_sending || !_currentLeadId || !_inputEl) return;
    const text = _inputEl.value.trim();
    if (!text) return;

    _sending = true;
    const restore = Skeleton.btn(_sendBtnEl, '');

    // Optimistic bubble
    _appendBubble({
      sender: 'user', message_text: text,
      direction: 'outbound', timestamp: new Date().toISOString().replace('T',' ').slice(0,19),
      status: 'pending'
    }, true);

    _inputEl.value = '';
    _inputEl.style.height = 'auto';

    const res = await Utils.post('/api/send_manual.php', {
      lead_id: _currentLeadId,
      message: text
    });

    restore();
    _sending = false;

    if (!res.success) {
      Toast.error('Send failed', res.error || 'Could not send message');
      // Remove optimistic bubble
      _chatAreaEl?.querySelector('.bubble-pending')?.closest('.bubble-wrap')?.remove();
    }
  }

  function _enableInput(enabled) {
    if (_inputEl)   _inputEl.disabled   = !enabled;
    if (_sendBtnEl) _sendBtnEl.disabled = !enabled;
    if (_inputEl)   _inputEl.placeholder = enabled ? 'Type a message... (Ctrl+Enter to send)' : 'WhatsApp number not validated — cannot send';
  }

  function _scrollToBottom() {
    if (_chatAreaEl) {
      requestAnimationFrame(() => {
        _chatAreaEl.scrollTop = _chatAreaEl.scrollHeight;
      });
    }
  }

  return { init, loadConversation, sendMessage };
})();

window.ChatModule = ChatModule;
