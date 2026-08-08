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
      manualLabel: 'item'
    },
    expense: {
      label: 'Expense', dropLabel: 'Drop a receipt or invoice',
      manualLabel: 'expense'
    },
    order: {
      label: 'Order', dropLabel: 'Drop an order screenshot',
      manualLabel: 'order'
    }
  };

  var sheetEl = null, contentEl = null;
  var currentEntity = null, currentOpts = null;
  var file = null;       // { raw: File, name, sizeMB, isPdf }
  var replaced = null;   // name of the file that was just swapped out, shown once
  var running = false;
  var usage = null;      // window.ShelfyCreateModal.checkUsage() result, or null
  var errorMsg = null;
  var errorCode = null; // one of ERR_CARDS's keys, or null for the old inline banner (429 etc.)
  var fakePct = 0, fakeTimer = null;
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
  // Error-card icons (34b reference set)
  var ICON_TRIANGLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><path d="M12 3.4L1.6 20.6h20.8z"/><line x1="12" y1="10" x2="12" y2="15.2"/><line x1="12" y1="17.7" x2="12" y2="17.8"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><circle cx="12" cy="12" r="9.2"/><polyline points="12 7 12 12 15.6 14"/></svg>';
  var ICON_SEARCH_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><circle cx="10.5" cy="10.5" r="6.6"/><line x1="15.4" y1="15.4" x2="21" y2="21"/><line x1="8" y1="10.5" x2="13" y2="10.5"/></svg>';
  var ICON_CHECK_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="4 12.6 9.2 17.6 20 6.6"/></svg>';

  // Real, distinguishable scan-step failures (api/extract-receipt.js's
  // `code`) -- everything else (429 limit reached, a thrown Error with no
  // code) keeps using the small inline .aim-error banner instead of this
  // takeover. scan.no_match's headline/message depend on currentEntity, so
  // those two are filled in by renderErrCard() instead of listed here.
  var ERR_CARDS = {
    'scan.timeout': { tone: 'warn', icon: ICON_CLOCK, headline: 'The read took too long',
      message: 'It stopped answering.' },
    'scan.malformed': { tone: 'bad', icon: ICON_TRIANGLE, headline: 'The scan failed',
      message: 'It came back broken. We’ve logged it.' },
    'scan.no_match': { tone: 'warn', icon: ICON_SEARCH_X },
    // 'unknown' is the server's own outer-catch code -- genuinely unsure
    // whether the charge happened. 'client' covers everything that never
    // reached that server code at all (not logged in, a 413, a raw network
    // failure) -- those are all definitely pre-charge, same shape/headline,
    // different confidence in the "keep" line (see renderErrCard()).
    'unknown': { tone: 'bad', icon: ICON_TRIANGLE, headline: 'Something went wrong', uncertain: true },
    'client': { tone: 'bad', icon: ICON_TRIANGLE, headline: 'Something went wrong' }
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
            '<span class="aim-title" id="aimTitle"></span>' +
          '</span>' +
        '</div>' +
        '<div id="aimNormalBody">' +
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
          '<div class="aim-error" id="aimError" style="display:none;">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
            '<span id="aimErrorText"></span>' +
          '</div>' +
          '<div class="aim-sec-head"><span class="aim-sec-title">Scan cost</span></div>' +
          '<div class="aim-quote" id="aimQuote"></div>' +
          '<div class="aim-foot">' +
            '<button type="button" class="aim-cta" id="aimCta">Read</button>' +
            '<button type="button" class="aim-ghost" id="aimManual"></button>' +
          '</div>' +
        '</div>' +
        '<div id="aimErrCard" style="display:none;"></div>' +
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
      if (e.target.closest('#aimFileRemove')) { clearFile(); return; }
      if (e.target.id === 'aimCta') { go(); return; }
      if (e.target.id === 'aimManual') { manual(); return; }
      if (e.target.id === 'aimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
      if (e.target.id === 'aimErrRetry') { go(); return; }
      if (e.target.id === 'aimErrDifferentPhoto') { dismissErrCard(); clearFile(); return; }
      if (e.target.id === 'aimErrPasteLink') { errToUrlImport(); return; }
      if (e.target.id === 'aimErrManual') { manual(); return; }
      if (e.target.id === 'aimErrBack') { dismissErrCard(); return; }
      if (e.target.id === 'aimErrSupport') { window.location.href = 'mailto:support@shelfyai.com?subject=' + encodeURIComponent('ShelfyAI error ' + (errorCode || 'unknown')); return; }
      if (e.target.id === 'aimErrClose') { close(); return; }
      if (e.target.id === 'aimErrCopy') { copyErrCode(); return; }
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

  function setFile(raw) {
    processingFile = true; errorMsg = null; errorCode = null; render();
    compressImage(raw).then(function (processed) {
      processingFile = false;
      var err = validate(processed);
      if (err) { errorMsg = err; render(); return; }
      if (file) replaced = file.name;
      file = { raw: processed, name: processed.name, sizeMB: processed.size / 1048576, isPdf: /\.pdf$/i.test(processed.name) };
      render();
    });
  }
  function clearFile() { file = null; replaced = null; errorMsg = null; errorCode = null; render(); }

  // Desktop "Take photo" doesn't have a camera to open -- reuse the same
  // screen-capture pattern already established in expenses.html/orders.html
  // (getDisplayMedia -> canvas -> blob), since a capture="environment" file
  // input is a no-op on desktop browsers anyway.
  function captureScreen() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      errorMsg = 'Screen capture is not supported in this browser'; errorCode = null; render(); return;
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
      errorCode = null;
      render();
    });
  }

  function renderHead() {
    var k = KINDS[currentEntity];
    document.getElementById('aimTitle').textContent = 'Import ' + k.label;
  }

  function renderDrop() {
    var k = KINDS[currentEntity];
    document.getElementById('aimDropT').textContent = file ? 'Replace the file' : k.dropLabel;
    document.getElementById('aimDropS').textContent = file
      ? 'One file per import — this replaces the one below'
      : 'JPG, PNG or PDF up to 4MB';
  }

  function renderFile() {
    var wrap = document.getElementById('aimFileWrap');
    if (!file) { wrap.innerHTML = ''; return; }
    var meta = running
      ? 'Reading… ' + Math.round(fakePct) + '%'
      : file.sizeMB.toFixed(1) + ' MB · ' + cost() + ' scan';
    wrap.innerHTML =
      '<div class="aim-sec-head"><span class="aim-sec-title">File</span>' +
        (replaced ? '<span class="aim-sec-note">replaced ' + esc(replaced) + '</span>' : '') + '</div>' +
      '<div class="aim-card">' +
        '<div class="aim-f">' +
          '<span class="aim-f-thumb">' + (file.isPdf ? 'PDF' : 'IMG') + '</span>' +
          '<span class="aim-f-main">' +
            '<span class="aim-f-name">' + esc(file.name) + '</span>' +
            '<span class="aim-f-meta">' + esc(meta) + '</span>' +
            (running ? '<span class="aim-f-track"><i style="width:' + fakePct + '%"></i></span>' : '') +
          '</span>' +
          (running ? '' : '<button type="button" class="aim-f-x" id="aimFileRemove" aria-label="Remove file">' + ICON_X + '</button>') +
        '</div>' +
      '</div>';
  }

  function renderQuote() {
    var need = cost();
    var el = document.getElementById('aimQuote');
    if (!usage) { el.innerHTML = '<div class="aim-q-why">Checking your scan balance…</div>'; return; }
    var mL = monthlyLeft(), bL = bonusLeft(), left = scansLeft();
    var fromMonthly = Math.min(need, mL), fromBonus = Math.min(need - fromMonthly, bL);
    var short = need - fromMonthly - fromBonus;
    function seg(color, cap, used) {
      if (!cap) return '';
      return '<span class="aim-q-seg" style="flex:' + cap + '"><i style="width:' + Math.round((used / cap) * 100) + '%;background:' + color + '"></i></span>';
    }
    var why = !need ? ''
      : short > 0 ? 'No scans left — buy a pack, or enter it by hand below.'
      : fromBonus ? 'Taken from your bought scans — your monthly allowance is spent.'
      : 'Taken from your ' + mL + ' monthly scan' + (mL === 1 ? '' : 's') + '. Bought scans stay untouched.';
    el.innerHTML =
      '<div class="aim-q-top">' +
        '<span class="aim-q-l">' + need + ' scan' + (need === 1 ? '' : 's') + '</span>' +
        '<span class="aim-q-r">' + left + ' left' + (need ? ' · ' + Math.max(0, left - need) + ' after' : '') + '</span>' +
      '</div>' +
      '<div class="aim-q-track">' + seg('var(--accent)', usage.planLimit, fromMonthly) + seg('var(--accent-deep)', usage.bonusScans, fromBonus) + '</div>' +
      '<div class="aim-q-why"' + (short > 0 ? ' data-state="warn"' : '') + '>' + esc(why) + '</div>' +
      (short > 0 ? '<button type="button" class="aim-q-buy" id="aimBuyBtn">' + buyLabel() + '</button>' : '');
    if (short > 0 && !scanPackPrice) {
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
    if (!el) return;
    if (errorMsg) {
      document.getElementById('aimErrorText').textContent = errorMsg;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  function renderFoot() {
    var k = KINDS[currentEntity];
    var cta = document.getElementById('aimCta');
    cta.disabled = running || processingFile || !usable() || !affordable();
    cta.textContent = running ? 'Reading…' : processingFile ? 'Preparing…' : !affordable() ? 'Not enough scans' : 'Read';
    document.getElementById('aimManual').textContent = 'Enter this ' + k.manualLabel + ' by hand instead';
  }

  // Full card takeover for a real, distinguishable scan-step failure (see
  // ERR_CARDS) -- everything else (limit reached etc.) stays on the small
  // inline banner above, which already has its own good resolution path.
  function renderErrCard() {
    var card = ERR_CARDS[errorCode];
    var el = document.getElementById('aimErrCard');
    if (!card) return;
    var k = KINDS[currentEntity];
    var headline = card.headline, msg = card.message;
    if (errorCode === 'scan.no_match') {
      headline = 'No ' + k.manualLabel + ' found in that photo';
      msg = 'No name or price found. Try a clearer photo, or enter it by hand.';
    }
    if (errorCode === 'unknown' || errorCode === 'client') msg = errorMsg || msg;
    var scansLeftTxt = usage ? (' ' + scansLeft() + ' left this month.') : '';
    var keepHtml = card.uncertain
      ? '<div class="aim-err-keep" data-tone="warn">' + ICON_WARN + '<span><b>Can’t confirm</b> whether this used a scan.</span></div>'
      : '<div class="aim-err-keep" data-tone="ok">' + ICON_CHECK_SM + '<span><b>No scan charged.</b>' + esc(scansLeftTxt) + '</span></div>';
    var actsHtml;
    if (errorCode === 'scan.no_match') {
      // Only the ingredient context has a URL-import equivalent to cross-link to.
      actsHtml =
        '<button type="button" class="aim-err-cta" id="aimErrDifferentPhoto">Try a different photo</button>' +
        (currentEntity === 'ingredient' ? '<button type="button" class="aim-err-alt" id="aimErrPasteLink">Paste a link instead</button>' : '') +
        '<button type="button" class="aim-err-ghost" id="aimErrManual">Enter by hand</button>';
    } else if (errorCode === 'unknown' || errorCode === 'client') {
      actsHtml =
        '<button type="button" class="aim-err-cta" id="aimErrRetry">Try again</button>' +
        '<button type="button" class="aim-err-alt" id="aimErrSupport">Send to support</button>' +
        '<button type="button" class="aim-err-ghost" id="aimErrClose">Close</button>';
    } else {
      actsHtml =
        '<button type="button" class="aim-err-cta" id="aimErrRetry">Try again</button>' +
        '<button type="button" class="aim-err-alt" id="aimErrManual">Enter by hand</button>' +
        '<button type="button" class="aim-err-ghost" id="aimErrBack">Back</button>';
    }
    var reqCode = errorCode + ' · agentql · req_' + Math.random().toString(36).slice(2, 8);
    el.dataset.reqCode = reqCode;
    el.innerHTML =
      '<div class="aim-err-mark" data-tone="' + card.tone + '">' + card.icon + '</div>' +
      '<h3 class="aim-err-h">' + esc(headline) + '</h3>' +
      '<p class="aim-err-p">' + esc(msg) + '</p>' +
      keepHtml +
      '<p class="aim-err-code">' + esc(reqCode) + '<button type="button" id="aimErrCopy">Copy</button></p>' +
      '<div class="aim-err-acts">' + actsHtml + '</div>';
  }

  function dismissErrCard() { errorCode = null; errorMsg = null; render(); }

  // Only offered for the ingredient context (see renderErrCard() -- url-import
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

  function copyErrCode() {
    var el = document.getElementById('aimErrCard');
    var text = (el && el.dataset.reqCode) || '';
    if (navigator.clipboard && navigator.clipboard.writeText && text) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  function render() {
    var isCard = !!ERR_CARDS[errorCode];
    document.getElementById('aimNormalBody').style.display = isCard ? 'none' : '';
    document.getElementById('aimErrCard').style.display = isCard ? 'block' : 'none';
    renderHead();
    if (isCard) { renderErrCard(); return; }
    renderDrop(); renderFile(); renderError(); renderQuote(); renderFoot();
  }

  function startFakeProgress() {
    fakePct = 4;
    clearInterval(fakeTimer);
    fakeTimer = setInterval(function () {
      fakePct = Math.min(90, fakePct + Math.random() * 9);
      renderFile();
    }, 350);
  }
  function stopFakeProgress() {
    clearInterval(fakeTimer); fakeTimer = null; fakePct = 100;
  }

  async function go() {
    if (running || !usable() || !affordable()) return;
    running = true; errorMsg = null; errorCode = null; render();
    startFakeProgress();
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
          var eLimit = new Error(errorData.message || errorData.error || 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.');
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
      // storage bucket every entity's own flow already uses today.
      var receiptUrl = null;
      try {
        var ts = Date.now();
        var path = session.user.id + '/' + ts + '_' + file.raw.name;
        var upRes = await sb.storage.from('expenses').upload(path, file.raw, { cacheControl: '3600', upsert: false });
        if (!upRes.error) {
          var pub = sb.storage.from('expenses').getPublicUrl(path);
          receiptUrl = pub && pub.data && pub.data.publicUrl;
        }
      } catch (upEx) { console.error('[ShelfyImportModal] Receipt upload failed:', upEx); }

      stopFakeProgress();
      var data = result.data;
      var cb = currentOpts.onImported;
      lastScanEntity = currentEntity;
      close();
      if (cb) cb(data, receiptUrl);
    } catch (err) {
      stopFakeProgress();
      running = false;
      console.error('[ShelfyImportModal] Upload/extract failed:', err);
      errorMsg = err.message || 'Something went wrong';
      errorCode = err.limitReached ? null : (ERR_CARDS[err.code] ? err.code : 'client');
      render();
    }
  }

  function manual() {
    var cb = currentOpts.onManual;
    close();
    if (cb) cb();
  }

  async function open(entityType, opts) {
    opts = opts || {};
    if (!KINDS[entityType]) { console.error('[ShelfyImportModal] Unknown entity type:', entityType); return; }
    currentEntity = entityType; currentOpts = opts;
    file = null; replaced = null; running = false; errorMsg = null; errorCode = null; usage = null;
    clearInterval(fakeTimer); fakeTimer = null;
    ensureSheet();
    sheetEl.classList.add('active');
    render();
    usage = (window.ShelfyCreateModal && typeof window.ShelfyCreateModal.checkUsage === 'function')
      ? await window.ShelfyCreateModal.checkUsage()
      : null;
    render();
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  function close() {
    clearInterval(fakeTimer); fakeTimer = null;
    if (!sheetEl) return;
    // No fade here -- close() also runs right before opening a *different*
    // modal (manual()/go()'s onImported handoff), and .modal-overlay's own
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
      if (f && quickEntity) open(quickEntity, quickOpts).then(function () { setFile(f); });
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
      if (f && quickEntity) open(quickEntity, quickOpts).then(function () { setFile(f); });
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
