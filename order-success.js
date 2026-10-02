// "Order created" / "Expense recorded" success screen. Orders: shared by
// orders.html and operations.html (both duplicate the whole order-creation
// flow and end in showOrderSuccessScreen()); expenses: expenses.html's
// showExpenseSuccessScreen(). Renders the scrollable body only: cat,
// headline, total / lines / items touched, the SOLD (or BOUGHT) list and the
// INVENTORY UPDATED list with each item's stock counting down (order) or up
// (expense). Footer buttons and the order "Needs attention" list stay
// page-side.
//
// Needs scan-screen.js (the cat). Styles: the .os-* rules in styles.css.
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var fmtN = function (n) {
    n = Math.round(num(n) * 100) / 100;
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  var money = function (n) {
    return '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var reduced = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  var timers = [], raf = null;
  function clearTimers() { timers.forEach(clearTimeout); timers = []; if (raf) cancelAnimationFrame(raf); raf = null; }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }

  var COPY = {
    order: {
      title: function (who) { return 'Order from ' + (who || 'Customer') + ' created'; },
      total: 'order total', line: 'product', lineVerb: 'sold', inv: 'item', invVerb: 'used', sign: '−',
      sec: 'Sold', undo: 'Put this stock back',
      empty: ['No inventory items were linked to this order.', 'Inventory was not updated for this order.']
    },
    expense: {
      title: function (who) { return who ? 'Expense from ' + who + ' recorded' : 'Expense recorded'; },
      total: 'expense total', line: 'product', lineVerb: 'bought', inv: 'item', invVerb: 'restocked', sign: '+',
      sec: 'Bought', undo: 'Undo stock increase',
      empty: ['No inventory items were linked to this expense.', 'Inventory was not updated for this expense.']
    }
  };
  var plural = function (n, w) { return w + (n === 1 ? '' : 's'); };

  // data: {
  //   kind: 'order' (default) | 'expense',
  //   customer (order) / vendor (expense), total,
  //   sold: [{name, quantity, unit?, price? (each) | lineTotal?}],
  //   changes: [{id, name, oldQty, newQty, unit, status, minStock?}],  // status: ok | low_stock | out_of_stock
  //   inventoryUpdated: bool,
  //   onUndo: function (btn) | null
  // }
  function render(container, data) {
    clearTimers();
    var kind = data.kind === 'expense' ? 'expense' : 'order';
    var up = kind === 'expense';
    var T = COPY[kind];
    var sold = data.sold || [];
    var changes = data.changes || [];
    var rowsSold = sold.map(function (it, i) {
      var q = num(it.quantity) || 1;
      var unit = it.unit && !/^(pcs?|pieces?|stk)$/i.test(it.unit) ? ' ' + it.unit : '×';
      var line = it.lineTotal != null ? num(it.lineTotal) : q * num(it.price);
      return '<div class="os-sold-row os-in" data-i="' + i + '">' +
          '<span class="os-sold-qty">' + esc(fmtN(q) + unit) + '</span>' +
          '<span class="os-sold-name">' + esc(it.name || 'Product') + '</span>' +
          '<span class="os-sold-price">' + esc(money(line)) + '</span>' +
        '</div>';
    }).join('');

    var rowsInv = changes.map(function (c, i) {
      var before = num(c.oldQty), after = num(c.newQty);
      // Bar = the larger of the two quantities. Order: shrinks from full to
      // after/before. Expense: starts at before/after and grows to full.
      var pct = up
        ? (after > 0 ? Math.max(0, Math.min(100, (before / after) * 100)) : 0)
        : (before > 0 ? Math.max(0, Math.min(100, (after / before) * 100)) : 0);
      var pill = '';
      if (up) {
        // Restocking: a "Low stock" tag this purchase cleared fades out; one
        // that's still low afterwards stays.
        var minS = num(c.minStock);
        var wasLow = minS > 0 && before <= minS;
        if (c.status === 'low_stock') pill = '<span class="os-pill" data-state="low">Low stock</span>';
        else if (wasLow) pill = '<span class="os-pill" data-state="low" data-fade="1">Low stock</span>';
      } else {
        pill = c.status === 'out_of_stock' ? '<span class="os-pill" data-state="out">Out of stock</span>'
          : c.status === 'low_stock' ? '<span class="os-pill" data-state="low">Low stock</span>' : '';
      }
      var name = c.id
        ? '<a class="os-inv-name" href="/ingredient-detail?id=' + encodeURIComponent(c.id) + '">' + esc(c.name) + '</a>'
        : '<span class="os-inv-name">' + esc(c.name) + '</span>';
      return '<div class="os-inv-row os-in' + (up ? ' os-up' : '') + '" data-i="' + i + '" style="--after:' + pct.toFixed(1) + '%">' +
          '<div class="os-inv-top">' +
            '<div class="os-inv-l">' + name + pill + '</div>' +
            '<div class="os-inv-r">' +
              '<span class="os-from"><b>' + esc(fmtN(before)) + '</b>' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>' +
              '<span class="os-odo-wrap">' +
                '<span class="os-odo"><span class="os-odo-col"><b>' + esc(fmtN(before)) + '</b><b class="os-after">' + esc(fmtN(after)) + '</b></span></span>' +
                '<span class="os-unit">' + esc(c.unit || '') + '</span>' +
                '<span class="os-delta">' + T.sign + esc(fmtN(Math.abs(after - before))) + '</span>' +
              '</span>' +
            '</div>' +
          '</div>' +
          '<div class="os-bar"><i class="os-bar-base"></i><i class="os-bar-cut"></i></div>' +
        '</div>';
    }).join('');

    var invBody = changes.length ? rowsInv
      : '<div class="os-empty">' + esc(data.inventoryUpdated ? T.empty[0] : T.empty[1]) + '</div>';

    container.innerHTML =
      '<div class="os">' +
        '<div class="os-head">' +
          '<div class="os-cat" id="osCat" title="Again!"></div>' +
          '<div class="os-title os-in">' + esc(T.title(up ? data.vendor : data.customer)) + '</div>' +
        '</div>' +
        '<div class="os-stats">' +
          '<div class="os-stat os-in"><b id="osTotal">' + esc(money(0)) + '</b><span>' + T.total + '</span></div>' +
          '<div class="os-stat os-in"><b>' + sold.length + '</b><span>' + plural(sold.length, T.line) + ' ' + T.lineVerb + '</span></div>' +
          '<div class="os-stat os-in"><b>' + (changes.length ? T.sign + changes.length : '0') + '</b><span>' + plural(changes.length, T.inv) + ' ' + T.invVerb + '</span></div>' +
        '</div>' +
        (sold.length ? '<div class="os-sec os-sec-sold">' +
          '<div class="os-sec-head os-in"><span>' + T.sec + '</span><span>' + sold.length + ' ' + plural(sold.length, T.line) + '</span></div>' +
          '<div class="os-card os-in">' + rowsSold + '</div>' +
        '</div>' : '') +
        '<div class="os-sec os-inv">' +
          '<div class="os-sec-head os-in"><span>Inventory updated</span><span>' + changes.length + ' item' + (changes.length === 1 ? '' : 's') + '</span></div>' +
          '<div class="os-card os-in">' + invBody + '</div>' +
          (data.onUndo && changes.length ? '<button type="button" class="os-undo os-in" id="osUndo">' + T.undo + '</button>' : '') +
        '</div>' +
      '</div>';

    var catWrap = container.querySelector('#osCat');
    var hop = function () {
      if (!window.ShelfyScanScreen) return;
      catWrap.dataset.mode = '';
      window.ShelfyScanScreen.setCat(catWrap, 'celebrate', { big: true });
    };
    hop();
    catWrap.addEventListener('click', hop);
    var undo = container.querySelector('#osUndo');
    if (undo) undo.addEventListener('click', function () { data.onUndo(undo); });

    // ---- timeline (design: headline 150ms, stats 400-600ms, sections 900ms,
    // rows from 1100ms, each inventory row counts down in turn) ----
    var head = container.querySelector('.os-title');
    var stats = container.querySelectorAll('.os-stat');
    var secHeads = container.querySelectorAll('.os-sec-head, .os-card');
    var soldRows = container.querySelectorAll('.os-sold-row');
    var invRows = container.querySelectorAll('.os-inv-row');
    var undoBtn = container.querySelector('.os-undo');
    var on = function (el) { if (el) el.classList.add('on'); };
    // Long orders shouldn't take forever: stagger shrinks with the row count.
    var step = invRows.length ? Math.min(750, 3000 / invRows.length) : 0;
    var deductAt = function (i) { return 2000 + i * step; };
    var lastAt = invRows.length ? deductAt(invRows.length - 1) : 1300;

    if (reduced()) {
      container.querySelectorAll('.os-in').forEach(on);
      invRows.forEach(function (r) { r.classList.add('d', 'settled'); });
      document.getElementById('osTotal').textContent = money(data.total);
      return;
    }

    at(150, function () { on(head); });
    [400, 500, 600].forEach(function (ms, i) { at(ms, function () { on(stats[i]); }); });
    at(900, function () { secHeads.forEach(on); });
    soldRows.forEach(function (r, i) { at(1100 + i * 90, function () { on(r); }); });
    invRows.forEach(function (r, i) {
      at(1400 + i * 90, function () { on(r); });
      at(deductAt(i), function () { r.classList.add('d'); });
      at(deductAt(i) + 1100, function () { r.classList.add('settled'); });
    });
    at(lastAt + 500, function () { on(undoBtn); });

    // Total counts up over 900ms from 500ms (ease-out cubic).
    var totalEl = document.getElementById('osTotal');
    var start = performance.now() + 500, target = num(data.total);
    var tick = function (now) {
      var k = Math.min(1, Math.max(0, (now - start) / 900));
      totalEl.textContent = money(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  window.ShelfyOrderSuccess = { render: render, stop: clearTimers };
})();
