/**
 * WWAS - CSV Import Module
 * Handles file upload drag-drop, progress, and import results
 */

const ImportModule = (() => {
  let _dropzone = null;
  let _fileInput = null;

  function init() {
    document.getElementById('btn-import-csv')?.addEventListener('click', open);
    document.getElementById('import-modal-close')?.addEventListener('click', close);
    document.getElementById('import-overlay')?.addEventListener('click', close);
    document.getElementById('import-confirm-btn')?.addEventListener('click', doImport);

    _dropzone  = document.getElementById('csv-dropzone');
    _fileInput = document.getElementById('csv-file-input');

    if (_dropzone) {
      _dropzone.addEventListener('click', () => _fileInput?.click());
      _dropzone.addEventListener('dragover', (e) => { e.preventDefault(); _dropzone.classList.add('dragover'); });
      _dropzone.addEventListener('dragleave', () => _dropzone.classList.remove('dragover'));
      _dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        _dropzone.classList.remove('dragover');
        const file = e.dataTransfer?.files[0];
        if (file) _onFileSelected(file);
      });
    }

    if (_fileInput) {
      _fileInput.addEventListener('change', () => {
        if (_fileInput.files[0]) _onFileSelected(_fileInput.files[0]);
      });
    }
  }

  function open() {
    const overlay = document.getElementById('import-overlay');
    const modal   = document.getElementById('import-modal');
    if (overlay) overlay.classList.remove('hidden');
    if (modal)   modal.classList.remove('hidden');
    _resetModal();
  }

  function close() {
    document.getElementById('import-overlay')?.classList.add('hidden');
    document.getElementById('import-modal')?.classList.add('hidden');
  }

  function _resetModal() {
    const confirmBtn = document.getElementById('import-confirm-btn');
    const statusEl   = document.getElementById('import-status');
    const fileNameEl = document.getElementById('import-filename');

    if (confirmBtn)  confirmBtn.disabled = true;
    if (statusEl)    statusEl.innerHTML  = '';
    if (fileNameEl)  fileNameEl.textContent = 'No file selected';
    if (_fileInput)  _fileInput.value = '';
  }

  function _onFileSelected(file) {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      Toast.error('Invalid file', 'Please select a .csv file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Toast.error('File too large', 'Maximum size is 10MB');
      return;
    }

    const fileNameEl = document.getElementById('import-filename');
    const confirmBtn = document.getElementById('import-confirm-btn');
    const sizeKb     = (file.size / 1024).toFixed(1);

    if (fileNameEl) fileNameEl.textContent = `${file.name} (${sizeKb} KB)`;
    if (confirmBtn) confirmBtn.disabled = false;

    // Attach file to input for later use
    if (_fileInput && _fileInput.files.length === 0) {
      const dt = new DataTransfer();
      dt.items.add(file);
      _fileInput.files = dt.files;
    }
  }

  async function doImport() {
    const confirmBtn = document.getElementById('import-confirm-btn');
    const statusEl   = document.getElementById('import-status');
    const file       = _fileInput?.files[0];

    if (!file) { Toast.error('No file selected'); return; }

    const restore = Skeleton.btn(confirmBtn, 'Importing...');

    if (statusEl) {
      statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--color-text-muted);font-size:13px;padding:12px 0;">
        <div class="loader loader-sm"></div> Importing leads...
      </div>`;
    }

    const formData = new FormData();
    formData.append('csv_file', file);

    const res = await Utils.upload('/scripts/import_csv.php', formData);
    restore();

    if (!res.success) {
      if (statusEl) statusEl.innerHTML = `<div class="badge badge-red" style="font-size:12px;padding:8px 12px;">${Utils.escHtml(res.error || 'Import failed')}</div>`;
      Toast.error('Import failed', res.error || '');
      return;
    }

    const d = res.data;
    if (statusEl) {
      statusEl.innerHTML = `
        <div style="padding:14px;background:var(--color-green-50);border:1px solid var(--color-green-200);border-radius:10px;margin-top:8px;">
          <div style="font-size:13px;font-weight:700;color:var(--color-green-700);margin-bottom:10px;">✅ Import Complete</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${[['Total Rows', d.total],['Imported', d.imported],['Duplicates', d.duplicates],['Skipped', d.skipped],['Errors', d.error_count]]
              .map(([l,v]) => `<div style="font-size:12px;"><span style="color:var(--color-text-muted);">${Utils.escHtml(l)}:</span> <strong>${Utils.escHtml(String(v??0))}</strong></div>`).join('')}
          </div>
          ${d.errors?.length ? `<div style="margin-top:10px;font-size:11px;color:var(--color-error);">${d.errors.slice(0,5).map(Utils.escHtml).join('<br>')}</div>` : ''}
        </div>`;
    }

    Toast.success('Import Complete!', `${d.imported} leads imported`);

    // Refresh leads list
    setTimeout(() => {
      close();
      LeadsModule?.refresh();
      CampaignModule?.loadStats();
    }, 1500);
  }

  return { init, open, close };
})();

window.ImportModule = ImportModule;
