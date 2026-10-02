// Shared "Import from image or PDF" sheet — one file, one AI read, then hand
// off to whichever entity opened it (ingredient / expense / order). Replaces
// the four separately-built upload modals duplicated (and diverged, with real
// bugs in at least one of them) across ingredients.html, expenses.html,
// orders.html and operations.html.
//
// This component only owns file intake + the scan-cost quote + the actual
// /api/extract-receipt call + pre-uploading the file for a receipt URL. It
// does NOT know how to turn extracted data into an ingredient/expense/order —
// that mapping logic (ingredient matching, expense-line mapping, order-recipe
// matching) is different enough per entity that it stays page-side, exactly
// like today's showIngredientMappingModal()/showRecipeMappingModal(), passed
// back via the onImported(data, receiptUrl) callback.
(function () {
  var KINDS = {
    ingredient: {
      label: 'Item', dropLabel: 'Drop a supplier list or price sheet',
      manualLabel: 'item', noun: 'item', nouns: 'items'
    },
    expense: {
      label: 'Expense', dropLabel: 'Drop a receipt or invoice',
      manualLabel: 'expense', noun: 'item', nouns: 'items'
    },
    order: {
      label: 'Order', dropLabel: 'Drop an order screenshot',
      manualLabel: 'order', noun: 'product', nouns: 'products'
    }
  };

  var sheetEl = null, contentEl = null;
  var currentEntity = null, currentOpts = null;
  var file = null;       // { raw: File, name, sizeMB, isPdf }
  var replaced = null;   // name of the file that was just swapped out, shown once
  var usage = null;      // window.ShelfyCreateModal.checkUsage() result, or null
  var errorMsg = null;   // inline banner text (bad file type, 429 limit etc.), idle phase only
  // 'idle' (pick a file / Scan) | 'loading' | 'done' (draft ready, waiting
  // for "Review draft items") | 'failed' (read failed, see failCode)
  var phase = 'idle';
  var failCode = null, failMsg = null, failStage = 0;
  var draft = null;      // { data, receiptUrl, storageFull, photoSaveFailed }
  // Reading-screen timeline -- same approach as url-import-modal.js: the read
  // is one request with no progress of its own, so the four steps advance on
  // a timer, hold on the last one until the response arrives, and an early
  // response fast-forwards the remaining steps instead of skipping them.
  var t0 = 0, tickTimer = null, resultAt = null, resultStage = 0, curStage = 0;
  var runId = 0; // bumped by every close()/new read so a stale response is ignored
  var scanPackPrice = null;
  // Entity type of the most recent scan whose result hasn't been saved or
  // discarded yet, or null. The monthly scan counter is incremented
  // server-side the moment AgentQL is actually called (extract-receipt.js) —
  // that has to stay, it's what caps real AgentQL cost, not just a UX
  // throttle. But if the user then discards the result without saving
  // anything, refundScan() gives the count back as a courtesy (the AgentQL
  // cost is already spent either way; this only affects what the user's
  // remaining quota looks like). Pages call confirmScanUsed() on an actual
  // successful save, or refundScan() when the review/mapping modal is
  // closed without one -- see ingredients.html/expenses.html/orders.html/
  // operations.html's saveXxx()/closeXxxModal() pairs.
  var lastScanEntity = null;
  var REFUND_RPC = { ingredient: 'decrement_ingredient_usage', order: 'decrement_order_usage', expense: 'decrement_expense_usage' };

  function confirmScanUsed() { lastScanEntity = null; }

  // Lets a page ask "would closing right now discard an unconfirmed scan?"
  // before it actually closes, so it can warn the user first instead of
  // silently refunding behind their back (refundScan() still runs either
  // way, but re-doing the scan later costs another one).
  function hasPending() { return !!lastScanEntity; }

  // A scan taken on a *different* page (operations.html's dashboard, which
  // hands the draft off via sessionStorage instead of prefilling its own
  // modal for the non-recipe-in-progress case) has no way to have set
  // lastScanEntity on THIS page's instance of this module, since each page
  // load gets a fresh closure. Called once the hand-off's draft has been
  // applied here, so refundScan() still works if the user then discards it.
  function markPending(entity) { lastScanEntity = entity; }

  function refundScan() {
    if (!lastScanEntity) return;
    var entity = lastScanEntity;
    lastScanEntity = null;
    var rpcName = REFUND_RPC[entity];
    var sb = window.supabaseClient;
    if (!rpcName || !sb) return;
    sb.auth.getSession().then(function (r) {
      var uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id;
      if (!uid) return;
      sb.rpc(rpcName, { p_user_id: uid }).then(function (res) {
        if (res && res.error) console.error('[ShelfyImportModal] refundScan RPC error:', res.error);
      });
    }).catch(function (e) { console.error('[ShelfyImportModal] refundScan failed:', e); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  var ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';
  var ICON_PDF = '<svg width="34" height="42" viewBox="0 0 34 42"><path d="M4 0H23L34 11V38Q34 42 30 42H4Q0 42 0 38V4Q0 0 4 0Z" fill="#FDECEC"/><path d="M23 0V7Q23 11 27 11H34Z" fill="#F6C3C4"/></svg>';

  // Step timings only -- the wording differs per upload type, see STEPS.
  var STAGES = [{ ms: 1800 }, { ms: 2200 }, { ms: 2800 }, {}];
  // Step label + headline sub per entity. Item creation reads one product
  // (singular), orders end in matching products, expenses in an expense --
  // a generic "Drafting your items" fit none of the last two.
  var STEPS = {
    ingredient: [
      { label: 'Uploading the file' },
      { label: 'Reading the file', sub: 'One scan, charged only if the file can be read.' },
      { label: 'Finding the item', sub: 'Looking for name, size and price.' },
      { label: 'Drafting your item', sub: 'Almost there.' }
    ],
    order: [
      { label: 'Uploading the file' },
      { label: 'Reading the order', sub: 'One scan, charged only if the file can be read.' },
      { label: 'Finding the products', sub: 'Looking for products and quantities.' },
      { label: 'Preparing your order', sub: 'Almost there.' }
    ],
    expense: [
      { label: 'Uploading the file' },
      { label: 'Reading the receipt', sub: 'One scan, charged only if the file can be read.' },
      { label: 'Finding the line items', sub: 'Looking for items, quantities and prices.' },
      { label: 'Preparing your expense', sub: 'Almost there.' }
    ]
  };
  function stepText(i) { return (STEPS[currentEntity] || STEPS.ingredient)[i]; }
  var FF_MS = 280; // per remaining step once the response is in
  var PREVIEW_ROWS = 3, PREVIEW_MAX = 4;

  // Real, distinguishable scan-step failures (api/extract-receipt.js's
  // `code`) -- the 429 limit keeps using the small inline .aim-error banner.
  // `stage` is the step shown as failed; null = whichever was running.
  // timeout/malformed/no_match all return before extract-receipt.js
  // increments usage, so those are definitely not charged; 'unknown' is the
  // server's own outer catch (genuinely unsure), 'client' never reached it.
  var FAILS = {
    'scan.timeout':   { stage: 1, title: 'The read took too long', sub: 'It stopped answering. No scan was charged.' },
    'scan.malformed': { stage: 1, title: 'The scan failed', sub: 'It came back broken. We’ve logged it. No scan was charged.' },
    'scan.no_match':  { stage: 2, title: 'We couldn’t read this file', sub: 'No scan was charged. Try a sharper photo or a PDF.' },
    'unknown':        { stage: null, title: 'Something went wrong', uncertain: true },
    'client':         { stage: null, title: 'Something went wrong' }
  };

  function monthlyLeft() { return usage ? Math.max(0, (usage.planLimit || 0) - (usage.used || 0)) : 0; }
  function bonusLeft()   { return usage ? (usage.bonusScans || 0) : 0; }
  function scansLeft()   { return usage ? monthlyLeft() + bonusLeft() : null; }
  function usable()      { return !!file; }
  function cost()        { return usable() ? 1 : 0; }
  function affordable()  { return scansLeft() === null || cost() <= scansLeft(); }

  function isMobileUA() {
    // iPadOS 13+ reports a desktop "Macintosh" UA by default, with no way to
    // tell it apart from a real Mac except that iPads are touch-capable and
    // Macs aren't (maxTouchPoints > 1 -- 1 is used by some trackpads/mice).
    // Without this, "Take Photo" on an iPad fell into the desktop
    // screen-capture branch, which iPadOS Safari doesn't support at all.
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function ensureSheet() {
    if (sheetEl) return sheetEl;
    var div = document.createElement('div');
    div.className = 'modal-overlay modal-sheet';
    div.id = 'shelfyImportSheet';
    div.innerHTML =
      '<div class="modal-content aim-content" id="aimContent">' +
        '<div class="aim-head">' +
          '<button type="button" class="aim-close" id="aimClose" aria-label="Back">' + ICON_BACK + '</button>' +
          '<span class="aim-titles">' +
            '<span class="aim-title" id="aimTitle">Import from file</span>' +
            '<span class="aim-sub" id="aimSub"></span>' +
          '</span>' +
        '</div>' +
        '<div class="aim-drop" id="aimDrop">' +
          '<span class="aim-drop-t" id="aimDropT"></span>' +
          '<span class="aim-drop-s" id="aimDropS"></span>' +
          '<div class="aim-drop-btns">' +
            '<button type="button" id="aimTakePhoto">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/><circle cx="12" cy="12.5" r="3.2"/></svg>' +
              'Take photo</button>' +
            '<button type="button" id="aimChooseFile">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M14 3v5h5"/><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/></svg>' +
              'Choose file</button>' +
          '</div>' +
          '<input type="file" id="aimFileInput" accept="image/png,image/jpeg,image/jpg,.pdf" style="display:none;">' +
          '<input type="file" id="aimCameraInput" accept="image/*" capture="environment" style="display:none;">' +
        '</div>' +
        '<div id="aimFileWrap"></div>' +
        '<div class="aim-error" id="aimError" style="display:none;">' + ICON_WARN +
          '<span id="aimErrorText"></span>' +
        '</div>' +
        '<div id="aimWorkWrap"></div>' +
        '<div class="aim-quote" id="aimQuote" style="display:none;"></div>' +
        '<div class="aim-foot">' +
          '<button type="button" class="aim-cta" id="aimCta">Scan</button>' +
          '<div id="aimAlt"></div>' +
          '<button type="button" class="aim-ghost" id="aimManual"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
    sheetEl = div;
    contentEl = div.querySelector('#aimContent');

    div.addEventListener('click', function (e) { if (e.target === div) close(); });
    document.getElementById('aimClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetEl.classList.contains('active')) close();
    });

    document.getElementById('aimChooseFile').addEventListener('click', function () {
      document.getElementById('aimFileInput').click();
    });
    document.getElementById('aimTakePhoto').addEventListener('click', function () {
      if (isMobileUA()) document.getElementById('aimCameraInput').click();
      else captureScreen();
    });
    document.getElementById('aimFileInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (f) setFile(f);
      e.target.value = '';
    });
    document.getElementById('aimCameraInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (f) setFile(f);
      e.target.value = '';
    });

    var dz = document.getElementById('aimDrop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.dataset.over = '1'; });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.dataset.over = '0'; });
    });
    dz.addEventListener('drop', function (e) {
      var list = [].slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (!list.length) return;
      setFile(list[0]);
    });

    contentEl.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button');
      var id = btn && btn.id;
      if (id === 'aimFileRemove') { clearFile(); return; }
      if (id === 'aimCta') { ctaClick(); return; }
      if (id === 'aimManual') { manual(); return; }
      if (id === 'aimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
      if (id === 'aimErrDifferentPhoto') { clearFile(); return; }
      if (id === 'aimErrPasteLink') { errToUrlImport(); return; }
      if (id === 'aimErrSupport') { window.location.href = 'mailto:support@shelfyai.com?subject=' + encodeURIComponent('ShelfyAI error ' + (failCode || 'unknown')); return; }
    });

    return sheetEl;
  }

  // Vercel's serverless functions reject request bodies over ~4.5MB at the
  // platform layer, before extract-receipt.js's own code (and its more
  // helpful error responses) ever runs -- so a file allowed through here at
  // up to 10MB could still fail with zero useful detail on the other end.
  // 4MB leaves headroom for multipart overhead plus the context field.
  var MAX_FILE_BYTES = 4 * 1024 * 1024;

  function validate(f) {
    var okType = /^(image\/png|image\/jpeg|image\/jpg)$/.test(f.type) || /\.pdf$/i.test(f.name);
    if (!okType) return 'Please choose a PNG, JPG, or PDF file';
    if (f.size > MAX_FILE_BYTES) return 'File size must be less than 4MB' + (/\.pdf$/i.test(f.name) ? ' — try a lower-resolution scan' : '');
    return null;
  }

  // Photos straight from a phone camera are full sensor resolution (often
  // 3-8MB+, more for high-detail subjects like a receipt full of small
  // text) -- this is THE reason "Take Photo" tended to fail specifically on
  // mobile: desktop's equivalent (captureScreen(), below) produces a small
  // PNG, so it never hit this. Downscale + re-encode client-side so a normal
  // phone photo just works instead of silently exceeding the server's
  // request-size limit. PDFs pass through untouched (can't be shrunk this
  // way); non-image/PDF files are rejected by validate() regardless.
  var MAX_DIM = 1800;
  var JPEG_QUALITY = 0.85;

  function compressImage(raw) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(raw.type)) { resolve(raw); return; } // PDFs etc.
      var img = new Image();
      var url = URL.createObjectURL(raw);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_DIM / Math.max(w, h));
        if (scale >= 1 && raw.size <= MAX_FILE_BYTES) { resolve(raw); return; } // already fine as-is
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          resolve(blob ? new File([blob], raw.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : raw);
        }, 'image/jpeg', JPEG_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(raw); }; // fall back to the original if it won't decode
      img.src = url;
    });
  }

  var processingFile = false;

  // This modal instance is a long-lived singleton (appended to <body> once,
  // reused across every open) -- without revoking, each file swap/clear
  // leaks the previous blob: URL for the life of the page.
  function _revokePreview() {
    if (file && file.previewUrl) URL.revokeObjectURL(file.previewUrl);
  }

  function setFile(raw) {
    processingFile = true; errorMsg = null; resetFail(); render();
    compressImage(raw).then(function (processed) {
      processingFile = false;
      var err = validate(processed);
      if (err) { errorMsg = err; render(); return; }
      if (file) replaced = file.name;
      _revokePreview();
      file = {
        raw: processed, name: processed.name, sizeMB: processed.size / 1048576,
        isPdf: /\.pdf$/i.test(processed.name),
        previewUrl: /^image\//.test(processed.type) ? URL.createObjectURL(processed) : null
      };
      render();
    });
  }
  function clearFile() {
    if (phase === 'loading' || phase === 'done') return;
    _revokePreview(); file = null; replaced = null; errorMsg = null; resetFail(); render();
  }
  function resetFail() { if (phase === 'failed') phase = 'idle'; failCode = null; failMsg = null; }

  // Desktop "Take photo" doesn't have a camera to open -- reuse the same
  // screen-capture pattern already established in expenses.html/orders.html
  // (getDisplayMedia -> canvas -> blob), since a capture="environment" file
  // input is a no-op on desktop browsers anyway.
  function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      errorMsg = 'Screen capture is not supported in this browser'; render(); return;
    }
    navigator.mediaDevices.getDisplayMedia({ video: { mediaSource: 'screen' } }).then(function (stream) {
      var video = document.createElement('video');
      video.srcObject = stream; video.play();
      video.onloadedmetadata = function () {
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        stream.getTracks().forEach(function (t) { t.stop(); });
        canvas.toBlob(function (blob) {
          setFile(new File([blob], 'screenshot.png', { type: 'image/png' }));
        }, 'image/png');
      };
    }).catch(function (err) {
      errorMsg = err.name === 'NotAllowedError' ? 'Screenshot permission denied' : 'Failed to capture screenshot';
      render();
    });
  }

  function renderHead() {
    document.getElementById('aimSub').textContent = scansLeft() === null ? ''
      : (scansLeft() + ' scan' + (scansLeft() === 1 ? '' : 's') + ' left this month');
  }

  function renderDrop() {
    var k = KINDS[currentEntity];
    // Also hidden while processingFile -- quickStart() hands a file straight
    // to setFile() before this sheet is ever shown, but setFile() only
    // populates `file` itself once compressImage() resolves. Checking `file`
    // alone here left the "Take a photo / Upload a file" chooser visible
    // for that whole stretch, right after the user had already picked one.
    document.getElementById('aimDrop').style.display = (file || processingFile) ? 'none' : '';
    document.getElementById('aimDropT').textContent = k.dropLabel;
    document.getElementById('aimDropS').textContent = 'JPG, PNG or PDF up to 4MB';
  }

  function sizeLabel(mb) { return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(mb * 1024)) + ' KB'; }
  function kindLabel() { return file && file.isPdf ? 'PDF' : 'Photo'; }

  // File card (design: file icon/thumbnail, name, "PDF · 1.2 MB"; while the
  // first step runs, "Uploading · 45 % of 1.2 MB" plus a thin bar). Built
  // once per file and then only its meta line/bar are touched, so the
  // thumbnail <img> isn't re-created on every progress tick.
  function renderFile() {
    var wrap = document.getElementById('aimFileWrap');
    if (!file && processingFile) {
      wrap.dataset.key = '';
      wrap.innerHTML =
        '<div class="aim-fc"><span class="aim-fc-tile">…</span>' +
          '<span class="aim-fc-main"><span class="aim-fc-name">Preparing your file…</span></span></div>';
      return;
    }
    if (!file) { wrap.dataset.key = ''; wrap.innerHTML = ''; return; }
    var key = file.name + '|' + file.sizeMB;
    if (wrap.dataset.key !== key) {
      wrap.dataset.key = key;
      var tile = file.previewUrl
        ? '<span class="aim-fc-tile aim-fc-photo"><img src="' + file.previewUrl + '" alt=""></span>'
        : file.isPdf
          ? '<span class="aim-fc-tile aim-fc-pdf">' + ICON_PDF + '<b>PDF</b></span>'
          : '<span class="aim-fc-tile">' + ICON_BOX + '</span>';
      wrap.innerHTML =
        '<div class="aim-fc">' + tile +
          '<span class="aim-fc-main">' +
            '<span class="aim-fc-name">' + esc(file.name) + '</span>' +
            '<span class="aim-fc-meta" id="aimFcMeta"></span>' +
            '<span class="aim-fc-up" id="aimFcUp"><i id="aimFcUpBar"></i></span>' +
          '</span>' +
          '<button type="button" class="aim-f-x" id="aimFileRemove" aria-label="Remove file">' + ICON_X + '</button>' +
        '</div>' +
        (replaced ? '<div class="aim-fc-note">Replaced ' + esc(replaced) + '</div>' : '');
    }
    var uploading = phase === 'loading' && curStage === 0;
    var upFrac = 1;
    if (uploading) upFrac = ease(Math.min(1, (performance.now() - t0) / STAGES[0].ms));
    document.getElementById('aimFcMeta').textContent = uploading
      ? 'Uploading · ' + Math.round(upFrac * 100) + ' % of ' + sizeLabel(file.sizeMB)
      : kindLabel() + ' · ' + sizeLabel(file.sizeMB);
    document.getElementById('aimFcUp').style.opacity = uploading ? '1' : '0';
    document.getElementById('aimFcUpBar').style.width = (upFrac * 100) + '%';
    document.getElementById('aimFileRemove').style.visibility = (phase === 'loading' || phase === 'done') ? 'hidden' : '';
  }

  // ---------- Reading screen ----------

  function buildWork() {
    var el = document.getElementById('aimWorkWrap');
    var rows = '';
    for (var i = 0; i < PREVIEW_ROWS; i++) rows += skelRowHtml(i);
    el.innerHTML =
      '<div class="uim-cat-wrap" id="aimCatWrap"></div>' +
      '<div class="uim-work">' +
        '<div class="uim-hl" id="aimHl"></div>' +
        '<div class="uim-bar"><i id="aimBar"><b></b></i></div>' +
        '<div class="uim-steps">' + STAGES.map(function (s, i) {
          return '<div class="uim-step" id="aimStep' + i + '" data-s="">' +
            '<span class="uim-step-ic"></span><span class="uim-step-l">' + esc(stepText(i).label) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="aim-rows" id="aimRows" data-state="wait">' + rows + '</div>' +
      '</div>';
  }

  var SKEL_W = ['15%', '40%', '28%'];
  function skelRowHtml(i) {
    return '<div class="aim-row">' +
      '<span class="aim-row-q"><i class="uim-scanline" style="animation-delay:' + (i * 0.25) + 's"></i></span>' +
      '<span class="aim-row-main">' +
        '<span class="aim-row-line"><span class="uim-skel" style="right:' + SKEL_W[i % SKEL_W.length] + '"><b></b></span></span>' +
        '<span class="aim-row-line aim-row-line-sm"><span class="uim-skel uim-skel-p"><b></b></span></span>' +
      '</span>' +
    '</div>';
  }

  function itemsOf(data) {
    if (!data) return [];
    if (Array.isArray(data.item)) return data.item;
    return data.item ? [data.item] : [];
  }

  function priceText(v) {
    if (v === null || v === undefined || v === '') return '';
    return typeof v === 'number' ? v.toFixed(2) : String(v);
  }

  function itemRowHtml(it, i) {
    var qty = it.quantity ? String(it.quantity).replace(/\.0+$/, '') : '';
    var attrs = it.attributes && typeof it.attributes === 'object'
      ? Object.keys(it.attributes).map(function (k) { return it.attributes[k]; }).filter(Boolean) : [];
    var meta = [qty && it.unit ? qty + ' ' + it.unit : null, it.SKU || null].concat(attrs).filter(Boolean).join(' · ');
    return '<div class="aim-row aim-row-in" style="animation-delay:' + (i * 90) + 'ms">' +
      '<span class="aim-row-q">' + (qty ? esc(qty) + '×' : '') + '</span>' +
      '<span class="aim-row-main">' +
        '<span class="aim-row-name">' + esc(it.name || 'Unnamed') + '</span>' +
        (meta ? '<span class="aim-row-meta">' + esc(meta) + '</span>' : '') +
      '</span>' +
      (priceText(it.price) ? '<span class="aim-row-price">' + esc(priceText(it.price)) + '</span>' : '') +
    '</div>';
  }

  function setHeadline(title, sub, failed) {
    var hl = document.getElementById('aimHl');
    if (!hl || hl.dataset.key === title + '|' + sub) return;
    hl.dataset.key = title + '|' + sub;
    hl.innerHTML = '<div class="uim-hl-in"><div class="uim-hl-t"' + (failed ? ' data-failed="1"' : '') + '>' + esc(title) + '</div>' +
      (sub ? '<div class="uim-hl-s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function setSteps(stateFor) {
    STAGES.forEach(function (s, i) {
      var st = document.getElementById('aimStep' + i);
      var state = stateFor(i);
      if (!st || st.dataset.s === state) return;
      st.dataset.s = state;
      st.querySelector('.uim-step-ic').innerHTML = window.ShelfyScanScreen.stepIconHtml(state);
    });
  }

  function setBar(pct, failed) {
    var bar = document.getElementById('aimBar');
    if (!bar) return;
    bar.style.width = pct + '%';
    bar.dataset.failed = failed ? '1' : '';
  }

  function setCat(mode) { window.ShelfyScanScreen.setCat(document.getElementById('aimCatWrap'), mode); }

  function ease(f) { return 1 - Math.pow(1 - f, 2); }

  function timeline() {
    var now = performance.now(), t = now - t0, acc = 0, stage = 3, frac = 0;
    for (var i = 0; i < 3; i++) {
      if (t < acc + STAGES[i].ms) { stage = i; frac = (t - acc) / STAGES[i].ms; break; }
      acc += STAGES[i].ms;
    }
    // Last step has no fixed length -- creep toward the end instead of
    // freezing, however long the real read takes.
    if (stage === 3) frac = 1 - Math.exp(-(t - acc) / 3000);
    if (resultAt !== null) {
      var ff = resultStage + Math.floor((now - resultAt) / FF_MS);
      if (ff > stage) { stage = ff; frac = 0; }
    }
    return { stage: stage, frac: frac };
  }

  function tick() {
    if (phase !== 'loading') return;
    var tl = timeline();
    curStage = Math.min(tl.stage, 3);
    if (tl.stage >= STAGES.length) { finishDone(); return; }
    var st = stepText(curStage);
    setHeadline(st.label + '…', curStage === 0 ? (file ? file.name : '') : st.sub, false);
    setBar(Math.min(97, ((curStage + ease(Math.min(tl.frac, 1)) * 0.9) / STAGES.length) * 100), false);
    setSteps(function (i) { return i < curStage ? 'done' : i === curStage ? 'active' : 'todo'; });
    setCat(curStage === 0 ? 'look' : 'read');
    var rows = document.getElementById('aimRows');
    if (rows) rows.dataset.state = curStage >= 1 ? 'scan' : 'wait';
    renderFile();
    renderFoot();
  }

  function stopTimeline() { clearInterval(tickTimer); tickTimer = null; }

  function finishDone() {
    stopTimeline();
    phase = 'done';
    // Charged server-side the moment the read succeeded -- refunded again
    // if these drafts get discarded instead of reviewed (see close()).
    lastScanEntity = currentEntity;
    render();
  }

  function doneCopy() {
    var k = KINDS[currentEntity];
    var n = itemsOf(draft && draft.data).length;
    if (n === 0) return { title: 'Draft ready', sub: 'No lines found — add them in the next step.', cta: 'Review draft' };
    if (n === 1) return { title: '1 ' + k.noun + ' found', sub: 'Check the draft before saving it.', cta: 'Review draft ' + k.noun };
    return { title: n + ' ' + k.nouns + ' found', sub: 'Check the drafts before saving them.', cta: 'Review ' + n + ' draft ' + k.nouns };
  }

  function paintWork() {
    if (phase === 'done') {
      var c = doneCopy();
      setHeadline(c.title, c.sub, false);
      setBar(100, false);
      setSteps(function () { return 'done'; });
      setCat('celebrate');
      var rows = document.getElementById('aimRows');
      if (rows && rows.dataset.state !== 'done') {
        var items = itemsOf(draft.data);
        rows.dataset.state = 'done';
        rows.innerHTML = items.slice(0, PREVIEW_MAX).map(itemRowHtml).join('') +
          (items.length > PREVIEW_MAX ? '<div class="aim-row-more">+ ' + (items.length - PREVIEW_MAX) + ' more</div>' : '');
        if (!items.length) rows.style.display = 'none';
      }
    } else if (phase === 'failed') {
      var f = FAILS[failCode] || FAILS.client;
      var sub = f.sub || ((failMsg || 'Please try again.') + (f.uncertain ? ' We can’t confirm whether this used a scan.' : ''));
      setHeadline(f.title, sub, true);
      setBar(100, true);
      setSteps(function (i) { return i < failStage ? 'done' : i === failStage ? 'failed' : 'todo'; });
      setCat('sad');
      var r = document.getElementById('aimRows');
      if (r) r.dataset.state = 'failed';
    }
  }

  function renderWork() {
    var el = document.getElementById('aimWorkWrap');
    if (phase === 'idle') { el.innerHTML = ''; return; }
    if (!document.getElementById('aimHl')) buildWork();
    if (phase === 'loading') tick(); else paintWork();
  }

  // Only surfaces when the user is actually short on scans -- the remaining
  // count itself now lives in the header (design), so the old "This scan
  // reduces your AI scans by 1" line is gone.
  function renderQuote() {
    var el = document.getElementById('aimQuote');
    var short = usage && scansLeft() <= 0 && phase === 'idle';
    if (!short) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML =
      '<div class="aim-q-why" data-state="warn">' +
        (window.SHELFY_NATIVE_APP ? 'No scans left this month — enter it by hand below.' : 'No scans left — buy a pack, or enter it by hand below.') +
      '</div>' +
      '<button type="button" class="aim-q-buy" id="aimBuyBtn">' + buyLabel() + '</button>';
    if (!scanPackPrice) {
      fetch('/api/scan-pack-price').then(function (r) { return r.json(); }).then(function (p) {
        scanPackPrice = p;
        var btn = document.getElementById('aimBuyBtn');
        if (btn) btn.textContent = buyLabel();
      }).catch(function () {});
    }
  }
  function buyLabel() {
    if (scanPackPrice && scanPackPrice.configured && scanPackPrice.priceFormatted) {
      return 'Buy ' + (scanPackPrice.scanCount || 50) + ' scans · ' + scanPackPrice.priceFormatted;
    }
    return 'Buy 50 scans';
  }

  function renderError() {
    var el = document.getElementById('aimError');
    if (errorMsg && phase === 'idle') {
      document.getElementById('aimErrorText').textContent = errorMsg;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  function renderFoot() {
    var k = KINDS[currentEntity];
    var cta = document.getElementById('aimCta');
    var label, mode;
    if (phase === 'loading') { mode = 'loading'; label = curStage === 0 ? 'Uploading' : 'Reading'; }
    else if (phase === 'done') { mode = 'done'; label = doneCopy().cta; }
    else if (phase === 'failed') { mode = 'failed'; label = 'Try again'; }
    else { mode = 'idle'; label = processingFile ? 'Preparing…' : !affordable() ? 'Not enough scans' : 'Scan'; }
    cta.disabled = mode === 'loading' || (mode !== 'done' && (processingFile || !usable() || !affordable()));
    if (cta.dataset.key !== mode + '|' + label) {
      cta.dataset.key = mode + '|' + label;
      cta.dataset.mode = mode;
      cta.innerHTML = mode === 'loading'
        ? '<i class="uim-cta-sh"></i><span>' + label + '</span><span class="uim-dots"><i></i><i></i><i></i></span>'
        : esc(label);
    }
    document.getElementById('aimManual').textContent = 'Enter this ' + k.manualLabel + ' by hand instead';
    var alt = document.getElementById('aimAlt');
    var altHtml = '';
    if (phase === 'failed' && failCode === 'scan.no_match') {
      altHtml = '<button type="button" class="aim-ghost" id="aimErrDifferentPhoto">Try a different photo</button>' +
        (currentEntity === 'ingredient' ? '<button type="button" class="aim-ghost" id="aimErrPasteLink">Paste a link instead</button>' : '');
    } else if (phase === 'failed' && (failCode === 'unknown' || failCode === 'client')) {
      altHtml = '<button type="button" class="aim-ghost" id="aimErrSupport">Send to support</button>';
    }
    if (alt.dataset.key !== altHtml) { alt.dataset.key = altHtml; alt.innerHTML = altHtml; }
  }

  // Only offered for the ingredient context (see renderFoot() -- url-import
  // is item-creation only), so the {item:[...]} shape below always matches
  // what THIS page's onImported (applyReceiptScanToManualModal(data)-style)
  // expects.
  function errToUrlImport() {
    var opts = currentOpts;
    close();
    if (!window.ShelfyUrlImportModal || typeof window.ShelfyUrlImportModal.open !== 'function') return;
    window.ShelfyUrlImportModal.open({
      onManual: opts.onManual,
      // url-import-modal.js hands back one flat item; wrap it into the
      // {item:[...]} array shape this page's onImported was built for,
      // instead of silently reading undefined fields off a flat object.
      onImported: function (flat) {
        if (opts.onImported) opts.onImported({
          vendor: flat.vendor || null,
          item: [{
            name: flat.name || null,
            price: flat.price || null,
            SKU: flat.sku || null,
            quantity: flat.quantity || null,
            attributes: { color: flat.color || null, size: flat.size || null }
          }]
        }, null);
      }
    });
  }

  // Storage-limit check before pre-uploading the file (see the "expenses"
  // bucket upload below) -- mirrors order-detail.html's/expense-detail.html's
  // own checkStorageLimit(), just without a page to call it from since this
  // sheet is shared across ingredient/expense/order intake. Failing the
  // check never blocks the scan itself (the AI read already happened by the
  // time this runs) -- it only skips saving the photo, which caller pages
  // already handle gracefully via a null receiptUrl.
  async function hasStorageSpace(sb, userId, fileSize) {
    try {
      var res = await sb.from('user_settings').select('storage_used_bytes, storage_limit_bytes').eq('user_id', userId).single();
      var settings = res && res.data;
      if (!settings) return true;
      // A null/0 storage_limit_bytes (e.g. a user_settings row from before
      // the storage-limits migration backfilled it) used to fall back to 0
      // here -- meaning 0 available space, no matter how small the file --
      // instead of the same free-tier 10MB default settings.html's own
      // display and expense-detail.html's checkStorageLimit() already
      // assume. That's exactly why storage could show "0% used" in Settings
      // (which defaults the same missing limit sensibly) while every scan
      // still got refused as "storage full" here.
      var available = (settings.storage_limit_bytes || 10485760) - (settings.storage_used_bytes || 0);
      return fileSize <= available;
    } catch (e) { return true; } // allow upload if the check itself fails
  }

  function showBottomNotice(text) {
    var el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);'
      + 'background:var(--bg-panel,#fff);color:var(--text-main,#0f172a);border:1px solid var(--border,#e2e8f0);'
      + 'padding:12px 18px;border-radius:12px;font-size:13.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.15);'
      + 'z-index:99999;max-width:calc(100vw - 32px);text-align:center;';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }
  function showStorageFullNotice() { showBottomNotice('Storage is full — saved without the photo.'); }
  function showPhotoSaveFailedNotice() { showBottomNotice("Couldn't save the photo — saved without it."); }

  function render() {
    renderHead(); renderDrop(); renderFile(); renderWork(); renderError(); renderQuote(); renderFoot();
  }

  function ctaClick() {
    if (phase === 'done') { review(); return; }
    if (phase === 'idle' || phase === 'failed') go();
  }

  function review() {
    var cb = currentOpts.onImported, d = draft;
    phase = 'idle'; // handed over -- close() mustn't treat this as a discard
    close();
    if (d.storageFull) showStorageFullNotice();
    else if (d.photoSaveFailed) showPhotoSaveFailedNotice();
    if (cb) cb(d.data, d.receiptUrl);
  }

  async function go() {
    if (phase === 'loading' || !usable() || !affordable()) return;
    var myRun = ++runId;
    phase = 'loading'; failCode = null; failMsg = null; errorMsg = null; draft = null;
    resultAt = null; curStage = 0; t0 = performance.now();
    document.getElementById('aimWorkWrap').innerHTML = '';
    render();
    stopTimeline();
    tickTimer = setInterval(tick, 60);
    try {
      var sb = window.supabaseClient;
      var sessionRes = sb ? await sb.auth.getSession() : null;
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (!session) throw new Error('You must be logged in to use this feature');

      var formData = new FormData();
      formData.append('file', file.raw);
      formData.append('context', currentEntity);
      var response = await fetch('/api/extract-receipt', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
        body: formData
      });

      if (!response.ok) {
        var errorData;
        try {
          errorData = await response.json();
        } catch (parseErr) {
          // A non-JSON body means the platform rejected the request before
          // extract-receipt.js's own code (and its normal JSON error
          // responses) ever ran -- most commonly a 413 (request too large).
          // Logged here since this is the one failure mode the server-side
          // logs can't show anything for either.
          console.error('[ShelfyImportModal] Non-JSON error response — status:', response.status, 'body parse error:', parseErr);
          errorData = { error: response.status === 413
            ? 'This file is too large for the server to accept. Try again — it should compress automatically now — or use a smaller photo.'
            : 'Failed to process (unexpected server response, status ' + response.status + ')' };
        }
        if (response.status === 429) {
          var eLimit = new Error(errorData.message || errorData.error || (window.SHELFY_NATIVE_APP ? 'Monthly scan limit reached. Enter it by hand instead.' : 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.'));
          eLimit.limitReached = true;
          throw eLimit;
        }
        // errorData.details (when present) is the raw AgentQL error -- not
        // shown to the user, but logged so a report of "it just failed,
        // no idea why" is actually diagnosable afterward.
        if (errorData.details) console.error('[ShelfyImportModal] Extraction failed, server details:', errorData.details);
        var eBad = new Error(errorData.error || 'Failed to extract data from this file');
        eBad.code = errorData.code;
        throw eBad;
      }

      var result = await response.json();
      if (currentEntity === 'order' || currentEntity === 'expense') {
        console.log('[ShelfyImportModal] AI read from ' + currentEntity + ' document:', result.data);
      }
      if (!result.success || !result.data) {
        var eEmpty = new Error(result.error || 'No data could be extracted from this file');
        eEmpty.code = result.code;
        throw eEmpty;
      }

      // Pre-upload the file for a receipt/reference URL, same "expenses"
      // storage bucket every entity's own flow already uses today. Skipped
      // (not blocked -- the scan above already succeeded) when there's no
      // room left, same as the manual "attach a receipt" flows elsewhere.
      //
      // Ingredient scans never actually use this -- there's no photo_url/
      // receipt_url column on `ingredients` at all, and every 'ingredient'
      // caller's onImported(data, receiptUrl) silently drops the second
      // argument. Uploading it anyway permanently burned storage quota with
      // no way to ever find or delete the file again (nothing references
      // its path), inflating storage_used_bytes forever on every single
      // ingredient photo scan. Skip the upload entirely for this entity.
      var receiptUrl = null;
      var storageFull = false;
      var photoSaveFailed = false;
      if (currentEntity !== 'ingredient') {
        try {
          if (await hasStorageSpace(sb, session.user.id, file.raw.size)) {
            var ts = Date.now();
            var path = session.user.id + '/' + ts + '_' + file.raw.name;
            var upRes = await sb.storage.from('expenses').upload(path, file.raw, { cacheControl: '3600', upsert: false });
            if (!upRes.error) {
              var pub = sb.storage.from('expenses').getPublicUrl(path);
              receiptUrl = pub && pub.data && pub.data.publicUrl;
            } else {
              // Previously swallowed entirely -- the scan would silently
              // succeed with no receiptUrl and no indication anywhere of
              // why, so a bad upload (RLS, quota, network) looked exactly
              // like "the photo just never got saved" with nothing to go
              // on. Now logged and surfaced the same way a full-storage
              // skip already is.
              console.error('[ShelfyImportModal] Receipt upload failed:', upRes.error);
              photoSaveFailed = true;
            }
          } else {
            storageFull = true;
          }
        } catch (upEx) {
          console.error('[ShelfyImportModal] Receipt upload failed:', upEx);
          photoSaveFailed = true;
        }
      }

      if (myRun !== runId) {
        // Sheet was closed mid-read -- nobody's going to review this draft.
        lastScanEntity = currentEntity;
        refundScan();
        return;
      }
      draft = { data: result.data, receiptUrl: receiptUrl, storageFull: storageFull, photoSaveFailed: photoSaveFailed };
      resultStage = curStage;
      resultAt = performance.now();
    } catch (err) {
      if (myRun !== runId) return;
      stopTimeline();
      console.error('[ShelfyImportModal] Upload/extract failed:', err);
      if (err.limitReached) {
        phase = 'idle';
        errorMsg = err.message;
      } else {
        phase = 'failed';
        failCode = FAILS[err.code] ? err.code : 'client';
        failMsg = err.message || 'Something went wrong';
        var fs = FAILS[failCode].stage;
        failStage = fs === null ? curStage : fs;
      }
      render();
    }
  }

  function manual() {
    var cb = currentOpts.onManual;
    close();
    if (cb) cb();
  }

  async function open(entityType, opts, pendingFile) {
    opts = opts || {};
    if (!KINDS[entityType]) { console.error('[ShelfyImportModal] Unknown entity type:', entityType); return; }
    currentEntity = entityType; currentOpts = opts;
    runId++; stopTimeline();
    _revokePreview();
    file = null; replaced = null; errorMsg = null; usage = null; draft = null;
    phase = 'idle'; failCode = null; failMsg = null;
    ensureSheet();
    sheetEl.classList.add('active');
    // quickStart() already picked (or shot) a file before calling this --
    // rendering the plain empty drop-zone first and only calling setFile()
    // once this async function resumes let that already-skipped "Take a
    // photo / Upload file" screen flash on screen for a frame. setFile()
    // renders its own "processing" state synchronously before doing
    // anything async, so calling it here instead goes straight there.
    if (pendingFile) setFile(pendingFile); else render();
    usage = (window.ShelfyCreateModal && typeof window.ShelfyCreateModal.checkUsage === 'function')
      ? await window.ShelfyCreateModal.checkUsage()
      : null;
    render();
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  function close() {
    runId++; stopTimeline();
    if (window.ShelfyScanScreen) window.ShelfyScanScreen.stopCat();
    // Finished drafts closed without "Review" are a discard.
    if (phase === 'done') refundScan();
    phase = 'idle';
    if (!sheetEl) return;
    document.getElementById('aimWorkWrap').innerHTML = '';
    // No fade here -- close() also runs right before opening a *different*
    // modal (manual()/review()'s onImported handoff), and .modal-overlay's own
    // ~200ms opacity transition otherwise left this sheet briefly visible
    // on top of whatever opens next (it's appended to <body> at runtime, so
    // it ties-or-beats any static page modal on z-index/DOM order). A hard,
    // same-frame hide avoids that overlap.
    sheetEl.style.transition = 'none';
    sheetEl.classList.remove('active');
    void sheetEl.offsetWidth;
    sheetEl.style.transition = '';
  }

  // Bare hidden inputs used only by quickStart() -- separate from the
  // sheet's own #aimFileInput/#aimCameraInput so a cancelled native picker
  // here never touches the sheet's file state or fires its listeners.
  var quickFileInput = null, quickCameraInput = null;
  var quickEntity = null, quickOpts = null;

  function ensureQuickInputs() {
    if (quickFileInput) return;
    quickFileInput = document.createElement('input');
    quickFileInput.type = 'file';
    quickFileInput.accept = 'image/png,image/jpeg,image/jpg,.pdf';
    quickFileInput.style.display = 'none';
    document.body.appendChild(quickFileInput);
    quickFileInput.addEventListener('change', function (e) {
      var f = e.target.files[0];
      quickFileInput.value = '';
      if (f && quickEntity) open(quickEntity, quickOpts, f);
    });

    quickCameraInput = document.createElement('input');
    quickCameraInput.type = 'file';
    quickCameraInput.accept = 'image/*';
    quickCameraInput.capture = 'environment';
    quickCameraInput.style.display = 'none';
    document.body.appendChild(quickCameraInput);
    quickCameraInput.addEventListener('change', function (e) {
      var f = e.target.files[0];
      quickCameraInput.value = '';
      if (f && quickEntity) open(quickEntity, quickOpts, f);
    });
  }

  // The FAB's one-tap shortcut: go straight to the native camera/gallery
  // picker with the sheet still hidden, same as the pre-shared-component
  // behavior -- cancelling the picker leaves nothing open. The sheet only
  // appears once a file actually comes back, already on the quote/CTA step
  // (no drop-zone tap needed). Desktop has no camera and no meaningfully
  // different "gallery" flow, so BOTH modes fall back to the sheet's own
  // screen-capture path there, which needs the sheet visible up front for
  // its async "Capturing…" status -- matching the pre-shared-component
  // behavior of both expenses.html's and orders.html's old FABs.
  function quickStart(entityType, mode, opts) {
    opts = opts || {};
    if (!KINDS[entityType]) { console.error('[ShelfyImportModal] Unknown entity type:', entityType); return; }

    if (!isMobileUA()) {
      open(entityType, opts);
      captureScreen();
      return;
    }

    ensureQuickInputs();
    quickEntity = entityType;
    quickOpts = opts;
    (mode === 'camera' ? quickCameraInput : quickFileInput).click();
  }

  window.ShelfyImportModal = { open: open, close: close, quickStart: quickStart, confirmScanUsed: confirmScanUsed, refundScan: refundScan, markPending: markPending, hasPending: hasPending };
})();
