/**
 * WWAS - Shared Utility Functions
 * Used across all frontend JS modules
 */

const Utils = (() => {

  // ── HTTP Helpers ───────────────────────────────────────────

  /**
   * Fetch JSON from a PHP API endpoint (GET)
   * @param {string} url
   * @param {object} params  Query params object
   * @returns {Promise<object>}
   */
  async function get(url, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
      credentials: 'same-origin'
    });
    return _parseResponse(res);
  }

  /**
   * POST JSON to a PHP API endpoint
   * @param {string} url
   * @param {object} body
   * @returns {Promise<object>}
   */
  async function post(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    });
    return _parseResponse(res);
  }

  /**
   * Upload a file via multipart/form-data
   * @param {string} url
   * @param {FormData} formData
   * @returns {Promise<object>}
   */
  async function upload(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData,
      credentials: 'same-origin'
    });
    return _parseResponse(res);
  }

  async function _parseResponse(res) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = { success: false, error: `HTTP ${res.status}: Server returned non-JSON response` };
    }
    if (!res.ok && data.success === undefined) {
      data.success = false;
      data.error = data.error || `HTTP ${res.status}`;
    }
    return data;
  }

  // ── DOM Helpers ────────────────────────────────────────────

  /** @param {string} sel @param {Element|Document} ctx */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  /** @param {string} sel @param {Element|Document} ctx */
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /**
   * Create element with attributes and children
   * @param {string} tag
   * @param {object} attrs
   * @param  {...(string|Element)} children
   * @returns {Element}
   */
  function el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class')           element.className = v;
      else if (k === 'html')       element.innerHTML = v;
      else if (k === 'text')       element.textContent = v;
      else if (k.startsWith('on')) element.addEventListener(k.slice(2), v);
      else                         element.setAttribute(k, v);
    }
    for (const child of children) {
      if (child == null) continue;
      element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return element;
  }

  /** Show element (remove hidden) */
  function show(el) { if (el) el.classList.remove('hidden'); }
  /** Hide element */
  function hide(el) { if (el) el.classList.add('hidden'); }
  /** Toggle element visibility */
  function toggle(el, force) {
    if (el) el.classList.toggle('hidden', force !== undefined ? !force : undefined);
  }

  // ── String Helpers ─────────────────────────────────────────

  /** Truncate string with ellipsis */
  function truncate(str, len = 80) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len - 3) + '...' : str;
  }

  /** Get initials from business name */
  function initials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/).slice(0, 2);
    return words.map(w => w[0].toUpperCase()).join('');
  }

  /** Escape HTML entities to prevent XSS */
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  /** nl2br: convert newlines to <br> */
  function nl2br(str) {
    return escHtml(str).replace(/\n/g, '<br>');
  }

  // ── Date / Time Helpers ────────────────────────────────────

  /** Format ISO/MySQL datetime to "12 Jan 2025, 04:30 PM" */
  function formatDateTime(str) {
    if (!str || str === 'Never') return 'Never';
    try {
      const d = new Date(str.replace(' ', 'T'));
      return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch { return str; }
  }

  /** Format time only: "04:30 PM" */
  function formatTime(str) {
    if (!str) return '';
    try {
      const d = new Date(str.replace(' ', 'T'));
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return str; }
  }

  // ── Number Helpers ─────────────────────────────────────────

  /** Format large numbers: 1200 → "1.2K" */
  function formatNum(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // ── Misc ───────────────────────────────────────────────────

  /** Debounce a function */
  function debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /** Deep copy an object */
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  /** Copy text to clipboard */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  }

  /** Wait ms milliseconds */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** Get WhatsApp status badge HTML */
  function waBadge(status) {
    const map = {
      valid:          '<span class="badge badge-green"><span class="dot"></span>Valid</span>',
      invalid:        '<span class="badge badge-red"><span class="dot"></span>Invalid</span>',
      not_on_whatsapp:'<span class="badge badge-yellow"><span class="dot"></span>Not on WA</span>',
      pending:        '<span class="badge badge-gray"><span class="dot"></span>Pending</span>',
      failed:         '<span class="badge badge-orange"><span class="dot"></span>Failed</span>',
    };
    return map[status] || `<span class="badge badge-gray">${escHtml(status)}</span>`;
  }

  /** Get outreach status badge HTML */
  function outreachBadge(status) {
    const map = {
      pending: '<span class="badge badge-gray">Pending</span>',
      queued:  '<span class="badge badge-blue">Queued</span>',
      sent:    '<span class="badge badge-green">Sent</span>',
      replied: '<span class="badge badge-green" style="background:#bbf7d0;color:#15803d;">Replied ✓</span>',
      failed:  '<span class="badge badge-red">Failed</span>',
      skipped: '<span class="badge badge-orange">Skipped</span>',
    };
    return map[status] || `<span class="badge badge-gray">${escHtml(status)}</span>`;
  }

  /** Generate star rating HTML */
  function starRating(rating) {
    if (!rating) return '<span class="text-xs text-gray-400">No rating</span>';
    const full = Math.floor(rating);
    const half = rating - full >= 0.5;
    let html = `<span class="text-xs font-semibold text-amber-600">${rating}★</span>`;
    return html;
  }

  return {
    get, post, upload,
    $, $$, el, show, hide, toggle,
    truncate, initials, escHtml, nl2br,
    formatDateTime, formatTime, formatNum,
    debounce, clone, copyText, sleep,
    waBadge, outreachBadge, starRating
  };
})();

// Expose globally
window.Utils = Utils;
