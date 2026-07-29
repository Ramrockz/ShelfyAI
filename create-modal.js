// Shared "add item / expense / order" create-method sheet.
// One sheet, one context table — replaces the separate #methodModal /
// #methodSelectionModal / #orderMethodModal markup duplicated (and
// drifting out of sync on bonus_scans handling) across ingredients.html,
// expenses.html, orders.html and operations.html.
//
// Host pages keep their existing trigger/close/select function NAMES as
// thin wrappers over window.ShelfyCreateModal, so nothing else on those
// pages (empty-state CTAs, Escape handlers, offline branches, FAB
// shortcuts) needs to change beyond what calls into this file.
(function () {
  var ICON = {
    scan: 'scan-line',
    link: 'link',
    manual: 'edit-3',
    csv: 'file-spreadsheet',
    search: 'search'
  };

  var CONTEXTS = {
    ingredient: {
      title: 'Add item',
      subtitle: "Choose how you'd like to add your item",
      methods: [
        { id: 'image', ai: true, icon: ICON.scan, name: 'PDF / Image Upload', desc: 'Scan receipts or invoices' },
        { id: 'url', ai: true, icon: ICON.link, name: 'URL Import', desc: 'Extract from product pages' },
        { id: 'manual', ai: false, icon: ICON.manual, name: 'Manual Entry', desc: 'Fill out the form yourself' },
        { id: 'csv', ai: false, icon: ICON.csv, name: 'CSV Import', desc: 'Upload bulk data from Excel', desktopOnly: true }
      ]
    },
    expense: {
      title: 'Add expense',
      subtitle: "Choose how you'd like to add your expense",
      methods: [
        { id: 'upload', ai: true, icon: ICON.scan, name: 'PDF / Image Upload', desc: 'Scan receipts or invoices' },
        { id: 'manual', ai: false, icon: ICON.manual, name: 'Manual Entry', desc: 'Fill out the form yourself' }
      ]
    },
    order: {
      title: 'Add order',
      subtitle: 'Pick products and set quantities, or scan an order screenshot',
      methods: [
        { id: 'upload', ai: true, icon: ICON.scan, name: 'PDF / Image Upload', desc: 'Scan an order screenshot with AI' },
        { id: 'manual', ai: false, icon: ICON.search, name: 'Pick products', desc: 'Search your products and set quantities' }
      ]
    }
  };

  var TIER_LIMITS = { free: 5, starter: 100, pro: 300 };
  var UPGRADE_NEXT = {
    free: { name: 'Starter', desc: '100 scans a month, €9.99' },
    starter: { name: 'Pro', desc: '300 scans a month, €24.99' }
  };

  var sheetEl = null;
  var contentEl = null;
  var currentContextKey = null;
  var currentOnSelect = null;
  var lastUsage = null;
  var scanPackPrice = null; // cached across opens for the session

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function scansLeft(u) { return Math.max(0, u.limit - u.used); }
  function lowState(u) {
    var left = scansLeft(u);
    return left === 0 ? 'none' : left <= 2 ? 'low' : '';
  }

  async function checkUsage() {
    try {
      var sb = window.supabaseClient;
      if (!sb) return null;
      var sessionRes = await sb.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (!session) return null;

      var settingsRes = await sb.from('user_settings').select('tier, bonus_scans').eq('user_id', session.user.id).single();
      var settings = settingsRes && settingsRes.data;
      var tier = (settings && settings.tier) || 'free';
      var bonusScans = (settings && settings.bonus_scans) || 0;
      var planLimit = TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : 5;
      var limit = planLimit + bonusScans;

      var now = new Date();
      var yearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      var usageRes = await sb.from('ai_usage_tracking')
        .select('ingredient_count, order_count, expense_count')
        .eq('user_id', session.user.id)
        .gte('date', yearMonth + '-01')
        .lte('date', yearMonth + '-' + String(lastDay).padStart(2, '0'));
      var usageRecords = usageRes && usageRes.data;
      var used = usageRecords ? usageRecords.reduce(function (sum, r) {
        return sum + (r.ingredient_count || 0) + (r.order_count || 0) + (r.expense_count || 0);
      }, 0) : 0;

      lastUsage = { used: used, limit: limit, planLimit: planLimit, bonusScans: bonusScans, tier: tier, limitReached: used >= limit };
      return lastUsage;
    } catch (e) {
      console.error('[ShelfyCreateModal] Error checking AI usage:', e);
      return null;
    }
  }

  async function fetchScanPackPrice() {
    if (scanPackPrice) return scanPackPrice;
    try {
      var res = await fetch('/api/scan-pack-price');
      scanPackPrice = await res.json();
    } catch (e) {
      scanPackPrice = null;
    }
    return scanPackPrice;
  }

  function buyLabel(priceData) {
    if (priceData && priceData.configured && priceData.priceFormatted) {
      return 'Buy ' + (priceData.scanCount || 50) + ' scans · ' + priceData.priceFormatted;
    }
    return 'Buy 50 scans';
  }

  function ensureSheet() {
    if (sheetEl) return sheetEl;
    var div = document.createElement('div');
    div.className = 'modal-overlay modal-sheet';
    div.id = 'shelfyCreateSheet';
    div.innerHTML =
      '<div class="modal-content" id="shelfyCreateSheetContent">' +
        '<h3 id="scmTitle" style="margin-top:0; margin-bottom:4px;"></h3>' +
        '<p class="scm-subtitle" id="scmSubtitle"></p>' +
        '<div class="scm-methods" id="scmMethods"></div>' +
        '<div id="scmUsageArea"></div>' +
        '<button type="button" class="btn" id="scmCancelBtn" style="width:100%; margin-top:8px; background:var(--bg-panel); border:1px solid var(--border); color:var(--text-main);">Cancel</button>' +
      '</div>';
    document.body.appendChild(div);
    sheetEl = div;
    contentEl = div.querySelector('#shelfyCreateSheetContent');

    div.addEventListener('click', function (e) {
      if (e.target === div) close();
    });
    contentEl.addEventListener('click', function (e) {
      var row = e.target.closest('.scm-row');
      if (row && !row.classList.contains('locked')) {
        handleSelect(row.getAttribute('data-method'));
        return;
      }
      if (row && row.classList.contains('locked')) {
        nudgeBuyButton();
        return;
      }
      if (e.target.id === 'scmCancelBtn') { close(); return; }
      if (e.target.id === 'scmBuyBtn') { window.location.href = '/pricing#scan-pack'; return; }
      if (e.target.id === 'scmUpgradeLink') { window.location.href = '/pricing'; return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetEl.classList.contains('active')) close();
    });
    return sheetEl;
  }

  function nudgeBuyButton() {
    var btn = document.getElementById('scmBuyBtn');
    if (!btn) return;
    btn.classList.remove('nudge');
    void btn.offsetWidth; // restart animation
    btn.classList.add('nudge');
    btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function rowHtml(method, usage) {
    var locked = !!(method.ai && usage && usage.limitReached);
    var pill = '';
    if (method.ai && usage && !locked) {
      var left = scansLeft(usage);
      pill = '<span class="scm-scans-left ' + lowState(usage) + '">' + (left === 0 ? 'None left' : left + ' left') + '</span>';
    }
    var badge = locked ? '<span class="scm-row-badge">Limit reached</span>' : '';
    var chevron = !locked
      ? '<svg class="scm-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="15" height="15"><polyline points="9 6 15 12 9 18"/></svg>'
      : '';
    return (
      '<button type="button" class="scm-row' + (locked ? ' locked' : '') + '" data-method="' + esc(method.id) + '"' +
        (method.desktopOnly ? ' data-desktop-only="1"' : '') + '>' +
        '<span class="scm-row-icon"><i data-lucide="' + method.icon + '"></i></span>' +
        '<span class="scm-row-main">' +
          '<span class="scm-row-name">' + esc(method.name) + '</span>' +
          '<span class="scm-row-desc">' + (locked ? 'Needs an AI scan — none left this month' : esc(method.desc)) + '</span>' +
        '</span>' +
        badge + pill + chevron +
      '</button>'
    );
  }

  function usageHtml(usage) {
    if (!usage) return '';
    var pct = usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
    var state = lowState(usage);
    var html =
      '<div class="scm-meter-wrap">' +
        '<div class="scm-meter-track"><div class="scm-meter-fill ' + state + '" style="width:' + pct + '%"></div></div>' +
        '<div class="scm-meter-text">' + usage.used + ' of ' + usage.limit + ' AI scans used this month · shared across items, orders and expenses</div>' +
      '</div>';
    if (usage.limitReached) {
      var next = UPGRADE_NEXT[usage.tier];
      html +=
        '<div class="scm-upsell">' +
          '<p class="scm-upsell-headline">All ' + usage.limit + ' AI scans used this month</p>' +
          '<p class="scm-upsell-sub">Resets on the 1st. Scans are shared across items, orders and expenses.</p>' +
          '<button type="button" class="scm-buy-btn" id="scmBuyBtn">' + buyLabel(scanPackPrice) + '</button>' +
          "<p class=\"scm-buy-note\">One-off. Yours until you use them — they don't expire.</p>" +
          (next ? '<button type="button" class="scm-upgrade-link" id="scmUpgradeLink">Or move to ' + next.name + ' — ' + next.desc + '</button>' : '') +
        '</div>';
    }
    return html;
  }

  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  function renderMethods() {
    var ctx = CONTEXTS[currentContextKey];
    document.getElementById('scmTitle').textContent = ctx.title;
    document.getElementById('scmSubtitle').textContent = usage_subtitle(ctx);
    document.getElementById('scmMethods').innerHTML = ctx.methods.map(function (m) { return rowHtml(m, lastUsage); }).join('');
    document.getElementById('scmUsageArea').innerHTML = usageHtml(lastUsage);
    renderIcons();
    if (lastUsage && lastUsage.limitReached) {
      fetchScanPackPrice().then(function (priceData) {
        var btn = document.getElementById('scmBuyBtn');
        if (btn) btn.textContent = buyLabel(priceData);
      });
    }
  }

  function usage_subtitle(ctx) {
    if (lastUsage && lastUsage.limitReached) return 'Out of AI scans — manual entry still works.';
    return ctx.subtitle;
  }

  function handleSelect(methodId) {
    var cb = currentOnSelect;
    close();
    if (cb) cb(methodId);
  }

  async function open(contextKey, opts) {
    opts = opts || {};
    if (!CONTEXTS[contextKey]) { console.error('[ShelfyCreateModal] Unknown context:', contextKey); return; }
    currentContextKey = contextKey;
    currentOnSelect = opts.onSelect || null;
    ensureSheet();
    sheetEl.classList.add('active');
    renderMethods();
    var status = await checkUsage();
    if (opts.onUsage) opts.onUsage(status);
    renderMethods();
  }

  function close() {
    if (sheetEl) sheetEl.classList.remove('active');
  }

  window.ShelfyCreateModal = { open: open, close: close, checkUsage: checkUsage };
})();
