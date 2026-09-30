// Cost breakdown sankey for a product (recipe-detail.html).
//
//   renderCostSankey(el, { items: [{ name, value, detail }], price })
//
// With a price above cost it reads left to right: Price -> Materials + Profit,
// Materials -> each item. Without a price (or when price <= cost) it's just
// Materials -> items. Item bands use the dataviz reference categorical palette
// in the product's own component order (colour follows the item, not its
// rank); beyond 8 items the smallest fold into a gray "Other". Every band is
// direct-labelled with name + amount + share, so identity never rests on
// colour alone (three light-mode hues are under 3:1 against white).
(function () {
  const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const SERIES_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const MAX_ITEMS = 8;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Cents, except for sub-cent line costs where 2 decimals would read $0.00.
  const money = v => '$' + (v === 0 || Math.abs(v) >= 0.01 ? v.toFixed(2) : v.toFixed(3));
  const pct = (v, of) => (of > 0 ? Math.round((v / of) * 100) : 0) + '%';

  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Horizontal band between two vertical spans, as a filled bezier ribbon.
  function ribbon(x0, y0a, y0b, x1, y1a, y1b) {
    const mx = (x0 + x1) / 2;
    return `M${x0},${y0a} C${mx},${y0a} ${mx},${y1a} ${x1},${y1a} L${x1},${y1b} C${mx},${y1b} ${mx},${y0b} ${x0},${y0b} Z`;
  }

  function renderCostSankey(el, { items, price }) {
    if (!el) return;
    const series = isDark() ? SERIES_DARK : SERIES_LIGHT;

    // Colour by component order, then fold the tail into "Other".
    let rows = (items || []).map((it, i) => ({ ...it, value: Math.max(0, parseFloat(it.value) || 0), idx: i }))
      .filter(r => r.value > 0);
    if (!rows.length) { el.hidden = true; el.innerHTML = ''; return; }
    rows.forEach(r => { r.color = r.idx < MAX_ITEMS ? series[r.idx] : null; });
    let other = null;
    if (rows.length > MAX_ITEMS) {
      const byValue = rows.slice().sort((a, b) => b.value - a.value);
      const keep = new Set(byValue.slice(0, MAX_ITEMS - 1).map(r => r.idx));
      const rest = rows.filter(r => !keep.has(r.idx));
      rows = rows.filter(r => keep.has(r.idx));
      other = { name: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), color: 'var(--cs-other)',
                detail: rest.map(r => r.name).join(', ') };
    }
    rows.forEach((r, n) => { if (!r.color) r.color = series[n % series.length]; });
    // Largest cost on top reads best; colours stay attached to their item.
    rows.sort((a, b) => b.value - a.value);
    if (other) rows.push(other);

    const cost = rows.reduce((s, r) => s + r.value, 0);
    const p = parseFloat(price) || 0;
    const withPrice = p > cost;
    const profit = withPrice ? p - cost : 0;
    const total = withPrice ? p : cost;

    // Geometry in real pixels at the container's width, so text stays 12-13px
    // on a phone instead of shrinking with a scaled viewBox. (Un-hide first:
    // a hidden element measures 0 wide.)
    el.hidden = false;
    // Capped so the flows don't stretch into thin ribbons on a wide desktop panel.
    const W = Math.min(760, Math.max(280, Math.round(el.clientWidth || 600)));
    const NODE = 12, GAP = 2, SLOT = 38;   // SLOT fits a name line + an amount line
    const colX = withPrice ? [0, Math.round(W * 0.2), Math.round(W * 0.42)] : [null, 0, Math.round(W * 0.28)];
    const labelX = colX[2] + NODE + 10;
    const H = Math.max(170, rows.length * SLOT + (rows.length - 1) * 4);
    const k = (H - (withPrice ? GAP : 0)) / total;   // px per $

    const costH = cost * k;
    const profitH = profit * k;
    // Middle column: Materials on top, Profit below (with a 2px surface gap).
    const matY0 = withPrice ? 0 : (H - costH) / 2;
    const profY0 = matY0 + costH + GAP;

    // Right column: each item gets a label slot >= SLOT, node height ∝ cost.
    const slots = rows.map(r => Math.max(r.value * k, SLOT - 4));
    const slotsH = slots.reduce((s, h) => s + h, 0) + (rows.length - 1) * 4;
    let y = Math.max(0, (H - slotsH) / 2);
    let yIn = matY0;
    const bands = rows.map((r, n) => {
      const h = Math.max(r.value * k, 2);
      const node = { y0: y + (slots[n] - h) / 2, y1: y + (slots[n] - h) / 2 + h };
      const inSeg = { y0: yIn, y1: yIn + r.value * k };
      yIn += r.value * k;
      y += slots[n] + 4;
      return { r, node, inSeg };
    });

    const parts = [];
    // Price -> Materials / Profit
    if (withPrice) {
      parts.push(`<path class="cs-link" fill="var(--cs-neutral)" d="${ribbon(colX[0] + NODE, 0, costH, colX[1], matY0, matY0 + costH)}">
        <title>Materials ${money(cost)} · ${pct(cost, p)} of the price</title></path>`);
      parts.push(`<path class="cs-link" fill="var(--cs-profit)" d="${ribbon(colX[0] + NODE, costH + GAP, H, colX[1], profY0, profY0 + profitH)}">
        <title>Profit ${money(profit)} · ${pct(profit, p)} of the price</title></path>`);
      parts.push(`<rect x="${colX[0]}" y="0" width="${NODE}" height="${H}" rx="3" fill="var(--cs-ink)"/>`);
      parts.push(`<rect x="${colX[1]}" y="${profY0}" width="${NODE}" height="${Math.max(profitH, 2)}" rx="3" fill="var(--cs-profit-node)"/>`);
    }
    // Materials -> items
    bands.forEach(({ r, node, inSeg }) => {
      parts.push(`<path class="cs-link" fill="${r.color}" d="${ribbon(colX[1] + NODE, inSeg.y0, inSeg.y1, colX[2], node.y0, node.y1)}">
        <title>${esc(r.name)} · ${money(r.value)} · ${pct(r.value, cost)} of materials${r.detail ? ' · ' + esc(r.detail) : ''}</title></path>`);
      parts.push(`<rect x="${colX[2]}" y="${node.y0}" width="${NODE}" height="${node.y1 - node.y0}" rx="3" fill="${r.color}"/>`);
      const cy = (node.y0 + node.y1) / 2;
      parts.push(`<text class="cs-label" x="${labelX}" y="${cy - 3}">${esc(r.name)}</text>`);
      parts.push(`<text class="cs-sub" x="${labelX}" y="${cy + 12}">${money(r.value)} · ${pct(r.value, cost)}</text>`);
    });
    parts.push(`<rect x="${colX[1]}" y="${matY0}" width="${NODE}" height="${costH}" rx="3" fill="var(--cs-ink)"/>`);

    // Column labels above the nodes
    const heads = [];
    // Two header lines so "Price" and "Materials" never collide on a phone.
    if (withPrice) heads.push(`<text class="cs-head" x="${colX[0]}" y="-28">Price ${money(p)}</text>`);
    heads.push(`<text class="cs-head" x="${colX[1]}" y="-10">Materials ${money(cost)}</text>`);
    // Under the Price column, clear of the item labels on the right.
    if (withPrice) heads.push(`<text class="cs-head cs-head-profit" x="${colX[0]}" y="${H + 20}">Profit ${money(profit)} · ${pct(profit, p)}</text>`);

    const note = p > 0 && p <= cost
      ? `<p class="cs-note">Your price (${money(p)}) doesn’t cover the ${money(cost)} material cost.</p>`
      : !p ? '<p class="cs-note">Add a price to see how much of it is profit.</p>' : '';

    // Clip overlong names so they never run off the right edge (~7px/char).
    const maxChars = Math.max(8, Math.floor((W - labelX) / 7.2));
    const vbTop = withPrice ? -44 : -26, vbH = H - vbTop + (withPrice ? 30 : 8);
    el.hidden = false;
    el.innerHTML = `
      <div class="cs-title">Cost breakdown</div>
      <svg class="cs-svg" width="${W}" height="${vbH}" viewBox="0 ${vbTop} ${W} ${vbH}" role="img"
           aria-label="Cost breakdown: ${esc(rows.map(r => `${r.name} ${money(r.value)}`).join(', '))}">
        ${heads.join('')}${parts.join('')}
      </svg>${note}`;
    el.querySelectorAll('.cs-label').forEach(t => {
      if (t.textContent.length > maxChars) t.textContent = t.textContent.slice(0, maxChars - 1) + '…';
    });

    // Hover / tap: dim the other bands so the chosen one stands out.
    const links = el.querySelectorAll('.cs-link');
    links.forEach(l => {
      const on = () => links.forEach(o => o.classList.toggle('cs-dim', o !== l));
      l.addEventListener('pointerenter', on);
      l.addEventListener('click', on);
    });
    el.querySelector('.cs-svg').addEventListener('pointerleave', () => links.forEach(o => o.classList.remove('cs-dim')));
  }

  // Re-draw at the new width when the layout changes (rotation, resize).
  // Re-draw whenever a container's width changes -- rotation, resize, and
  // going from hidden (0 wide) to shown, e.g. the mobile product overlay.
  const drawn = new Map();   // container -> { data, w } (desktop + mobile each have one)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    entries.forEach(({ target }) => {
      const rec = drawn.get(target);
      const w = Math.round(target.clientWidth);
      if (rec && w > 0 && w !== rec.w) { rec.w = w; renderCostSankey(target, rec.data); }
    });
  }) : null;
  function renderAndRemember(el, data) {
    if (!el) return;
    if (!drawn.has(el) && ro) ro.observe(el);
    renderCostSankey(el, data);
    drawn.set(el, { data, w: Math.round(el.clientWidth) });
  }

  window.renderCostSankey = renderAndRemember;
})();
