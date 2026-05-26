/**
 * WWAS - Socket.io Client Manager
 * Manages WebSocket connection to HF Node.js engine
 * Handles all realtime events and broadcasts to app modules
 */

const SocketManager = (() => {
  let _socket = null;
  let _connected = false;
  let _handlers = {};   // event → [callbacks]
  let _reconnectUI = null;

  /**
   * Initialize and connect to Socket.io server
   * @param {string} serverUrl  HF Space URL
   */
  function connect(serverUrl) {
    if (!serverUrl) {
      console.warn('[Socket] No server URL configured — realtime disabled');
      _updateConnectionUI('unknown');
      return;
    }

    if (typeof io === 'undefined') {
      console.error('[Socket] Socket.io client not loaded');
      return;
    }

    _socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      autoConnect: true,
      withCredentials: false
    });

    _bindCoreEvents();
  }

  function _bindCoreEvents() {
    if (!_socket) return;

    _socket.on('connect', () => {
      _connected = true;
      console.log('[Socket] Connected:', _socket.id);
      _updateConnectionUI('connected');
      _emit('_connected', { socketId: _socket.id });
    });

    _socket.on('disconnect', (reason) => {
      _connected = false;
      console.warn('[Socket] Disconnected:', reason);
      _updateConnectionUI('disconnected');
      _emit('_disconnected', { reason });
    });

    _socket.on('connect_error', (err) => {
      _connected = false;
      console.error('[Socket] Connection error:', err.message);
      _updateConnectionUI('error');
    });

    _socket.on('reconnect', (attempt) => {
      console.log('[Socket] Reconnected after', attempt, 'attempts');
      Toast.info('Connection restored', 'Realtime sync is back online');
      _emit('_reconnected', { attempt });
    });

    _socket.on('reconnect_attempt', (attempt) => {
      _updateConnectionUI('reconnecting');
      _emit('_reconnecting', { attempt });
    });

    // ── App Events from HF Engine ────────────────────────────

    _socket.on('connection_ack', (data) => {
      _emit('connection_ack', data);
      // Sync WA status immediately on connect
      if (data.wa_status) _emit('_wa_status_update', data.wa_status);
    });

    _socket.on('heartbeat', (data) => {
      _emit('heartbeat', data);
      _updateHeartbeat();
    });

    _socket.on('qr_code', (data) => {
      console.log('[Socket] QR code received');
      _emit('qr_code', data);
      _updateConnectionUI('qr');
    });

    _socket.on('whatsapp_ready', (data) => {
      console.log('[Socket] WhatsApp ready');
      _emit('whatsapp_ready', data);
      _updateConnectionUI('wa_connected');
      Toast.success('WhatsApp Connected', 'Engine is ready to send messages');
    });

    _socket.on('whatsapp_disconnected', (data) => {
      console.warn('[Socket] WhatsApp disconnected:', data.reason);
      _emit('whatsapp_disconnected', data);
      _updateConnectionUI('wa_disconnected');
      Toast.warning('WhatsApp Disconnected', data.reason || 'Reconnecting...');
    });

    _socket.on('whatsapp_authenticated', (data) => {
      _emit('whatsapp_authenticated', data);
    });

    _socket.on('whatsapp_auth_failure', (data) => {
      _emit('whatsapp_auth_failure', data);
      Toast.error('WhatsApp Auth Failed', data.message || 'Please scan QR again');
    });

    _socket.on('whatsapp_reconnecting', (data) => {
      _emit('whatsapp_reconnecting', data);
      _updateConnectionUI('wa_reconnecting');
    });

    _socket.on('whatsapp_reconnect_failed', (data) => {
      _emit('whatsapp_reconnect_failed', data);
      _updateConnectionUI('wa_disconnected');
      Toast.error('WhatsApp Reconnect Failed', `Max attempts reached (${data.attempts}). Please reload and scan QR again.`, 0);
    });

    _socket.on('message_received', (data) => {
      console.log('[Socket] Message received from:', data.phone_number);
      _emit('message_received', data);
    });

    _socket.on('message_sent', (data) => {
      _emit('message_sent', data);
    });

    _socket.on('message_ack', (data) => {
      _emit('message_ack', data);
    });

    // NOTE: 'lead_replied' is NOT emitted by the HF engine.
    // Lead reply detection happens via webhook.php (inbound_message event)
    // which updates the DB and the frontend polls via get_leads.php.
    // The message_received event below already covers live inbound notification.

    _socket.on('outreach_started', (data) => {
      _emit('outreach_started', data);
    });

    _socket.on('outreach_stopped', (data) => {
      _emit('outreach_stopped', data);
    });

    _socket.on('campaign_progress', (data) => {
      _emit('campaign_progress', data);
    });

    _socket.on('number_validated', (data) => {
      _emit('number_validated', data);
    });

    _socket.on('validation_complete', (data) => {
      _emit('validation_complete', data);
      Toast.success('Validation Complete', `${data.valid} valid, ${data.invalid} not on WA`);
    });

    _socket.on('pong_server', (data) => {
      _emit('pong_server', data);
    });
  }

  /**
   * Register an event handler
   * @param {string} event
   * @param {Function} callback
   */
  function on(event, callback) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(callback);
  }

  /**
   * Remove an event handler
   */
  function off(event, callback) {
    if (!_handlers[event]) return;
    _handlers[event] = _handlers[event].filter(cb => cb !== callback);
  }

  /** Internal event emitter to registered handlers */
  function _emit(event, data) {
    (_handlers[event] || []).forEach(cb => {
      try { cb(data); } catch (e) { console.error('[Socket] Handler error:', e); }
    });
  }

  /**
   * Emit event to server
   */
  function emit(event, data) {
    if (_socket && _connected) {
      _socket.emit(event, data);
    }
  }

  /** Send heartbeat ping to server */
  function ping() {
    if (_socket && _connected) {
      _socket.emit('ping_server');
    }
  }

  /** Pause the HF queue via socket */
  function pauseQueue() { emit('queue_pause'); }
  /** Resume the HF queue via socket */
  function resumeQueue() { emit('queue_resume'); }
  /** Clear the HF queue via socket */
  function clearQueue() { emit('queue_clear'); }

  /** Update the connection state indicator in UI */
  function _updateConnectionUI(state) {
    const dotEl  = document.getElementById('socket-dot');
    const textEl = document.getElementById('socket-text');
    const waBar  = document.getElementById('wa-status-bar');

    const stateMap = {
      connected:      { dot: 'green',  text: 'Connected' },
      disconnected:   { dot: 'red',    text: 'Disconnected' },
      reconnecting:   { dot: 'yellow', text: 'Reconnecting...' },
      error:          { dot: 'red',    text: 'Error' },
      unknown:        { dot: 'gray',   text: 'Unknown' },
      qr:             { dot: 'yellow', text: 'Scan QR' },
      wa_connected:   { dot: 'green',  text: 'WA Connected' },
      wa_disconnected:{ dot: 'red',    text: 'WA Disconnected' },
      wa_reconnecting:{ dot: 'yellow', text: 'WA Reconnecting...' }
    };

    const s = stateMap[state] || stateMap.unknown;

    if (dotEl) {
      dotEl.className = `live-dot ${s.dot}`;
    }
    if (textEl) {
      textEl.textContent = s.text;
    }

    // Update WA status bar classes
    if (waBar) {
      waBar.className = 'wa-status-bar';
      if (state === 'wa_connected')    waBar.classList.add('connected');
      else if (state === 'wa_disconnected') waBar.classList.add('disconnected');
      else if (state === 'qr')         waBar.classList.add('initializing');
      else if (state === 'wa_reconnecting') waBar.classList.add('initializing');
      else                             waBar.classList.add('unknown');
    }
  }

  let _lastHeartbeat = null;
  function _updateHeartbeat() {
    _lastHeartbeat = Date.now();
    const el = document.getElementById('heartbeat-time');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }

  function isConnected() { return _connected; }
  function getLastHeartbeat() { return _lastHeartbeat; }

  return {
    connect, on, off, emit, ping,
    pauseQueue, resumeQueue, clearQueue,
    isConnected, getLastHeartbeat
  };
})();

window.SocketManager = SocketManager;
