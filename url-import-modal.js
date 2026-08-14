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
  var errorCode = null; // one of ERR_CARDS's keys, or null for the old inline banner (429 etc.)
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

  // Lets a page ask "would closing right now discard an unconfirmed scan?"
  // before it actually closes, so it can warn the user first instead of
  // silently refunding behind their back (refundScan() still runs either
  // way, but re-doing the scan later costs another one).
  function hasPending() { return lastScanUsed; }

  // A scan taken on a *different* page (operations.html's dashboard, which
  // hands the draft off via sessionStorage instead of prefilling its own
  // modal -- see startIngredientUrlImport() there) has no way to have set
  // lastScanUsed on THIS page's instance of this module, since each page
  // load gets a fresh closure. Called once the hand-off's draft has been
  // applied here, so refundScan() still works if the user then discards it.
  function markPending() { lastScanUsed = true; }

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
  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  // Error-card icons (34b reference set)
  var ICON_TRIANGLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><path d="M12 3.4L1.6 20.6h20.8z"/><line x1="12" y1="10" x2="12" y2="15.2"/><line x1="12" y1="17.7" x2="12" y2="17.8"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><circle cx="12" cy="12" r="9.2"/><polyline points="12 7 12 12 15.6 14"/></svg>';
  var ICON_SEARCH_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><circle cx="10.5" cy="10.5" r="6.6"/><line x1="15.4" y1="15.4" x2="21" y2="21"/><line x1="8" y1="10.5" x2="13" y2="10.5"/></svg>';
  var ICON_CHECK_SM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="4 12.6 9.2 17.6 20 6.6"/></svg>';

  // Real, distinguishable scan-step failures (api/extract-url.js's `code`) --
  // everything else (429 limit reached, a thrown Error with no code) keeps
  // using the small inline .aim-error banner below instead of this takeover.
  var ERR_CARDS = {
    'scan.timeout': { tone: 'warn', icon: ICON_CLOCK, headline: 'The read took too long' },
    'scan.malformed': { tone: 'bad', icon: ICON_TRIANGLE, headline: 'The scan failed',
      message: 'It came back broken. We’ve logged it.' },
    'scan.no_match': { tone: 'warn', icon: ICON_SEARCH_X, headline: 'No product on that page',
      message: 'No title or price found. Check the link points at one product.' },
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
          '<button type="button" class="aim-close" id="uimClose" aria-label="Back">' + ICON_BACK + '</button>' +
          '<span class="aim-titles">' +
            '<span class="aim-title">Import from URL</span>' +
            '<span class="aim-sub" id="uimSub"></span>' +
          '</span>' +
        '</div>' +
        '<div id="uimNormalBody">' +
          '<div class="uim-field-wrap">' +
            '<div class="uim-url" id="uimUrlBox"><span id="uimUrlIcon">' + ICON_LINK + '</span>' +
              '<input id="uimUrlInput" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://supplier.com/product">' +
              '<button type="button" id="uimUrlBtn">Paste</button>' +
            '</div>' +
            '<div class="uim-field-hint" id="uimFieldHint" style="display:none;"></div>' +
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
        '</div>' +
        '<div id="uimErrCard" style="display:none;"></div>' +
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
    input.addEventListener('input', function (e) { raw = e.target.value; errorMsg = null; errorCode = null; render(); });
    input.addEventListener('focus', function () { document.getElementById('uimUrlBox').dataset.focus = '1'; });
    input.addEventListener('blur',  function () { document.getElementById('uimUrlBox').dataset.focus = '0'; });
    document.getElementById('uimUrlBtn').addEventListener('click', urlAction);

    contentEl.addEventListener('click', function (e) {
      if (e.target.id === 'uimCta') { go(); return; }
      if (e.target.id === 'uimManual') { manual(); return; }
      if (e.target.id === 'uimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
      if (e.target.id === 'uimErrRetry') { go(); return; }
      if (e.target.id === 'uimErrScreenshot') { errToScreenshot(); return; }
      if (e.target.id === 'uimErrAnotherLink') { setUrl(''); var i = document.getElementById('uimUrlInput'); if (i) i.focus(); return; }
      if (e.target.id === 'uimErrManual') { manual(); return; }
      if (e.target.id === 'uimErrBack') { dismissErrCard(); return; }
      if (e.target.id === 'uimErrSupport') { window.location.href = 'mailto:support@shelfyai.com?subject=' + encodeURIComponent('ShelfyAI error ' + (errorCode || 'unknown')); return; }
      if (e.target.id === 'uimErrClose') { close(); return; }
      if (e.target.id === 'uimErrCopy') { copyErrCode(); return; }
    });

    return sheetEl;
  }

  function setUrl(s) {
    raw = s || '';
    var input = document.getElementById('uimUrlInput');
    if (input) input.value = raw;
    errorMsg = null;
    errorCode = null;
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
    var ok = usable() && !running;
    document.getElementById('uimUrlBox').dataset.state = l && l.bad ? 'bad' : (ok ? 'ok' : '');
    var icon = document.getElementById('uimUrlIcon');
    if (icon) icon.innerHTML = ok ? ICON_CHECK_SM : ICON_LINK;
    // The field alone doesn't make it obvious the paste registered or what
    // to do next -- a valid link only otherwise shows up as a subtle border
    // color and a hostname buried in the footer tally below the scan-cost
    // section, which is easy to miss (see user report: "not clear the
    // pasting worked and how to proceed").
    var hint = document.getElementById('uimFieldHint');
    if (hint) {
      if (ok) {
        hint.style.display = 'flex';
        hint.innerHTML = ICON_CHECK_SM + '<span>Link recognized — tap “Read this page” below to continue</span>';
      } else {
        hint.style.display = 'none';
      }
    }
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

  // Full card takeover for a real, distinguishable scan-step failure (see
  // ERR_CARDS) -- everything else (limit reached etc.) stays on the small
  // inline banner above, which already has its own good resolution path.
  function renderErrCard() {
    var card = ERR_CARDS[errorCode];
    var el = document.getElementById('uimErrCard');
    if (!card) return;
    var msg = card.message;
    if (errorCode === 'scan.timeout') {
      var l = link();
      msg = (l && l.host ? l.host : 'That site') + ' stopped answering.';
    }
    if (errorCode === 'unknown' || errorCode === 'client') msg = errorMsg || msg;
    var scansLeftTxt = usage ? (' ' + scansLeft() + ' left this month.') : '';
    var keepHtml = card.uncertain
      ? '<div class="aim-err-keep" data-tone="warn">' + ICON_WARN + '<span><b>Can’t confirm</b> whether this used a scan.</span></div>'
      : '<div class="aim-err-keep" data-tone="ok">' + ICON_CHECK_SM + '<span><b>No scan charged.</b>' + esc(scansLeftTxt) + '</span></div>';
    var actsHtml;
    if (errorCode === 'scan.no_match') {
      actsHtml =
        '<button type="button" class="aim-err-cta" id="uimErrScreenshot">Import a screenshot</button>' +
        '<button type="button" class="aim-err-alt" id="uimErrAnotherLink">Try another link</button>' +
        '<button type="button" class="aim-err-ghost" id="uimErrManual">Enter by hand</button>';
    } else if (errorCode === 'unknown' || errorCode === 'client') {
      actsHtml =
        '<button type="button" class="aim-err-cta" id="uimErrRetry">Try again</button>' +
        '<button type="button" class="aim-err-alt" id="uimErrSupport">Send to support</button>' +
        '<button type="button" class="aim-err-ghost" id="uimErrClose">Close</button>';
    } else {
      actsHtml =
        '<button type="button" class="aim-err-cta" id="uimErrRetry">Try again</button>' +
        '<button type="button" class="aim-err-alt" id="uimErrManual">Enter by hand</button>' +
        '<button type="button" class="aim-err-ghost" id="uimErrBack">Back</button>';
    }
    var reqCode = errorCode + ' · agentql · req_' + Math.random().toString(36).slice(2, 8);
    el.dataset.reqCode = reqCode;
    el.innerHTML =
      '<div class="aim-err-mark" data-tone="' + card.tone + '">' + card.icon + '</div>' +
      '<h3 class="aim-err-h">' + esc(card.headline) + '</h3>' +
      '<p class="aim-err-p">' + esc(msg) + '</p>' +
      keepHtml +
      '<p class="aim-err-code">' + esc(reqCode) + '<button type="button" id="uimErrCopy">Copy</button></p>' +
      '<div class="aim-err-acts">' + actsHtml + '</div>';
  }

  function dismissErrCard() { errorCode = null; errorMsg = null; render(); }

  function errToScreenshot() {
    var opts = currentOpts;
    close();
    if (!window.ShelfyImportModal || typeof window.ShelfyImportModal.open !== 'function') return;
    window.ShelfyImportModal.open('ingredient', {
      onManual: opts.onManual,
      // import-modal.js hands back {item:[...]} (possibly several rows);
      // this page's onImported was built for THIS module's flat single-item
      // shape (applyUrlScanToManualModal(data)-style) -- adapt the first
      // item into that shape so it still populates correctly when reached
      // via this cross-link, instead of silently reading undefined fields.
      onImported: function (data) {
        var item = (data.item && data.item[0]) || {};
        if (opts.onImported) opts.onImported({
          vendor: data.vendor || null,
          name: item.name || null,
          price: item.price || null,
          sku: item.SKU || null,
          quantity: item.quantity || null,
          color: (item.attributes && item.attributes.color) || null,
          size: (item.attributes && item.attributes.size) || null
        });
      }
    });
  }

  function copyErrCode() {
    var el = document.getElementById('uimErrCard');
    var text = (el && el.dataset.reqCode) || '';
    if (navigator.clipboard && navigator.clipboard.writeText && text) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  function render() {
    var isCard = !!ERR_CARDS[errorCode];
    document.getElementById('uimNormalBody').style.display = isCard ? 'none' : '';
    document.getElementById('uimErrCard').style.display = isCard ? 'block' : 'none';
    renderHead();
    if (isCard) { renderErrCard(); return; }
    renderField(); renderWork(); renderError(); renderQuote(); renderFoot();
  }

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
    running = true; errorMsg = null; errorCode = null; render();
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
          var eLimit = new Error(errorData.message || errorData.error || 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.');
          eLimit.limitReached = true;
          throw eLimit;
        }
        // errorData.details (when present) is the raw AgentQL error — not
        // shown to the user, but logged so a report of "it just failed,
        // no idea why" is actually diagnosable afterward.
        if (errorData.details) console.error('[ShelfyUrlImportModal] Extraction failed, server details:', errorData.details);
        var eBad = new Error(errorData.error || "Couldn't read this page — check the link, or enter it by hand instead. This didn't use one of your scans.");
        eBad.code = errorData.code;
        throw eBad;
      }

      var result = await response.json();
      if (!result.success || !result.data) {
        var eEmpty = new Error(result.error || 'No data could be read from this page');
        eEmpty.code = result.code;
        throw eEmpty;
      }

      stopFakeProgress();
      var data = result.data;
      // The extracted data has no idea what page it came from -- keep the
      // actual URL the user pasted so the resulting form can link back to
      // it (to double-check details or reorder from the same page fast).
      data.source_url = link().href;
      var cb = currentOpts.onImported;
      lastScanUsed = true;
      close();
      if (cb) cb(data);
    } catch (err) {
      stopFakeProgress();
      running = false;
      console.error('[ShelfyUrlImportModal] Read failed:', err);
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

  async function open(opts) {
    opts = opts || {};
    currentOpts = opts;
    raw = ''; running = false; errorMsg = null; errorCode = null; usage = null;
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

  window.ShelfyUrlImportModal = { open: open, close: close, confirmScanUsed: confirmScanUsed, refundScan: refundScan, markPending: markPending, hasPending: hasPending };
})();
