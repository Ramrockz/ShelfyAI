/**
 * csv-import.js — full-page "Import items from CSV" wizard.
 * Desktop-oriented (wide mapping table, real pointer for column matching).
 * Public API unchanged from the old modal version: window.openCSVImport(),
 * window.closeCSVImport() — both host pages (ingredients.html/operations.html)
 * call these through the shared method-picker sheet, so neither needed
 * updating for this rewrite.
 *
 * Five stages: pick -> map -> preview -> work -> done. The real capability
 * the old version didn't have: a row whose SKU matches an existing
 * ingredient is an UPDATE (quantity/price overwritten), not a duplicate --
 * and a row missing something required is SKIPPED with a stated reason
 * instead of silently inserting with placeholder values.
 */
(function () {
  'use strict';

  // ─── Field definitions ────────────────────────────────────────────────────
  const FIELDS = [
    { key: 'name',               label: 'Name',          required: true },
    { key: 'quantity',           label: 'Quantity',      required: true,  number: true },
    { key: 'cost_per_unit',      label: 'Unit price',    required: true,  number: true },
    { key: 'min_stock',          label: 'Alert level',   required: false, number: true },
    { key: 'category',           label: 'Category',      required: false },
    { key: 'sku',                label: 'SKU',           required: false },
    { key: 'variant',            label: 'Variant',       required: false },
    { key: 'supplier',           label: 'Supplier',      required: false },
    { key: 'estimated_delivery', label: 'Delivery days', required: false, number: true },
    { key: 'source_url',         label: 'Source URL',    required: false },
  ];
  const REQUIRED_KEYS = FIELDS.filter(f => f.required).map(f => f.key);
  const fieldLabel = key => FIELDS.find(f => f.key === key)?.label || key;

  // Aliases include German terms -- this user's real spreadsheets are
  // German-locale exports (semicolon-delimited, comma-decimal), confirmed
  // from the reference design's own sample data.
  const ALIASES = {
    name:               ['name','item','product','title','item name','product name','ingredient','material','artikel','artikelname','bezeichnung','produkt','produktname'],
    quantity:           ['qty','quantity','stock','amount','on hand','in stock','current stock','bestand','menge','lagerbestand','lagermenge','anzahl'],
    cost_per_unit:      ['cost','price','unit price','unit cost','cost per unit','ek netto','ek preis','einkaufspreis','preis','kosten','stückpreis'],
    min_stock:          ['min','minimum','min stock','reorder point','alert','threshold','mindest','mindestbestand','meldebestand'],
    category:           ['category','cat','type','group','kategorie','warengruppe','produktart'],
    sku:                ['sku','barcode','code','product code','item code','part number','art.-nr.','art nr','artikelnummer','artikel-nr','artikelnr'],
    variant:            ['variant','variante','option','ausführung','ausfuehrung'],
    supplier:           ['supplier','vendor','lieferant','hersteller'],
    estimated_delivery: ['delivery','lead time','delivery days','lead days','lieferzeit','lieferdauer'],
    source_url:         ['url','link','source','website','quelle','bezugsquelle'],
  };

  function autoMap(header) {
    const norm = header.toLowerCase().trim().replace(/[_\-./]/g, ' ').replace(/\s+/g, ' ');
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(norm)) return key;
    }
    return null;
  }

  // ─── CSV parsing (delimiter-aware, locale-aware numbers) ──────────────────
  function detectDelimiter(headerLine) {
    let comma = 0, semi = 0, inQ = false;
    for (let i = 0; i < headerLine.length; i++) {
      const ch = headerLine[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === ',') comma++;
      else if (!inQ && ch === ';') semi++;
    }
    return semi > comma ? ';' : ',';
  }

  function parseCSV(text, delim) {
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
        } else if (ch === delim && !inQ) { row.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      row.push(cur.trim());
      result.push(row);
    }
    return result;
  }

  // "16,47" (German) and "16.47" (US) both need to work; "1.234,56"/"1,234.56"
  // (thousands separators) too -- whichever of , or . appears LAST is the
  // decimal point, the other (if present) is a thousands separator to strip.
  function parseLocaleNumber(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim().replace(/[^\d,.\-]/g, '');
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  let state = null;
  function freshState() {
    return {
      entityType: 'ingredient',
      filename: '', fileSize: '', delimiter: ',',
      headers: [], rows: [],
      mapping: {},        // colIdx -> fieldKey | null
      stage: 'pick',      // pick | map | preview | work | done
      showAllRows: false,
      verdicts: [],       // [{ n, name, note, tone, kind:'new'|'update'|'skip', record, matchedId, before }]
      counts: { new: 0, update: 0, skip: 0 },
      pct: 0, running: false,
      result: null,       // { updated: [...], skippedCsv: string }
      dstPickerCol: null,
    };
  }

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const chev = '<svg class="m-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="16" height="16"><polyline points="9 6 15 12 9 18"/></svg>';
  const arrowIcon = '<svg class="m-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="4" y1="12" x2="18" y2="12"/><polyline points="13 7 18 12 13 17"/></svg>';
  const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><line x1="12" y1="7.6" x2="12" y2="7.7"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16"><path d="M12 3.6L1.8 20.4h20.4z"/><line x1="12" y1="10" x2="12" y2="15"/><line x1="12" y1="17.6" x2="12" y2="17.7"/></svg>';

  const mappedFields = () => new Set(Object.values(state.mapping).filter(Boolean));
  const missingRequired = () => REQUIRED_KEYS.filter(k => !mappedFields().has(k));
  const colForField = key => Object.entries(state.mapping).find(([, v]) => v === key)?.[0];
  const cellFor = (row, key) => { const c = colForField(key); return c != null ? (row[c] || '').trim() : ''; };

  // ─── Styles + frame markup (self-contained; injected once) ────────────────
  const STYLE_ID = 'csvImportStyles';
  const STYLES = `
#csvImportFrame { position:fixed; inset:0; z-index:999999999; display:none; flex-direction:column;
  background:var(--bg-app, var(--bg-inner)); color:var(--text-main); }
#csvImportFrame.open { display:flex; }
#csvImportFrame .wrap { width:100%; max-width:920px; margin:0 auto; padding:0 28px; box-sizing:border-box; }
#csvImportFrame .im-head { flex-shrink:0; background:var(--bg-panel); border-bottom:1px solid var(--border-hair, var(--border)); }
#csvImportFrame .im-bar { min-height:62px; display:flex; align-items:center; gap:6px; margin-left:-10px; }
#csvImportFrame .im-back { width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:none; border:none; color:var(--text-main); }
#csvImportFrame .im-titles { flex:1; min-width:0; display:flex; flex-direction:column; }
#csvImportFrame .im-title { display:block; font-size:19px; font-weight:800; letter-spacing:-.02em; }
#csvImportFrame .im-sub { display:block; font-size:11.5px; color:var(--text-faint, var(--text-muted)); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .steps { display:flex; gap:5px; padding:0 4px 12px; }
#csvImportFrame .steps i { flex:1; height:3px; border-radius:99px; background:var(--bg-inner); }
#csvImportFrame .steps i[data-on="1"] { background:var(--accent); }
#csvImportFrame .im-scroll { flex:1; overflow-y:auto; padding-bottom:8px; }
#csvImportFrame .im-sec-head { display:flex; align-items:baseline; padding:22px 4px 9px; }
#csvImportFrame .im-sec-title { font-size:11px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:var(--text-muted); }
#csvImportFrame .im-sec-note { margin-left:auto; font-size:11.5px; color:var(--text-faint, var(--text-muted)); }
#csvImportFrame .im-note { padding:16px 4px 30px; font-size:12.5px; color:var(--text-faint, var(--text-muted)); line-height:1.55; }
#csvImportFrame .drop { border:1.5px dashed var(--border); border-radius:18px; background:var(--bg-panel); padding:52px 24px; text-align:center; }
#csvImportFrame .drop[data-over="1"] { border-color:var(--accent-deep, var(--accent)); background:var(--accent-glow, rgba(6,182,212,.08)); }
#csvImportFrame .drop svg { color:var(--text-faint, var(--text-muted)); }
#csvImportFrame .drop-l { font-size:15px; font-weight:700; letter-spacing:-.01em; margin-top:11px; }
#csvImportFrame .drop-s { font-size:12.5px; color:var(--text-muted); margin-top:5px; line-height:1.5; }
#csvImportFrame .drop-btn { margin-top:14px; height:44px; padding:0 20px; border-radius:12px; border:none; background:var(--accent-deep, var(--accent)); color:#fff; font-size:14.5px; font-weight:800; cursor:pointer; }
#csvImportFrame .tmpl { margin-top:12px; display:flex; align-items:center; gap:13px; background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); border-radius:13px; padding:14px 18px; }
#csvImportFrame .tmpl svg { flex-shrink:0; color:var(--accent-deep, var(--accent)); }
#csvImportFrame .tmpl-m { flex:1; min-width:0; }
#csvImportFrame .tmpl-n { display:block; font-size:13.5px; font-weight:700; letter-spacing:-.01em; }
#csvImportFrame .tmpl-s { display:block; font-size:11.5px; color:var(--text-faint, var(--text-muted)); margin-top:3px; }
#csvImportFrame .tmpl button { flex-shrink:0; height:34px; padding:0 12px; border-radius:10px; border:1px solid var(--border); background:var(--bg-panel); font-size:12.5px; font-weight:800; color:var(--accent-ink, var(--accent-deep, var(--accent))); cursor:pointer; }
#csvImportFrame .file { display:flex; align-items:center; gap:13px; background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); border-radius:14px; padding:14px 18px; }
#csvImportFrame .file-ic { width:38px; height:38px; flex-shrink:0; border-radius:10px; background:var(--bg-inner); display:flex; align-items:center; justify-content:center; color:var(--accent-ink, var(--accent-deep, var(--accent))); font:800 10px ui-monospace,Menlo,monospace; }
#csvImportFrame .file-m { flex:1; min-width:0; }
#csvImportFrame .file-n { display:block; font-size:14px; font-weight:700; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .file-s { display:block; font-size:11.5px; color:var(--text-muted); margin-top:3px; }
#csvImportFrame .file button { flex-shrink:0; width:34px; height:34px; border:none; border-radius:10px; background:none; color:var(--text-faint, var(--text-muted)); display:flex; align-items:center; justify-content:center; cursor:pointer; }
#csvImportFrame .map { background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); border-radius:16px; overflow:hidden; }
#csvImportFrame .m-row { display:flex; align-items:center; gap:18px; width:100%; min-height:62px; padding:11px 18px; text-align:left; background:var(--bg-panel); border:none; border-bottom:1px solid var(--border-hair, var(--border)); cursor:pointer; font:inherit; color:inherit; }
#csvImportFrame .m-row:last-child { border-bottom:none; }
#csvImportFrame .m-row:hover { background:var(--bg-inner); }
#csvImportFrame .m-src { width:250px; flex-shrink:0; min-width:0; }
#csvImportFrame .m-src-h { display:block; font-size:13px; font-weight:800; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .m-src-x { display:block; font-size:11px; color:var(--text-faint, var(--text-muted)); margin-top:3px; font-family:ui-monospace,Menlo,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .m-arrow { flex-shrink:0; color:var(--text-ghost, var(--border)); }
#csvImportFrame .m-dst { flex:1; min-width:0; font-size:13.5px; font-weight:700; letter-spacing:-.01em; text-align:left; }
#csvImportFrame .m-dst small { display:block; font-size:11px; font-weight:600; color:var(--text-faint, var(--text-muted)); margin-top:3px; }
#csvImportFrame .m-dst[data-state="off"] { color:var(--text-faint, var(--text-muted)); font-weight:600; }
#csvImportFrame .m-dst[data-state="need"] { color:var(--danger); }
#csvImportFrame .m-chev { flex-shrink:0; color:var(--text-ghost, var(--border)); }
#csvImportFrame .m-req { display:inline-block; margin-left:5px; font-size:10.5px; font-weight:800; color:var(--text-faint, var(--text-muted)); letter-spacing:.04em; text-transform:uppercase; }
#csvImportFrame .rows { background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); border-radius:16px; overflow:hidden; }
#csvImportFrame .r-row { display:flex; align-items:center; gap:16px; padding:13px 18px; border-bottom:1px solid var(--border-hair, var(--border)); }
#csvImportFrame .r-row:last-child { border-bottom:none; }
#csvImportFrame .r-num { width:26px; flex-shrink:0; font:600 11px ui-monospace,Menlo,monospace; color:var(--text-ghost, var(--border)); }
#csvImportFrame .r-m { flex:1; min-width:0; }
#csvImportFrame .r-n { display:block; font-size:13.5px; font-weight:700; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .r-s { display:block; font-size:11.5px; color:var(--text-faint, var(--text-muted)); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .r-s[data-tone="warn"] { color:var(--warning); font-weight:600; }
#csvImportFrame .r-s[data-tone="bad"] { color:var(--danger); font-weight:600; }
#csvImportFrame .r-tag { flex-shrink:0; height:22px; padding:0 9px; border-radius:7px; background:var(--bg-inner); color:var(--text-muted); font-size:10.5px; font-weight:800; letter-spacing:.03em; text-transform:uppercase; display:flex; align-items:center; }
#csvImportFrame .r-tag[data-tone="new"] { background:rgba(16,185,129,.12); color:var(--success); }
#csvImportFrame .r-tag[data-tone="warn"] { background:rgba(245,158,11,.14); color:var(--warning); }
#csvImportFrame .r-tag[data-tone="bad"] { background:rgba(239,68,68,.12); color:var(--danger); }
#csvImportFrame .r-more { display:block; width:100%; padding:12px 13px; background:var(--bg-panel); border:none; border-top:1px solid var(--border-hair, var(--border)); font-size:12.5px; font-weight:800; color:var(--accent-ink, var(--accent-deep, var(--accent))); text-align:center; cursor:pointer; }
#csvImportFrame .host { margin-top:12px; display:flex; align-items:flex-start; gap:11px; border-radius:13px; padding:13px 18px; font-size:13px; line-height:1.5; background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); color:var(--text-muted); }
#csvImportFrame .host b { color:var(--text-main); font-weight:800; }
#csvImportFrame .host svg { flex-shrink:0; margin-top:1px; color:var(--accent-deep, var(--accent)); }
#csvImportFrame .host[data-tone="bad"] { background:rgba(239,68,68,.06); border-color:rgba(220,38,38,.22); color:var(--danger); }
#csvImportFrame .host[data-tone="bad"] b, #csvImportFrame .host[data-tone="bad"] svg { color:var(--danger); }
#csvImportFrame .work { background:var(--bg-panel); border:1px solid var(--border-hair, var(--border)); border-radius:14px; padding:14px; }
#csvImportFrame .work-l { font-size:13.5px; font-weight:700; }
#csvImportFrame .work-s { font-size:12px; color:var(--text-muted); margin-top:4px; }
#csvImportFrame .work-track { height:4px; border-radius:99px; background:var(--bg-inner); margin-top:11px; overflow:hidden; }
#csvImportFrame .work-track i { display:block; height:100%; border-radius:99px; background:var(--accent); transition:width .2s linear; }
#csvImportFrame .ok-ic { width:44px; height:44px; margin:22px auto 0; border-radius:99px; background:rgba(16,185,129,.12); color:var(--success); display:flex; align-items:center; justify-content:center; }
#csvImportFrame .ok-t { text-align:center; font-size:19px; font-weight:800; letter-spacing:-.025em; margin-top:14px; padding:0 24px; line-height:1.25; }
#csvImportFrame .ok-s { text-align:center; font-size:12.5px; color:var(--text-faint, var(--text-muted)); margin-top:6px; }
#csvImportFrame .tally3 { display:flex; justify-content:center; gap:52px; margin:20px 0 0; padding-bottom:20px; border-bottom:1px solid var(--border-hair, var(--border)); }
#csvImportFrame .t-i { text-align:center; }
#csvImportFrame .t-v { display:block; font-size:20px; font-weight:800; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
#csvImportFrame .t-v[data-tone="bad"] { color:var(--danger); }
#csvImportFrame .t-l { display:block; font-size:11px; color:var(--text-faint, var(--text-muted)); margin-top:5px; }
#csvImportFrame .im-foot { flex-shrink:0; background:var(--bg-panel); border-top:1px solid var(--border-hair, var(--border)); padding:14px 0; }
#csvImportFrame .im-foot .wrap { display:flex; align-items:center; gap:16px; }
#csvImportFrame .im-tally { display:flex; align-items:baseline; gap:10px; min-width:0; flex:1; }
#csvImportFrame .im-tally-l { font-size:13.5px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#csvImportFrame .im-tally-r { font-size:13.5px; font-weight:700; flex-shrink:0; color:var(--text-faint, var(--text-muted)); font-variant-numeric:tabular-nums; }
#csvImportFrame .im-cta { flex-shrink:0; height:46px; padding:0 26px; border:none; border-radius:12px; background:var(--accent-deep, var(--accent)); color:#fff; font-size:15px; font-weight:800; letter-spacing:-.01em; cursor:pointer; }
#csvImportFrame .im-cta:disabled { background:var(--bg-inner); color:var(--text-faint, var(--text-muted)); cursor:default; }
#csvImportFrame .im-ghost { flex-shrink:0; height:46px; padding:0 14px; background:none; border:none; color:var(--text-muted); font-size:13.5px; font-weight:600; cursor:pointer; }
#csvDstSheet .cd-row { display:flex; align-items:center; gap:12px; height:48px; padding:0 16px; border-radius:12px; cursor:pointer; border:none; background:none; width:100%; text-align:left; font:inherit; color:var(--text-main); }
#csvDstSheet .cd-row:hover, #csvDstSheet .cd-row.active { background:var(--bg-inner); color:var(--accent-ink, var(--accent-deep, var(--accent))); }
#csvDstSheet .cd-req { margin-left:auto; font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--text-faint, var(--text-muted)); }
`;

  function ensureFrame() {
    if ($('csvImportFrame')) return;
    if (!$(STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = STYLES;
      document.head.appendChild(styleEl);
    }
    const frame = document.createElement('div');
    frame.id = 'csvImportFrame';
    frame.innerHTML = `
      <div class="im-head">
        <div class="wrap"><div class="im-bar">
          <button class="im-back" onclick="window._csvBack()" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="im-titles">
            <span class="im-title">Import items from CSV</span>
            <span class="im-sub" id="csvSub"></span>
          </span>
        </div>
        <div class="steps" id="csvSteps"></div></div>
      </div>
      <div class="im-scroll" id="csvScroll"><div class="wrap">
        <div id="csvStageWrap"></div>
        <div class="im-note" id="csvNote"></div>
      </div></div>
      <div class="im-foot"><div class="wrap">
        <div class="im-tally"><span class="im-tally-l" id="csvTallyL"></span><span class="im-tally-r" id="csvTallyR"></span></div>
        <button class="im-ghost" id="csvGhost" onclick="window._csvGhostAction()"></button>
        <button class="im-cta" id="csvCta" onclick="window._csvGo()">Choose a file</button>
      </div></div>
      <input type="file" id="csvFileInput" accept=".csv,text/csv" style="display:none;" onchange="window._csvHandleFile(event.target.files[0])">
    `;
    document.body.appendChild(frame);

    const dstSheet = document.createElement('div');
    dstSheet.className = 'modal-overlay modal-sheet';
    dstSheet.id = 'csvDstSheet';
    dstSheet.style.zIndex = '1000000000';
    dstSheet.setAttribute('onclick', "if(event.target===this)window._csvCloseDstSheet()");
    dstSheet.innerHTML = `<div class="modal-content" style="max-width:360px"><div id="csvDstList"></div></div>`;
    document.body.appendChild(dstSheet);
  }

  // ─── Open / close ──────────────────────────────────────────────────────────
  function openCSVImport(entityType) {
    state = freshState();
    state.entityType = entityType || 'ingredient';
    ensureFrame();
    const fi = $('csvFileInput');
    if (fi) fi.value = '';
    $('csvImportFrame').classList.add('open');
    render();
    _wireDropZone();
  }
  function closeCSVImport() {
    const f = $('csvImportFrame');
    if (f) f.classList.remove('open');
  }
  function back() {
    if (!state) return;
    if (state.stage === 'map') { state.stage = 'pick'; render(); return; }
    if (state.stage === 'preview') { state.stage = 'map'; render(); return; }
    closeCSVImport();
  }

  // ─── Drop zone wiring (delegated, since the drop zone is re-rendered) ─────
  function _wireDropZone() {
    const scroll = $('csvScroll');
    if (!scroll || scroll._csvWired) return;
    scroll._csvWired = true;
    scroll.addEventListener('dragover', e => {
      const d = e.target.closest('#csvDrop');
      if (!d) return;
      e.preventDefault();
      d.dataset.over = '1';
    });
    scroll.addEventListener('dragleave', e => {
      const d = e.target.closest('#csvDrop');
      if (d) d.dataset.over = '0';
    });
    scroll.addEventListener('drop', e => {
      const d = e.target.closest('#csvDrop');
      if (!d) return;
      e.preventDefault();
      d.dataset.over = '0';
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  }

  // ─── Stage 1: pick ─────────────────────────────────────────────────────────
  function renderPick() {
    return `<div class="im-sec-head"><span class="im-sec-title">Your file</span><span class="im-sec-note">.csv</span></div>
      <div class="drop" id="csvDrop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="34" height="34"><path d="M12 16.5V4.5"/><polyline points="7.5 9 12 4.5 16.5 9"/><path d="M4 16v3.5a1 1 0 001 1h14a1 1 0 001-1V16"/></svg>
        <div class="drop-l">Drop your spreadsheet here</div>
        <div class="drop-s">One row per item. Your own column names are fine — you match them up on the next step.</div>
        <button type="button" class="drop-btn" onclick="document.getElementById('csvFileInput').click()">Choose a file</button>
      </div>
      <div class="tmpl">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z"/><polyline points="14 3 14 7 18 7"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
        <span class="tmpl-m"><span class="tmpl-n">Starter template</span><span class="tmpl-s">The ten columns, already named</span></span>
        <button type="button" onclick="window._csvDownloadTemplate()">Download</button>
      </div>
      <div id="csvErr" style="display:none;margin-top:12px;padding:10px 14px;background:rgba(239,68,68,.08);border:1px solid rgba(220,38,38,.22);border-radius:8px;font-size:13px;color:var(--danger);"></div>`;
  }

  function handleFile(file) {
    if (!file) return;
    const name = file.name || '';
    if (!name.toLowerCase().endsWith('.csv') && file.type && file.type !== 'text/csv') {
      _err('Please upload a .csv file (Excel: File → Save As → CSV works too).');
      return;
    }
    state.filename = name;
    state.fileSize = file.size ? Math.round(file.size / 1024) + ' KB' : '';
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const firstLine = (text.split(/\r\n|\r|\n/).find(l => l.trim()) || '');
        state.delimiter = detectDelimiter(firstLine);
        const parsed = parseCSV(text, state.delimiter);
        if (parsed.length < 2) { _err('The file appears to be empty or has only a header row.'); return; }
        state.headers = parsed[0].map(h => h.trim());
        state.rows = parsed.slice(1).filter(r => r.some(v => v && v.trim()));
        if (!state.rows.length) { _err('No data rows found after the header.'); return; }
        state.mapping = {};
        state.headers.forEach((h, i) => { state.mapping[i] = autoMap(h); });
        state.stage = 'map';
        render();
      } catch (err) {
        _err('Could not read the file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
  function _err(msg) {
    const el = $('csvErr');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }

  // ─── Stage 2: map ──────────────────────────────────────────────────────────
  function fileCard() {
    return `<div class="im-sec-head"><span class="im-sec-title">File</span><span class="im-sec-note">${state.rows.length} rows</span></div>
      <div class="file">
        <span class="file-ic">CSV</span>
        <span class="file-m">
          <span class="file-n">${esc(state.filename)}</span>
          <span class="file-s">${esc(state.fileSize)}${state.fileSize ? ' · ' : ''}"${state.delimiter === ';' ? ';' : ','}" separated</span>
        </span>
        <button type="button" onclick="window._csvReset()" aria-label="Remove file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="17" height="17"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }

  function renderMap() {
    const need = missingRequired();
    const ignoredCount = state.headers.filter((_, i) => !state.mapping[i]).length;
    const rowsHtml = state.headers.map((header, i) => {
      const dst = state.mapping[i];
      const field = FIELDS.find(f => f.key === dst);
      const samples = state.rows.slice(0, 3).map(r => (r[i] || '').trim()).filter(Boolean).join(', ');
      return `<button type="button" class="m-row" onclick="window._csvOpenDstSheet(${i})">
          <span class="m-src"><span class="m-src-h">${esc(header)}</span>${samples ? `<span class="m-src-x">${esc(samples)}</span>` : ''}</span>
          ${arrowIcon}
          <span class="m-dst"${field ? '' : ' data-state="off"'}>${field ? esc(field.label) : 'Don’t import'}
            ${field && field.required ? '<i class="m-req">required</i>' : ''}
            <small>${field ? 'mapped' : 'this column is skipped'}</small></span>
          ${chev}
        </button>`;
    }).join('');
    return fileCard() +
      `<div class="im-sec-head"><span class="im-sec-title">Match your columns</span><span class="im-sec-note">${state.headers.length - ignoredCount} of ${state.headers.length} used</span></div>
      <div class="map">${rowsHtml}</div>` +
      (need.length
        ? `<div class="host" data-tone="bad">${ICON_WARN}<span><b>${need.map(fieldLabel).join(' and ')}</b> ${need.length > 1 ? 'have' : 'has'} no column yet. An item can’t be created without ${need.length > 1 ? 'them' : 'it'}.</span></div>`
        : ignoredCount
          ? `<div class="host">${ICON_INFO}<span><b>${ignoredCount} column${ignoredCount > 1 ? 's' : ''}</b> won’t be imported. Nothing else in your file is left behind.</span></div>`
          : '');
  }

  function openDstSheet(colIdx) {
    state.dstPickerCol = colIdx;
    const cur = state.mapping[colIdx];
    const list = $('csvDstList');
    list.innerHTML = `<button type="button" class="cd-row${cur ? '' : ' active'}" onclick="window._csvSetDst(null)">Don’t import</button>` +
      FIELDS.map(f => `<button type="button" class="cd-row${cur === f.key ? ' active' : ''}" onclick="window._csvSetDst('${f.key}')">${esc(f.label)}${f.required ? '<span class="cd-req">required</span>' : ''}</button>`).join('');
    $('csvDstSheet').classList.add('active');
  }
  function closeDstSheet() { $('csvDstSheet')?.classList.remove('active'); }
  function setDst(fieldKey) {
    if (state.dstPickerCol == null) return;
    if (fieldKey) {
      // a field can only be mapped from one column at a time
      for (const idx in state.mapping) if (state.mapping[idx] === fieldKey) state.mapping[idx] = null;
    }
    state.mapping[state.dstPickerCol] = fieldKey || null;
    closeDstSheet();
    render();
  }

  // ─── Stage 3: preview (row verdicts) ──────────────────────────────────────
  async function computeVerdicts() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('You must be logged in to import.');
    if (!window.currentStoreId && typeof ensureStoreExists === 'function') await ensureStoreExists(user);
    const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');

    let q = supabaseClient.from('ingredients').select('id, sku, quantity, cost_per_unit').eq('profile_id', user.id);
    if (storeId) q = q.eq('store_id', storeId);
    const { data: existing, error } = await q;
    if (error) throw error;
    const bySku = new Map();
    (existing || []).forEach(r => { if (r.sku && r.sku.trim()) bySku.set(r.sku.trim().toLowerCase(), r); });

    const verdicts = state.rows.map((row, i) => {
      const n = i + 2; // header is row 1
      const name = cellFor(row, 'name');
      const qtyRaw = cellFor(row, 'quantity');
      const priceRaw = cellFor(row, 'cost_per_unit');
      const qty = qtyRaw ? parseLocaleNumber(qtyRaw) : NaN;
      const price = priceRaw ? parseLocaleNumber(priceRaw) : NaN;

      if (!name) return { n, name: `Row ${n}`, note: `${fieldLabel('name')} is empty, so there is nothing to name the item.`, tone: 'bad', kind: 'skip' };
      if (!qtyRaw || isNaN(qty)) return { n, name, note: `${fieldLabel('quantity')} reads "${qtyRaw || ''}" — not a number.`, tone: 'bad', kind: 'skip' };
      if (!priceRaw || isNaN(price)) return { n, name, note: `${fieldLabel('cost_per_unit')} reads "${priceRaw || ''}" — not a number.`, tone: 'bad', kind: 'skip' };

      const minStockRaw = cellFor(row, 'min_stock');
      const minStock = minStockRaw ? parseLocaleNumber(minStockRaw) : null;
      const deliveryRaw = cellFor(row, 'estimated_delivery');
      const delivery = deliveryRaw ? parseLocaleNumber(deliveryRaw) : null;
      const sku = cellFor(row, 'sku');
      const record = {
        name, quantity: qty, cost_per_unit: price,
        min_stock: (minStock != null && !isNaN(minStock)) ? minStock : null,
        category: cellFor(row, 'category') || null,
        sku: sku || null,
        variant: cellFor(row, 'variant') || null,
        supplier: cellFor(row, 'supplier') || null,
        estimated_delivery: (delivery != null && !isNaN(delivery)) ? delivery : null,
        source_url: cellFor(row, 'source_url') || null,
      };

      const match = sku ? bySku.get(sku.trim().toLowerCase()) : null;
      if (match) {
        return {
          n, name, tone: 'warn', kind: 'update', record, matchedId: match.id,
          before: { quantity: match.quantity, cost_per_unit: match.cost_per_unit },
          note: `SKU ${sku} already in your inventory — quantity and price will be overwritten.`,
        };
      }
      const bits = [`${qty} ${qty === 1 ? 'unit' : 'units'}`, `$${price.toFixed(2)}`];
      if (minStock != null && !isNaN(minStock)) bits.push(`alert ${minStock}`);
      return { n, name, tone: '', kind: 'new', record, note: bits.join(' · ') };
    });

    state.verdicts = verdicts;
    state.counts = {
      new: verdicts.filter(v => v.kind === 'new').length,
      update: verdicts.filter(v => v.kind === 'update').length,
      skip: verdicts.filter(v => v.kind === 'skip').length,
    };
  }

  function renderPreview() {
    const shown = state.showAllRows ? state.verdicts : state.verdicts.slice(0, 6);
    const tagFor = { new: 'Create', update: 'Update', skip: 'Skip' };
    return fileCard() +
      `<div class="im-sec-head"><span class="im-sec-title">What will happen</span><span class="im-sec-note">nothing saved yet</span></div>
      <div class="rows">${shown.map(v => `
        <div class="r-row">
          <span class="r-num">${v.n}</span>
          <span class="r-m"><span class="r-n">${esc(v.name)}</span><span class="r-s"${v.tone ? ` data-tone="${v.tone}"` : ''}>${esc(v.note)}</span></span>
          <span class="r-tag" data-tone="${v.kind}">${tagFor[v.kind]}</span>
        </div>`).join('')}
        ${state.showAllRows ? '' : (state.verdicts.length > shown.length ? `<button type="button" class="r-more" onclick="window._csvShowAllRows()">Show the other ${state.verdicts.length - shown.length} rows</button>` : '')}
      </div>`;
  }

  // ─── Stage 4: work (import) ────────────────────────────────────────────────
  function renderWork() {
    const total = state.counts.new + state.counts.update;
    const done = Math.round(total * state.pct / 100);
    return `<div class="im-sec-head"><span class="im-sec-title">Importing</span><span class="im-sec-note">${esc(state.filename)}</span></div>
      <div class="work">
        <div class="work-l" id="csvWorkLabel">${state.pct < 60 ? 'Creating items…' : 'Updating the items you already had…'}</div>
        <div class="work-s" id="csvWorkSub">${done} of ${total} rows written.</div>
        <div class="work-track"><i style="width:${state.pct}%"></i></div>
      </div>`;
  }

  async function resolveSupplierIds(user, storeId, names) {
    const map = new Map();
    for (const rawName of names) {
      const name = rawName.trim();
      if (!name || map.has(name.toLowerCase())) continue;
      let q = supabaseClient.from('suppliers').select('id').eq('profile_id', user.id).ilike('name', name);
      if (storeId) q = q.eq('store_id', storeId);
      const { data: existingSup } = await q.limit(1);
      if (existingSup && existingSup.length) { map.set(name.toLowerCase(), existingSup[0].id); continue; }
      const row = { profile_id: user.id, name };
      if (storeId) row.store_id = storeId;
      const { data: sup, error } = await supabaseClient.from('suppliers').insert([row]).select().single();
      if (!error && sup) map.set(name.toLowerCase(), sup.id);
    }
    return map;
  }

  async function doImport() {
    state.running = true;
    state.stage = 'work';
    state.pct = 0;
    render();
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('You must be logged in to import.');
      if (!window.currentStoreId && typeof ensureStoreExists === 'function') await ensureStoreExists(user);
      const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');

      const newRows = state.verdicts.filter(v => v.kind === 'new');
      const updateRows = state.verdicts.filter(v => v.kind === 'update');
      const total = newRows.length + updateRows.length || 1;

      const supplierNames = newRows.map(v => v.record.supplier).filter(Boolean);
      const supplierMap = await resolveSupplierIds(user, storeId, supplierNames);

      let written = 0;
      const BATCH = 100;
      const insertedIds = [];
      for (let i = 0; i < newRows.length; i += BATCH) {
        const chunk = newRows.slice(i, i + BATCH);
        const records = chunk.map(v => ({
          profile_id: user.id, store_id: storeId,
          name: v.record.name, quantity: v.record.quantity, cost_per_unit: v.record.cost_per_unit,
          min_stock: v.record.min_stock || 0, category: v.record.category || 'General',
          sku: v.record.sku, estimated_delivery: v.record.estimated_delivery, source_url: v.record.source_url,
          custom_attributes: v.record.variant ? JSON.stringify({ Variant: v.record.variant }) : null,
          type: 'Production',
        }));
        const { data, error } = await supabaseClient.from('ingredients').insert(records).select('id');
        if (error) throw error;
        (data || []).forEach((row, j) => { insertedIds.push({ id: row.id, v: chunk[j] }); });
        written += records.length;
        state.pct = Math.round((written / total) * 60);
        renderStage();
      }
      for (const { id, v } of insertedIds) {
        if (!v.record.supplier) continue;
        const supplierId = supplierMap.get(v.record.supplier.toLowerCase());
        if (!supplierId) continue;
        await supabaseClient.from('ingredient_suppliers').insert([{
          ingredient_id: id, supplier_id: supplierId, profile_id: user.id,
          price: v.record.cost_per_unit || 0, lead_time_days: v.record.estimated_delivery || null,
          moq: 0, is_primary: true,
        }]);
      }

      const updatedSummaries = [];
      for (const v of updateRows) {
        const { error } = await supabaseClient.from('ingredients')
          .update({ quantity: v.record.quantity, cost_per_unit: v.record.cost_per_unit })
          .eq('id', v.matchedId);
        if (error) throw error;
        updatedSummaries.push({ name: v.name, before: v.before, after: { quantity: v.record.quantity, cost_per_unit: v.record.cost_per_unit } });
        written += 1;
        state.pct = 60 + Math.round(((written - newRows.length) / Math.max(1, updateRows.length)) * 40);
        renderStage();
      }

      state.pct = 100;
      const skipRows = state.verdicts.filter(v => v.kind === 'skip');
      state.result = { updated: updatedSummaries, skipCsv: skipRows.length ? buildSkippedCsv(skipRows) : null };
      state.running = false;
      state.stage = 'done';
      render();
    } catch (err) {
      console.error('[csv-import] error:', err);
      state.running = false;
      alert('Import failed: ' + (err.message || 'please try again.'));
      state.stage = 'preview';
      render();
    }
  }

  function buildSkippedCsv(skipRows) {
    const header = state.headers.concat(['Reason']).join(',');
    const lines = skipRows.map(v => {
      const rowIdx = v.n - 2;
      const raw = state.rows[rowIdx] || [];
      const cells = state.headers.map((_, i) => `"${(raw[i] || '').replace(/"/g, '""')}"`);
      cells.push(`"${v.note.replace(/"/g, '""')}"`);
      return cells.join(',');
    });
    return [header].concat(lines).join('\n');
  }

  // ─── Stage 5: done ─────────────────────────────────────────────────────────
  function renderDone() {
    const total = state.counts.new + state.counts.update;
    const r = state.result || { updated: [], skipCsv: null };
    return `<div class="ok-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="4 12.6 9.2 17.6 20 6.6"/></svg></div>
      <div class="ok-t">${total} item${total !== 1 ? 's' : ''} imported</div>
      <div class="ok-s">from ${esc(state.filename)} · ${state.rows.length} rows read</div>
      <div class="tally3">
        <span class="t-i"><span class="t-v">${state.counts.new}</span><span class="t-l">created</span></span>
        <span class="t-i"><span class="t-v">${state.counts.update}</span><span class="t-l">updated</span></span>
        <span class="t-i"><span class="t-v"${state.counts.skip ? ' data-tone="bad"' : ''}>${state.counts.skip}</span><span class="t-l">skipped</span></span>
      </div>` +
      (r.updated.length ? `<div class="im-sec-head"><span class="im-sec-title">Updated, not replaced</span></div>
        <div class="rows">${r.updated.map(u => `
          <div class="r-row"><span class="r-m"><span class="r-n">${esc(u.name)}</span>
            <span class="r-s">${u.before.quantity} → ${u.after.quantity} · $${(+u.before.cost_per_unit).toFixed(2)}${u.before.cost_per_unit === u.after.cost_per_unit ? ' unchanged' : ` → $${(+u.after.cost_per_unit).toFixed(2)}`}</span></span>
            <span class="r-tag" data-tone="warn">Updated</span></div>`).join('')}
        </div>` : '') +
      (r.skipCsv ? `<div class="host" data-tone="bad">${ICON_WARN}<span><b>${state.counts.skip} row${state.counts.skip !== 1 ? 's' : ''}</b> skipped. <a href="#" onclick="window._csvDownloadSkipped();return false;" style="color:inherit;font-weight:800;">Download them</a> to fix and re-upload.</span></div>` : '');
  }

  // ─── Render orchestration ──────────────────────────────────────────────────
  function renderStage() {
    const el = $('csvStageWrap');
    if (state.stage === 'pick') el.innerHTML = renderPick();
    else if (state.stage === 'map') el.innerHTML = renderMap();
    else if (state.stage === 'preview') el.innerHTML = renderPreview();
    else if (state.stage === 'work') el.innerHTML = renderWork();
    else el.innerHTML = renderDone();
  }

  function render() {
    const order = ['pick', 'map', 'preview', 'done'];
    const at = state.stage === 'work' ? 2 : order.indexOf(state.stage);
    $('csvSteps').innerHTML = order.map((_, i) => `<i data-on="${i <= at ? 1 : 0}"></i>`).join('');
    $('csvSub').textContent =
      state.stage === 'pick' ? 'One row per item · CSV'
      : state.stage === 'map' ? 'Step 2 of 3 · match your columns'
      : state.stage === 'preview' ? 'Step 3 of 3 · check before importing'
      : state.stage === 'work' ? 'Writing to your inventory…'
      : 'Done';
    $('csvNote').textContent =
      state.stage === 'map' ? 'Anything set to "Don’t import" is left in your file, not deleted from it. Change a mapping and the preview recalculates.'
      : state.stage === 'done' ? 'Every change here is in your item history, so you can see exactly what this import touched.'
      : '';

    renderStage();

    const need = missingRequired();
    $('csvTallyL').textContent =
      state.stage === 'pick' ? 'No file yet'
      : state.stage === 'map' ? (need.length ? `${need.length} required field${need.length > 1 ? 's' : ''} unmatched` : `${state.headers.length - state.headers.filter((_, i) => !state.mapping[i]).length} columns matched`)
      : state.stage === 'preview' ? `${state.counts.new} new · ${state.counts.update} updated · ${state.counts.skip} skipped`
      : state.stage === 'work' ? 'Importing…'
      : `${state.counts.new + state.counts.update} items now in your inventory`;
    $('csvTallyR').textContent = (state.stage === 'pick' || state.stage === 'done') ? '' : `${state.rows.length} rows`;

    const cta = $('csvCta');
    cta.disabled = state.running || (state.stage === 'map' && need.length > 0);
    cta.textContent =
      state.stage === 'pick' ? 'Choose a file'
      : state.stage === 'map' ? (need.length ? `Match ${fieldLabel(need[0])} to continue` : 'Preview the rows')
      : state.stage === 'preview' ? `Import ${state.counts.new + state.counts.update} rows`
      : state.stage === 'work' ? 'Importing…'
      : 'Go to inventory';

    const ghost = $('csvGhost');
    ghost.style.display = state.stage === 'work' ? 'none' : '';
    ghost.textContent =
      state.stage === 'pick' ? ''
      : state.stage === 'map' ? 'Use a different file'
      : state.stage === 'preview' ? 'Back to column matching'
      : state.stage === 'done' ? 'Import another file'
      : '';
  }

  function go() {
    if (state.running) return;
    if (state.stage === 'pick') { $('csvFileInput').click(); return; }
    if (state.stage === 'map') { if (missingRequired().length) return; state.stage = 'preview'; render(); computeVerdicts().then(render).catch(err => { alert(err.message); state.stage = 'map'; render(); }); return; }
    if (state.stage === 'preview') { doImport(); return; }
    if (state.stage === 'done') { window.location.href = '/ingredients'; return; }
  }
  function ghostAction() {
    if (state.stage === 'map') reset();
    else if (state.stage === 'preview') { state.stage = 'map'; render(); }
    else if (state.stage === 'done') reset();
  }
  function reset() { state.stage = 'pick'; state.showAllRows = false; render(); }

  function downloadTemplate() {
    const rows = [
      'Name,Quantity,Unit price,Alert level,Category,SKU,Variant,Supplier,Delivery days,Source URL',
      '"Red Fabric Roll",50,4.99,10,Apparel,FAB-001,,,,',
      '"Gold Thread",200,1.25,20,Apparel,THR-002,,,,',
    ];
    _download(rows.join('\n'), 'shelfy_import_template.csv');
  }
  function downloadSkipped() {
    if (state.result && state.result.skipCsv) _download(state.result.skipCsv, 'skipped_rows.csv');
  }
  function _download(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────
  window.openCSVImport = openCSVImport;
  window.closeCSVImport = closeCSVImport;
  window._csvBack = back;
  window._csvHandleFile = handleFile;
  window._csvReset = reset;
  window._csvGo = go;
  window._csvGhostAction = ghostAction;
  window._csvOpenDstSheet = openDstSheet;
  window._csvCloseDstSheet = closeDstSheet;
  window._csvSetDst = setDst;
  window._csvShowAllRows = () => { state.showAllRows = true; render(); };
  window._csvDownloadTemplate = downloadTemplate;
  window._csvDownloadSkipped = downloadSkipped;
})();
