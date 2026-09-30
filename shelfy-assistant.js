// Shelfy assistant — the dashboard. A reactive avatar (mood from stock), a
// radial quick-action menu, and an ask bar (typed or spoken) that answers:
//   "Hab ich noch blau XL da?"        -> matching items + products using them
//   "Wie viele Hoodies kann ich machen?" -> producible count + bottleneck
//   "Was muss ich nachbestellen?"     -> opens the restock card
//   "Kommt noch was?"                 -> opens the pending-deliveries card
// Everything runs locally on the user's own data; no AI call.
// The restock + deliveries cards are still filled by operations.html's own
// _renderInventoryStatus / _renderInboundStatus, which announce their data via
// the shelfy:dash-stock / shelfy:dash-inbound events for the mood + nudge.

(function () {
  let asItems = null;      // ingredients rows
  let asProducts = null;   // recipes rows
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

  const AS_DE_MARKERS = new Set(('ich hab habe noch wie viele viel kann was muss gibt sind ist da welche ' +
    'kommt nachbestellen bestellen lieferung lieferungen unterwegs machen herstellen leer knapp').split(' '));

  function asLang(query) {
    const words = asNorm(query).split(' ');
    if (words.some(w => AS_DE_MARKERS.has(w))) return 'de';
    if (/^(do|how|what|is|are|any|can)\b/.test(asNorm(query))) return 'en';
    return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  function asIntent(query) {
    const q = ' ' + asNorm(query) + ' ';
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
          .select('id, name, quantity, unit, min_stock, category, custom_attributes, reorder_pending, alert_disabled, expiration_date')
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

  // ─── Answer text ──────────────────────────────────────────────────────────

  function asNum(q) {
    const n = parseFloat(q) || 0;
    return Number.isInteger(n) ? n : +n.toFixed(2);
  }

  function asLabel(i) {
    const vals = asAttrValues(i.custom_attributes);
    return vals.length ? `${i.name} (${vals.join(', ')})` : i.name;
  }

  function asList(names, lang) {
    const and = lang === 'de' ? 'und' : 'and';
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ` ${and} ` + names[names.length - 1];
  }

  const T = {
    de: {
      nothing: q => `Dazu habe ich nichts gefunden${q ? ` („${q}“)` : ''}.`,
      haveOne: (i) => `Ja, noch ${asNum(i.quantity)}${i.unit ? ' ' + i.unit : ''} ${asLabel(i)}.`,
      haveLow: (i) => ` Wird knapp – Minimum ist ${asNum(i.min_stock)}.`,
      outOne: (i) => `Nein, ${asLabel(i)} ist leer.`,
      pending: ' Ist aber schon nachbestellt.',
      haveMany: (n, inStock) => `${n} passende Artikel – ${inStock === n ? 'alle' : inStock} davon auf Lager.`,
      onlyProducts: n => `Keine Artikel, aber ${n} passende${n === 1 ? 's Produkt' : ' Produkte'}.`,
      makeOne: (p, r) => `Du kannst ${r.count}× ${p.name} machen.`,
      makeBlock: r => ` Engpass: ${r.blocker.name} (${asNum(r.stock)} übrig, ${asNum(r.need)} pro Stück).`,
      makeZero: (p, r) => `Gerade kannst du kein ${p.name} machen – ${r.blocker.name} ${r.expired ? 'ist abgelaufen' : 'reicht nicht'}.`,
      makeMany: (total, n, top) => `Insgesamt ${total} möglich über ${n} Varianten. Am meisten: ${top.name} (${top.count}).`,
      makeNoRecipe: p => `${p.name} hat noch keine Bestandteile hinterlegt – dann kann ich nicht rechnen.`,
      makeNone: q => `Ich habe kein Produkt zu „${q}“ gefunden.`,
      reorderNone: 'Alles gut – gerade muss nichts nachbestellt werden.',
      reorder: (n, names, more) => `${n === 1 ? 'Eine Sache musst' : n + ' Sachen musst'} du nachbestellen: ${asList(names, 'de')}${more ? ' und weitere' : ''}.`,
      reorderPendingOnly: n => `Alles Nötige ist schon bestellt – ${n} ${n === 1 ? 'Lieferung ist' : 'Lieferungen sind'} unterwegs.`,
      delivNone: 'Gerade ist nichts unterwegs.',
      deliv: (n, names) => `${n === 1 ? 'Eine Lieferung ist' : n + ' Lieferungen sind'} unterwegs: ${asList(names, 'de')}.`,
      makes: n => `${n} möglich`,
    },
    en: {
      nothing: q => `I couldn’t find anything${q ? ` for “${q}”` : ''}.`,
      haveOne: (i) => `Yes, you have ${asNum(i.quantity)}${i.unit ? ' ' + i.unit : ''} ${asLabel(i)}.`,
      haveLow: (i) => ` Running low – minimum is ${asNum(i.min_stock)}.`,
      outOne: (i) => `No, ${asLabel(i)} is out of stock.`,
      pending: ' It’s already reordered though.',
      haveMany: (n, inStock) => `${n} matching items – ${inStock === n ? 'all' : inStock} in stock.`,
      onlyProducts: n => `No items, but ${n} matching product${n === 1 ? '' : 's'}.`,
      makeOne: (p, r) => `You can make ${r.count}× ${p.name}.`,
      makeBlock: r => ` Bottleneck: ${r.blocker.name} (${asNum(r.stock)} left, ${asNum(r.need)} each).`,
      makeZero: (p, r) => `You can’t make ${p.name} right now – ${r.blocker.name} ${r.expired ? 'has expired' : 'is short'}.`,
      makeMany: (total, n, top) => `${total} in total across ${n} variants. Most: ${top.name} (${top.count}).`,
      makeNoRecipe: p => `${p.name} has no components yet, so I can’t calculate it.`,
      makeNone: q => `I couldn’t find a product for “${q}”.`,
      reorderNone: 'All good – nothing needs reordering right now.',
      reorder: (n, names, more) => `${n === 1 ? 'One thing needs' : n + ' things need'} reordering: ${asList(names, 'en')}${more ? ' and more' : ''}.`,
      reorderPendingOnly: n => `Everything low is already ordered – ${n} ${n === 1 ? 'delivery is' : 'deliveries are'} on the way.`,
      delivNone: 'Nothing is on the way right now.',
      deliv: (n, names) => `${n === 1 ? 'One delivery is' : n + ' deliveries are'} on the way: ${asList(names, 'en')}.`,
      makes: n => `makes ${n}`,
    },
  };

  // Pure: question + data -> { intent, lang, say, items, products, card }
  function asAnswer(query) {
    const lang = asLang(query);
    const t = T[lang];
    const intent = asIntent(query);

    if (intent === 'reorder') {
      const all = [...asStock.out, ...asStock.low];
      const open = all.filter(i => !i.reorder_pending);
      let say;
      if (!all.length) say = t.reorderNone;
      else if (!open.length) say = t.reorderPendingOnly(asInbound.length || all.length);
      else say = t.reorder(open.length, open.slice(0, 3).map(i => i.name), open.length > 3);
      return { intent, lang, say, items: [], products: [], card: all.length ? 'restock' : null };
    }

    if (intent === 'deliveries') {
      const say = asInbound.length ? t.deliv(asInbound.length, asInbound.slice(0, 3).map(i => i.name)) : t.delivNone;
      return { intent, lang, say, items: [], products: [], card: asInbound.length ? 'deliveries' : null };
    }

    const tokens = asTokens(query).filter(w => intent !== 'produce' || !AS_PRODUCE_WORDS.has(w));
    // The user's own spelling of the search words ("Einhörner", not "einhorner").
    const keep = new Set(tokens);
    const shown = String(query).split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}-]/gu, ''))
      .filter(w => keep.has(asNorm(w))).join(' ') || tokens.join(' ');
    if (!tokens.length) return { intent, lang, say: '', items: [], products: [], card: null };
    const { items, products } = asSearch(tokens);
    const itemById = asItemById();
    const withMake = asDropShadowedParents(products).map(e => ({ ...e, make: asCanMake(e.product, itemById) }));

    if (intent === 'produce') {
      // Prefer products named like the question; fall back to ones using a matched item.
      const direct = withMake.filter(e => e.direct);
      const pool = direct.length ? direct : withMake;
      if (!pool.length) return { intent, lang, say: t.makeNone(shown), items, products: [], card: null };
      const calc = pool.filter(e => e.make);
      let say;
      if (!calc.length) say = t.makeNoRecipe(pool[0].product);
      else if (calc.length === 1) {
        const { product: p, make: r } = calc[0];
        say = r.count === 0 ? t.makeZero(p, r) : t.makeOne(p, r) + t.makeBlock(r);
      } else {
        const total = calc.reduce((s, e) => s + e.make.count, 0);
        const top = calc.reduce((a, b) => (b.make.count > a.make.count ? b : a));
        say = t.makeMany(total, calc.length, { name: top.product.name, count: top.make.count });
      }
      pool.sort((a, b) => ((b.make ? b.make.count : -1) - (a.make ? a.make.count : -1)));
      return { intent, lang, say, items: [], products: pool, card: null };
    }

    // have
    let say;
    if (!items.length && !withMake.length) say = t.nothing(shown);
    else if (!items.length) say = t.onlyProducts(withMake.length);
    else if (items.length === 1) {
      const i = items[0];
      const st = asStatus(i);
      say = st === 'out' ? t.outOne(i) + (i.reorder_pending ? t.pending : '')
          : t.haveOne(i) + (st === 'low' ? t.haveLow(i) + (i.reorder_pending ? t.pending : '') : '');
    } else {
      say = t.haveMany(items.length, items.filter(i => asStatus(i) !== 'out').length);
    }
    return { intent, lang, say, items, products: withMake, card: null };
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

  function asRenderAnswer(ans) {
    const box = document.getElementById('asAnswer');
    const sayEl = document.getElementById('asSay');
    const res = document.getElementById('asResults');
    if (!box) return;
    asShowCard(ans ? ans.card : null);
    if (!ans || (!ans.say && !ans.items.length && !ans.products.length)) { box.hidden = true; return; }
    box.hidden = false;
    sayEl.textContent = ans.say;
    const t = T[ans.lang];

    let html = '';
    if (ans.items.length) {
      html += `<div class="as-section">Inventory <span>${ans.items.length}</span></div>`;
      html += ans.items.slice(0, AS_MAX).map(i => `
        <a class="as-row" href="/ingredient-detail?id=${encodeURIComponent(i.id)}">
          <span class="as-main"><span class="as-name">${asEsc(i.name)}</span>${asChips(i.custom_attributes)}</span>
          <span class="as-qty as-${asStatus(i)}">${asNum(i.quantity)}${i.unit ? ' ' + asEsc(i.unit) : ''}</span>
        </a>`).join('');
    }
    if (ans.products.length) {
      html += `<div class="as-section">Products <span>${ans.products.length}</span></div>`;
      html += ans.products.slice(0, AS_MAX).map(({ product: p, uses, make }) => {
        const usesLine = uses.length ? `<span class="as-sub">Uses ${uses.map(u => asEsc(u.name)).join(', ')}</span>` : '';
        const makeTag = make ? `<span class="as-make${make.count === 0 ? ' as-make-zero' : ''}">${asEsc(t.makes(make.count))}</span>` : '';
        return `<a class="as-row" href="/recipe-detail?id=${encodeURIComponent(p.id)}">
          <span class="as-main"><span class="as-name">${asEsc(p.name)}</span>${asChips(p.attributes)}${usesLine}</span>
          ${makeTag}
        </a>`;
      }).join('');
    }
    res.innerHTML = html;
  }

  function asHint(msg) {
    const box = document.getElementById('asAnswer');
    if (!box) return;
    box.hidden = false;
    document.getElementById('asSay').textContent = msg;
    document.getElementById('asResults').innerHTML = '';
  }

  function asShowCard(which) {
    const r = document.getElementById('asCardRestock');
    const d = document.getElementById('asCardDeliveries');
    if (r) r.hidden = which !== 'restock';
    if (d) d.hidden = which !== 'deliveries';
  }

  // ─── Asking ───────────────────────────────────────────────────────────────

  let asSeq = 0;

  async function asAsk(fromVoice) {
    const input = document.getElementById('asInput');
    const query = input.value;
    document.getElementById('asClear').hidden = !query;
    const seq = ++asSeq;
    if (!query.trim()) { asRenderAnswer(null); return; }

    const intent = asIntent(query);
    if (intent === 'have' || intent === 'produce') {
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
    const ans = asAnswer(query);
    asRenderAnswer(ans);
    if (fromVoice) asSpeak(ans.say, ans.lang);
  }

  // ─── Voice in / out ───────────────────────────────────────────────────────

  let asRec = null;

  function asMuted() {
    try { return localStorage.getItem('shelfy_assistant_muted') === '1'; } catch (_) { return false; }
  }

  function asSpeak(text, lang) {
    if (!text || asMuted() || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'de' ? 'de-DE' : 'en-US';
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  function asRenderMute() {
    const btn = document.getElementById('asMute');
    if (!btn) return;
    const muted = asMuted();
    btn.classList.toggle('as-muted', muted);
    btn.setAttribute('aria-label', muted ? 'Turn spoken answers on' : 'Turn spoken answers off');
    btn.title = muted ? 'Spoken answers off' : 'Spoken answers on';
  }

  function asMic() {
    const input = document.getElementById('asInput');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (asRec) { try { asRec.stop(); } catch (_) {} return; }
    if (!Rec) {
      input.focus();
      asHint('Tap the mic on your keyboard to speak.');
      return;
    }
    asLoad();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const rec = new Rec();
    rec.lang = navigator.language || 'de-DE';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let gotResult = false;
    rec.onresult = e => {
      gotResult = true;
      input.value = Array.from(e.results).map(r => r[0].transcript).join(' ');
      document.getElementById('asClear').hidden = !input.value;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        input.focus();
        asHint('Microphone blocked – tap the mic on your keyboard instead.');
      } else if (e.error === 'no-speech') {
        asHint('Didn’t catch that – try again.');
      }
    };
    rec.onend = () => {
      asRec = null;
      document.getElementById('asMic')?.classList.remove('as-listening');
      asAvatarState('listening', false);
      if (gotResult) asAsk(true);
    };
    try {
      rec.start();
      asRec = rec;
      document.getElementById('asMic').classList.add('as-listening');
      asAvatarState('listening', true);
      input.value = '';
      asHint('Listening…');
    } catch (_) {
      asRec = null;
      input.focus();
      asHint('Tap the mic on your keyboard to speak.');
    }
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
    nudge.innerHTML = parts.length ? parts.join('')
      : '<span class="as-nudge-ok">All stocked up ✓</span>';
  }

  function asGreeting() {
    const el = document.getElementById('asGreet');
    if (!el) return;
    const h = new Date().getHours();
    const hi = h < 11 ? 'Morning!' : h < 18 ? 'Hi!' : 'Evening!';
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

    input.addEventListener('focus', () => { asLoad(); asToggleRadial(false); });
    input.addEventListener('input', () => {
      clearTimeout(asTypeTimer);
      asTypeTimer = setTimeout(() => asAsk(false), 220);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; asAsk(false); input.blur(); }
      if (e.key === 'Enter') { clearTimeout(asTypeTimer); asAsk(false); input.blur(); }
    });
    document.getElementById('asClear').addEventListener('click', () => {
      input.value = ''; asAsk(false); input.focus();
    });
    document.getElementById('asMic').addEventListener('click', asMic);
    document.getElementById('asMute').addEventListener('click', () => {
      try { localStorage.setItem('shelfy_assistant_muted', asMuted() ? '0' : '1'); } catch (_) {}
      if (asMuted() && 'speechSynthesis' in window) speechSynthesis.cancel();
      asRenderMute();
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
    document.addEventListener('keydown', e => { if (e.key === 'Escape') asToggleRadial(false); });

    document.getElementById('asNudge').addEventListener('click', e => {
      const btn = e.target.closest('[data-card]');
      if (!btn) return;
      const lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
      const q = btn.dataset.card === 'restock' ? (lang === 'de' ? 'Was muss ich nachbestellen?' : 'What do I need to reorder?')
                                               : (lang === 'de' ? 'Welche Lieferungen sind unterwegs?' : 'Which deliveries are on the way?');
      input.value = q;
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
  window.addEventListener('shelfy:synced', () => { asItems = null; });

  // Exposed for the dashboard and for testing.
  window.ShelfyAssistant = { answer: asAnswer, canMake: asCanMake, _set(items, products, stock, inbound) {
    asItems = items; asProducts = products; asLoadedAt = Date.now();
    if (stock) asStock = stock;
    if (inbound) asInbound = inbound;
  } };

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', asInit);
  else asInit();
})();
