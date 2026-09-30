// Dashboard search — finds inventory items and the products that use them.
// "blue xl" (or spoken "Hab ich noch blau XL da?") -> matching items plus
// every product whose components include one of those items. Mic button uses
// the browser's SpeechRecognition where it exists; where it doesn't (iOS
// home-screen PWA) it focuses the field so the keyboard's own mic can be used.

(function () {
  let dsItems = null;      // ingredients rows
  let dsProducts = null;   // recipes rows
  let dsLoadedAt = 0;
  let dsLoading = null;
  const DS_TTL = 60 * 1000;

  // ─── Normalising & vocabulary ─────────────────────────────────────────────

  function dsNorm(str) {
    return String(str || '').toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Filler words from spoken/typed questions (DE + EN) that carry no search meaning.
  const DS_STOP = new Set((
    'hab habe haben hast hat ich wir du noch da gibt es ist sind wie viel viele ' +
    'was welche welcher welches der die das den dem ein eine einen einer im in ' +
    'auf lager vorhanden vorratig mehr mal bitte zeig zeige mir suche such nach ' +
    'mit von fur und oder' + ' ' +
    'do does i we you have has got any still left is are there the a an of in ' +
    'how many much what which show me find search for please stock with and or'
  ).split(' '));

  // Groups of equivalent words; any member matches any other.
  const DS_EQUIV = [
    ['blau', 'blue'], ['rot', 'red'], ['grun', 'green'], ['gelb', 'yellow'],
    ['schwarz', 'black'], ['weiss', 'white'], ['grau', 'grey', 'gray'],
    ['braun', 'brown'], ['rosa', 'pink'], ['lila', 'purple', 'violett', 'violet'],
    ['turkis', 'turquoise'], ['dunkelblau', 'navy'], ['silber', 'silver'], ['gold', 'golden'],
    ['xs', 'extrasmall'], ['s', 'small', 'klein'], ['m', 'medium', 'mittel'],
    ['l', 'large', 'gross'], ['xl', 'extralarge'], ['xxl', '2xl'], ['xxxl', '3xl'],
  ];
  const DS_EQUIV_MAP = {};
  DS_EQUIV.forEach(g => g.forEach(w => { DS_EQUIV_MAP[w] = g; }));

  function dsTokens(query) {
    let q = dsNorm(query)
      .replace(/\bextra (large|small)\b/g, 'extra$1')
      .replace(/\bx (x )?(x )?l\b/g, m => m.replace(/ /g, ''))   // speech: "x l" -> "xl"
      .replace(/\bdouble xl\b/g, 'xxl');
    return q.split(' ').filter(w => w && !DS_STOP.has(w));
  }

  function dsWordMatches(token, word) {
    // Short tokens (sizes like "l", "xl") must match a whole word, or "l"
    // would hit every word containing an L; 3 letters ("tee", "xxl") may
    // prefix-match ("tees") but never match mid-word ("xxxl").
    if (token.length <= 2 || word.length <= 2) return token === word;
    if (token.length === 3) return word.startsWith(token);
    return word.startsWith(token) || (word.length >= 4 && token.startsWith(word)) || word.includes(token);
  }

  function dsTokenMatches(token, words) {
    const variants = DS_EQUIV_MAP[token] || [token];
    return variants.some(v => words.some(w => dsWordMatches(v, w)));
  }

  function dsParse(json) {
    if (!json) return {};
    if (typeof json === 'string') { try { return JSON.parse(json) || {}; } catch (_) { return {}; } }
    return json;
  }

  function dsAttrValues(attrs) {
    return Object.values(dsParse(attrs)).filter(v => v != null && String(v).trim()).map(v => String(v).trim());
  }

  function dsWordsOf(...parts) {
    return dsNorm(parts.flat().join(' ')).split(' ').filter(Boolean);
  }

  // ─── Data ─────────────────────────────────────────────────────────────────

  async function dsLoad(force) {
    if (!force && dsItems && Date.now() - dsLoadedAt < DS_TTL) return;
    if (dsLoading) return dsLoading;
    dsLoading = (async () => {
      try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return;
        if (!window.currentStoreId && typeof ensureStoreExists === 'function') await ensureStoreExists(user);
        const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');
        let qi = supabaseClient.from('ingredients')
          .select('id, name, quantity, unit, min_stock, category, custom_attributes')
          .eq('profile_id', user.id);
        let qr = supabaseClient.from('recipes')
          .select('id, name, attributes, parent_id, components, category')
          .eq('profile_id', user.id);
        if (storeId) { qi = qi.eq('store_id', storeId); qr = qr.eq('store_id', storeId); }
        const [ri, rr] = await Promise.all([qi, qr]);
        if (ri.error) throw ri.error;
        if (rr.error) throw rr.error;
        dsItems = ri.data || [];
        dsProducts = rr.data || [];
        dsLoadedAt = Date.now();
      } catch (e) {
        console.error('Dashboard search: load failed', e);
      } finally {
        dsLoading = null;
      }
    })();
    return dsLoading;
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  function dsSearch(query) {
    const tokens = dsTokens(query);
    if (!tokens.length || !dsItems) return { tokens, items: [], products: [] };

    const items = dsItems.filter(i => {
      const words = dsWordsOf(i.name, dsAttrValues(i.custom_attributes), i.category || '');
      return tokens.every(t => dsTokenMatches(t, words));
    });
    const itemIds = new Set(items.map(i => i.id));
    const itemById = {};
    dsItems.forEach(i => { itemById[i.id] = i; });

    const productById = {};
    dsProducts.forEach(p => { productById[p.id] = p; });
    const products = [];
    dsProducts.forEach(p => {
      const base = p.parent_id && productById[p.parent_id] ? productById[p.parent_id].name : '';
      const words = dsWordsOf(p.name, base, dsAttrValues(p.attributes), p.category || '');
      const direct = tokens.every(t => dsTokenMatches(t, words));
      const uses = (Array.isArray(p.components) ? p.components : [])
        .filter(c => c && itemIds.has(c.ingredient_id))
        .map(c => itemById[c.ingredient_id]);
      if (direct || uses.length) products.push({ product: p, uses, direct });
    });
    // Direct name matches first, then products found via their items.
    products.sort((a, b) => (b.direct - a.direct) || String(a.product.name).localeCompare(String(b.product.name)));

    return { tokens, items, products };
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function dsEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dsFmtQty(i) {
    const q = parseFloat(i.quantity) || 0;
    const n = Number.isInteger(q) ? q : +q.toFixed(2);
    return `${n}${i.unit ? ' ' + dsEsc(i.unit) : ''}`;
  }

  function dsStatus(i) {
    const q = parseFloat(i.quantity) || 0;
    const min = parseFloat(i.min_stock) || 0;
    if (q === 0) return 'out';
    if (min > 0 && q <= min) return 'low';
    return 'ok';
  }

  function dsChips(attrs) {
    const vals = dsAttrValues(attrs);
    return vals.length ? `<span class="ds-chips">${vals.map(v => `<span class="ds-chip">${dsEsc(v)}</span>`).join('')}</span>` : '';
  }

  const DS_MAX = 15;

  function dsRender() {
    const input = document.getElementById('dsInput');
    const panel = document.getElementById('dsResults');
    if (!input || !panel) return;
    const query = input.value;
    document.getElementById('dsClear').hidden = !query;

    if (!query.trim()) { panel.hidden = true; panel.innerHTML = ''; return; }
    if (!dsItems) {
      panel.hidden = false;
      panel.innerHTML = `<div class="ds-empty">${navigator.onLine ? 'Loading…' : 'Search needs a connection.'}</div>`;
      return;
    }

    const { tokens, items, products } = dsSearch(query);
    panel.hidden = false;
    if (!tokens.length) { panel.innerHTML = '<div class="ds-empty">Type an item or product name.</div>'; return; }
    if (!items.length && !products.length) {
      panel.innerHTML = `<div class="ds-empty">Nothing found for “${dsEsc(tokens.join(' '))}”.</div>`;
      return;
    }

    let html = '';
    if (items.length) {
      html += `<div class="ds-section">Inventory <span>${items.length}</span></div>`;
      html += items.slice(0, DS_MAX).map(i => {
        const st = dsStatus(i);
        return `<a class="ds-row" href="/ingredient-detail?id=${encodeURIComponent(i.id)}">
          <span class="ds-main"><span class="ds-name">${dsEsc(i.name)}</span>${dsChips(i.custom_attributes)}</span>
          <span class="ds-qty ds-${st}">${dsFmtQty(i)}</span>
        </a>`;
      }).join('');
    }
    if (products.length) {
      html += `<div class="ds-section">Products <span>${products.length}</span></div>`;
      html += products.slice(0, DS_MAX).map(({ product: p, uses }) => {
        const usesLine = uses.length
          ? `<span class="ds-sub">Uses ${uses.map(u => dsEsc(u.name)).join(', ')}</span>` : '';
        return `<a class="ds-row" href="/recipe-detail?id=${encodeURIComponent(p.id)}">
          <span class="ds-main"><span class="ds-name">${dsEsc(p.name)}</span>${dsChips(p.attributes)}${usesLine}</span>
          <i data-lucide="chevron-right" class="ds-chev"></i>
        </a>`;
      }).join('');
    }
    panel.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ─── Voice ────────────────────────────────────────────────────────────────

  let dsRec = null;

  function dsHint(msg) {
    const panel = document.getElementById('dsResults');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = `<div class="ds-empty">${dsEsc(msg)}</div>`;
  }

  function dsStopListening() {
    document.getElementById('dsMic')?.classList.remove('ds-listening');
    if (dsRec) { try { dsRec.stop(); } catch (_) {} }
  }

  function dsMic() {
    const input = document.getElementById('dsInput');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (dsRec) { dsStopListening(); return; }
    if (!Rec) {
      input.focus();
      dsHint('Tap the mic on your keyboard to speak.');
      return;
    }
    dsLoad();
    const rec = new Rec();
    rec.lang = navigator.language || 'de-DE';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let gotResult = false;
    rec.onresult = e => {
      gotResult = true;
      input.value = Array.from(e.results).map(r => r[0].transcript).join(' ');
      dsRender();
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        input.focus();
        dsHint('Microphone blocked — tap the mic on your keyboard instead.');
      } else if (e.error === 'no-speech') {
        dsHint('Didn’t catch that — try again.');
      }
    };
    rec.onend = () => {
      dsRec = null;
      document.getElementById('dsMic')?.classList.remove('ds-listening');
      if (gotResult) dsLoad().then(dsRender);
    };
    try {
      rec.start();
      dsRec = rec;
      document.getElementById('dsMic').classList.add('ds-listening');
      input.value = '';
      dsHint('Listening…');
    } catch (_) {
      dsRec = null;
      input.focus();
      dsHint('Tap the mic on your keyboard to speak.');
    }
  }

  // ─── Wiring ───────────────────────────────────────────────────────────────

  function dsInit() {
    const input = document.getElementById('dsInput');
    if (!input) return;
    input.addEventListener('focus', () => { dsLoad().then(dsRender); });
    input.addEventListener('input', dsRender);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; dsRender(); input.blur(); }
      if (e.key === 'Enter') input.blur();   // closes the mobile keyboard, keeps results
    });
    document.getElementById('dsClear').addEventListener('click', () => {
      input.value = ''; dsRender(); input.focus();
    });
    document.getElementById('dsMic').addEventListener('click', dsMic);
    document.addEventListener('click', e => {
      if (!e.target.closest('.dash-search')) {
        const panel = document.getElementById('dsResults');
        if (panel && !input.value.trim()) panel.hidden = true;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dsInit);
  else dsInit();
})();
