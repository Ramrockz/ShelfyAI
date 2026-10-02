// "Shelfy's take" -- deep per-item inventory analytics on ingredient-detail.html.
// A Shelfy chat bubble (bottom-right) opens a sheet with a one-line summary,
// metric cards (days on hand, sell-through, daily use, turnover, stockouts,
// reorder point, value on hand, restocked) and quick follow-up questions,
// all computed in the browser from the item's own ingredient_history rows
// (quantity changes tagged with a reason: order / order_reversal / expense /
// expense_reversal / reorder / manual), plus the orders those rows reference
// for "which products use it up". No AI, no server function.
//
// The page calls ShelfyItemInsights.attach(() => currentIngredient) once the
// item has loaded. Styles: the .ins-* rules in styles.css.
(function () {
  const DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const fmt = (n, d = 1) => {
    if (!isFinite(n)) return '–';
    const r = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return r.toLocaleString('en-US', { maximumFractionDigits: d });
  };
  const money = n => '€' + num(n).toFixed(2);
  const dateTxt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const agoTxt = t => {
    if (!t) return 'never';
    const days = Math.floor((Date.now() - t) / DAY);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
  };

  const CAT = `<svg viewBox="14 10 72 83" aria-hidden="true">
      <path d="M17 13 L35 34 H65 L83 13 V78 Q83 90 71 90 H29 Q17 90 17 78 Z" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
      <ellipse cx="37" cy="53" rx="8" ry="8" fill="#fff"/><ellipse cx="63" cy="53" rx="8" ry="8" fill="#fff"/>
      <path d="M44.6 64.5 h10.8 a1.6 1.6 0 0 1 1.28 2.56 l-4.6 6.13 a2.6 2.6 0 0 1 -4.16 0 l-4.6 -6.13 A1.6 1.6 0 0 1 44.6 64.5 Z" fill="#fff"/>
    </svg>`;

  let getIng = () => null;
  let data = null;        // { rows, sales, recipes, leadDays, leadSource }
  let loading = null;
  let period = '30';      // '30' | '90' | 'all'
  let m = null;           // current metrics

  // ─── data ──────────────────────────────────────────────────────────────
  async function load(ing) {
    const sb = window.supabaseClient;
    const { data: { user } } = await sb.auth.getUser();
    const [histRes, supRes, recRes] = await Promise.all([
      sb.from('ingredient_history').select('old_value, new_value, reason, reference_id, changed_at')
        .eq('ingredient_id', ing.id).eq('field_name', 'quantity').order('changed_at', { ascending: true }).limit(5000),
      sb.from('ingredient_suppliers').select('lead_time_days, is_primary').eq('ingredient_id', ing.id),
      (() => {
        let q = sb.from('recipes').select('id, name, components').eq('profile_id', user.id);
        if (ing.store_id) q = q.eq('store_id', ing.store_id);
        return q;
      })()
    ]);
    const rows = (histRes.data || []).map(r => ({
      t: new Date(r.changed_at).getTime(), from: num(r.old_value), to: num(r.new_value),
      reason: r.reason || 'manual', ref: r.reference_id
    })).filter(r => isFinite(r.t));

    // Orders referenced by this item's order rows -> product attribution.
    const saleIds = [...new Set(rows.filter(r => r.reason === 'order' && r.ref).map(r => r.ref))];
    const sales = {};
    for (let i = 0; i < saleIds.length; i += 100) {
      const { data: s } = await sb.from('sales').select('id, items').in('id', saleIds.slice(i, i + 100));
      (s || []).forEach(x => {
        let it = x.items;
        if (typeof it === 'string') { try { it = JSON.parse(it); } catch (e) { it = []; } }
        sales[x.id] = Array.isArray(it) ? it : [];
      });
    }

    const sups = supRes.data || [];
    const primary = sups.find(s => s.is_primary && num(s.lead_time_days) > 0) || sups.find(s => num(s.lead_time_days) > 0);
    let leadDays = primary ? num(primary.lead_time_days) : num(ing.estimated_delivery);
    let leadSource = primary ? 'supplier' : num(ing.estimated_delivery) > 0 ? 'item' : 'assumed';
    if (!(leadDays > 0)) leadDays = 7;

    return { rows, sales, recipes: recRes.data || [], leadDays, leadSource };
  }

  // ─── metrics ───────────────────────────────────────────────────────────
  const isUse = r => r.reason === 'order' || r.reason === 'order_reversal';
  const isIn = r => r.reason === 'expense' || r.reason === 'reorder' || r.reason === 'expense_reversal';

  function compute(ing, d, per) {
    const now = Date.now();
    const qty = num(ing.quantity);
    const created = ing.created_at ? new Date(ing.created_at).getTime() : null;
    const firstT = d.rows.length ? d.rows[0].t : (created || now);
    const historyStart = Math.min(firstT, created || firstT);
    const want = per === 'all' ? now - historyStart : num(per) * DAY;
    const start = Math.max(now - want, historyStart);
    const days = Math.max(1, (now - start) / DAY);
    const historyDays = Math.max(0, (now - historyStart) / DAY);

    const inP = d.rows.filter(r => r.t >= start);
    const usage = inP.filter(isUse).reduce((s, r) => s + (r.from - r.to), 0);
    const received = inP.filter(isIn).reduce((s, r) => s + (r.to - r.from), 0);
    const manualRows = inP.filter(r => !isUse(r) && !isIn(r));
    const manualUp = manualRows.reduce((s, r) => s + Math.max(0, r.to - r.from), 0);
    const manualDown = manualRows.reduce((s, r) => s + Math.max(0, r.from - r.to), 0);

    // Stock level over the period, rebuilt from the rows' own before/after values.
    const before = d.rows.filter(r => r.t < start);
    let level = before.length ? before[before.length - 1].to : (inP.length ? inP[0].from : qty);
    const startLevel = level;
    let t = start, area = 0, zeroT = 0, outs = 0;
    inP.forEach(r => {
      const dt = Math.max(0, r.t - t);
      area += level * dt; if (level <= 0) zeroT += dt;
      if (r.from > 0 && r.to <= 0) outs++;
      level = r.to; t = r.t;
    });
    const tail = Math.max(0, now - t);
    area += qty * tail; if (qty <= 0) zeroT += tail;
    const avgStock = area / Math.max(1, now - start);

    const daily = usage / days;
    const doh = daily > 0 ? qty / daily : Infinity;
    const available = startLevel + Math.max(0, received);
    const sellThrough = available > 0 ? Math.max(0, Math.min(1, usage / available)) : null;
    const turnover = avgStock > 0 ? usage / avgStock : null;

    // Day-by-day usage for the safety buffer (standard deviation).
    const nDays = Math.max(1, Math.round(days));
    const buckets = new Array(nDays).fill(0);
    inP.filter(isUse).forEach(r => {
      const i = Math.min(nDays - 1, Math.max(0, Math.floor((r.t - start) / DAY)));
      buckets[i] += r.from - r.to;
    });
    const mean = buckets.reduce((s, v) => s + v, 0) / nDays;
    const sd = Math.sqrt(buckets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / nDays);
    const safety = 1.65 * sd * Math.sqrt(d.leadDays);              // ~95% service level
    const rop = daily > 0 ? Math.ceil(daily * d.leadDays + safety) : 0;
    const daysToRop = daily > 0 ? Math.max(0, (qty - rop) / daily) : Infinity;

    // Fixed trend windows, independent of the selected period.
    const useIn = (a, b) => d.rows.filter(r => isUse(r) && r.t >= a && r.t < b).reduce((s, r) => s + (r.from - r.to), 0);
    const last30 = useIn(now - 30 * DAY, now + 1);
    const prev30 = useIn(now - 60 * DAY, now - 30 * DAY);
    const trend = historyDays >= 45 && prev30 > 0 ? (last30 - prev30) / prev30 : null;

    const lastUse = [...d.rows].reverse().find(r => r.reason === 'order');
    const lastIn = [...d.rows].reverse().find(r => r.reason === 'expense' || r.reason === 'reorder');

    return {
      qty, unit: ing.unit || '', cost: num(ing.cost_per_unit), minStock: num(ing.min_stock),
      pending: !!ing.reorder_pending, days, historyDays, per,
      usage, received, manualUp, manualDown, startLevel, available,
      daily, doh, sellThrough, turnover, avgStock,
      zeroDays: zeroT / DAY, outs, rop, safety, daysToRop, leadDays: d.leadDays, leadSource: d.leadSource,
      last30, prev30, trend, lastUseT: lastUse && lastUse.t, lastInT: lastIn && lastIn.t,
      products: attribute(ing, d, inP)
    };
  }

  // Order rows only reference the order, and order lines only carry the
  // product *name* -- so each order's deduction is split across its lines
  // whose product (matched by name) contains this item, weighted by
  // line quantity × the product's component quantity.
  function attribute(ing, d, inP) {
    const uses = {};
    d.recipes.forEach(p => {
      const c = (Array.isArray(p.components) ? p.components : []).find(c => String(c.ingredient_id || c.id) === String(ing.id));
      if (c) uses[String(p.name || '').trim().toLowerCase()] = { name: p.name, per: num(c.quantity) || 1 };
    });
    const per = {};
    const bySale = {};
    inP.filter(isUse).forEach(r => { const k = r.ref || '_'; bySale[k] = (bySale[k] || 0) + (r.from - r.to); });
    Object.entries(bySale).forEach(([saleId, used]) => {
      const lines = (d.sales[saleId] || []).map(l => ({ l, u: uses[String(l.name || '').trim().toLowerCase()] })).filter(x => x.u);
      const w = lines.reduce((s, x) => s + num(x.l.quantity || 1) * x.u.per, 0);
      if (!lines.length || w <= 0) { per['Other orders'] = (per['Other orders'] || 0) + used; return; }
      lines.forEach(x => { per[x.u.name] = (per[x.u.name] || 0) + used * (num(x.l.quantity || 1) * x.u.per) / w; });
    });
    return Object.entries(per).filter(([, v]) => Math.abs(v) > 0.0001).sort((a, b) => b[1] - a[1]);
  }

  // ─── copy ──────────────────────────────────────────────────────────────
  const u = () => (m.unit ? ' ' + esc(m.unit) : '');
  const perLabel = () => m.per === 'all' ? `the last ${fmt(m.days, 0)} days` : `the last ${m.per} days`;

  function summary(ing) {
    const parts = [];
    if (m.usage <= 0) {
      parts.push(`No orders used <b>${esc(ing.name)}</b> in ${perLabel()}.`);
      parts.push(m.qty > 0 ? `${fmt(m.qty)}${u()} are sitting on the shelf${m.cost ? ` – ${money(m.qty * m.cost)} tied up` : ''}.` : 'It’s out of stock, too.');
    } else {
      parts.push(`You use about <b>${fmt(m.daily, 2)}${u()} a day</b>.`);
      if (m.qty <= 0) parts.push('You’re out of it right now.');
      else parts.push(`At that pace your ${fmt(m.qty)}${u()} last <b>~${fmt(m.doh, 0)} days</b> – until ${dateTxt(new Date(Date.now() + m.doh * DAY))}.`);
      if (m.pending) parts.push('A reorder is already on the way.');
      else if (m.qty <= m.rop) parts.push(`That’s at or below the suggested reorder point of ${fmt(m.rop, 0)}${u()} – <b>time to reorder</b>.`);
      else parts.push(`Reorder when you’re down to about ${fmt(m.rop, 0)}${u()} (around ${dateTxt(new Date(Date.now() + m.daysToRop * DAY))}).`);
    }
    if (m.per !== 'all' && m.historyDays < num(m.per)) parts.push(`<span class="ins-dim">I only have ${fmt(m.historyDays, 0)} days of history for this item so far.</span>`);
    return parts.join(' ');
  }

  const CARDS = [
    { key: 'doh', label: 'Days on hand',
      val: () => m.daily > 0 ? (m.qty <= 0 ? '0' : '~' + fmt(m.doh, 0)) : '∞',
      sub: () => m.daily > 0 ? (m.qty > 0 ? 'runs out ~' + dateTxt(new Date(Date.now() + m.doh * DAY)) : 'out of stock') : 'not used lately',
      tone: () => m.daily > 0 && m.doh <= m.leadDays ? 'bad' : m.daily > 0 && m.qty <= m.rop ? 'warn' : '',
      why: () => `How long your current stock lasts at your average daily use: ${fmt(m.qty)}${u()} ÷ ${fmt(m.daily, 2)}${u()} a day. Below your lead time (${fmt(m.leadDays, 0)} days) means you’ll likely run out before a new order arrives.` },
    { key: 'st', label: 'Sell-through',
      val: () => m.sellThrough == null ? '–' : fmt(m.sellThrough * 100, 0) + '%',
      sub: () => m.available > 0 ? `used ${fmt(m.usage)} of ${fmt(m.available)} available` : 'nothing available',
      tone: () => m.sellThrough != null && m.sellThrough < 0.2 && m.qty > 0 ? 'warn' : '',
      why: () => `Share of the stock you had available in ${perLabel()} (what you started with plus what came in) that orders used up. Low means stock is sitting; very high means you’re running lean.` },
    { key: 'daily', label: 'Daily use',
      val: () => fmt(m.daily, 2) + u(),
      sub: () => m.trend == null ? `${fmt(m.usage)}${u()} in ${perLabel()}` : `${m.trend >= 0 ? '+' : '−'}${fmt(Math.abs(m.trend) * 100, 0)}% vs previous 30 days`,
      tone: () => '',
      why: () => `Units orders used per day, on average, over ${perLabel()}. The trend compares the last 30 days with the 30 before (${fmt(m.last30)} vs ${fmt(m.prev30)}${u()}).` },
    { key: 'turn', label: 'Turnover',
      val: () => m.turnover == null ? '–' : fmt(m.turnover, 1) + '×',
      sub: () => m.turnover == null ? 'no stock held' : `~${fmt(m.turnover * 365 / m.days, 0)}× a year at this pace`,
      tone: () => '',
      why: () => `How many times you went through your average stock (${fmt(m.avgStock)}${u()}) in ${perLabel()}. Higher means less money sitting on the shelf.` },
    { key: 'out', label: 'Stockouts',
      val: () => fmt(m.zeroDays, m.zeroDays < 10 ? 1 : 0) + ' days',
      sub: () => m.outs ? `ran out ${m.outs}×` : 'never ran out',
      tone: () => m.outs ? 'bad' : '',
      why: () => `Days in ${perLabel()} this item sat at zero (or below), and how many times it hit zero. Each one is a sale you might have missed.` },
    { key: 'rop', label: 'Reorder point',
      val: () => m.daily > 0 ? fmt(m.rop, 0) + u() : '–',
      sub: () => m.minStock ? `your alert: ${fmt(m.minStock)}${u()}` : 'no alert level set',
      tone: () => m.daily > 0 && m.minStock && m.minStock < m.rop ? 'warn' : '',
      why: () => `Daily use × lead time (${fmt(m.leadDays, 0)} days, ${m.leadSource === 'supplier' ? 'from your supplier' : m.leadSource === 'item' ? 'from this item' : 'assumed – set a supplier lead time for a better number'}) plus a safety buffer of ${fmt(m.safety, 1)}${u()} for busy days. Reorder at this level to avoid running out.` },
    { key: 'value', label: 'Value on hand',
      val: () => money(Math.max(0, m.qty) * m.cost),
      sub: () => m.cost ? `${fmt(Math.max(0, m.qty))}${u()} × ${money(m.cost)}` : 'no cost set',
      tone: () => '',
      why: () => 'What the stock on your shelf is worth at its cost per unit – money that’s tied up until it’s used.' },
    { key: 'in', label: 'Restocked',
      val: () => (m.received >= 0 ? '+' : '−') + fmt(Math.abs(m.received)) + u(),
      sub: () => 'last ' + agoTxt(m.lastInT),
      tone: () => '',
      why: () => `Stock that came in through expenses and confirmed deliveries in ${perLabel()} (minus reversed expenses). Last time ${agoTxt(m.lastInT)}.` }
  ];

  const QUESTIONS = [
    { q: 'When should I reorder?', a: ing => {
      if (m.pending) return 'A reorder is already on the way – nothing to do right now.';
      if (m.daily <= 0) return `Orders haven’t used it in ${perLabel()}, so there’s no rush. ${m.qty > 0 ? 'Maybe hold off reordering until it moves again.' : ''}`;
      if (m.qty <= m.rop) return `Now. You have ${fmt(m.qty)}${u()}, the reorder point is ${fmt(m.rop, 0)}${u()}, and a new order takes about ${fmt(m.leadDays, 0)} days. Covering the next 30 days would be roughly <b>${fmt(Math.max(0, m.daily * 30 + m.rop - m.qty), 0)}${u()}</b>.`;
      return `In about <b>${fmt(m.daysToRop, 0)} days</b> (around ${dateTxt(new Date(Date.now() + m.daysToRop * DAY))}), when you’re down to ${fmt(m.rop, 0)}${u()}. That leaves ${fmt(m.leadDays, 0)} days for delivery plus a ${fmt(m.safety, 1)}${u()} buffer.`;
    } },
    { q: 'Which products use it up most?', a: () => {
      if (!m.products.length) return `No orders used it in ${perLabel()}.`;
      const tot = m.products.reduce((s, [, v]) => s + v, 0);
      return 'In ' + perLabel() + ':<ul class="ins-list">' + m.products.slice(0, 6).map(([n, v]) =>
        `<li><span>${esc(n)}</span><b>${fmt(v)}${u()} · ${fmt(v / tot * 100, 0)}%</b></li>`).join('') + '</ul>' +
        (m.products.some(([n]) => n === 'Other orders') ? '<span class="ins-dim">“Other orders” are lines I couldn’t match to a product by name.</span>' : '');
    } },
    { q: 'How has usage changed?', a: () => {
      if (m.historyDays < 45) return `I need a bit more history for a fair comparison – right now there are ${fmt(m.historyDays, 0)} days. Last 30 days: ${fmt(m.last30)}${u()}.`;
      if (!m.prev30 && !m.last30) return 'It wasn’t used in either of the last two 30-day stretches.';
      if (!m.prev30) return `It’s new in your orders: ${fmt(m.last30)}${u()} in the last 30 days, none in the 30 before.`;
      const dir = m.trend > 0.1 ? 'up' : m.trend < -0.1 ? 'down' : 'about the same';
      return `Usage is <b>${dir}</b>: ${fmt(m.last30)}${u()} in the last 30 days vs ${fmt(m.prev30)}${u()} in the 30 before (${m.trend >= 0 ? '+' : '−'}${fmt(Math.abs(m.trend) * 100, 0)}%).${m.trend > 0.25 ? ' Worth checking your reorder point.' : ''}`;
    } },
    { q: 'How much did I correct by hand?', a: () => {
      if (!m.manualUp && !m.manualDown) return `No manual stock corrections in ${perLabel()} – every change came from orders, expenses or deliveries.`;
      const net = m.manualUp - m.manualDown;
      const share = m.usage > 0 ? ` That’s ${fmt(m.manualDown / m.usage * 100, 0)}% on top of what orders used.` : '';
      return `Manual changes in ${perLabel()}: <b>+${fmt(m.manualUp)}${u()}</b> added, <b>−${fmt(m.manualDown)}${u()}</b> removed (net ${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}${u()}).${m.manualDown ? share + ' Removals can mean breakage, samples or miscounts.' : ''}`;
    } },
    { q: 'Is my alert level right?', a: () => {
      if (m.daily <= 0) return 'Orders haven’t used it lately, so I can’t suggest an alert level yet.';
      if (!m.minStock) return `You haven’t set one. Based on your usage I’d set it to about <b>${fmt(m.rop, 0)}${u()}</b>.`;
      if (m.minStock < m.rop * 0.8) return `It’s probably too low: your alert is ${fmt(m.minStock)}${u()}, but you’d need about <b>${fmt(m.rop, 0)}${u()}</b> to bridge the ${fmt(m.leadDays, 0)}-day lead time.`;
      if (m.minStock > m.rop * 1.6) return `It’s on the cautious side: ${fmt(m.minStock)}${u()} vs a suggested ${fmt(m.rop, 0)}${u()}. Fine if you like a buffer – it does tie up more stock.`;
      return `Looks right: ${fmt(m.minStock)}${u()} vs a suggested ${fmt(m.rop, 0)}${u()}.`;
    } },
    { q: 'How often did it run out?', a: () => m.outs || m.zeroDays > 0
      ? `In ${perLabel()} it hit zero <b>${m.outs}×</b> and was empty for about ${fmt(m.zeroDays, 1)} days in total.${m.daily > 0 ? ` At ${fmt(m.daily, 2)}${u()} a day that’s roughly ${fmt(m.daily * m.zeroDays, 0)}${u()} you couldn’t have sold.` : ''}`
      : `It never ran out in ${perLabel()}.` }
  ];

  // ─── UI ────────────────────────────────────────────────────────────────
  function ensureUI() {
    if (document.getElementById('insFab')) return;
    const fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'insFab'; fab.className = 'ins-fab';
    fab.setAttribute('aria-label', 'Ask Shelfy about this item');
    fab.innerHTML = `<span class="ins-fab-cat">${CAT}</span>`;
    fab.addEventListener('click', open);
    document.body.appendChild(fab);

    const ov = document.createElement('div');
    ov.id = 'insOverlay'; ov.className = 'ins-overlay'; ov.hidden = true;
    ov.innerHTML = `<div class="ins-sheet" role="dialog" aria-modal="true" aria-labelledby="insTitle">
        <div class="ins-head">
          <span class="ins-avatar">${CAT}</span>
          <span class="ins-titles"><span class="ins-title" id="insTitle">Shelfy’s take</span><span class="ins-sub" id="insSub"></span></span>
          <button type="button" class="ins-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>
        <div class="ins-periods" role="tablist">
          <button type="button" data-p="30">30 days</button><button type="button" data-p="90">90 days</button><button type="button" data-p="all">All time</button>
        </div>
        <div class="ins-body" id="insBody"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.ins-close').addEventListener('click', close);
    ov.querySelectorAll('.ins-periods button').forEach(b => b.addEventListener('click', () => { period = b.dataset.p; render(true); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) close(); });
    ov.addEventListener('click', e => {
      const card = e.target.closest('.ins-card');
      if (card) { const c = CARDS.find(x => x.key === card.dataset.k); if (c) say(c.label + ' – what’s that?', c.why()); return; }
      const chip = e.target.closest('.ins-chip');
      if (chip) { const q = QUESTIONS[+chip.dataset.i]; if (q) say(q.q, q.a(getIng())); }
    });
  }

  function say(question, answer) {
    const feed = document.getElementById('insFeed');
    if (!feed) return;
    feed.insertAdjacentHTML('beforeend',
      `<div class="ins-msg ins-me">${esc(question)}</div>` +
      `<div class="ins-msg ins-shelfy"><span class="ins-mini">${CAT}</span><span class="ins-bubble">${answer}</span></div>`);
    const last = feed.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function render(keepFeed) {
    const ing = getIng();
    const body = document.getElementById('insBody');
    if (!ing || !body || !data) return;
    m = compute(ing, data, period);
    document.querySelectorAll('#insOverlay .ins-periods button').forEach(b => b.classList.toggle('on', b.dataset.p === period));
    const oldFeed = keepFeed ? (document.getElementById('insFeed') || {}).innerHTML || '' : '';
    body.innerHTML = `
      <div class="ins-msg ins-shelfy"><span class="ins-mini">${CAT}</span><span class="ins-bubble">${summary(ing)}</span></div>
      <div class="ins-grid">${CARDS.map(c => `<button type="button" class="ins-card" data-k="${c.key}"${c.tone() ? ` data-tone="${c.tone()}"` : ''}>
          <span class="ins-card-l">${c.label}</span><span class="ins-card-v">${c.val()}</span><span class="ins-card-s">${c.sub()}</span>
        </button>`).join('')}</div>
      <div class="ins-feed" id="insFeed">${oldFeed}</div>
      <div class="ins-ask"><span class="ins-ask-h">Ask Shelfy</span>
        <div class="ins-chips">${QUESTIONS.map((q, i) => `<button type="button" class="ins-chip" data-i="${i}">${esc(q.q)}</button>`).join('')}</div>
      </div>`;
  }

  async function open() {
    const ing = getIng();
    if (!ing) return;
    ensureUI();
    const ov = document.getElementById('insOverlay');
    document.getElementById('insSub').textContent = ing.name || '';
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('in'));
    document.body.classList.add('ins-open');
    if (!data) {
      document.getElementById('insBody').innerHTML = `<div class="ins-msg ins-shelfy"><span class="ins-mini">${CAT}</span><span class="ins-bubble ins-dim">Crunching the numbers…</span></div>
        <div class="ins-grid">${CARDS.map(() => '<span class="ins-card ins-skel"></span>').join('')}</div>`;
      try {
        loading = loading || load(ing);
        data = await loading;
      } catch (e) {
        console.error('[item-insights] load failed', e);
        loading = null;
        document.getElementById('insBody').innerHTML = `<div class="ins-msg ins-shelfy"><span class="ins-mini">${CAT}</span><span class="ins-bubble">I couldn’t load this item’s history – check your connection and try again.</span></div>`;
        return;
      }
    }
    render(false);
  }

  function close() {
    const ov = document.getElementById('insOverlay');
    if (!ov) return;
    ov.classList.remove('in');
    document.body.classList.remove('ins-open');
    data = null; loading = null;   // stock may change on the page -- reload next open
    setTimeout(() => { if (!ov.classList.contains('in')) ov.hidden = true; }, 200);
  }

  window.ShelfyItemInsights = {
    attach(getter) { getIng = getter; ensureUI(); },
    // Stock changed on the page (+/−, delivery, edit) -- recompute next open.
    invalidate() { data = null; loading = null; }
  };
})();
