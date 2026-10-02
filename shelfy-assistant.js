// Shelfy assistant — the dashboard. A reactive avatar (mood from stock), a
// radial quick-action menu, and an ask bar (typed or spoken) that answers:
//   "Do I still have blue XL?"        -> matching items + products using them
//   "How many hoodies can I make?"    -> producible count + bottleneck
//   "What do I need to reorder?"      -> opens the restock card
//   "When does my delivery arrive?"   -> opens the pending-deliveries card
// Questions may be German or English; answers are always English (the app's
// language). Everything runs locally on the user's own data; no AI call.
// The restock + deliveries cards are still filled by operations.html's own
// _renderInventoryStatus / _renderInboundStatus, which announce their data via
// the shelfy:dash-stock / shelfy:dash-inbound events for the mood + nudge.

(function () {
  let asItems = null;      // ingredients rows
  let asProducts = null;   // recipes rows
  let asLeadById = {};     // ingredient id -> { days, supplier } from ingredient_suppliers
  let asLoadedAt = 0;
  let asLoading = null;
  const AS_TTL = 60 * 1000;

  let asStock = { out: [], low: [] };   // from shelfy:dash-stock
  let asInbound = [];                   // from shelfy:dash-inbound

  // ─── Normalising & vocabulary ─────────────────────────────────────────────

  function asNorm(str) {
    return String(str || '').toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Filler words from spoken/typed questions (DE + EN) that carry no search meaning.
  const AS_STOP = new Set((
    'hab habe haben hast hat ich wir du noch da gibt es ist sind wie viel viele ' +
    'was welche welcher welches der die das den dem ein eine einen einer im in ' +
    'auf lager vorhanden vorratig mehr mal bitte zeig zeige mir suche such nach ' +
    'mit von fur und oder denn eigentlich aktuell gerade jetzt ' +
    'do does i we you have has got any still left is are there the a an of in ' +
    'how many much what which show me find search for please stock with and or ' +
    'currently right now'
  ).split(' '));

  // Words that only say "how many can I make" — stripped before matching products.
  // Words that only carry the question type — stripped before item matching.
  const AS_COST_WORDS = new Set((
    'cost costs costing price prices priced worth kostet kosten preis teuer me mich mir per piece unit stuck'
  ).split(' '));
  const AS_LEAD_WORDS = new Set((
    'long take takes taking it to get reorder reordering order ordering restock lead time delivery deliver ' +
    'arrive lange dauert dauern es bis nachbestellen nachbestellung bestellen bestellung lieferzeit liefern'
  ).split(' '));

  const AS_PRODUCE_WORDS = new Set((
    'kann konnte koennte konnen machen herstellen produzieren bauen fertigen basteln nahen drucken ' +
    'stuck stueck stuk exemplare davon ' +
    'can could make produce build craft manufacture print sew pieces units of them'
  ).split(' '));

  // Groups of equivalent words; any member matches any other.
  const AS_EQUIV = [
    ['blau', 'blue'], ['rot', 'red'], ['grun', 'green'], ['gelb', 'yellow'],
    ['schwarz', 'black'], ['weiss', 'white'], ['grau', 'grey', 'gray'],
    ['braun', 'brown'], ['rosa', 'pink'], ['lila', 'purple', 'violett', 'violet'],
    ['turkis', 'turquoise'], ['dunkelblau', 'navy'], ['silber', 'silver'], ['gold', 'golden'],
    ['xs', 'extrasmall'], ['s', 'small', 'klein'], ['m', 'medium', 'mittel'],
    ['l', 'large', 'gross'], ['xl', 'extralarge'], ['xxl', '2xl'], ['xxxl', '3xl'],
  ];
  const AS_EQUIV_MAP = {};
  AS_EQUIV.forEach(g => g.forEach(w => { AS_EQUIV_MAP[w] = g; }));

  function asTokens(query) {
    const q = asNorm(query)
      .replace(/\bextra (large|small)\b/g, 'extra$1')
      .replace(/\bx (x )?(x )?l\b/g, m => m.replace(/ /g, ''))   // speech: "x l" -> "xl"
      .replace(/\bdouble xl\b/g, 'xxl');
    return q.split(' ').filter(w => w && !AS_STOP.has(w));
  }

  function asWordMatches(token, word) {
    // Short tokens (sizes like "l", "xl") must match a whole word, or "l"
    // would hit every word containing an L; 3 letters ("tee", "xxl") may
    // prefix-match ("tees") but never match mid-word ("xxxl").
    if (token.length <= 2 || word.length <= 2) return token === word;
    if (token.length === 3) return word.startsWith(token);
    // token.startsWith(word) covers plurals ("mugs" -> "mug", "hoodies" -> "hoodie").
    return word.startsWith(token) || word.includes(token) ||
      (token.startsWith(word) && (word.length >= 4 || token.length - word.length <= 2));
  }

  function asTokenMatches(token, words) {
    const variants = AS_EQUIV_MAP[token] || [token];
    return variants.some(v => words.some(w => asWordMatches(v, w)));
  }

  function asParse(json) {
    if (!json) return {};
    if (typeof json === 'string') { try { return JSON.parse(json) || {}; } catch (_) { return {}; } }
    return json;
  }

  function asAttrValues(attrs) {
    return Object.values(asParse(attrs)).filter(v => v != null && String(v).trim()).map(v => String(v).trim());
  }

  function asWordsOf(...parts) {
    return asNorm(parts.flat().join(' ')).split(' ').filter(Boolean);
  }

  // ─── Intent ───────────────────────────────────────────────────────────────

  function asIntent(query) {
    const q = ' ' + asNorm(query) + ' ';
    if (/ (how long|wie lange|lead ?time|lieferzeit|dauert)/.test(q)) return 'leadtime';
    if (/ (costs?|price|priced|kostet|kosten|preis|what does .* cost|how much (is|are|does|do) )/.test(q) && !/ (have|left|habe|hab) /.test(q)) return 'cost';
    if (/ (nachbestell|bestellen|auffull|knapp|ausverkauft|leer |reorder|restock|running low|out of stock|low on|need to order|order more)/.test(q)) return 'reorder';
    if (/ (lieferung|unterwegs|kommt|geliefert|delivery|deliveries|arriving|on the way|incoming|shipment)/.test(q)) return 'deliveries';
    if (/ (machen|herstellen|produzieren|bauen|fertigen|make|produce|build|manufacture)\b/.test(q) &&
        / (wie ?viel|kann ich|konnte ich|how many|how much|can i|could i)/.test(q)) return 'produce';
    return 'have';
  }

  // ─── Data ─────────────────────────────────────────────────────────────────

  async function asLoad(force) {
    if (!force && asItems && Date.now() - asLoadedAt < AS_TTL) return;
    if (asLoading) return asLoading;
    asLoading = (async () => {
      try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;
        if (!window.currentStoreId && typeof ensureStoreExists === 'function') await ensureStoreExists(user);
        const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');
        let qi = supabaseClient.from('ingredients')
          .select('id, name, quantity, unit, min_stock, category, custom_attributes, reorder_pending, alert_disabled, expiration_date, cost_per_unit, estimated_delivery')
          .eq('profile_id', user.id);
        let qr = supabaseClient.from('recipes')
          .select('id, name, attributes, parent_id, components, category')
          .eq('profile_id', user.id);
        if (storeId) { qi = qi.eq('store_id', storeId); qr = qr.eq('store_id', storeId); }
        const [ri, rr] = await Promise.all([qi, qr]);
        if (ri.error) throw ri.error;
        if (rr.error) throw rr.error;
        asItems = ri.data || [];
        asProducts = rr.data || [];
        // Supplier lead times are optional extra info -- a failure here must
        // not break the rest of the assistant.
        asLeadById = {};
        try {
          const ids = asItems.map(i => i.id);
          if (ids.length) {
            const rs = await supabaseClient.from('ingredient_suppliers')
              .select('ingredient_id, lead_time_days, is_primary, suppliers(name)').in('ingredient_id', ids);
            (rs.data || []).forEach(r => {
              if (r.lead_time_days == null) return;
              const cur = asLeadById[r.ingredient_id];
              if (!cur || (r.is_primary && !cur.primary)) {
                asLeadById[r.ingredient_id] = { days: r.lead_time_days, primary: !!r.is_primary, supplier: r.suppliers && r.suppliers.name };
              }
            });
          }
        } catch (_) {}
        asLoadedAt = Date.now();
      } catch (e) {
        console.error('Shelfy assistant: load failed', e);
      } finally {
        asLoading = null;
      }
    })();
    return asLoading;
  }

  // ─── Search & capacity ────────────────────────────────────────────────────

  function asCompId(c) { return c && (c.ingredient_id || c.id); }

  function asSearch(tokens) {
    if (!tokens.length || !asItems) return { items: [], products: [] };

    const items = asItems.filter(i => {
      const words = asWordsOf(i.name, asAttrValues(i.custom_attributes), i.category || '');
      return tokens.every(t => asTokenMatches(t, words));
    });
    const itemIds = new Set(items.map(i => i.id));
    const itemById = asItemById();

    const productById = {};
    asProducts.forEach(p => { productById[p.id] = p; });
    const products = [];
    asProducts.forEach(p => {
      const base = p.parent_id && productById[p.parent_id] ? productById[p.parent_id].name : '';
      const words = asWordsOf(p.name, base, asAttrValues(p.attributes), p.category || '');
      const direct = tokens.every(t => asTokenMatches(t, words));
      const uses = (Array.isArray(p.components) ? p.components : [])
        .filter(c => itemIds.has(asCompId(c)))
        .map(c => itemById[asCompId(c)]);
      if (direct || uses.length) products.push({ product: p, uses, direct });
    });
    // Direct name matches first, then products found via their items.
    products.sort((a, b) => (b.direct - a.direct) || String(a.product.name).localeCompare(String(b.product.name)));

    return { items, products };
  }

  function asItemById() {
    const m = {};
    (asItems || []).forEach(i => { m[i.id] = i; });
    return m;
  }

  function asIsExpired(dateStr) {
    if (!dateStr) return false;
    return String(dateStr).slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  // Same rule as recipe-detail.html's renderRecipe(): the scarcest component
  // caps the count; an expired component makes it 0. null = no components.
  function asCanMake(product, itemById) {
    const comps = (Array.isArray(product.components) ? product.components : [])
      .filter(c => asCompId(c) && (parseFloat(c.quantity) || 0) > 0);
    if (!comps.length) return null;
    let best = null;
    comps.forEach(c => {
      const ing = itemById[asCompId(c)];
      const need = parseFloat(c.quantity) || 0;
      const stock = ing ? (parseFloat(ing.quantity) || 0) : 0;
      const n = !ing || asIsExpired(ing.expiration_date) ? 0 : Math.floor(stock / need);
      if (best === null || n < best.count) {
        best = { count: n, blocker: ing || { name: c.ingredient_name || c.name || '?' }, stock, need,
                 expired: !!(ing && asIsExpired(ing.expiration_date)) };
      }
    });
    best.count = Math.max(0, Number.isFinite(best.count) ? best.count : 0);
    return best;
  }

  // Drop a parent template row when its own variants are in the list too —
  // they share the same components, so it would double-count the total.
  function asDropShadowedParents(entries) {
    const ids = new Set(entries.map(e => e.product.parent_id).filter(Boolean));
    return entries.filter(e => !ids.has(e.product.id));
  }

  function asStatus(i) {
    const q = parseFloat(i.quantity) || 0;
    const min = parseFloat(i.min_stock) || 0;
    if (q === 0) return 'out';
    if (min > 0 && q < min) return 'low';
    return 'ok';
  }

  // ─── Answer text (English only; questions may be German or English) ───────

  function asNum(q) {
    const n = parseFloat(q) || 0;
    return Number.isInteger(n) ? n : +n.toFixed(2);
  }

  function asLabel(i) {
    // Skip attribute values the name already spells out ("T-Shirt · Black · M").
    const nameWords = asWordsOf(i.name);
    const vals = asAttrValues(i.custom_attributes)
      .filter(v => !asWordsOf(v).every(w => nameWords.includes(w)));
    return vals.length ? `${i.name} (${vals.join(', ')})` : i.name;
  }

  function asList(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function asMoney(n) {
    const v = parseFloat(n) || 0;
    return '$' + (v >= 1 || v === 0 ? v.toFixed(2) : v.toFixed(v < 0.1 ? 3 : 2));
  }

  function asLead(i) {
    const l = asLeadById[i.id];
    if (l) return l;
    const d = parseInt(i.estimated_delivery, 10);
    return d > 0 ? { days: d, supplier: null } : null;
  }

  function asProductCost(p, itemById) {
    const comps = (Array.isArray(p.components) ? p.components : []).filter(c => asCompId(c));
    if (!comps.length) return null;
    return comps.reduce((s, c) => {
      const ing = itemById[asCompId(c)];
      const unit = ing ? parseFloat(ing.cost_per_unit) : parseFloat(c.cost);
      return s + (parseFloat(c.quantity) || 0) * (unit || 0);
    }, 0);
  }

  // Pending delivery -> ETA date (same rule as _renderInboundStatus).
  function asEta(item) {
    const base = item.reorder_date || (item.updated_at ? String(item.updated_at).split('T')[0] : null);
    if (!base) return null;
    let eta = new Date(base + 'T00:00:00');
    if (item.estimated_delivery) {
      eta = typeof window.addBusinessDays === 'function'
        ? window.addBusinessDays(eta, item.estimated_delivery)
        : new Date(eta.getTime() + item.estimated_delivery * 86400000);
    }
    return eta;
  }

  function asEtaText(item) {
    const eta = asEta(item);
    if (!eta) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((eta - today) / 86400000);
    if (days < 0) return 'is overdue';
    if (days === 0) return 'arrives today';
    if (days === 1) return 'arrives tomorrow';
    return 'arrives ' + eta.toLocaleDateString('en-US', { weekday: days < 7 ? 'long' : undefined, month: 'short', day: 'numeric' });
  }

  const T = {
    nothing: q => `I couldn’t find anything${q ? ` for “${q}”` : ''}.`,
    haveOne: i => `Yes, you have ${asNum(i.quantity)}${i.unit ? ' ' + i.unit : ''} ${asLabel(i)}.`,
    haveLow: i => ` Running low – minimum is ${asNum(i.min_stock)}.`,
    outOne: i => `No, ${asLabel(i)} is out of stock.`,
    pending: ' It’s already reordered though.',
    haveMany: (n, inStock) => `${n} matching items – ${inStock === n ? 'all' : inStock} in stock.`,
    onlyProducts: n => `No items, but ${n} matching product${n === 1 ? '' : 's'}.`,
    makeOne: (p, r) => `You can make ${r.count} ${p.name}.`,
    makeBlock: r => ` ${r.blocker.name} is the limit – ${asNum(r.stock)} left, ${asNum(r.need)} per piece.`,
    makeZero: (p, r) => `You can’t make ${p.name} right now – ${r.blocker.name} ${r.expired ? 'has expired' : 'is short'}.`,
    makeMany: (total, n, top) => `${total} in total across ${n} variants. Most: ${top.name}, ${top.count}.`,
    makeNoRecipe: p => `${p.name} has no components yet, so I can’t work it out.`,
    makeNone: q => `I couldn’t find a product for “${q}”.`,
    reorderNone: 'All good – nothing needs reordering right now.',
    reorder: (n, names, more) => `${n === 1 ? 'One thing needs' : n + ' things need'} reordering: ${asList(names)}${more ? ' and more' : ''}.`,
    reorderPendingOnly: n => `Everything low is already ordered – ${n} ${n === 1 ? 'delivery is' : 'deliveries are'} on the way.`,
    delivNone: 'Nothing is on the way right now.',
    delivOne: i => { const e = asEtaText(i); return `Your ${i.name} delivery ${e || 'is on the way'}.`; },
    delivMany: items => `${items.length} deliveries are on the way: ` +
      asList(items.slice(0, 3).map(i => { const e = asEtaText(i); return e ? `${i.name} ${e}` : i.name; })) +
      (items.length > 3 ? ' and more' : '') + '.',
    canMake: n => (n === 0 ? 'Can’t make' : `Can make ${n}`),
    costOne: (i, c) => `${asLabel(i)} costs you ${asMoney(c)} per ${i.unit || 'piece'}.`,
    costNone: i => `${asLabel(i)} has no cost set yet.`,
    costProduct: (p, c) => `Making one ${p.name} costs you ${asMoney(c)} in materials.`,
    costMany: n => `${n} matching items – costs are listed below.`,
    leadOne: (i, l) => `Reordering ${asLabel(i)} takes about ${l.days} ${l.days === 1 ? 'day' : 'days'}${l.supplier ? ` from ${l.supplier}` : ''}.`,
    leadNone: i => `I don’t know how long ${asLabel(i)} takes yet – add a supplier lead time on the item.`,
    leadMany: n => `${n} matching items – lead times are listed below.`,
    limit: r => `Limited by ${r.blocker.name} · ${asNum(r.stock)} left, ${asNum(r.need)} each`,
  };

  // Questions that aren't about a specific item: answered from the dashboard's
  // own restock / pending-delivery lists.
  function asAnswerGeneral(intent) {
    if (intent === 'reorder') {
      const all = [...asStock.out, ...asStock.low];
      const open = all.filter(i => !i.reorder_pending);
      let say;
      if (!all.length) say = T.reorderNone;
      else if (!open.length) say = T.reorderPendingOnly(asInbound.length || all.length);
      else say = T.reorder(open.length, open.slice(0, 3).map(i => i.name), open.length > 3);
      return { intent, say, items: [], products: [], card: open.length ? 'restock' : (asInbound.length ? 'deliveries' : null) };
    }

    if (intent === 'deliveries') {
      const say = !asInbound.length ? T.delivNone
        : asInbound.length === 1 ? T.delivOne(asInbound[0]) : T.delivMany(asInbound);
      return { intent, say, items: [], products: [], card: asInbound.length ? 'deliveries' : null };
    }
    return null;
  }

  // Pure: question + data -> { intent, say, items, products, card }
  function asAnswer(query) {
    const intent = asIntent(query);
    if (intent === 'reorder' || intent === 'deliveries') return asAnswerGeneral(intent);

    const strip = intent === 'produce' ? AS_PRODUCE_WORDS : intent === 'cost' ? AS_COST_WORDS
                : intent === 'leadtime' ? AS_LEAD_WORDS : null;
    const tokens = asTokens(query).filter(w => !strip || !strip.has(w));
    // The user's own spelling of the search words ("Einhörner", not "einhorner").
    const keep = new Set(tokens);
    const shown = String(query).split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}-]/gu, ''))
      .filter(w => keep.has(asNorm(w))).join(' ') || tokens.join(' ');
    if (!tokens.length) return { intent, say: '', items: [], products: [], card: null };
    const { items, products } = asSearch(tokens);
    return asCompose(intent, items, products, shown);
  }

  // Matched items + product entries ({ product, uses, direct }) -> answer.
  // Shared by the local matcher and the Claude mapping (asAnswerFromAI).
  function asCompose(intent, items, products, shown, note) {
    const none = say => ({ intent, say, items: [], products: [], card: null, empty: shown, note });
    const itemById = asItemById();
    const withMake = asDropShadowedParents(products).map(e => ({ ...e, make: asCanMake(e.product, itemById) }));

    if (intent === 'produce') {
      // Prefer products named like the question; fall back to ones using a matched item.
      const direct = withMake.filter(e => e.direct);
      const pool = direct.length ? direct : withMake;
      if (!pool.length) return none(T.makeNone(shown));
      const calc = pool.filter(e => e.make);
      let say;
      if (!calc.length) say = T.makeNoRecipe(pool[0].product);
      else if (calc.length === 1) {
        const { product: p, make: r } = calc[0];
        say = r.count === 0 ? T.makeZero(p, r) : T.makeOne(p, r) + T.makeBlock(r);
      } else {
        const total = calc.reduce((s, e) => s + e.make.count, 0);
        const top = calc.reduce((a, b) => (b.make.count > a.make.count ? b : a));
        say = T.makeMany(total, calc.length, { name: top.product.name, count: top.make.count });
      }
      pool.sort((a, b) => ((b.make ? b.make.count : -1) - (a.make ? a.make.count : -1)));
      return { intent, say, items: [], products: pool, card: null, showLimit: true };
    }

    if (!items.length && !withMake.length) return none(T.nothing(shown));

    if (intent === 'cost') {
      let say;
      if (items.length === 1) {
        const c = parseFloat(items[0].cost_per_unit);
        say = c > 0 ? T.costOne(items[0], c) : T.costNone(items[0]);
      } else if (!items.length) {
        const c = asProductCost(withMake[0].product, itemById);
        say = c != null ? T.costProduct(withMake[0].product, c) : T.makeNoRecipe(withMake[0].product);
      } else say = T.costMany(items.length);
      return { intent, say, items, products: items.length ? [] : withMake.slice(0, 1), card: null,
        itemTag: i => (parseFloat(i.cost_per_unit) > 0 ? `${asMoney(i.cost_per_unit)} each` : 'No cost set'),
        productTag: p => { const c = asProductCost(p, itemById); return c != null ? asMoney(c) : null; } };
    }

    if (intent === 'leadtime') {
      if (!items.length) return none(T.nothing(shown));
      const l = items.length === 1 ? asLead(items[0]) : null;
      const say = items.length > 1 ? T.leadMany(items.length) : l ? T.leadOne(items[0], l) : T.leadNone(items[0]);
      return { intent, say, items, products: [], card: null,
        itemTag: i => { const x = asLead(i); return x ? `${x.days} ${x.days === 1 ? 'day' : 'days'}` : 'Not set'; } };
    }

    // have
    let say;
    if (!items.length && !withMake.length) say = T.nothing(shown);
    else if (!items.length) say = T.onlyProducts(withMake.length);
    else if (items.length === 1) {
      const i = items[0];
      const st = asStatus(i);
      say = st === 'out' ? T.outOne(i) + (i.reorder_pending ? T.pending : '')
          : T.haveOne(i) + (st === 'low' ? T.haveLow(i) + (i.reorder_pending ? T.pending : '') : '');
    } else {
      say = T.haveMany(items.length, items.filter(i => asStatus(i) !== 'out').length);
    }
    return { intent, say, items, products: withMake, card: null };
  }

  // Claude's mapping ({ intent, item_ids, product_ids, sort_field, sort_order,
  // limit, note } from /api/account-email action "assistant") -> answer.
  // Claude only chose WHICH records; every figure still comes from here.
  function asAnswerFromAI(query, ai) {
    const intent = ai.intent;
    if (intent === 'reorder' || intent === 'deliveries') return asAnswerGeneral(intent);
    const shown = String(query).trim();
    if (intent === 'unknown') return asCompose('have', [], [], shown, ai.note || '');

    const itemById = asItemById();
    const productById = {};
    (asProducts || []).forEach(p => { productById[p.id] = p; });
    let items = (ai.item_ids || []).map(id => itemById[id]).filter(Boolean);
    let products = (ai.product_ids || []).map(id => productById[id]).filter(Boolean)
      .map(p => ({ product: p, uses: [], direct: true }));

    // "How many can I make" naming an item: the products that use it.
    if (intent === 'produce' && !products.length && items.length) {
      const ids = new Set(items.map(i => i.id));
      products = (asProducts || []).map(p => {
        const uses = (Array.isArray(p.components) ? p.components : []).filter(c => ids.has(asCompId(c))).map(c => itemById[asCompId(c)]);
        return uses.length ? { product: p, uses, direct: true } : null;
      }).filter(Boolean);
      items = [];
    }

    // Rankings ("least of", "cheapest") are applied here, on real numbers.
    const dir = ai.sort_order === 'desc' ? -1 : 1;
    const num = v => (v == null || isNaN(v) ? Infinity * dir : v);
    const itemKey = {
      quantity: i => parseFloat(i.quantity) || 0,
      cost: i => parseFloat(i.cost_per_unit),
      lead_time: i => { const l = asLead(i); return l ? l.days : null; },
    }[ai.sort_field];
    const prodKey = {
      can_make: e => { const r = asCanMake(e.product, itemById); return r ? r.count : null; },
      cost: e => asProductCost(e.product, itemById),
    }[ai.sort_field];
    if (itemKey) items.sort((a, b) => dir * (num(itemKey(a)) - num(itemKey(b))));
    if (prodKey) products.sort((a, b) => dir * (num(prodKey(a)) - num(prodKey(b))));
    if (ai.limit > 0) {
      if (itemKey || !prodKey) items = items.slice(0, ai.limit);
      if (prodKey) products = products.slice(0, ai.limit);
    }

    return asCompose(intent, items, products, shown, ai.note || '');
  }

  async function asAskAI(question) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch('/api/account-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({
          action: 'assistant',
          question,
          store_id: window.currentStoreId || localStorage.getItem('shelfy_store_id') || null,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      const ai = await r.json();
      return ai && ai.intent ? ai : null;
    } catch (_) {
      return null;   // offline / timeout -> the local answer stands
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function asEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function asChips(attrs) {
    const vals = asAttrValues(attrs);
    return vals.length ? `<span class="as-chips">${vals.map(v => `<span class="as-chip">${asEsc(v)}</span>`).join('')}</span>` : '';
  }

  const AS_MAX = 15;

  // The spoken sentence isn't shown; only when there are no rows or card to
  // look at does a short line of it appear, so the screen never stays blank.
  function asRenderAnswer(ans) {
    asShowingRecent = false;
    const box = document.getElementById('asAnswer');
    const res = document.getElementById('asResults');
    if (!box) return;
    asShowCard(ans ? ans.card : null);
    if (!ans || (!ans.say && !ans.items.length && !ans.products.length)) { box.hidden = true; asSyncCtas(); return; }
    if (ans.card) { box.hidden = true; asSyncCtas(); return; }
    box.hidden = false;

    let html = '';
    if (ans.items.length) {
      html += `<div class="as-section">Inventory <span>${ans.items.length}</span></div>`;
      html += ans.items.slice(0, AS_MAX).map(i => `
        <a class="as-row" href="/ingredient-detail?id=${encodeURIComponent(i.id)}">
          <span class="as-main"><span class="as-name">${asEsc(i.name)}</span>${asChips(i.custom_attributes)}</span>
          ${ans.itemTag
            ? `<span class="as-make as-tag">${asEsc(ans.itemTag(i))}</span>`
            : `<span class="as-qty as-${asStatus(i)}">${asNum(i.quantity)}${i.unit ? ' ' + asEsc(i.unit) : ''}</span>`}
        </a>`).join('');
    }
    if (ans.products.length) {
      html += `<div class="as-section">Products <span>${ans.products.length}</span></div>`;
      html += ans.products.slice(0, AS_MAX).map(({ product: p, uses, make }) => {
        const sub = ans.showLimit && make
          ? `<span class="as-sub">${asEsc(T.limit(make))}</span>`
          : uses.length ? `<span class="as-sub">Uses ${uses.map(u => asEsc(u.name)).join(', ')}</span>` : '';
        const custom = ans.productTag ? ans.productTag(p) : null;
        const makeTag = custom ? `<span class="as-make as-tag">${asEsc(custom)}</span>`
          : make ? `<span class="as-make${make.count === 0 ? ' as-make-zero' : ''}">${asEsc(T.canMake(make.count))}</span>` : '';
        return `<a class="as-row" href="/recipe-detail?id=${encodeURIComponent(p.id)}">
          <span class="as-main"><span class="as-name">${asEsc(p.name)}</span>${asChips(p.attributes)}${sub}</span>
          ${makeTag}
        </a>`;
      }).join('');
    }
    if (ans.empty != null) {
      html = `<div class="as-noresult"><img src="/cat_no_results.png" alt="" />
        <p>${ans.note ? asEsc(ans.note) : `Nothing found${ans.empty ? ` for “${asEsc(ans.empty)}”` : ''}`}</p></div>`;
    } else if (!html) html = asMsgHtml(ans.intent === 'reorder' ? 'ok' : ans.intent === 'deliveries' ? 'deliv' : 'info', ans.say);
    res.innerHTML = html;
    asSyncCtas();
  }

  // ─── Recent searches (shown when the empty ask bar is focused) ────────────
  // Per-device convenience only, so localStorage is fine; every access is
  // guarded because storage can be unavailable (private mode, blocked).

  const AS_RECENT_KEY = 'shelfy_assistant_recent';
  const AS_RECENT_MAX = 5;
  let asShowingRecent = false;

  function asRecentGet() {
    try { const v = JSON.parse(localStorage.getItem(AS_RECENT_KEY)); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }

  function asRecentSet(list) {
    try { localStorage.setItem(AS_RECENT_KEY, JSON.stringify(list.slice(0, AS_RECENT_MAX))); } catch (_) {}
  }

  function asRecentAdd(q) {
    q = String(q || '').trim();
    if (asTokens(q).join('').length < 3) return;
    asRecentSet([q, ...asRecentGet().filter(x => x.toLowerCase() !== q.toLowerCase())]);
  }

  function asRenderRecent() {
    const input = document.getElementById('asInput');
    const box = document.getElementById('asAnswer');
    const list = asRecentGet();
    if (!box || input.value || !list.length) { if (asShowingRecent) { box.hidden = true; asShowingRecent = false; asSyncCtas(); } return; }
    asShowCard(null);
    asShowingRecent = true;
    box.hidden = false;
    const clock = '<svg class="as-recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    document.getElementById('asResults').innerHTML =
      '<div class="as-section">Recent</div>' +
      list.map(q => `<div class="as-row as-recent" role="button" tabindex="0" data-q="${asEsc(q)}">${clock}
          <span class="as-main"><span class="as-name">${asEsc(q)}</span></span>
          <button type="button" class="as-recent-x" aria-label="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>`).join('');
    asSyncCtas();
  }

  // One-line answers with nothing to list ("All good – nothing needs
  // reordering", "Nothing is on the way", "Search needs a connection", mic
  // hints): a row with a round icon, styled like the result rows around it,
  // instead of bare text in the card. tone: ok | deliv | warn | mic | info
  const AS_MSG_ICONS = {
    ok: '<path d="M20 6 9 17l-5-5"/>',
    deliv: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    warn: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
  };
  function asMsgHtml(tone, text) {
    const icon = AS_MSG_ICONS[tone] || AS_MSG_ICONS.info;
    return `<div class="as-msg" data-tone="${tone}" role="status">
        <span class="as-msg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
        <span class="as-msg-text">${asEsc(text)}</span>
      </div>`;
  }

  function asHint(msg, tone) {
    const box = document.getElementById('asAnswer');
    if (!box) return;
    asShowCard(null);
    box.hidden = false;
    document.getElementById('asResults').innerHTML = asMsgHtml(tone || 'warn', msg);
    asSyncCtas();
  }

  // Waiting on the AI answer (a search-history tap, or a typed question the
  // local match couldn't answer): placeholder rows shaped like the results
  // they'll be replaced by, instead of a bare "Let me check…" line.
  function asLoadingHint() {
    const box = document.getElementById('asAnswer');
    if (!box) return;
    asShowCard(null);
    box.hidden = false;
    const row = w => `<div class="as-row as-skel-row" aria-hidden="true">
        <span class="as-main"><span class="as-skel" style="width:${w}%"></span><span class="as-skel as-skel-sm"></span></span>
        <span class="as-skel as-skel-qty"></span>
      </div>`;
    document.getElementById('asResults').innerHTML =
      `<div class="as-section" role="status">Looking it up…</div>` + row(62) + row(48) + row(70);
    asSyncCtas();
  }

  function asShowCard(which) {
    const r = document.getElementById('asCardRestock');
    const d = document.getElementById('asCardDeliveries');
    if (r) r.hidden = which !== 'restock';
    if (d) d.hidden = which !== 'deliveries';
    asSyncCtas();
  }

  // ─── Asking ───────────────────────────────────────────────────────────────

  let asSeq = 0;

  async function asAsk(speak, useAI) {
    const input = document.getElementById('asInput');
    const query = input.value;
    document.getElementById('asClear').hidden = !query;
    asTyperSync();
    const seq = ++asSeq;
    if (!query.trim()) { asRenderAnswer(null); if (document.activeElement === input) asRenderRecent(); return; }

    const intent = asIntent(query);
    // No feedback until the search words have 3 letters ("Do I h" stays quiet).
    if (intent !== 'reorder' && intent !== 'deliveries' && asTokens(query).join('').length < 3) {
      asRenderAnswer(null);
      return;
    }
    if (intent !== 'reorder' && intent !== 'deliveries') {
      if (!asItems) {
        if (!navigator.onLine) { asHint('Search needs a connection.'); return; }
        asAvatarState('thinking', true);
        await asLoad();
        asAvatarState('thinking', false);
        if (seq !== asSeq) return;   // a newer question arrived meanwhile
        if (!asItems) { asHint('Couldn’t load your stock – try again.'); return; }
      } else {
        asLoad();   // refresh in the background if stale
      }
    }
    let ans = asAnswer(query);
    const wantAI = useAI === true || (useAI === 'fallback' && ans && ans.empty != null);
    if (wantAI && navigator.onLine) {
      if (useAI === 'fallback') asLoadingHint();
      asAvatarState('thinking', true);
      const ai = await asAskAI(query);
      asAvatarState('thinking', false);
      if (seq !== asSeq) return;
      if (ai) {
        // Items created since the last load wouldn't resolve -- reload once.
        const known = asItemById();
        if ((ai.item_ids || []).some(id => !known[id])) { await asLoad(true); if (seq !== asSeq) return; }
        ans = asAnswerFromAI(query, ai);
      }
    }
    asRenderAnswer(ans);
    if (useAI) asRecentAdd(query);
    if (speak) asSpeak(ans.say);
  }

  // ─── Voice out ────────────────────────────────────────────────────────────

  // Set when the user chose to speak but the browser has no in-app speech
  // recognition (iOS home-screen app) -> keyboard dictation fills the field,
  // and that answer should still be read aloud.
  let asDictation = false;
  let asSpeechUnlocked = false;
  // Spoken answers are switched off for now (flip to true to bring them and
  // the speaker toggle in the ask bar back).
  const AS_VOICE_ANSWERS = false;

  function asMuted() {
    try { return localStorage.getItem('shelfy_assistant_muted') === '1'; } catch (_) { return false; }
  }

  // iOS only lets speechSynthesis talk after it was first used inside a user
  // gesture; answers arrive after an await, outside the gesture. Speaking a
  // silent utterance on the first tap/keypress unlocks it for the session.
  const AS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function asUnlockSpeech() {
    // Only iOS needs this; on Chrome a silent utterance can wedge the queue.
    if (!AS_IOS || asSpeechUnlocked || !('speechSynthesis' in window)) return;
    asSpeechUnlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  function asPickVoice() {
    try {
      const voices = speechSynthesis.getVoices() || [];
      return voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en') && v.localService)
          || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en')) || null;
    } catch (_) { return null; }
  }

  let asUtterance = null;   // kept referenced: Chrome drops events of GC'd utterances

  function asVoiceNote(msg) {
    const res = document.getElementById('asResults');
    if (!res) return;
    const note = document.createElement('div');
    note.className = 'as-voice-err';
    note.textContent = `Couldn’t play the answer aloud (${msg}).`;
    res.appendChild(note);
  }

  // attempt 0: preferred voice, after a pause so a just-ended speech
  // recognition session (Android) has released the audio channel.
  // attempt 1: plain utterance with just a lang, as a fallback.
  function asSpeak(text, attempt = 0, manual = false) {
    if (!AS_VOICE_ANSWERS) return;
    if (!text || (asMuted() && !manual) || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    try {
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      if (attempt === 0) { const v = asPickVoice(); if (v) u.voice = v; }
      asUtterance = u;
      let settled = false;
      const retryOrReport = reason => {
        if (settled) return;
        settled = true;
        if (attempt === 0) asSpeak(text, 1, manual);
        else asVoiceNote(reason);
      };
      u.onstart = () => { settled = true; };
      u.onerror = e => {
        if (e.error === 'interrupted' || e.error === 'canceled') { settled = true; return; }
        retryOrReport(e.error || 'error');
      };
      setTimeout(() => {
        try { synth.resume(); synth.speak(u); } catch (err) { retryOrReport(err.message || 'error'); return; }
        setTimeout(() => { if (!settled && !synth.speaking) retryOrReport('no audio started'); }, 3000);
      }, attempt === 0 && !manual ? 400 : 50);
    } catch (err) {
      asVoiceNote(err.message || 'error');
    }
  }

  function asRenderMute() {
    const btn = document.getElementById('asMute');
    if (!btn) return;
    btn.hidden = !AS_VOICE_ANSWERS;
    const muted = asMuted();
    btn.classList.toggle('as-muted', muted);
    btn.setAttribute('aria-label', muted ? 'Turn spoken answers on' : 'Turn spoken answers off');
    btn.title = muted ? 'Spoken answers off' : 'Spoken answers on';
  }

  // ─── Voice in: full-screen listening overlay ──────────────────────────────

  let asRec = null;
  let asRecAborted = false;

  // Same cat as #asAvatar, but with the ears drawn as their own shapes so
  // they can twitch while listening and perk up when speech comes in (same
  // ear motion as the scan screens' cat, scan-screen.js). The dashboard
  // avatar keeps its single-outline drawing.
  const AS_VOICE_FACE = `
    <svg viewBox="14 10 72 83" aria-hidden="true">
      <path class="as-body as-ear as-ear-l" d="M17 38 V13 L37 36 Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
      <path class="as-body as-ear as-ear-r" d="M83 38 V13 L63 36 Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
      <path class="as-body" d="M17 34 H83 V78 Q83 90 71 90 H29 Q17 90 17 78 Z" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>
      <path class="as-brow" d="M29 43 L43 39"/>
      <path class="as-brow" d="M57 39 L71 43"/>
      <g class="as-eyes">
        <ellipse class="as-eye" cx="37" cy="53" rx="8" ry="8"/>
        <ellipse class="as-eye" cx="63" cy="53" rx="8" ry="8"/>
      </g>
      <path class="as-nose" d="M44.6 64.5 h10.8 a1.6 1.6 0 0 1 1.28 2.56 l-4.6 6.13 a2.6 2.6 0 0 1 -4.16 0 l-4.6 -6.13 A1.6 1.6 0 0 1 44.6 64.5 Z"/>
    </svg>`;

  let asLastPerk = 0;
  // Ears flick up once -- called as speech comes in, at most every 900ms so
  // a stream of interim results doesn't keep restarting the animation.
  function asVoicePerk() {
    const face = document.querySelector('#asVoice .as-voice-face');
    if (!face || Date.now() - asLastPerk < 900) return;
    asLastPerk = Date.now();
    face.classList.remove('as-perk');
    void face.offsetWidth;
    face.classList.add('as-perk');
  }

  function asVoiceOverlay() {
    let el = document.getElementById('asVoice');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'asVoice';
    el.className = 'as-voice';
    el.hidden = true;
    el.innerHTML = `
      <button type="button" class="as-voice-close" aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="as-voice-body">
        <div class="as-avatar as-voice-face" data-mood="happy">${AS_VOICE_FACE}</div>
        <p class="as-voice-status" id="asVoiceStatus"></p>
        <p class="as-voice-text" id="asVoiceText"></p>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.as-voice-close').addEventListener('click', e => { e.stopPropagation(); asVoiceCancel(); });
    // Tapping anywhere (except the X, which cancels) means "I'm done talking"
    // -- there's no separate Done button.
    el.addEventListener('click', () => asVoiceFinish());
    return el;
  }

  // isExample: `text` is the "e.g. …" prompt, not something the user said --
  // shown in regular weight instead of the transcript's emphasis.
  function asVoiceState(state, status, text, isExample) {
    const el = asVoiceOverlay();
    el.dataset.state = state;
    const face = el.querySelector('.as-voice-face');
    face.classList.toggle('as-listening', state === 'listening');
    face.classList.toggle('as-thinking', state === 'thinking');
    document.getElementById('asVoiceStatus').textContent = status;
    if (text != null) {
      const t = document.getElementById('asVoiceText');
      t.textContent = text;
      t.toggleAttribute('data-example', !!isExample);
    }
  }

  function asVoiceShow() {
    const el = asVoiceOverlay();
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('as-voice-in'));
    document.body.classList.add('as-voice-open');
  }

  function asVoiceHide() {
    const el = document.getElementById('asVoice');
    if (!el) return;
    el.classList.remove('as-voice-in');
    document.body.classList.remove('as-voice-open');
    setTimeout(() => { if (!el.classList.contains('as-voice-in')) el.hidden = true; }, 220);
  }

  function asVoiceFinish() { if (asRec) { try { asRec.stop(); } catch (_) {} } else asVoiceHide(); }
  function asVoiceCancel() {
    asRecAborted = true;
    if (asRec) { try { asRec.abort(); } catch (_) {} }
    asVoiceHide();
  }

  function asKeyboardFallback(msg) {
    const input = document.getElementById('asInput');
    asDictation = true;
    asVoiceHide();
    input.focus();
    asHint(msg, 'mic');
  }

  function asMic() {
    const input = document.getElementById('asInput');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (asRec) { asVoiceFinish(); return; }
    if (!Rec) { asKeyboardFallback('Tap the mic on your keyboard to speak.'); return; }
    asLoad();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const rec = new Rec();
    // Always English -- Shelfy's UI and the assistant's question matching are
    // English-only. navigator.language follows the phone's system language
    // (e.g. de-DE), which made the recognizer transcribe English questions as
    // German and garble them.
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let transcript = '';
    asRecAborted = false;
    rec.onstart = () => asVoiceState('listening', 'I’m listening – go ahead', 'e.g. “' + asSuggestions()[0] + '”', true);
    rec.onresult = e => {
      transcript = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
      if (transcript) {
        asVoiceState('listening', 'I’m listening – tap anywhere when finished', transcript);
        asVoicePerk();
      }
    };
    rec.onspeechend = () => { if (transcript) asVoiceState('thinking', 'Let me check…'); };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        asRecAborted = true;
        asKeyboardFallback('Microphone blocked – tap the mic on your keyboard instead.');
      } else if (e.error === 'no-speech') {
        asRecAborted = true;
        asVoiceState('idle', 'I didn’t hear anything', 'Tap the mic and try again.');
        setTimeout(asVoiceHide, 1600);
      }
    };
    rec.onend = () => {
      asRec = null;
      asAvatarState('listening', false);
      if (asRecAborted || !transcript) { if (!asRecAborted) asVoiceHide(); return; }
      asVoiceState('thinking', 'Let me check…', transcript);
      input.value = transcript;
      asAsk(true, true).finally(() => setTimeout(asVoiceHide, 350));
    };
    try {
      rec.start();
      asRec = rec;
      asAvatarState('listening', true);
      asVoiceState('starting', 'One moment…', '');
      asVoiceShow();
    } catch (_) {
      asRec = null;
      asKeyboardFallback('Tap the mic on your keyboard to speak.');
    }
  }

  // ─── Typing suggestions in the empty ask bar ──────────────────────────────

  const AS_FALLBACK_SUGGESTIONS = [
    'What do I need to reorder?',
    'When does my delivery arrive?',
  ];

  const AS_ITEM_TEMPLATES = [
    n => `What does a ${n} cost me?`,
    n => `How many of ${n} have I left?`,
    n => `How long does it take to reorder ${n}?`,
  ];
  const AS_PRODUCT_TEMPLATES = [
    n => `How many ${n} can I make?`,
  ];

  function asShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Base name without the " · Black · M" variant suffix.
  function asBaseName(name) {
    return String(name || '').split(/\s[·•|]\s|\s-\s/)[0].trim();
  }

  function asPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // A fresh round every cycle: each template gets a different random item or
  // product, so the examples keep changing and always name real things.
  function asSuggestions() {
    const short = arr => { const s = arr.filter(x => x.name && x.name.length <= 34); return s.length ? s : arr.filter(x => x.name); };
    const items = asShuffle(short(asItems || []));
    const prods = asShuffle(short((asProducts || []).filter(p => Array.isArray(p.components) && p.components.length)));
    const out = [];
    AS_ITEM_TEMPLATES.forEach((t, k) => { if (items.length) out.push(t(items[k % items.length].name)); });
    AS_PRODUCT_TEMPLATES.forEach((t, k) => { if (prods.length) out.push(t(prods[k % prods.length].name)); });
    if (prods.length > 1) out.push(AS_PRODUCT_TEMPLATES[0](prods[1].name));
    if (asInbound.length) out.push('When does my delivery arrive?');
    if (asStock.out.some(i => !i.reorder_pending) || asStock.low.some(i => !i.reorder_pending)) out.push('What do I need to reorder?');
    return out.length ? asShuffle(out) : AS_FALLBACK_SUGGESTIONS;
  }

  let asTyperTimer = null;
  let asTyperList = [];
  let asTyperIdx = 0;

  function asTyperSync() {
    const input = document.getElementById('asInput');
    const typer = document.getElementById('asTyper');
    if (!input || !typer) return;
    const active = !input.value && document.activeElement !== input && !document.hidden;
    typer.hidden = !active;
    if (active && !asTyperTimer) asTyperRun();
    if (!active && asTyperTimer) { clearTimeout(asTyperTimer); asTyperTimer = null; }
  }

  function asTyperRun() {
    const textEl = document.getElementById('asTyperText');
    if (!textEl) return;
    if (asTyperIdx >= asTyperList.length) { asTyperList = asSuggestions(); asTyperIdx = 0; if (!asItems) asLoad(); }
    const typer = document.getElementById('asTyper');
    const full = asTyperList[asTyperIdx++];
    let n = 0;
    const show = str => {
      textEl.textContent = str;
      typer.classList.toggle('as-overflow', textEl.scrollWidth > typer.clientWidth - 4);
    };
    const type = () => {
      show(full.slice(0, ++n));
      if (n < full.length) asTyperTimer = setTimeout(type, 45 + Math.random() * 55);
      else asTyperTimer = setTimeout(erase, 1800);
    };
    const erase = () => {
      show(full.slice(0, --n));
      if (n > 0) asTyperTimer = setTimeout(erase, 18);
      else asTyperTimer = setTimeout(asTyperRun, 350);
    };
    type();
  }

  // ─── First steps: "Create your first ..." CTAs below the ask bar ─────────
  // Replaces the old onboarding questionnaire: each card shows only while
  // the user has none of that thing yet, and opens the same create flow as
  // the radial menu.

  const AS_FIRST_STEPS = [
    { key: 'item', table: 'ingredients', action: 'item', title: 'Create your first item',
      sub: 'Anything you keep in stock – materials, blanks, packaging',
      icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
    { key: 'product', table: 'recipes', action: 'product', title: 'Create your first product',
      sub: 'Bundle items into something you sell',
      icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    { key: 'order', table: 'sales', action: 'order', title: 'Process your first order',
      sub: 'Takes the items it used out of your stock',
      icon: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>' },
    { key: 'expense', table: 'expenses', action: 'expense', title: 'Add your first expense',
      sub: 'Log a receipt or supplier bill',
      icon: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>' },
  ];
  let asFirstCounts = null;   // { item, product, order, expense } -> count

  async function asLoadFirstCounts() {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;
      if (!window.currentStoreId && typeof ensureStoreExists === 'function') await ensureStoreExists(user);
      const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');
      const results = await Promise.all(AS_FIRST_STEPS.map(step => {
        let q = supabaseClient.from(step.table).select('id', { count: 'exact', head: true }).eq('profile_id', user.id);
        if (storeId) q = q.eq('store_id', storeId);
        return q;
      }));
      // A failed count is treated as "has some" so a network error never
      // shows a new-user card to an existing user.
      asFirstCounts = {};
      AS_FIRST_STEPS.forEach((step, n) => {
        const r = results[n];
        asFirstCounts[step.key] = r && !r.error && typeof r.count === 'number' ? r.count : 1;
      });
      asRenderCtas();
    } catch (e) {
      console.error('Shelfy assistant: first-steps counts failed', e);
    }
  }

  function asRenderCtas() {
    const el = document.getElementById('asCtas');
    if (!el) return;
    const missing = asFirstCounts ? AS_FIRST_STEPS.filter(step => asFirstCounts[step.key] === 0) : [];
    if (!missing.length) { el.innerHTML = ''; asSyncCtas(); return; }
    const done = AS_FIRST_STEPS.length - missing.length;
    el.innerHTML = `<div class="as-section">Get started <span>${done} of ${AS_FIRST_STEPS.length} done</span></div>` +
      missing.map(step => `<button type="button" class="as-cta" data-action="${step.action}">
          <span class="as-cta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${step.icon}</svg></span>
          <span class="as-main"><span class="as-name">${asEsc(step.title)}</span><span class="as-sub">${asEsc(step.sub)}</span></span>
          <svg class="as-cta-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="9 6 15 12 9 18"/></svg>
        </button>`).join('');
    asSyncCtas();
  }

  // The CTAs step aside while an answer, a list or recent searches are shown.
  function asSyncCtas() {
    const el = document.getElementById('asCtas');
    if (!el) return;
    const busy = ['asAnswer', 'asCardRestock', 'asCardDeliveries']
      .some(id => { const x = document.getElementById(id); return x && !x.hidden; });
    el.hidden = busy || !el.innerHTML;
  }

  // ─── Avatar: mood, nudge, radial menu ─────────────────────────────────────

  function asAvatarState(state, on) {
    document.getElementById('asAvatar')?.classList.toggle('as-' + state, on);
  }

  function asRenderMood() {
    const av = document.getElementById('asAvatar');
    const nudge = document.getElementById('asNudge');
    if (!av || !nudge) return;
    const openOut = asStock.out.filter(i => !i.reorder_pending).length;
    const openLow = asStock.low.filter(i => !i.reorder_pending).length;
    av.dataset.mood = openOut ? 'worried' : openLow ? 'concerned' : 'happy';

    const toOrder = openOut + openLow;
    const parts = [];
    if (toOrder) parts.push(`<button type="button" class="as-nudge-btn as-nudge-${openOut ? 'out' : 'low'}" data-card="restock">${toOrder} to reorder</button>`);
    if (asInbound.length) parts.push(`<button type="button" class="as-nudge-btn" data-card="deliveries">${asInbound.length} on the way</button>`);
    nudge.innerHTML = parts.join('');
  }

  function asGreeting() {
    const el = document.getElementById('asGreet');
    if (!el) return;
    const h = new Date().getHours();
    const hi = h < 5 ? 'Up late?' : h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!';
    el.textContent = `${hi} What do you need to know?`;
  }

  function asToggleRadial(open) {
    const wrap = document.getElementById('asAvatarWrap');
    const av = document.getElementById('asAvatar');
    if (!wrap) return;
    const next = open == null ? !wrap.classList.contains('as-open') : open;
    wrap.classList.toggle('as-open', next);
    document.body.classList.toggle('as-radial-open', next);
    av.setAttribute('aria-expanded', String(next));
  }

  const AS_ACTIONS = {
    order: 'openOrderMethodModal',
    item: 'openMethodModal',
    product: 'goToNewProduct',
    expense: 'openExpenseChoiceModal',
  };

  // ─── Wiring ───────────────────────────────────────────────────────────────

  let asTypeTimer = null;

  function asInit() {
    const input = document.getElementById('asInput');
    if (!input) return;
    asGreeting();
    asRenderMood();
    asRenderMute();
    asTyperSync();
    // Load now so suggestions can use the user's own items.
    setTimeout(() => { asLoad().then(() => { asTyperList = []; }); asLoadFirstCounts(); }, 600);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && asFirstCounts) asLoadFirstCounts(); });
    document.getElementById('asCtas')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const fn = window[AS_ACTIONS[btn.dataset.action]];
      if (typeof fn === 'function') fn();
    });

    input.addEventListener('focus', () => { asLoad(); asToggleRadial(false); asTyperSync(); asRenderRecent(); });
    input.addEventListener('blur', () => {
      asDictation = false;
      setTimeout(asTyperSync, 0);
      if (asShowingRecent) { const box = document.getElementById('asAnswer'); if (box) box.hidden = true; asShowingRecent = false; asSyncCtas(); }
    });

    const results = document.getElementById('asResults');
    // mousedown default = blur the input, which would hide the list before the
    // click lands; keep focus until the tap is handled.
    results.addEventListener('mousedown', e => { if (e.target.closest('.as-recent')) e.preventDefault(); });
    results.addEventListener('click', e => {
      const row = e.target.closest('.as-recent');
      if (row) {
        const q = row.dataset.q;
        if (e.target.closest('.as-recent-x')) {
          asRecentSet(asRecentGet().filter(x => x !== q));
          asRenderRecent();
          if (!asShowingRecent) input.blur();
          return;
        }
        input.value = q;
        input.blur();
        asAsk(false, 'fallback');
        asRecentAdd(q);
        return;
      }
      // Opening a result also counts as a search worth remembering.
      if (e.target.closest('a.as-row')) asRecentAdd(input.value);
    });
    document.addEventListener('visibilitychange', asTyperSync);
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, asUnlockSpeech, { once: true, capture: true }));
    if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); } catch (_) {} }
    input.addEventListener('input', () => {
      clearTimeout(asTypeTimer);
      asTyperSync();
      // Dictated text arrives in bursts; wait for it to settle, then answer aloud.
      asTypeTimer = asDictation ? setTimeout(() => asAsk(true, true), 1100)
                                : setTimeout(() => asAsk(false), 220);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; asAsk(false); input.blur(); }
      if (e.key === 'Enter') { clearTimeout(asTypeTimer); asAsk(true, 'fallback'); input.blur(); }
    });
    document.getElementById('asClear').addEventListener('click', () => {
      input.value = ''; asAsk(false); input.focus();
    });
    document.getElementById('asMic').addEventListener('click', asMic);
    document.getElementById('asMute').addEventListener('click', () => {
      try { localStorage.setItem('shelfy_assistant_muted', asMuted() ? '0' : '1'); } catch (_) {}
      if (asMuted() && 'speechSynthesis' in window) speechSynthesis.cancel();
      asRenderMute();
      if (!asMuted()) asSpeak('Sound on.', 0, true);
    });

    document.getElementById('asAvatar').addEventListener('click', e => { e.stopPropagation(); asToggleRadial(); });
    document.getElementById('asRadial').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      asToggleRadial(false);
      const fn = window[AS_ACTIONS[btn.dataset.action]];
      if (typeof fn === 'function') fn();
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#asAvatarWrap')) asToggleRadial(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      asToggleRadial(false);
      if (asRec) asVoiceCancel();
    });

    document.getElementById('asNudge').addEventListener('click', e => {
      const btn = e.target.closest('[data-card]');
      if (!btn) return;
      // Tapping the same nudge again closes its list.
      const open = document.getElementById(btn.dataset.card === 'restock' ? 'asCardRestock' : 'asCardDeliveries');
      if (open && !open.hidden) { input.value = ''; asAsk(false); return; }
      input.value = btn.dataset.card === 'restock' ? 'What do I need to reorder?' : 'When does my delivery arrive?';
      asAsk(false);
    });
    document.querySelectorAll('.as-card-close').forEach(b => b.addEventListener('click', () => {
      input.value = ''; asAsk(false);
    }));
  }

  window.addEventListener('shelfy:dash-stock', e => {
    asStock = { out: e.detail.out || [], low: e.detail.low || [] };
    asRenderMood();
  });
  window.addEventListener('shelfy:dash-inbound', e => {
    asInbound = e.detail.pending || [];
    asRenderMood();
  });
  window.addEventListener('shelfy:synced', () => { asItems = null; if (asFirstCounts) asLoadFirstCounts(); });

  // Exposed for the dashboard and for testing.
  window.ShelfyAssistant = { answer: asAnswer, fromAI: asAnswerFromAI, canMake: asCanMake, _set(items, products, stock, inbound) {
    asItems = items; asProducts = products; asLoadedAt = Date.now();
    if (stock) asStock = stock;
    if (inbound) asInbound = inbound;
  } };

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', asInit);
  else asInit();
})();
