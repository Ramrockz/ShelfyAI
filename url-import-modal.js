// Shared "Import from URL" sheet — item creation only. Paste a supplier
// product page link, spend one scan reading it, then hand the draft off to
// whichever page opened this (same onImported(data) callback shape as
// import-modal.js's onImported(data, receiptUrl), minus the receipt URL
// since there's no file here). The page turns that draft into a prefilled
// New Item form itself — this component only owns the URL field, the
// scan-cost quote, the reading screen, and the actual /api/extract-url call.
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
  var usage = null;
  var errorMsg = null;   // inline banner text (429 limit etc.), idle phase only
  var scanPackPrice = null;
  // 'idle' (URL field) | 'loading' | 'done' (draft ready, waiting for
  // "Review draft item") | 'failed' (read failed, see failCode)
  var phase = 'idle';
  var failCode = null, failMsg = null, failStage = 0;
  var draft = null;
  // Reading-screen timeline. The real read is one request with no progress
  // of its own, so the four steps advance on a timer and hold on the last
  // one until the response arrives; an early response fast-forwards the
  // remaining steps instead of jumping straight to "done".
  var t0 = 0, tickTimer = null, resultAt = null, resultStage = 0, curStage = 0;
  // Bumped by every close()/new read so a response arriving after the
  // sheet was closed (or a newer read started) is recognized as stale.
  var runId = 0;
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
  var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  var ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';

  var STAGES = [
    { label: 'Opening the page', title: 'Opening the page…', ms: 1800 },
    { label: 'Reading the page', title: 'Reading the page…', sub: 'One scan, charged only if the page arrives.', ms: 2200 },
    { label: 'Finding the item', title: 'Finding the item…', sub: 'Looking for title, price and photo.', ms: 2400 },
    { label: 'Drafting your item', title: 'Drafting your item…', sub: 'Almost there.' }
  ];
  var FF_MS = 280; // per remaining step once the response is in

  // Real, distinguishable scan-step failures (api/extract-url.js's `code`) --
  // the 429 limit keeps using the small inline .aim-error banner instead.
  // `stage` is the step shown as failed; null = whichever step was running.
  // timeout/malformed/no_match all return before extract-url.js increments
  // usage, so those are definitely not charged; 'unknown' is the server's
  // own outer catch (genuinely unsure), 'client' never reached the server.
  var FAILS = {
    'scan.timeout':   { stage: 1, title: 'The page took too long', sub: function (host) { return host + ' stopped answering. No scan was charged.'; } },
    'scan.malformed': { stage: 1, title: 'The scan failed', sub: function () { return 'It came back broken. We’ve logged it. No scan was charged.'; } },
    'scan.no_match':  { stage: 2, title: 'No product on that page', sub: function () { return 'No title or price found. Check the link points at one product. No scan was charged.'; } },
    'unknown':        { stage: null, title: 'Something went wrong', sub: null },
    'client':         { stage: null, title: 'Something went wrong', sub: null }
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
  function host()       { var l = link(); return (l && l.host) || 'the site'; }

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
        '<div class="uim-field-wrap">' +
          '<div class="uim-url" id="uimUrlBox">' +
            '<input id="uimUrlInput" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://supplier.com/product">' +
            '<button type="button" id="uimUrlBtn">Paste</button>' +
          '</div>' +
        '</div>' +
        '<div class="aim-error" id="uimError" style="display:none;">' + ICON_WARN +
          '<span id="uimErrorText"></span>' +
        '</div>' +
        '<div id="uimWorkWrap"></div>' +
        '<div id="uimOutOfScans" style="display:none;"></div>' +
        '<div class="aim-foot">' +
          '<button type="button" class="aim-cta" id="uimCta">Scan page</button>' +
          '<div id="uimAlt"></div>' +
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
    input.addEventListener('input', function (e) { raw = e.target.value; toIdle(); });
    input.addEventListener('focus', function () { document.getElementById('uimUrlBox').dataset.focus = '1'; });
    input.addEventListener('blur',  function () { document.getElementById('uimUrlBox').dataset.focus = '0'; });
    document.getElementById('uimUrlBtn').addEventListener('click', urlAction);

    contentEl.addEventListener('click', function (e) {
      var id = e.target.closest && e.target.closest('button') && e.target.closest('button').id;
      if (id === 'uimCta') { ctaClick(); return; }
      if (id === 'uimManual') { manual(); return; }
      if (id === 'uimBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
      if (id === 'uimErrScreenshot') { errToScreenshot(); return; }
      if (id === 'uimErrAnotherLink') { setUrl(''); var i = document.getElementById('uimUrlInput'); if (i) i.focus(); return; }
      if (id === 'uimErrSupport') { window.location.href = 'mailto:support@shelfyai.com?subject=' + encodeURIComponent('ShelfyAI error ' + (failCode || 'unknown')); return; }
    });

    return sheetEl;
  }

  // Back to the plain URL field -- editing the link after a failed read,
  // or "Try another link". Never interrupts a read that's still running.
  function toIdle() {
    if (phase === 'loading' || phase === 'done') return;
    phase = 'idle'; failCode = null; failMsg = null; errorMsg = null;
    render();
  }

  function setUrl(s) {
    raw = s || '';
    var input = document.getElementById('uimUrlInput');
    if (input) input.value = raw;
    toIdle();
  }

  function urlAction() {
    if (phase === 'loading' || phase === 'done') return;
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
    var busy = phase === 'loading' || phase === 'done';
    var input = document.getElementById('uimUrlInput');
    input.readOnly = busy;
    var btn = document.getElementById('uimUrlBtn');
    btn.style.visibility = busy ? 'hidden' : '';
    if (!raw) { btn.className = ''; btn.textContent = 'Paste'; }
    else { btn.className = 'x'; btn.innerHTML = ICON_X; }
    var ok = usable() && phase === 'idle';
    document.getElementById('uimUrlBox').dataset.state = l && l.bad ? 'bad' : (ok ? 'ok' : '');
  }

  // ---------- Reading screen ----------

  // Built once per read; paint() then only touches what changed, so the
  // CSS animations (cat, spinners, shimmer) aren't restarted every tick.
  function buildWork() {
    var el = document.getElementById('uimWorkWrap');
    el.innerHTML =
      '<div class="uim-cat-wrap" id="uimCatWrap"></div>' +
      '<div class="uim-work">' +
        '<div class="uim-hl" id="uimHl"></div>' +
        '<div class="uim-bar"><i id="uimBar"><b></b></i></div>' +
        '<div class="uim-steps">' + STAGES.map(function (s, i) {
          return '<div class="uim-step" id="uimStep' + i + '" data-s="">' +
            '<span class="uim-step-ic"></span><span class="uim-step-l">' + esc(s.label) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="uim-prev" id="uimPrev" data-state="wait">' +
          '<div class="uim-prev-img"><div class="uim-prev-photo" id="uimPrevPhoto"></div><i class="uim-scanline"></i></div>' +
          '<div class="uim-prev-txt">' +
            '<div class="uim-prev-row"><span class="uim-skel uim-skel-t"><b></b></span><div class="uim-prev-t" id="uimPrevT"></div></div>' +
            '<div class="uim-prev-row uim-prev-row-sm"><span class="uim-skel uim-skel-p"><b></b></span><div class="uim-prev-p" id="uimPrevP"></div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function setHeadline(title, sub, failed) {
    var hl = document.getElementById('uimHl');
    if (!hl || hl.dataset.key === title + '|' + sub) return;
    hl.dataset.key = title + '|' + sub;
    hl.innerHTML = '<div class="uim-hl-in"><div class="uim-hl-t"' + (failed ? ' data-failed="1"' : '') + '>' + esc(title) + '</div>' +
      (sub ? '<div class="uim-hl-s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function setSteps(stateFor) {
    STAGES.forEach(function (s, i) {
      var st = document.getElementById('uimStep' + i);
      var state = stateFor(i);
      if (!st || st.dataset.s === state) return;
      st.dataset.s = state;
      st.querySelector('.uim-step-ic').innerHTML = window.ShelfyScanScreen.stepIconHtml(state);
    });
  }

  function setBar(pct, failed) {
    var bar = document.getElementById('uimBar');
    if (!bar) return;
    bar.style.width = pct + '%';
    bar.dataset.failed = failed ? '1' : '';
  }

  function fillPreview() {
    var prev = document.getElementById('uimPrev');
    if (!prev || !draft) return;
    var photo = document.getElementById('uimPrevPhoto');
    if (draft.image_url) {
      var img = document.createElement('img');
      img.alt = draft.name || '';
      img.onerror = function () { photo.innerHTML = '<span class="uim-prev-ph">' + ICON_BOX + '</span>'; };
      img.src = draft.image_url;
      photo.innerHTML = '';
      photo.appendChild(img);
    } else {
      photo.innerHTML = '<span class="uim-prev-ph">' + ICON_BOX + '</span>';
    }
    document.getElementById('uimPrevT').textContent = draft.name || 'Untitled item';
    // sku falls back to the item name server-side (extract-url.js) --
    // don't repeat the name as if it were a product code.
    var bits = [draft.price, draft.sku && draft.sku !== draft.name ? draft.sku : null, host()].filter(Boolean);
    document.getElementById('uimPrevP').textContent = bits.join(' · ');
    prev.dataset.state = 'done';
  }

  function ease(f) { return 1 - Math.pow(1 - f, 2); }

  // Which step the timeline is on right now, and how far into it (0..1).
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
    var st = STAGES[curStage];
    setHeadline(st.title, curStage === 0 ? 'Connecting to ' + host() : st.sub, false);
    setBar(Math.min(97, ((curStage + ease(Math.min(tl.frac, 1)) * 0.9) / STAGES.length) * 100), false);
    setSteps(function (i) { return i < curStage ? 'done' : i === curStage ? 'active' : 'todo'; });
    window.ShelfyScanScreen.setCat(document.getElementById('uimCatWrap'), curStage === 0 ? 'look' : 'read');
    var prev = document.getElementById('uimPrev');
    if (prev) prev.dataset.state = curStage >= 1 ? 'scan' : 'wait';
    renderFoot();
  }

  function stopTimeline() { clearInterval(tickTimer); tickTimer = null; }

  function finishDone() {
    stopTimeline();
    phase = 'done';
    // Charged server-side the moment the read succeeded -- refunded again
    // if this draft gets discarded instead of reviewed (see close()).
    lastScanUsed = true;
    render();
  }

  function paintWork() {
    if (phase === 'done') {
      setHeadline('Item found', 'Check the draft before saving it.', false);
      setBar(100, false);
      setSteps(function () { return 'done'; });
      window.ShelfyScanScreen.setCat(document.getElementById('uimCatWrap'), 'celebrate');
      fillPreview();
    } else if (phase === 'failed') {
      var f = FAILS[failCode] || FAILS.client;
      setHeadline(f.title, f.sub ? f.sub(host()) : (failMsg || 'Please try again.'), true);
      setBar(100, true);
      setSteps(function (i) { return i < failStage ? 'done' : i === failStage ? 'failed' : 'todo'; });
      window.ShelfyScanScreen.setCat(document.getElementById('uimCatWrap'), 'sad');
      var prev = document.getElementById('uimPrev');
      if (prev) prev.dataset.state = 'failed';
    }
  }

  function renderWork() {
    var el = document.getElementById('uimWorkWrap');
    if (phase === 'idle') { el.innerHTML = ''; return; }
    if (!document.getElementById('uimHl')) buildWork();
    if (phase === 'loading') tick(); else paintWork();
  }

  // Only surfaces when the user is actually short on scans -- the full cost
  // breakdown (segmented usage bar, "why" explainer, running tally) was
  // stripped as clutter, but the "buy more scans" path has to survive since
  // it's a real purchase funnel, not bookkeeping.
  function renderOutOfScans() {
    var need = cost();
    var el = document.getElementById('uimOutOfScans');
    if (phase !== 'idle' || !usage || !need || scansLeft() >= need) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '<button type="button" class="aim-q-buy" id="uimBuyBtn">' + buyLabel() + '</button>';
    if (!scanPackPrice) {
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
    if (errorMsg && phase === 'idle') {
      document.getElementById('uimErrorText').textContent = errorMsg;
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  }

  function renderFoot() {
    var cta = document.getElementById('uimCta');
    var label, mode;
    if (phase === 'loading') { mode = 'loading'; label = curStage === 0 ? 'Opening' : 'Reading'; }
    else if (phase === 'done') { mode = 'done'; label = 'Review draft item'; }
    else if (phase === 'failed') { mode = 'failed'; label = 'Try again'; }
    else { mode = 'idle'; label = !affordable() ? 'Not enough scans' : 'Scan page'; }
    cta.disabled = mode === 'loading' || (mode !== 'done' && (!usable() || !affordable()));
    if (cta.dataset.key !== mode + '|' + label) {
      cta.dataset.key = mode + '|' + label;
      cta.dataset.mode = mode;
      cta.innerHTML = mode === 'loading'
        ? '<i class="uim-cta-sh"></i><span>' + label + '</span><span class="uim-dots"><i></i><i></i><i></i></span>'
        : esc(label);
    }
    var alt = document.getElementById('uimAlt');
    var altHtml = '';
    if (phase === 'failed' && failCode === 'scan.no_match') {
      altHtml = '<button type="button" class="aim-ghost" id="uimErrScreenshot">Import a screenshot instead</button>' +
        '<button type="button" class="aim-ghost" id="uimErrAnotherLink">Try another link</button>';
    } else if (phase === 'failed' && (failCode === 'unknown' || failCode === 'client')) {
      altHtml = '<button type="button" class="aim-ghost" id="uimErrSupport">Send to support</button>';
    }
    if (alt.dataset.key !== altHtml) { alt.dataset.key = altHtml; alt.innerHTML = altHtml; }
  }

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

  function render() {
    renderHead(); renderField(); renderWork(); renderError(); renderOutOfScans(); renderFoot();
  }

  function ctaClick() {
    if (phase === 'done') { review(); return; }
    if (phase === 'idle' || phase === 'failed') go();
  }

  function review() {
    var cb = currentOpts.onImported, data = draft;
    phase = 'idle'; // handed over -- close() mustn't treat this as a discard
    close();
    if (cb) cb(data);
  }

  async function go() {
    if (phase === 'loading' || !usable() || !affordable()) return;
    var myRun = ++runId;
    phase = 'loading'; failCode = null; failMsg = null; errorMsg = null; draft = null;
    resultAt = null; curStage = 0; t0 = performance.now();
    document.getElementById('uimWorkWrap').innerHTML = '';
    render();
    stopTimeline();
    tickTimer = setInterval(tick, 60);
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
          var eLimit = new Error(errorData.message || errorData.error || (window.SHELFY_NATIVE_APP ? 'Monthly scan limit reached. Enter it by hand instead.' : 'Monthly scan limit reached. Buy a scan pack, or enter it by hand instead.'));
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

      var data = result.data;
      // The extracted data has no idea what page it came from -- keep the
      // actual URL the user pasted so the resulting form can link back to
      // it (to double-check details or reorder from the same page fast).
      data.source_url = link().href;
      if (myRun !== runId) {
        // Sheet was closed mid-read -- nobody's going to review this draft.
        lastScanUsed = true;
        refundScan();
        return;
      }
      draft = data;
      resultStage = curStage;
      resultAt = performance.now();
    } catch (err) {
      if (myRun !== runId) return;
      stopTimeline();
      console.error('[ShelfyUrlImportModal] Read failed:', err);
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

  async function open(opts) {
    opts = opts || {};
    currentOpts = opts;
    runId++; stopTimeline();
    raw = ''; phase = 'idle'; failCode = null; failMsg = null; errorMsg = null; usage = null; draft = null;
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
    runId++; stopTimeline();
    window.ShelfyScanScreen.stopCat();
    // A finished draft closed without "Review draft item" is a discard.
    if (phase === 'done') refundScan();
    phase = 'idle';
    if (!sheetEl) return;
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
    document.getElementById('uimWorkWrap').innerHTML = '';
  }

  window.ShelfyUrlImportModal = { open: open, close: close, confirmScanUsed: confirmScanUsed, refundScan: refundScan, markPending: markPending, hasPending: hasPending };
})();
