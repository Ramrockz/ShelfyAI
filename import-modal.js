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
      note: 'Reads each row as an item with its cost and unit. Existing items are matched, not duplicated.',
      manualLabel: 'item'
    },
    expense: {
      label: 'Expense', dropLabel: 'Drop a receipt or invoice',
      note: 'Reads the vendor, date, total and each line. You confirm before anything is saved.',
      manualLabel: 'expense'
    },
    order: {
      label: 'Order', dropLabel: 'Drop an order screenshot',
      note: 'Reads the customer, order number and each line, then matches lines to your products.',
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
  var fakePct = 0, fakeTimer = null;
  var scanPackPrice = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function monthlyLeft() { return usage ? Math.max(0, (usage.planLimit || 0) - (usage.used || 0)) : 0; }
  function bonusLeft()   { return usage ? (usage.bonusScans || 0) : 0; }
  function scansLeft()   { return usage ? monthlyLeft() + bonusLeft() : null; }
  function usable()      { return !!file; }
  function cost()        { return usable() ? 1 : 0; }
  function affordable()  { return scansLeft() === null || cost() <= scansLeft(); }

  function isMobileUA() { return /android|iphone|ipad|ipod/i.test(navigator.userAgent); }

  function ensureSheet() {
    if (sheetEl) return sheetEl;
    var div = document.createElement('div');
    div.className = 'modal-overlay modal-sheet';
    div.id = 'shelfyImportSheet';
    div.innerHTML =
      '<div class="modal-content aim-content" id="aimContent">' +
        '<div class="aim-head">' +
          '<span class="aim-titles">' +
            '<span class="aim-title" id="aimTitle"></span>' +
            '<span class="aim-sub" id="aimSub"></span>' +
          '</span>' +
          '<button type="button" class="aim-close" id="aimClose" aria-label="Close">' + ICON_X + '</button>' +
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
        '<div class="aim-sec-head"><span class="aim-sec-title">Scan cost</span></div>' +
        '<div class="aim-quote" id="aimQuote"></div>' +
        '<div class="aim-note" id="aimNote"></div>' +
        '<div class="aim-foot">' +
          '<div class="aim-tally"><span class="aim-tally-l" id="aimTallyL"></span><span class="aim-tally-r" id="aimTallyR"></span></div>' +
          '<button type="button" class="aim-cta" id="aimCta">Read this file</button>' +
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
      if (e.target.closest('#aimFileRemove')) { clearFile(); return; }
      if (e.target.id === 'aimCta') { go(); return; }
      if (e.target.id === 'aimManual') { manual(); return; }
      if (e.target.id === 'aimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
    });

    return sheetEl;
  }

  function validate(f) {
    var okType = /^(image\/png|image\/jpeg|image\/jpg)$/.test(f.type) || /\.pdf$/i.test(f.name);
    if (!okType) return 'Please choose a PNG, JPG, or PDF file';
    if (f.size > 10 * 1024 * 1024) return 'File size must be less than 10MB';
    return null;
  }

  function setFile(raw) {
    var err = validate(raw);
    if (err) { errorMsg = err; render(); return; }
    if (file) replaced = file.name;
    errorMsg = null;
    file = { raw: raw, name: raw.name, sizeMB: raw.size / 1048576, isPdf: /\.pdf$/i.test(raw.name) };
    render();
  }
  function clearFile() { file = null; replaced = null; errorMsg = null; render(); }

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
    var k = KINDS[currentEntity];
    document.getElementById('aimTitle').textContent = 'Import ' + k.label;
    document.getElementById('aimSub').textContent = scansLeft() === null ? ''
      : (scansLeft() + ' scan' + (scansLeft() === 1 ? '' : 's') + ' left this month');
  }

  function renderDrop() {
    var k = KINDS[currentEntity];
    document.getElementById('aimDropT').textContent = file ? 'Replace the file' : k.dropLabel;
    document.getElementById('aimDropS').textContent = file
      ? 'One file per import — this replaces the one below'
      : 'One file at a time · JPG, PNG or PDF up to 10MB';
    document.getElementById('aimNote').textContent = k.note;
  }

  function renderFile() {
    var wrap = document.getElementById('aimFileWrap');
    if (!file) { wrap.innerHTML = ''; return; }
    var meta = running
      ? 'Reading… ' + Math.round(fakePct) + '%'
      : file.sizeMB.toFixed(1) + ' MB · ' + cost() + ' scan';
    wrap.innerHTML =
      '<div class="aim-sec-head"><span class="aim-sec-title">File</span>' +
        '<span class="aim-sec-note">' + (replaced ? 'replaced ' + esc(replaced) : 'one per import') + '</span></div>' +
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
    var why = !need ? 'Nothing to read yet.'
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

  function renderFoot() {
    var k = KINDS[currentEntity];
    document.getElementById('aimTallyL').textContent = errorMsg ? errorMsg
      : !file ? 'No file yet'
      : running ? 'Reading…'
      : file.name;
    document.getElementById('aimTallyR').textContent = file && !running ? cost() + ' scan' : '';
    var cta = document.getElementById('aimCta');
    cta.disabled = running || !usable() || !affordable();
    cta.textContent = running ? 'Reading…' : !usable() ? 'Read this file' : !affordable() ? 'Not enough scans' : 'Read this file · ' + cost() + ' scan';
    document.getElementById('aimManual').textContent = 'Enter this ' + k.manualLabel + ' by hand instead';
  }

  function render() { renderHead(); renderDrop(); renderFile(); renderQuote(); renderFoot(); }

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
    running = true; errorMsg = null; render();
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
        try { errorData = await response.json(); } catch (e) { errorData = { error: 'Failed to process' }; }
        if (response.status === 429) {
          throw new Error(errorData.message || errorData.error || 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.');
        }
        throw new Error(errorData.error || 'Failed to extract data from this file');
      }

      var result = await response.json();
      if (!result.success || !result.data) throw new Error('No data could be extracted from this file');

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
      close();
      if (cb) cb(data, receiptUrl);
    } catch (err) {
      stopFakeProgress();
      running = false;
      errorMsg = err.message || 'Something went wrong';
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
    file = null; replaced = null; running = false; errorMsg = null; usage = null;
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
    if (sheetEl) sheetEl.classList.remove('active');
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

  window.ShelfyImportModal = { open: open, close: close, quickStart: quickStart };
})();
