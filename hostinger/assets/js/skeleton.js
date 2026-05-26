/**
 * WWAS - Loading Skeleton Manager
 * Renders shimmer skeletons while data loads
 */

const Skeleton = (() => {

  /**
   * Render n lead card skeletons into a container
   * @param {Element} container
   * @param {number} count
   */
  function leads(container, count = 5) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => `
      <div class="skeleton-card" style="margin-bottom:2px;border-radius:0;border-left:none;border-right:none;">
        <div class="flex items-center gap-3">
          <div class="skeleton skeleton-circle" style="width:38px;height:38px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div class="skeleton skeleton-text" style="width:65%;margin-bottom:6px;"></div>
            <div class="skeleton skeleton-text" style="width:80%;height:11px;"></div>
          </div>
          <div style="flex-shrink:0;text-align:right;">
            <div class="skeleton skeleton-text" style="width:36px;height:10px;margin-bottom:6px;"></div>
            <div class="skeleton" style="width:48px;height:18px;border-radius:999px;"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render KPI card skeletons
   * @param {Element} container
   * @param {number} count
   */
  function kpis(container, count = 4) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-text" style="width:50%;height:10px;margin-bottom:10px;"></div>
        <div class="skeleton skeleton-title" style="width:40%;height:24px;margin-bottom:6px;"></div>
        <div class="skeleton skeleton-text" style="width:70%;height:10px;"></div>
      </div>
    `).join('');
  }

  /**
   * Render chat message skeletons
   * @param {Element} container
   */
  function messages(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;padding:20px;">
        <div style="display:flex;justify-content:flex-end;">
          <div class="skeleton" style="width:60%;height:60px;border-radius:18px 18px 4px 18px;"></div>
        </div>
        <div style="display:flex;justify-content:flex-start;">
          <div class="skeleton" style="width:50%;height:44px;border-radius:18px 18px 18px 4px;"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <div class="skeleton" style="width:40%;height:36px;border-radius:18px 18px 4px 18px;"></div>
        </div>
        <div style="display:flex;justify-content:flex-start;">
          <div class="skeleton" style="width:65%;height:80px;border-radius:18px 18px 18px 4px;"></div>
        </div>
      </div>
    `;
  }

  /**
   * Render right panel detail skeleton
   * @param {Element} container
   */
  function details(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="padding:20px;display:flex;flex-direction:column;gap:16px;">
        <div class="flex items-center gap-3">
          <div class="skeleton skeleton-circle" style="width:48px;height:48px;"></div>
          <div style="flex:1;">
            <div class="skeleton skeleton-title" style="width:60%;margin-bottom:8px;"></div>
            <div class="skeleton skeleton-text" style="width:40%;"></div>
          </div>
        </div>
        ${Array.from({length:3},()=>`
          <div class="skeleton-card">
            <div class="skeleton skeleton-text" style="width:30%;height:10px;margin-bottom:8px;"></div>
            <div class="skeleton skeleton-text" style="width:90%;margin-bottom:4px;"></div>
            <div class="skeleton skeleton-text" style="width:75%;"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Replace content with inline spinner
   * @param {Element} el
   * @param {string} size 'sm'|'md'|'lg'
   */
  function spinner(el, size = 'md') {
    if (!el) return;
    const cls = size === 'sm' ? 'loader-sm' : size === 'lg' ? 'loader-lg' : '';
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:32px;">
      <div class="loader ${cls}"></div>
    </div>`;
  }

  /**
   * Show inline button loading state
   * @param {Element} btn
   * @param {string} loadingText
   * @returns {Function} restore function
   */
  function btn(btn, loadingText = 'Loading...') {
    if (!btn) return () => {};
    const original = btn.innerHTML;
    const disabled  = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = `<div class="loader loader-sm" style="border-top-color:#fff;margin-right:6px;"></div>${Utils.escHtml(loadingText)}`;
    return () => {
      btn.disabled = disabled;
      btn.innerHTML = original;
    };
  }

  return { leads, kpis, messages, details, spinner, btn };
})();

window.Skeleton = Skeleton;
