// Shared "what did this do to inventory" success-screen renderer.
// One render function for both contexts — order (stock came out) and
// expense (stock went in) — matching the 12b reference. Each page keeps
// its own footer buttons (the action set differs per page), only the
// scrollable body (head/figures, stock rows, unmatched lines, note, undo)
// is rendered here.
(function () {
  var ICONS = {
    check: '<polyline points="20 6 9 17 4 12"/>',
    arrow: '<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>'
  };
  var svg = function (k, w, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) +
      '" stroke-linecap="round" stroke-linejoin="round" width="' + w + '" height="' + w + '">' + ICONS[k] + '</svg>';
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var fmt = function (v) {
    var n = parseFloat(v) || 0;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  };

  // "low" depends on min_stock, which only the caller has loaded, so it
  // must be passed explicitly via r.state; out/short are derivable from
  // the new quantity alone.
  function stateFor(r) {
    if (r.state) return r.state;
    if (r.to < 0) return 'short';
    if (r.to === 0) return 'out';
    return '';
  }
  function flagFor(r, st) {
    if (r.flag) return r.flag;
    return st === 'short' ? ('Short ' + Math.abs(r.to)) : st === 'out' ? 'Out of stock' : st === 'low' ? 'Low' : '';
  }

  function rowHtml(r) {
    var st = stateFor(r);
    var flag = flagFor(r, st);
    var nameHtml = r.href
      ? '<a class="stock-name" href="' + r.href + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>'
      : '<span class="stock-name">' + esc(r.name) + '</span>';
    return (
      '<div class="stock-row">' +
        '<span class="stock-main">' +
          nameHtml +
          (r.why ? '<span class="stock-why">' + esc(r.why) + '</span>' : '') +
        '</span>' +
        (flag ? '<span class="stock-flag" data-state="' + st + '">' + esc(flag) + '</span>' : '') +
        '<span class="stock-delta">' +
          '<span class="stock-from">' + fmt(r.from) + '</span>' +
          '<span class="stock-arrow">' + svg('arrow', 15, 2.1) + '</span>' +
          '<span class="stock-to" data-state="' + st + '">' + fmt(r.to) +
            (r.unit ? '<span class="stock-unit">' + esc(r.unit) + '</span>' : '') +
          '</span>' +
        '</span>' +
      '</div>'
    );
  }

  function unmatchedHtml(unmatched) {
    if (!unmatched || !unmatched.length) return '';
    return (
      '<div class="ii-sec">' +
        '<div class="ii-sec-head">' +
          '<span class="ii-sec-title">Not in inventory</span>' +
          '<span class="ii-sec-note">' + unmatched.length + ' line' + (unmatched.length > 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div class="ii-list">' +
          unmatched.map(function (u, i) {
            return (
              '<div class="ii-un">' +
                '<span class="ii-un-main">' +
                  '<span class="ii-un-name">' + esc(u.name) + '</span>' +
                  '<span class="ii-un-why">' + esc(u.why) + '</span>' +
                '</span>' +
                (u.action ? '<button type="button" class="ii-un-btn" data-idx="' + i + '">' + esc(u.action) + '</button>' : '') +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  // Renders into `container`. data: { title, sub, figs: [[value,label]],
  // secTitle, secNote, rows: [{name,from,to,unit?,why?,href?,state?,flag?}],
  // unmatched: [{name,why,action?,onAdd?}], note, undo: {label, onClick} }
  function render(container, data) {
    var hasRows = data.rows && data.rows.length > 0;
    var rows = hasRows
      ? data.rows.map(rowHtml).join('')
      : '<div style="padding:22px 14px;text-align:center;color:var(--text-muted);font-size:13px;">' +
          esc(data.emptyText || 'No stock was affected.') + '</div>';
    container.innerHTML =
      '<div class="ii-head">' +
        '<span class="ii-check">' + svg('check', 22, 2.6) + '</span>' +
        '<div class="ii-title">' + esc(data.title) + '</div>' +
        (data.sub ? '<div class="ii-sub">' + esc(data.sub) + '</div>' : '') +
        (data.figs && data.figs.length
          ? '<div class="ii-figs">' + data.figs.map(function (f) {
              return '<span><span class="ii-fig-n">' + esc(f[0]) + '</span><span class="ii-fig-l">' + esc(f[1]) + '</span></span>';
            }).join('') + '</div>'
          : '') +
      '</div>' +
      '<div class="ii-sec">' +
        '<div class="ii-sec-head">' +
          '<span class="ii-sec-title">' + esc(data.secTitle) + '</span>' +
          '<span class="ii-sec-note">' + esc(data.secNote) + '</span>' +
        '</div>' +
        '<div class="ii-list">' + rows + '</div>' +
      '</div>' +
      unmatchedHtml(data.unmatched) +
      (data.note ? '<div class="ii-note">' + esc(data.note) + '</div>' : '') +
      (data.undo ? '<button type="button" class="ii-undo" id="iiUndoBtn">' + esc(data.undo.label) + '</button>' : '');

    if (data.unmatched && data.unmatched.length) {
      var btns = container.querySelectorAll('.ii-un-btn');
      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.dataset.idx, 10);
          var u = data.unmatched[i];
          if (u && u.onAdd) u.onAdd(btn);
        });
      });
    }
    if (data.undo) {
      var undoBtn = container.querySelector('#iiUndoBtn');
      if (undoBtn) undoBtn.addEventListener('click', function () { data.undo.onClick(undoBtn); });
    }
  }

  window.ShelfyInventoryImpact = { render: render, stateFor: stateFor, flagFor: flagFor, fmt: fmt };
})();
