/**
 * csv-import.js — Shared CSV bulk import module for Shelfy
 * Provides a 3-step modal: Upload → Map Fields → Preview & Import
 */
(function () {
  'use strict';

  // ─── Field Definitions ───────────────────────────────────────────────────
  const INGREDIENT_FIELDS = [
    { key: 'name',               label: 'Name',                required: true  },
    { key: 'quantity',           label: 'Quantity',            required: true,  type: 'number' },
    { key: 'cost_per_unit',      label: 'Cost Per Unit',       required: true,  type: 'number' },
    { key: 'min_stock',          label: 'Min Stock Alert',     required: true,  type: 'number' },
    { key: 'category',           label: 'Category',            required: false },
    { key: 'sku',                label: 'SKU / Barcode',       required: false },
    { key: 'estimated_delivery', label: 'Delivery Days',       required: false, type: 'number' },
    { key: 'source_url',         label: 'Source URL',          required: false },
  ];

  const AUTO_MAP_ALIASES = {
    name:               ['name','item','product','title','item name','product name','ingredient','ingredient name','material','supply','component','article name','label'],
    quantity:           ['qty','quantity','stock','amount','count','current stock','on hand','stock qty','inv qty','inventory','current qty','in stock','available'],
    cost_per_unit:      ['cost','price','cost per unit','unit price','price per unit','unit cost','cost/unit','price/unit','rate','value','buying price','purchase price','buy price'],
    min_stock:          ['min','minimum','min stock','reorder','reorder point','alert','min_stock','minimum stock','low stock','threshold','reorder level','safety stock'],
    category:           ['category','cat','type','group','department','section','product type','class'],
    sku:                ['sku','barcode','code','product code','item code','part number','part no','model','ref','reference','article no','article number','product id'],
    estimated_delivery: ['delivery','lead time','days','delivery days','lead days','estimated delivery','lead','turnaround','ship time','delivery time'],
    source_url:         ['url','link','source','supplier url','website','product url','supplier link','supplier website','product link'],
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let state = {
    entityType: 'ingredient',
    headers: [],
    rows: [],
    mapping: {},   // colIndex (number) → fieldKey string
    filename: '',
    step: 1,
  };

  // ─── Auto-mapping ─────────────────────────────────────────────────────────
  function autoMapField(header) {
    const norm = header.toLowerCase().trim().replace(/[_\-\.\/]/g, ' ').replace(/\s+/g, ' ');
    for (const [fieldKey, aliases] of Object.entries(AUTO_MAP_ALIASES)) {
      if (aliases.includes(norm)) return fieldKey;
    }
    const asKey = header.toLowerCase().trim().replace(/\s+/g, '_');
    if (INGREDIENT_FIELDS.some(f => f.key === asKey)) return asKey;
    return '__notes_append';
  }

  // ─── CSV Parser ───────────────────────────────────────────────────────────
  function parseCSV(text) {
    const result = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      row.push(cur.trim());
      result.push(row);
    }
    return result;
  }

  // ─── Modal HTML ───────────────────────────────────────────────────────────
  const MODAL_STYLES = `
<style id="csvImportStyles">
#csvImportModal .modal-content {
  transition: max-width 0.25s ease;
}
.csv-si {
  display:flex; align-items:center; gap:6px;
  font-size:13px; color:var(--text-muted); transition:color 0.2s;
}
.csv-si.active { color:var(--text-main); font-weight:600; }
.csv-si.done   { color:var(--accent); }
.csv-si-num {
  width:22px; height:22px; border-radius:50%;
  border:2px solid var(--border); display:flex; align-items:center;
  justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;
  transition:all 0.2s;
}
.csv-si.active .csv-si-num { border-color:var(--accent); background:var(--accent); color:#fff; }
.csv-si.done   .csv-si-num { border-color:var(--accent); background:var(--accent); color:#fff; }
.csv-si-sep { color:var(--border); font-size:18px; margin:0 10px; user-select:none; }
.csv-map-row {
  display:grid; grid-template-columns:1fr 24px 1fr; align-items:center;
  gap:8px; padding:10px 12px; background:var(--bg-panel);
  border-radius:8px; border:1px solid var(--border);
}
.csv-map-name { font-weight:600; font-size:14px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.csv-map-sample { font-size:11px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
.csv-map-arrow { text-align:center; color:var(--text-muted); font-size:16px; }
.csv-map-sel {
  width:100%; padding:7px 10px; border:1px solid var(--border);
  border-radius:6px; background:var(--bg-main,#fff); color:var(--text-main);
  font-size:13px; cursor:pointer; outline:none;
}
.csv-map-sel:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(99,102,241,0.1); }
.csv-map-sel.req-mapped { border-color:var(--accent); background:rgba(99,102,241,0.04); }
.csv-pt { width:100%; border-collapse:collapse; font-size:13px; }
.csv-pt th {
  padding:8px 12px; background:var(--bg-panel); border-bottom:2px solid var(--border);
  text-align:left; font-size:11px; text-transform:uppercase;
  letter-spacing:0.05em; color:var(--text-muted); white-space:nowrap;
}
.csv-pt td {
  padding:8px 12px; border-bottom:1px solid var(--border);
  max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.csv-pt tr:last-child td { border-bottom:none; }
.csv-pt tr.row-warn td { background:rgba(255,193,7,0.07); }
.csv-pt .missing-val { color:#999; font-style:italic; }
#csvDropZone:hover, #csvDropZone.drag-over {
  border-color:var(--accent) !important;
  background:rgba(99,102,241,0.04) !important;
}
@media(max-width:640px){
  .csv-map-row { grid-template-columns:1fr; gap:6px; }
  .csv-map-arrow { display:none; }
}
</style>`;

  const MODAL_HTML = `
<div class="modal-overlay" id="csvImportModal" onclick="if(event.target===this)window.closeCSVImport()">
  <div class="modal-content" id="csvImportContent" style="max-width:600px;width:95vw;padding:28px 32px;display:flex;flex-direction:column;overflow:hidden;">

    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h3 style="margin:0 0 4px 0;font-size:20px;">Import from CSV</h3>
        <p style="margin:0;font-size:13px;color:var(--text-muted);">Create multiple items at once from a spreadsheet</p>
      </div>
      <button onclick="window.closeCSVImport()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-muted);padding:0 0 0 16px;line-height:1;flex-shrink:0;">&times;</button>
    </div>

    <!-- Step bar -->
    <div id="csvStepBar" style="display:flex;align-items:center;margin-bottom:24px;">
      <div class="csv-si active" id="csvSI1"><span class="csv-si-num">1</span><span>Upload</span></div>
      <div class="csv-si-sep">›</div>
      <div class="csv-si" id="csvSI2"><span class="csv-si-num">2</span><span>Map &amp; Import</span></div>
    </div>

    <!-- ── Step 1: Upload ──────────────────────────────────── -->
    <div id="csvP1">
      <div id="csvDropZone"
        style="border:2px dashed var(--border);border-radius:12px;padding:48px 24px;text-align:center;cursor:pointer;transition:all 0.2s;background:var(--bg-panel);"
        onclick="document.getElementById('csvFileHiddenInput').click()">
        <div style="margin-bottom:16px;color:var(--accent);opacity:0.6;"><i data-lucide="file-spreadsheet" style="width:48px;height:48px;stroke-width:1.5;"></i></div>
        <p style="margin:0 0 6px 0;font-weight:600;font-size:16px;color:var(--text-main);">Drag &amp; drop your CSV file here</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:var(--text-muted);">or click to browse</p>
        <p style="margin:0;font-size:12px;color:var(--text-muted);">Supports .csv · Excel &quot;Save as CSV&quot; works too</p>
        <input type="file" id="csvFileHiddenInput" accept=".csv,text/csv" style="display:none;" onchange="window._csvHandleFile(event.target.files[0])">
      </div>
      <div id="csvP1Error" style="display:none;margin-top:12px;padding:10px 14px;background:#fff0f0;border:1px solid #ffcccc;border-radius:8px;font-size:13px;color:#c0392b;"></div>
      <div style="margin-top:14px;text-align:center;">
        <a href="#" onclick="window._csvDownloadSample();return false;" style="font-size:13px;color:var(--accent);text-decoration:none;">↓ Download sample CSV</a>
      </div>
      <div style="display:flex;gap:12px;margin-top:20px;">
        <button class="btn" style="background:var(--bg-panel);border:1px solid var(--border);color:var(--text-main);flex:1;" onclick="window.closeCSVImport()">Cancel</button>
      </div>
    </div>

    <!-- ── Step 2: Map Fields ──────────────────────────────── -->
    <div id="csvP2" style="display:none;overflow:hidden;display:none;flex-direction:column;">

      <!-- File info bar -->
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-panel);border-radius:8px;border:1px solid var(--border);margin-bottom:14px;">
        <span style="color:var(--text-muted);flex-shrink:0;"><i data-lucide="file-spreadsheet" style="width:22px;height:22px;vertical-align:middle;stroke-width:1.5;display:block;"></i></span>
        <div style="flex:1;min-width:0;">
          <div id="csvFilenameLabel" style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          <div id="csvRowCountLabel" style="font-size:12px;color:var(--text-muted);"></div>
        </div>
        <button onclick="window._csvGoStep(1)" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--text-muted);flex-shrink:0;">Change file</button>
      </div>

      <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-muted);">Only relevant columns for Shelfy are being displayed. Everything else will be ignored.</p>

      <!-- Mapping rows -->
      <div id="csvMapRows" style="display:flex;flex-direction:column;gap:7px;max-height:300px;overflow-y:auto;padding-right:2px;margin-bottom:14px;"></div>

      <!-- Required field warning -->
      <div id="csvReqWarn" style="display:none;padding:10px 14px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;font-size:13px;color:#7d5a00;margin-bottom:14px;"></div>

      <!-- Live preview -->
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:7px;">Live Preview — first 3 rows</div>
        <div id="csvLivePreview" style="overflow-x:auto;border-radius:8px;border:1px solid var(--border);"></div>
      </div>

      <div style="display:flex;gap:12px;">
        <button class="btn" style="background:var(--bg-panel);border:1px solid var(--border);color:var(--text-main);flex:1;" onclick="window._csvGoStep(1)">← Back</button>
        <button class="btn" id="csvImportBtn" style="flex:2;" onclick="window._csvDoImport()">Import <span id="csvImportCount"></span> items</button>
      </div>
    </div>

    <!-- ── Step 3: Done ───────────────────────────────────── -->
    <div id="csvP3" style="display:none;text-align:center;padding:24px 0;">
      <div id="csvDoneIcon" style="margin-bottom:16px;"></div>
      <div id="csvDoneTitle" style="font-size:20px;font-weight:700;margin-bottom:8px;"></div>
      <div id="csvDoneMsg" style="font-size:14px;color:var(--text-muted);margin-bottom:24px;line-height:1.5;"></div>
      <button class="btn" style="min-width:160px;" onclick="window.closeCSVImport()">Done</button>
    </div>

  </div>
</div>`;

  // ─── Inject modal into DOM ────────────────────────────────────────────────
  function injectModal() {
    if (document.getElementById('csvImportModal')) return;
    if (!document.getElementById('csvImportStyles')) {
      document.head.insertAdjacentHTML('beforeend', MODAL_STYLES);
    }
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const dz = document.getElementById('csvDropZone');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) window._csvHandleFile(e.dataTransfer.files[0]);
      });
    }
  }

  // ─── Public: open / close ─────────────────────────────────────────────────
  function openCSVImport(entityType) {
    state.entityType = entityType || 'ingredient';
    state.headers = [];
    state.rows    = [];
    state.mapping = {};
    state.filename = '';
    state.step    = 1;

    injectModal();

    // Reset file input
    const fi = document.getElementById('csvFileHiddenInput');
    if (fi) fi.value = '';

    // Reset step bar visibility
    const sb = document.getElementById('csvStepBar');
    if (sb) sb.style.display = '';

    _goStep(1);
    document.getElementById('csvImportModal').classList.add('active');
  }

  function closeCSVImport() {
    const m = document.getElementById('csvImportModal');
    if (m) m.classList.remove('active');
  }

  // ─── Step navigation ──────────────────────────────────────────────────────
  function _goStep(n) {
    state.step = n;

    // Step indicators (only 2 in bar)
    for (let i = 1; i <= 2; i++) {
      const el = document.getElementById('csvSI' + i);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (i < n) el.classList.add('done');
      else if (i === n) el.classList.add('active');
    }

    // Panels: 1=upload (flex), 2=map (flex), 3=done (block)
    [1, 2, 3].forEach(i => {
      const p = document.getElementById('csvP' + i);
      if (!p) return;
      if (i === n) {
        p.style.display = i < 3 ? 'flex' : 'block';
        if (i < 3) p.style.flexDirection = 'column';
      } else {
        p.style.display = 'none';
      }
    });

    // Modal width
    const c = document.getElementById('csvImportContent');
    if (c) c.style.maxWidth = n === 2 ? '900px' : '600px';

    if (n === 2) { _renderMapStep(); if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }

  // ─── Step 1: file handling ────────────────────────────────────────────────
  function _handleFile(file) {
    if (!file) return;
    const name = file.name || '';
    if (!name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      _p1Error('Please upload a .csv file (e.g. exported from Excel or Google Sheets).');
      return;
    }
    state.filename = name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parseCSV(e.target.result);
        if (parsed.length < 2) {
          _p1Error('The file appears to be empty or has only a header row with no data.');
          return;
        }
        state.headers = parsed[0].map(h => h.trim());
        state.rows    = parsed.slice(1).filter(r => r.some(v => v && v.trim()));
        if (state.rows.length === 0) {
          _p1Error('No data rows found after the header.');
          return;
        }
        state.mapping = {};
        state.headers.forEach((h, i) => { const m = autoMapField(h); state.mapping[i] = m === '__notes_append' ? '__ignore' : m; });
        _clearP1Error();
        _goStep(2);
      } catch (err) {
        _p1Error('Could not parse the file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function _p1Error(msg) {
    const el = document.getElementById('csvP1Error');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }
  function _clearP1Error() {
    const el = document.getElementById('csvP1Error');
    if (el) el.style.display = 'none';
  }

  // ─── Step 2: mapping ──────────────────────────────────────────────────────
  function _renderMapStep() {
    document.getElementById('csvFilenameLabel').textContent = state.filename;
    document.getElementById('csvRowCountLabel').textContent =
      state.rows.length + ' data row' + (state.rows.length !== 1 ? 's' : '') + ' detected';
    const countEl = document.getElementById('csvImportCount');
    if (countEl) countEl.textContent = state.rows.length;

    const container = document.getElementById('csvMapRows');
    container.innerHTML = '';

    state.headers.forEach((header, colIdx) => {
      if (state.mapping[colIdx] === '__ignore') return;
      const samples = state.rows.slice(0, 3)
        .map(r => (r[colIdx] || '').trim()).filter(Boolean)
        .slice(0, 3).join(', ');
      const cur = state.mapping[colIdx] || '__ignore';

      const row = document.createElement('div');
      row.className = 'csv-map-row';
      row.innerHTML =
        '<div class="csv-map-col-info" style="min-width:0;">' +
          '<div class="csv-map-name">' + _esc(header) + '</div>' +
          (samples ? '<div class="csv-map-sample">e.g. ' + _esc(samples) + '</div>' : '') +
        '</div>' +
        '<div class="csv-map-arrow">→</div>' +
        '<div>' +
          '<select class="csv-map-sel" data-colidx="' + colIdx + '" onchange="window._csvUpdateMap(' + colIdx + ',this.value)">' +
            _buildOptions(cur) +
          '</select>' +
        '</div>';
      container.appendChild(row);
      _refreshSelectStyle(colIdx, cur);
    });

    _renderLivePreview();
    _checkReqWarn();
  }

  function _buildOptions(selectedKey) {
    const req = INGREDIENT_FIELDS.filter(f => f.required);
    const opt = INGREDIENT_FIELDS.filter(f => !f.required);
    const sel = k => k === selectedKey ? ' selected' : '';

    return '<option value="__ignore"' + sel('__ignore') + '>— Ignore this column —</option>' +
           '<option disabled>──────────────</option>' +
           req.map(f => '<option value="' + f.key + '"' + sel(f.key) + '>' + f.label + ' *</option>').join('') +
           '<option disabled>──────────────</option>' +
           opt.map(f => '<option value="' + f.key + '"' + sel(f.key) + '>' + f.label + '</option>').join('');
  }

  function _updateMap(colIdx, fieldKey) {
    state.mapping[colIdx] = fieldKey;
    _refreshSelectStyle(colIdx, fieldKey);
    _renderLivePreview();
    _checkReqWarn();
  }

  function _refreshSelectStyle(colIdx, fieldKey) {
    const sel = document.querySelector('[data-colidx="' + colIdx + '"]');
    if (!sel) return;
    const isReq = INGREDIENT_FIELDS.some(f => f.key === fieldKey && f.required);
    sel.classList.toggle('req-mapped', isReq);
  }

  function _checkReqWarn() {
    const mapped = new Set(Object.values(state.mapping));
    const missing = INGREDIENT_FIELDS.filter(f => f.required && !mapped.has(f.key));
    const warn = document.getElementById('csvReqWarn');
    if (!warn) return;
    if (missing.length) {
      warn.style.display = '';
      warn.innerHTML = '<strong>Required fields not yet mapped:</strong> ' +
        missing.map(f => f.label).join(', ') +
        '. These rows will use default values (0 or "Unnamed") if left unmapped.';
    } else {
      warn.style.display = 'none';
    }
  }

  function _renderLivePreview() {
    const container = document.getElementById('csvLivePreview');
    if (!container) return;

    const visibleCols = Object.entries(state.mapping)
      .filter(([, fk]) => fk !== '__ignore')
      .map(([idx, fk]) => ({ idx: +idx, fk }));

    if (visibleCols.length === 0) {
      container.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:13px;margin:0;">Map at least one column to see a preview.</p>';
      return;
    }

    const previewRows = state.rows.slice(0, 3);

    let html = '<table class="csv-pt"><thead><tr>';
    for (const col of visibleCols) {
      const label = INGREDIENT_FIELDS.find(f => f.key === col.fk)?.label || col.fk;
      html += '<th>' + _esc(label) + '</th>';
    }
    html += '</tr></thead><tbody>';
    for (const row of previewRows) {
      html += '<tr>';
      for (const col of visibleCols) {
        const val = (row[col.idx] || '').trim();
        html += '<td>' + (val ? _esc(val) : '<span class="missing-val">—</span>') + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function _getMapped(row, fieldKey) {
    for (const [idx, fk] of Object.entries(state.mapping)) {
      if (fk === fieldKey) return (row[+idx] || '').trim();
    }
    return '';
  }

  function _buildRecord(row) {
    return {
      name:               _getMapped(row, 'name') || 'Unnamed',
      quantity:           parseFloat(_getMapped(row, 'quantity'))           || 0,
      cost_per_unit:      parseFloat(_getMapped(row, 'cost_per_unit'))      || 0,
      min_stock:          parseFloat(_getMapped(row, 'min_stock'))          || 0,
      category:           _getMapped(row, 'category')           || 'General',
      sku:                _getMapped(row, 'sku')                || '',
      estimated_delivery: parseFloat(_getMapped(row, 'estimated_delivery')) || null,
      source_url:         _getMapped(row, 'source_url')         || '',
    };
  }

  // ─── Step 4: import ───────────────────────────────────────────────────────
  async function _doImport() {
    const btn = document.getElementById('csvImportBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('You must be logged in to import.');

      if (!window.currentStoreId && typeof ensureStoreExists === 'function') {
        await ensureStoreExists(user);
      }
      const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');

      const records = state.rows.map(row => {
        const rec = _buildRecord(row);
        return {
          profile_id:         user.id,
          store_id:           storeId,
          name:               rec.name,
          quantity:           rec.quantity,
          cost_per_unit:      rec.cost_per_unit,
          min_stock:          rec.min_stock,
          category:           rec.category,
          sku:                rec.sku,
          estimated_delivery: rec.estimated_delivery,
          source_url:         rec.source_url,
          type:               'Production',
        };
      });

      let inserted = 0;
      const BATCH  = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        const { data, error } = await supabaseClient
          .from('ingredients')
          .insert(records.slice(i, i + BATCH))
          .select('id');
        if (error) throw error;
        inserted += (data || []).length;
      }

      if (typeof loadIngredients === 'function') loadIngredients();
      _showDone(true, inserted);
    } catch (err) {
      console.error('[csv-import] error:', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Import ' + state.rows.length + ' items'; }
      _showDone(false, 0, err.message);
    }
  }

  function _showDone(ok, count, errMsg) {
    _goStep(3);
    const sb = document.getElementById('csvStepBar');
    if (sb) sb.style.display = 'none';

    const iconEl = document.getElementById('csvDoneIcon');
    iconEl.innerHTML = ok
      ? '<i data-lucide="circle-check" style="width:56px;height:56px;stroke-width:1.5;color:#22c55e;"></i>'
      : '<i data-lucide="circle-x" style="width:56px;height:56px;stroke-width:1.5;color:#ef4444;"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons({ el: iconEl });
    document.getElementById('csvDoneTitle').textContent = ok
      ? count + ' item' + (count !== 1 ? 's' : '') + ' imported!'
      : 'Import failed';
    document.getElementById('csvDoneMsg').textContent   = ok
      ? 'All items have been added to your inventory. You can find them in the list now.'
      : (errMsg || 'Something went wrong. Please try again.');
  }

  // ─── Sample CSV download ──────────────────────────────────────────────────
  function _downloadSample() {
    const rows = [
      'name,quantity,cost_per_unit,category,sku,min_stock',
      '"Red Fabric Roll",50,4.99,Apparel,FAB-001,10',
      '"Gold Thread",200,1.25,Apparel,THR-002,20',
      '"Cardboard Box S",100,0.50,Boxes,BOX-003,30',
      '"Pine Wood Plank",25,8.75,Wood,WD-004,5',
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'shelfy_import_sample.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── Expose globals ───────────────────────────────────────────────────────
  window.openCSVImport     = openCSVImport;
  window.closeCSVImport    = closeCSVImport;
  window._csvHandleFile    = _handleFile;
  window._csvGoStep        = _goStep;
  window._csvUpdateMap     = _updateMap;
  window._csvDoImport      = _doImport;
  window._csvDownloadSample = _downloadSample;

})();
