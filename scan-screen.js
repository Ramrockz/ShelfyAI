// Shared pieces of the AI-scan "reading" screen -- the cat mascot and the
// step-list icons -- used by both import-modal.js (file scans: items,
// orders, expenses) and url-import-modal.js (Import from URL). Styles are
// the .uim-* rules in styles.css. Must load before either modal script.
(function () {
  var ICON_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICON_FAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" width="9" height="9"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // mode: 'look' (just started) | 'read' (working) | 'celebrate' (done) | 'sad' (failed)
  // opts.big: the larger success-screen cat (order-success.js) -- 80px wide,
  // eyes a little closer together and a smaller nose, per that design.
  function catHtml(mode, opts) {
    var big = !!(opts && opts.big);
    var EX = big ? [80, 160] : [66, 186];
    var C = '#10B4D6';
    var celebrate = mode === 'celebrate', sad = mode === 'sad';
    var pieces = '';
    if (celebrate) {
      var colors = ['#10B4D6', '#FFD31D', '#12A36B', '#E5484D', '#111827', '#7DD6E8'];
      for (var i = 0; i < 16; i++) {
        var a = (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1), d = 56 + (i * 37) % 30;
        pieces += '<i class="uim-confetti" style="width:' + (i % 3 ? 7 : 6) + 'px;height:' + (i % 3 ? 11 : 6) + 'px;' +
          'border-radius:' + (i % 3 ? 2 : 6) + 'px;background:' + colors[i % colors.length] + ';' +
          '--dx:' + (Math.cos(a) * d).toFixed(1) + 'px;--dy:' + (Math.sin(a) * d * 0.8 + 16).toFixed(1) + 'px;' +
          '--r:' + ((i * 47) % 360) + 'deg;animation-delay:' + (380 + (i % 4) * 40) + 'ms"></i>';
      }
    }
    var eyes = EX.map(function (cx) {
      return '<circle class="uim-eye" cx="' + cx + '" cy="' + (sad ? 156 : 148) + '" r="' + (sad ? 22 : 27) + '" fill="#fff"/>';
    }).join('');
    var happyEyes = celebrate ? '<g class="uim-eyes-happy">' + EX.map(function (cx) {
      return '<path d="M' + (cx - 24) + ' 158 Q' + cx + ' 120 ' + (cx + 24) + ' 158" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>';
    }).join('') + '</g>' : '';
    var badge = celebrate
      ? '<div class="uim-cat-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>'
      : '';
    return '<div class="uim-cat' + (big ? ' uim-cat-big' : '') + '" data-mode="' + mode + '" aria-hidden="true">' +
      '<div class="uim-cat-shadow"></div>' + pieces +
      '<div class="uim-cat-in"><div class="uim-cat-body"><div class="uim-cat-idle">' +
        '<svg width="' + (big ? 80 : 62) + '" height="' + (big ? 92 : 71) + '" viewBox="0 0 252 288">' +
          '<path class="uim-ear-l" d="M0 84 L0 14 Q0 0 12 3 Q14 4 16 6 L84 84 Z" fill="' + C + '"/>' +
          '<path class="uim-ear-r" d="M252 84 L252 14 Q252 0 240 3 Q238 4 236 6 L168 84 Z" fill="' + C + '"/>' +
          '<path d="M0 73 L252 73 L252 246 Q252 288 210 288 L42 288 Q0 288 0 246 Z" fill="' + C + '"/>' +
          '<g class="uim-eyes">' + eyes + '</g>' + happyEyes +
          (big ? '<path d="M104 190 L148 190 L126 220 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>'
               : '<path d="M96 192 L156 192 L126 222 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>') +
        '</svg>' + badge +
      '</div></div></div></div>';
  }

  // Swaps the cat in `wrap` only when the mode actually changes, so its CSS
  // animations aren't restarted on every progress tick. On 'celebrate' the
  // eyes turn into happy arcs for the length of the jump.
  var happyTimers = [];
  function setCat(wrap, mode, opts) {
    if (!wrap || wrap.dataset.mode === mode) return;
    wrap.dataset.mode = mode;
    wrap.innerHTML = catHtml(mode, opts);
    happyTimers.forEach(clearTimeout); happyTimers = [];
    if (mode === 'celebrate') {
      var cat = wrap.firstChild;
      happyTimers.push(setTimeout(function () { cat.classList.add('happy'); }, 400));
      happyTimers.push(setTimeout(function () { cat.classList.remove('happy'); }, 2150));
    }
  }
  function stopCat() { happyTimers.forEach(clearTimeout); happyTimers = []; }

  // state: 'done' | 'active' | 'failed' | 'todo'
  function stepIconHtml(state) {
    if (state === 'done') return '<i class="uim-ic uim-ic-done">' + ICON_TICK + '</i>';
    if (state === 'active') return '<i class="uim-ic uim-ic-spin"></i>';
    if (state === 'failed') return '<i class="uim-ic uim-ic-fail">' + ICON_FAIL + '</i>';
    return '<i class="uim-ic uim-ic-todo"></i>';
  }

  window.ShelfyScanScreen = { catHtml: catHtml, setCat: setCat, stopCat: stopCat, stepIconHtml: stepIconHtml };
})();
