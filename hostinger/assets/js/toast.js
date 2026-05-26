/**
 * WWAS - Toast Notification System
 * Premium slide-in toast notifications with icons and auto-dismiss
 */

const Toast = (() => {
  let container = null;

  function _getContainer() {
    if (!container) {
      container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
    }
    return container;
  }

  const ICONS = {
    success: `<svg viewBox="0 0 20 20" fill="currentColor" class="toast-icon">
      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
    </svg>`,
    error: `<svg viewBox="0 0 20 20" fill="currentColor" class="toast-icon">
      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/>
    </svg>`,
    warning: `<svg viewBox="0 0 20 20" fill="currentColor" class="toast-icon">
      <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
    </svg>`,
    info: `<svg viewBox="0 0 20 20" fill="currentColor" class="toast-icon">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd"/>
    </svg>`
  };

  const CLOSE_ICON = `<svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
  </svg>`;

  /**
   * Show a toast notification
   * @param {string} type     'success' | 'error' | 'warning' | 'info'
   * @param {string} title
   * @param {string} [message]
   * @param {number} [duration=4000]  ms before auto-dismiss (0 = no auto-dismiss)
   */
  function show(type, title, message = '', duration = 4000) {
    const c = _getContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      ${ICONS[type] || ICONS.info}
      <div class="toast-content">
        <div class="toast-title">${Utils.escHtml(title)}</div>
        ${message ? `<div class="toast-message">${Utils.escHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close">${CLOSE_ICON}</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => dismiss(toast));

    c.appendChild(toast);

    // Play notification sound if enabled
    _playSound(type);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => dismiss(toast), duration);
    }

    return toast;
  }

  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('exit');
    setTimeout(() => toast.parentNode?.removeChild(toast), 300);
  }

  function _playSound(type) {
    try {
      const notifSound = window.WWAS_CONFIG?.notification_sound;
      if (!notifSound || notifSound === '0') return;
      if (type !== 'success' && type !== 'info') return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(type === 'success' ? 880 : 660, ctx.currentTime);
      osc.frequency.setValueAtTime(type === 'success' ? 1100 : 880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* Audio not available */ }
  }

  // Shorthand methods
  const success = (title, msg, dur)  => show('success', title, msg, dur);
  const error   = (title, msg, dur)  => show('error',   title, msg, dur);
  const warning = (title, msg, dur)  => show('warning', title, msg, dur);
  const info    = (title, msg, dur)  => show('info',    title, msg, dur);

  return { show, dismiss, success, error, warning, info };
})();

window.Toast = Toast;
