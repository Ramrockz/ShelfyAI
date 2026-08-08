// Shared "Place reorder" screen — supplier picker, quantity, "ship
// together" cross-sell, new-supplier creation. Originally built into
// ingredient-detail.html only (a full page); extracted here so any page
// can open it as an in-place modal instead of navigating to
// ingredient-detail.html?openReorder=true first.
//
// Usage: a page must (1) link reorder-modal.css, (2) load this script,
// (3) copy the #roScreen/#roSupSheet markup from ingredient-detail.html
// into its own body, then call openReorderModal(ingredientId, { onPlaced }).
// onPlaced(updatedIngredient, placedIds) fires after a successful reorder,
// once the screen has already closed — use it to refresh whatever this
// page shows for that ingredient.

let _roIngredient = null;
let _roSuppliers = [];      // ingredient_suppliers rows (+ joined supplier name) for _roIngredient
let _roSupplierId = null;   // selected ingredient_suppliers.id
let _roAlsoList = [];       // other low/out ingredients sharing the selected supplier
let _roPicked = {};         // otherIngredientId -> qty, for "ship together"
let _roOnPlaced = null;

async function openReorderModal(ingredientId, { onPlaced } = {}) {
  const screen = document.getElementById('roScreen');
  if (!screen) { console.error('openReorderModal: #roScreen markup missing on this page'); return; }

  const { data, error } = await supabaseClient
    .from('ingredients')
    .select('id, name, quantity, min_stock, source_url, cost_per_unit, estimated_delivery, reorder_pending')
    .eq('id', ingredientId)
    .single();
  if (error || !data) { console.error('openReorderModal: error loading ingredient:', error); return; }

  _roIngredient = data;
  _roOnPlaced = onPlaced || null;
  _roPicked = {};

  document.getElementById('roSub').textContent = _roIngredient.name || '';
  screen.classList.add('active');

  await loadRoSuppliers();
  if (!_roSuppliers.length) await materializeDefaultSupplier();
  _roSupplierId = (_roSuppliers.find(s => s.is_primary) || _roSuppliers[0] || {}).id || null;

  roSetQty(roSuggestedQty());
  await loadRoAlso();
  roRenderAll();
}

function closeReorderScreen() {
  const screen = document.getElementById('roScreen');
  if (screen) screen.classList.remove('active');
}

async function loadRoSuppliers() {
  _roSuppliers = [];
  if (!_roIngredient) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data, error } = await supabaseClient
      .from('ingredient_suppliers')
      .select('id, supplier_id, price, lead_time_days, moq, is_primary, last_ordered_at, suppliers(name)')
      .eq('ingredient_id', _roIngredient.id)
      .eq('profile_id', user.id)
      .order('is_primary', { ascending: false })
      .order('price', { ascending: true });
    if (error) throw error;
    _roSuppliers = (data || []).map(r => ({
      id: r.id, supplierId: r.supplier_id, name: r.suppliers?.name || 'Supplier',
      price: parseFloat(r.price) || 0, lead: r.lead_time_days || 0,
      moq: parseFloat(r.moq) || 0, is_primary: !!r.is_primary, lastOrdered: r.last_ordered_at
    }));
  } catch (e) {
    console.error('Error loading suppliers:', e);
  }
}

function _roVendorNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const label = host.split('.')[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch (e) {
    return null;
  }
}

// First time the reorder screen opens for an ingredient that predates the
// suppliers table, turn its old single-vendor fields (source_url,
// cost_per_unit, estimated_delivery) into a real supplier row instead of
// leaving the reorder screen with nothing to show.
async function materializeDefaultSupplier() {
  const url = _roIngredient.source_url;
  if (!url || !url.trim()) return;
  const name = _roVendorNameFromUrl(url) || 'Supplier';
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');

    // Reuse an existing supplier with the same name instead of always
    // inserting a new one -- otherwise every ingredient materialized from
    // the same vendor's URL ends up with its own separate supplier row,
    // and "ship together" (which matches by supplier_id) never finds them.
    let supplierId = null;
    let _supQ = supabaseClient.from('suppliers').select('id').eq('profile_id', user.id).ilike('name', name);
    if (storeId) _supQ = _supQ.eq('store_id', storeId);
    const { data: existingSup, error: findErr } = await _supQ.limit(1);
    if (findErr) throw findErr;

    if (existingSup && existingSup.length) {
      supplierId = existingSup[0].id;
    } else {
      const supplierRow = { profile_id: user.id, name };
      if (storeId) supplierRow.store_id = storeId;
      const { data: sup, error: supErr } = await supabaseClient
        .from('suppliers').insert([supplierRow]).select().single();
      if (supErr) throw supErr;
      supplierId = sup.id;
    }

    const { error: isErr } = await supabaseClient.from('ingredient_suppliers').insert([{
      ingredient_id: _roIngredient.id,
      supplier_id: supplierId,
      profile_id: user.id,
      price: parseFloat(_roIngredient.cost_per_unit) || 0,
      lead_time_days: _roIngredient.estimated_delivery || null,
      moq: 0,
      is_primary: true
    }]);
    if (isErr) throw isErr;
    await loadRoSuppliers();
  } catch (e) {
    console.error('Error materializing default supplier:', e);
  }
}

function roSup() { return _roSuppliers.find(s => s.id === _roSupplierId) || null; }
function roQty() { return Math.max(0, parseInt(document.getElementById('roQty').value, 10) || 0); }

// No usage-history tracking exists yet, so "suggested" is just enough to
// clear the alert level with a little headroom — not a velocity-based
// forecast like a real demand-planning feature would compute.
function roSuggestedQty() {
  const stock = parseFloat(_roIngredient?.quantity) || 0;
  const min = parseFloat(_roIngredient?.min_stock) || 0;
  const topUp = Math.max(0, min - stock);
  return Math.max(topUp, min, 1);
}

function roEtaLabel(days) {
  const d = new Date(Date.now() + (parseInt(days, 10) || 0) * 86400000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderRoSupplier() {
  const s = roSup();
  const nameEl = document.getElementById('roSupName');
  const metaEl = document.getElementById('roSupMeta');
  const tagEl = document.getElementById('roSupTag');
  const etaRow = document.getElementById('roEtaRow');
  const visitBtn = document.getElementById('roVisitBtn');
  // Suppliers don't have their own URL on file yet -- the only link we
  // actually have is the ingredient's own source_url (the page it was
  // originally added/scanned from), so that's what "visit" reopens.
  visitBtn.style.display = _roIngredient && _roIngredient.source_url ? '' : 'none';
  if (!s) {
    nameEl.textContent = 'Add a supplier';
    metaEl.textContent = 'No supplier on file for this item yet';
    tagEl.style.display = 'none';
    etaRow.style.display = 'none';
    return;
  }
  nameEl.textContent = s.name;
  const bits = [s.price ? `$${s.price.toFixed(2)} each` : null, s.lead ? `~${s.lead} days` : null,
                s.lastOrdered ? `last ordered ${new Date(s.lastOrdered).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null]
    .filter(Boolean);
  metaEl.textContent = bits.join(' · ');

  if (_roSuppliers.length > 1) {
    const cheapest = _roSuppliers.reduce((a, b) => (b.price < a.price ? b : a));
    tagEl.style.display = 'inline-flex';
    tagEl.textContent = s.id === cheapest.id ? 'cheapest' : `$${(s.price - cheapest.price).toFixed(2)} over ${cheapest.name}`;
  } else {
    tagEl.style.display = 'none';
  }

  if (s.lead) {
    etaRow.style.display = 'flex';
    document.getElementById('roEtaName').textContent = 'Expected ' + roEtaLabel(s.lead);
    document.getElementById('roEtaMeta').textContent = `~${s.lead} days · stock updates when you mark it received`;
  } else {
    etaRow.style.display = 'none';
  }
}

async function loadRoAlso() {
  _roAlsoList = [];
  const s = roSup();
  if (!s || !_roIngredient) return;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const { data, error } = await supabaseClient
      .from('ingredient_suppliers')
      .select('ingredient_id, price, ingredients(id, name, quantity, min_stock)')
      .eq('supplier_id', s.supplierId)
      .eq('profile_id', user.id)
      .neq('ingredient_id', _roIngredient.id);
    if (error) throw error;
    _roAlsoList = (data || [])
      .filter(r => r.ingredients)
      .map(r => ({
        id: r.ingredients.id, name: r.ingredients.name,
        stock: parseFloat(r.ingredients.quantity) || 0, min: parseFloat(r.ingredients.min_stock) || 0,
        price: parseFloat(r.price) || 0
      }))
      .filter(a => a.stock === 0 || (a.min > 0 && a.stock < a.min))
      .sort((a, b) => (a.stock === 0 ? 0 : 1) - (b.stock === 0 ? 0 : 1));
  } catch (e) {
    console.error('Error loading ship-together items:', e);
  }
}

function renderRoAlso() {
  const rows = _roAlsoList;
  const s = roSup();
  document.getElementById('roAlsoNote').textContent =
    rows.length && s ? `${rows.length} low at ${s.name}` : '';
  document.getElementById('roAlso').innerHTML = !rows.length ? `<div class="ro-op-row"><span class="ro-op-main">
      <span class="ro-op-name" style="font-weight:600;color:var(--text-muted)">${s ? 'Nothing else is low here' : 'Pick a supplier to see what else ships with it'}</span>
    </span></div>` : rows.map(a => {
    const q = _roPicked[a.id] || 0;
    const st = a.stock === 0 ? 'out' : 'low';
    const line = q
      ? `$${a.price.toFixed(2)} each · <b>${a.stock} &rarr; ${a.stock + q}</b>`
      : `$${a.price.toFixed(2)} each · ${a.stock} of ${a.min} min`;
    return `<div class="ro-op-row" data-picked="${q ? 1 : 0}">
      <span class="ro-op-main">
        <span class="ro-op-name">${escapeHtml(a.name)}</span>
        <span class="ro-op-meta"${st && !q ? ` data-state="${st}"` : ''}>${line}</span>
      </span>
      ${q ? `<span class="ro-op-step">
          <button onclick="roBump('${a.id}',-1)" aria-label="One fewer">&minus;</button>
          <span class="ro-op-qty">${q}</span>
          <button onclick="roBump('${a.id}',1)" aria-label="One more">+</button>
        </span>`
      : `<button class="ro-op-add" onclick="roBump('${a.id}',${Math.max(a.min, 1) || 1})" aria-label="Add ${escapeHtml(a.name)}">+</button>`}
    </div>`;
  }).join('');
  document.getElementById('roFootnote').textContent = s
    ? `Creates a draft order to ${s.name}. Nothing is deducted or paid until you mark it received.`
    : '';
}

function renderRoTally() {
  const s = roSup(), q = roQty();
  const extraUnits = Object.values(_roPicked).reduce((a, b) => a + b, 0);
  const extra = Object.keys(_roPicked).reduce((sum, id) =>
    sum + _roPicked[id] * (_roAlsoList.find(a => a.id === id)?.price || 0), 0);
  const total = (s ? q * s.price : 0) + extra;
  const lines = (q && s ? 1 : 0) + Object.keys(_roPicked).length;

  document.getElementById('roCount').textContent = lines
    ? `${lines} item${lines > 1 ? 's' : ''} · ${q + extraUnits} unit${q + extraUnits !== 1 ? 's' : ''}`
    : 'Nothing to order yet';
  document.getElementById('roTotal').textContent = `$${total.toFixed(2)}`;

  const shortBy = s && s.moq ? s.moq - total : 0;
  document.getElementById('roWarn').innerHTML = lines && shortBy > 0
    ? `<div class="ro-warn">$${shortBy.toFixed(2)} under ${escapeHtml(s.name)}'s $${s.moq.toFixed(2)} minimum</div>`
    : '';
  const cont = document.getElementById('roCont');
  cont.disabled = !lines || !s;
  cont.textContent = lines ? `Place reorder · $${total.toFixed(2)}` : 'Place reorder';
}

function roRenderAll() { renderRoSupplier(); renderRoAlso(); renderRoTally(); }
function roSetQty(n) { document.getElementById('roQty').value = Math.max(0, n); roRenderAll(); }
function roStepQty(d) { roSetQty(roQty() + d); }
function roBump(id, d) {
  const next = (_roPicked[id] || 0) + d;
  if (next <= 0) delete _roPicked[id]; else _roPicked[id] = next;
  renderRoAlso();
  renderRoTally();
}

function openRoSupplierSheet() {
  const cheapest = _roSuppliers.length ? _roSuppliers.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const fastest = _roSuppliers.length ? _roSuppliers.reduce((a, b) => (b.lead && (!a.lead || b.lead < a.lead) ? b : a)) : null;
  document.getElementById('roSupList').innerHTML = _roSuppliers.map(s => {
    const tag = s.id === cheapest?.id ? 'cheapest' : s.id === fastest?.id ? 'fastest' : '';
    return `<button class="ro-sup-opt" aria-selected="${s.id === _roSupplierId}" onclick="pickRoSupplier('${s.id}')">
      <span class="ro-drow-label">
        <span class="ro-drow-name">${escapeHtml(s.name)}</span>
        <span class="ro-drow-meta">$${s.price.toFixed(2)} each${s.lead ? ` · ~${s.lead} days` : ''}${s.moq ? ` · $${s.moq.toFixed(2)} min` : ''}</span>
      </span>
      ${tag ? `<span class="ro-drow-tag">${tag}</span>` : ''}
      ${s.id === _roSupplierId ? '<svg class="ro-sup-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>`;
  }).join('');
  document.getElementById('roNewSupplierForm').style.display = 'none';
  document.getElementById('roNewSupplierToggle').textContent = 'New supplier';
  document.getElementById('roSupSheet').classList.add('active');
}
function closeRoSupplierSheet() { document.getElementById('roSupSheet').classList.remove('active'); }
function pickRoSupplier(id) {
  _roSupplierId = id;
  _roPicked = {}; // "ship together" items belong to the old supplier, can't carry over
  closeRoSupplierSheet();
  loadRoAlso().then(roRenderAll);
}
function toggleNewSupplierForm() {
  const form = document.getElementById('roNewSupplierForm');
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'flex';
  document.getElementById('roNewSupplierToggle').textContent = isOpen ? 'New supplier' : 'Cancel';
}
async function saveNewSupplier() {
  const name = document.getElementById('roNewSupName').value.trim();
  if (!name) { showAlert('Supplier name is required'); return; }
  const price = parseFloat(document.getElementById('roNewSupPrice').value) || 0;
  const lead = parseInt(document.getElementById('roNewSupLead').value, 10) || null;
  const moq = parseFloat(document.getElementById('roNewSupMoq').value) || 0;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const storeId = window.currentStoreId || localStorage.getItem('shelfy_store_id');
    const supplierRow = { profile_id: user.id, name };
    if (storeId) supplierRow.store_id = storeId;
    const { data: sup, error: supErr } = await supabaseClient
      .from('suppliers').insert([supplierRow]).select().single();
    if (supErr) throw supErr;

    const { data: isRow, error: isErr } = await supabaseClient.from('ingredient_suppliers').insert([{
      ingredient_id: _roIngredient.id,
      supplier_id: sup.id,
      profile_id: user.id,
      price, lead_time_days: lead, moq,
      is_primary: _roSuppliers.length === 0
    }]).select().single();
    if (isErr) throw isErr;

    await loadRoSuppliers();
    _roSupplierId = isRow.id;
    closeRoSupplierSheet();
    await loadRoAlso();
    roRenderAll();
  } catch (e) {
    console.error('Error saving supplier:', e);
    showAlert('Failed to save supplier: ' + e.message);
  }
}

async function placeReorder() {
  const s = roSup();
  const q = roQty();
  if (!s) { showAlert('Add a supplier first'); return; }
  if (!q && !Object.keys(_roPicked).length) { showAlert('Nothing to order yet'); return; }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const placedIds = [];

    if (q) {
      const { error } = await supabaseClient.from('ingredients').update({
        reorder_pending: true, reorder_date: today, estimated_delivery: s.lead || null,
        reorder_quantity: q, reorder_supplier_id: s.supplierId
      }).eq('id', _roIngredient.id);
      if (error) throw error;
      _roIngredient.reorder_pending = true;
      _roIngredient.estimated_delivery = s.lead || null;
      await supabaseClient.from('ingredient_suppliers').update({ last_ordered_at: today }).eq('id', s.id);
      placedIds.push(_roIngredient.id);
    }

    for (const [id, pickedQty] of Object.entries(_roPicked)) {
      const { data: rows } = await supabaseClient
        .from('ingredient_suppliers').select('id, lead_time_days')
        .eq('ingredient_id', id).eq('supplier_id', s.supplierId).limit(1);
      const row = rows?.[0];
      await supabaseClient.from('ingredients').update({
        reorder_pending: true, reorder_date: today, estimated_delivery: row?.lead_time_days || null,
        reorder_quantity: pickedQty, reorder_supplier_id: s.supplierId
      }).eq('id', id);
      if (row) await supabaseClient.from('ingredient_suppliers').update({ last_ordered_at: today }).eq('id', row.id);
      placedIds.push(id);
    }

    closeReorderScreen();
    if (_roOnPlaced) _roOnPlaced(_roIngredient, placedIds);
  } catch (e) {
    console.error('Error placing reorder:', e);
    showAlert('Failed to place reorder: ' + e.message);
  }
}
