// Shared "Import from URL" sheet — item creation only. Paste a supplier
// product page link, spend one scan reading it, then hand the draft off to
// whichever page opened this (same onImported(data) callback shape as
// import-modal.js's onImported(data, receiptUrl), minus the receipt URL
// since there's no file here). The page turns that draft into a prefilled
// New Item form itself — this component only owns the URL field, the
// scan-cost quote, and the actual /api/extract-url call.
//
// Deliberately does NOT try to tell the user in advance whether a given
// host will fetch cleanly (Amazon blocks it, some pages need a login,
// etc) — that would mean asserting things about specific suppliers that
// haven't actually been verified. A failed fetch just isn't charged,
// same guarantee api/extract-receipt.js already gives image/PDF scans.
(function () {
  var sheetEl = null, contentEl = null;
  var currentOpts = null;
  var raw = '';
  var running = false;
  var usage = null;
  var errorMsg = null;
  var fakePct = 0, fakeTimer = null;
  var scanPackPrice = null;
  // Whether the most recent scan's result hasn't been saved or discarded
  // yet — mirrors import-modal.js's lastScanEntity, but this module only
  // ever handles ingredients, so a boolean is enough. Same reasoning:
  // the monthly count is incremented server-side the moment AgentQL is
  // actually called (extract-url.js), since that's what caps real AgentQL
  // cost — this only refunds the UX-visible count if the draft is then
  // discarded without saving. Pages call confirmScanUsed() on an actual
  // save, or refundScan() when the manual-entry modal is closed without
  // one — see ingredients.html/operations.html's saveIngredient()/
  // closeManualModal() pairs (same convention as ShelfyImportModal).
  var lastScanUsed = false;

  function confirmScanUsed() { lastScanUsed = false; }

  function refundScan() {
    if (!lastScanUsed) return;
    lastScanUsed = false;
    var sb = window.supabaseClient;
    if (!sb) return;
    sb.auth.getSession().then(function (r) {
      var uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id;
      if (!uid) return;
      sb.rpc('decrement_ingredient_usage', { p_user_id: uid }).then(function (res) {
        if (res && res.error) console.error('[ShelfyUrlImportModal] refundScan RPC error:', res.error);
      });
    }).catch(function (e) { console.error('[ShelfyUrlImportModal] refundScan failed:', e); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  function monthlyLeft() { return usage ? Math.max(0, (usage.planLimit || 0) - (usage.used || 0)) : 0; }
  function bonusLeft()   { return usage ? (usage.bonusScans || 0) : 0; }
  function scansLeft()   { return usage ? monthlyLeft() + bonusLeft() : null; }

  function parseUrl(s) {
    var t = (s || '').trim();
    if (!t) return null;
    try {
      var u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t);
      if (u.hostname.indexOf('.') === -1) return { bad: true };
      return { host: u.hostname.replace(/^www\./, ''), href: u.href };
    } catch (e) { return { bad: true }; }
  }
  function link()      { return parseUrl(raw); }
  function usable()     { var l = link(); return !!l && !l.bad; }
  function cost()       { return usable() ? 1 : 0; }
  function affordable() { return scansLeft() === null || cost() <= scansLeft(); }

  function ensureSheet() {
    if (sheetEl) return sheetEl;
    var div = document.createElement('div');
    div.className = 'modal-overlay modal-sheet';
    div.id = 'shelfyUrlImportSheet';
    div.innerHTML =
      '<div class="modal-content aim-content" id="uimContent">' +
        '<div class="aim-head">' +
          '<span class="aim-titles">' +
            '<span class="aim-title">Import from URL</span>' +
            '<span class="aim-sub" id="uimSub"></span>' +
          '</span>' +
          '<button type="button" class="aim-close" id="uimClose" aria-label="Close">' + ICON_X + '</button>' +
        '</div>' +
        '<div class="uim-field-wrap">' +
          '<div class="uim-url" id="uimUrlBox">' + ICON_LINK +
            '<input id="uimUrlInput" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://supplier.com/product">' +
            '<button type="button" id="uimUrlBtn">Paste</button>' +
          '</div>' +
        '</div>' +
        '<div class="aim-error" id="uimError" style="display:none;">' + ICON_WARN +
          '<span id="uimErrorText"></span>' +
        '</div>' +
        '<div id="uimWorkWrap"></div>' +
        '<div class="aim-sec-head"><span class="aim-sec-title">Scan cost</span></div>' +
        '<div class="aim-quote" id="uimQuote"></div>' +
        '<div class="aim-note">A read costs one scan and returns a draft item — nothing is saved until you confirm it. A page we can’t reach isn’t charged.</div>' +
        '<div class="aim-foot">' +
          '<div class="aim-tally"><span class="aim-tally-l" id="uimTallyL"></span><span class="aim-tally-r" id="uimTallyR"></span></div>' +
          '<button type="button" class="aim-cta" id="uimCta">Read this page</button>' +
          '<button type="button" class="aim-ghost" id="uimManual">Enter this item by hand instead</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
    sheetEl = div;
    contentEl = div.querySelector('#uimContent');

    div.addEventListener('click', function (e) { if (e.target === div) close(); });
    document.getElementById('uimClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetEl.classList.contains('active')) close();
    });

    var input = document.getElementById('uimUrlInput');
    input.addEventListener('input', function (e) { raw = e.target.value; errorMsg = null; render(); });
    input.addEventListener('focus', function () { document.getElementById('uimUrlBox').dataset.focus = '1'; });
    input.addEventListener('blur',  function () { document.getElementById('uimUrlBox').dataset.focus = '0'; });
    document.getElementById('uimUrlBtn').addEventListener('click', urlAction);

    contentEl.addEventListener('click', function (e) {
      if (e.target.id === 'uimCta') { go(); return; }
      if (e.target.id === 'uimManual') { manual(); return; }
      if (e.target.id === 'uimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
    });

    return sheetEl;
  }

  function setUrl(s) {
    raw = s || '';
    var input = document.getElementById('uimUrlInput');
    if (input) input.value = raw;
    errorMsg = null;
    render();
  }

  function urlAction() {
    if (raw) { setUrl(''); return; }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (text) {
        if (text) setUrl(text.trim());
      }).catch(function () { /* clipboard permission denied — type/paste manually instead */ });
    }
  }

  function renderHead() {
    document.getElementById('uimSub').textContent = scansLeft() === null ? ''
      : (scansLeft() + ' scan' + (scansLeft() === 1 ? '' : 's') + ' left this month');
  }

  function renderField() {
    var l = link();
    var btn = document.getElementById('uimUrlBtn');
    if (!raw) { btn.className = ''; btn.textContent = 'Paste'; }
    else { btn.className = 'x'; btn.innerHTML = ICON_X; }
    document.getElementById('uimUrlBox').dataset.state = l && l.bad ? 'bad' : '';
  }

  function renderWork() {
    var el = document.getElementById('uimWorkWrap');
    if (!running) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="uim-work">' +
        '<div class="uim-work-l">' + (fakePct < 45 ? 'Fetching the page…' : fakePct < 80 ? 'Finding the item…' : 'Reading price and details…') + '</div>' +
        '<div class="uim-work-s">One scan, charged only if the page arrives.</div>' +
        '<div class="uim-work-track"><i style="width:' + fakePct + '%"></i></div>' +
      '</div>';
  }

  function renderQuote() {
    var need = cost();
    var el = document.getElementById('uimQuote');
    if (!usage) { el.innerHTML = '<div class="aim-q-why">Checking your scan balance…</div>'; return; }
    var mL = monthlyLeft(), bL = bonusLeft(), left = scansLeft();
    var fromMonthly = Math.min(need, mL), fromBonus = Math.min(need - fromMonthly, bL);
    var short = need - fromMonthly - fromBonus;
    function seg(color, cap, used) {
      if (!cap) return '';
      return '<span class="aim-q-seg" style="flex:' + cap + '"><i style="width:' + Math.round((used / cap) * 100) + '%;background:' + color + '"></i></span>';
    }
    var why = !need ? 'No readable link yet — nothing will be charged.'
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
      (short > 0 ? '<button type="button" class="aim-q-buy" id="uimBuyBtn">' + buyLabel() + '</button>' : '');
    if (short > 0 && !scanPackPrice) {
      fetch('/api/scan-pack-price').then(function (r) { return r.json(); }).then(function (p) {
        scanPackPrice = p;
        var btn = document.getElementById('uimBuyBtn');
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
    var el = document.getElementById('uimError');
    if (!el) return;
    if (errorMsg) {
      document.getElementById('uimErrorText').textContent = errorMsg;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  function renderFoot() {
    var l = link();
    document.getElementById('uimTallyL').textContent =
      running ? 'Reading…'
      : !raw ? 'No link yet'
      : (l && l.bad) ? 'Not a full web address'
      : (l ? l.host : '');
    document.getElementById('uimTallyR').textContent = usable() && !running ? cost() + ' scan' : '';
    var cta = document.getElementById('uimCta');
    cta.disabled = running || !usable() || !affordable();
    cta.textContent = running ? 'Reading…' : !usable() ? 'Read this page' : !affordable() ? 'Not enough scans' : 'Read this page · ' + cost() + ' scan';
  }

  function render() { renderHead(); renderField(); renderWork(); renderError(); renderQuote(); renderFoot(); }

  function startFakeProgress() {
    fakePct = 4;
    clearInterval(fakeTimer);
    fakeTimer = setInterval(function () {
      fakePct = Math.min(90, fakePct + Math.random() * 9);
      renderWork();
    }, 350);
  }
  function stopFakeProgress() { clearInterval(fakeTimer); fakeTimer = null; fakePct = 100; }

  async function go() {
    if (running || !usable() || !affordable()) return;
    running = true; errorMsg = null; render();
    startFakeProgress();
    try {
      var sb = window.supabaseClient;
      var sessionRes = sb ? await sb.auth.getSession() : null;
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (!session) throw new Error('You must be logged in to use this feature');

      var response = await fetch('/api/extract-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ url: link().href })
      });

      if (!response.ok) {
        var errorData;
        try {
          errorData = await response.json();
        } catch (parseErr) {
          console.error('[ShelfyUrlImportModal] Non-JSON error response — status:', response.status, 'body parse error:', parseErr);
          errorData = { error: 'Failed to process (unexpected server response, status ' + response.status + ')' };
        }
        if (response.status === 429) {
          throw new Error(errorData.message || errorData.error || 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.');
        }
        // errorData.details (when present) is the raw AgentQL error — not
        // shown to the user, but logged so a report of "it just failed,
        // no idea why" is actually diagnosable afterward.
        if (errorData.details) console.error('[ShelfyUrlImportModal] Extraction failed, server details:', errorData.details);
        throw new Error(errorData.error || "Couldn't read this page — check the link, or enter it by hand instead. This didn't use one of your scans.");
      }

      var result = await response.json();
      if (!result.success || !result.data) throw new Error('No data could be read from this page');

      stopFakeProgress();
      var data = result.data;
      var cb = currentOpts.onImported;
      lastScanUsed = true;
      close();
      if (cb) cb(data);
    } catch (err) {
      stopFakeProgress();
      running = false;
      console.error('[ShelfyUrlImportModal] Read failed:', err);
      errorMsg = err.message || 'Something went wrong';
      render();
    }
  }

  function manual() {
    var cb = currentOpts.onManual;
    close();
    if (cb) cb();
  }

  async function open(opts) {
    opts = opts || {};
    currentOpts = opts;
    raw = ''; running = false; errorMsg = null; usage = null;
    clearInterval(fakeTimer); fakeTimer = null;
    ensureSheet();
    var input = document.getElementById('uimUrlInput');
    if (input) input.value = '';
    sheetEl.classList.add('active');
    render();
    usage = (window.ShelfyCreateModal && typeof window.ShelfyCreateModal.checkUsage === 'function')
      ? await window.ShelfyCreateModal.checkUsage()
      : null;
    render();
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

  window.ShelfyUrlImportModal = { open: open, close: close, confirmScanUsed: confirmScanUsed, refundScan: refundScan };
})();
