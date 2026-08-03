// ============================================================
// Store Modal — inject HTML + define all store functions
// ============================================================

(function injectStoreModal() {
  const html = `
<div class="modal-overlay modal-sheet" id="storeModal" onclick="if(event.target===this)closeStoreModal()">
  <div class="modal-content" style="max-width:440px;background:var(--bg-panel,#fff);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3 style="margin:0;font-size:17px;font-weight:700;">Your Stores</h3>
      <button onclick="closeStoreModal()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:24px;line-height:1;padding:0;">×</button>
    </div>

    <div id="storeList" style="margin-bottom:16px;">
      <p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0;">Loading stores...</p>
    </div>

    <div id="newStoreForm" style="display:none;margin-bottom:16px;background:var(--bg-inner);border:1px solid var(--border);border-radius:12px;padding:16px;">
      <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px;">Store Name</label>
      <input id="newStoreName" type="text" placeholder="e.g. Main Shop, Pop-up Store…"
        style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-panel);color:var(--text-main);font-size:14px;box-sizing:border-box;margin-bottom:12px;font-family:inherit;"
        onkeydown="if(event.key==='Enter')createStore();" />
      <div style="display:flex;gap:8px;">
        <button onclick="createStore()" id="createStoreBtn"
          style="flex:1;padding:10px;background:#06b6d4;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
          Create Store
        </button>
        <button onclick="document.getElementById('newStoreForm').style.display='none';document.getElementById('newStoreName').value='';"
          style="flex:1;padding:10px;background:var(--bg-panel);color:var(--text-muted);border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
          Cancel
        </button>
      </div>
    </div>

    <button id="addStoreBtn" onclick="showNewStoreForm()"
      style="width:100%;padding:12px;border:2px dashed var(--border);border-radius:8px;background:transparent;color:#06b6d4;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:20px;transition:border-color 0.2s;"
      onmouseover="this.style.borderColor='#06b6d4'" onmouseout="this.style.borderColor='var(--border)'">
      + New Store
    </button>

    <div style="border-top:1px solid var(--border);padding-top:14px;text-align:center;">
      <button onclick="closeStoreModal();_openSwitchAccountModal();"
        style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;text-decoration:underline;padding:0;">
        Switch to a different account
      </button>
    </div>
  </div>
</div>

<!-- Delete Store confirmation -->
<div class="modal-overlay modal-sheet" id="storeDeleteModal" onclick="if(event.target===this)closeStoreDeleteModal()">
  <div class="modal-content" style="max-width:400px;background:var(--bg-panel,#fff);">
    <h3 style="margin:0 0 12px;font-size:17px;font-weight:700;">Delete Store?</h3>
    <p style="color:var(--text-muted);font-size:14px;line-height:1.5;margin:0 0 16px;">
      When deleting this store all its data will be lost.
    </p>
    <p style="font-size:13px;color:var(--text-muted);margin:0 0 8px;">Type <strong style="color:var(--text-main);letter-spacing:0.03em;">DELETE STORE</strong> to confirm</p>
    <input id="deleteStoreConfirmInput" type="text" placeholder="DELETE STORE" autocomplete="off"
      oninput="_onDeleteStoreInput()"
      style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-inner);color:var(--text-main);font-size:14px;box-sizing:border-box;font-family:inherit;margin-bottom:16px;" />
    <div style="display:flex;gap:10px;">
      <button onclick="closeStoreDeleteModal()"
        style="flex:1;padding:12px;background:var(--bg-inner);color:var(--text-main);border:1px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
        Cancel
      </button>
      <button id="confirmDeleteStoreBtn" onclick="_doDeleteStore()" disabled
        style="flex:1;padding:12px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:not-allowed;opacity:0.4;">
        Delete Store
      </button>
    </div>
  </div>
</div>`;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('beforeend', html));
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }
})();

// ── helpers ─────────────────────────────────────────────────

function _storeLimitForTier(tier) {
  if (tier === 'pro') return Infinity;
  if (tier === 'starter') return 5;
  return 1;
}

function _getStoreId() {
  return window.currentStoreId || localStorage.getItem('shelfy_store_id');
}

function _openSwitchAccountModal() {
  const m = document.getElementById('switchAccountModal');
  if (m) m.classList.add('active');
}

let _pendingDeleteStoreId = null;

// ── store modal ──────────────────────────────────────────────

// manage=true shows rename/delete; manage=false (default) = switch-only
async function openStoreModal(manage) {
  const modal = document.getElementById('storeModal');
  if (!modal) return;
  modal.classList.add('active');
  await _loadStoreList(!!manage);
}

function closeStoreModal() {
  const modal = document.getElementById('storeModal');
  if (modal) modal.classList.remove('active');
  const form = document.getElementById('newStoreForm');
  if (form) form.style.display = 'none';
  const input = document.getElementById('newStoreName');
  if (input) input.value = '';
}

async function _loadStoreList(manage) {
  const listEl = document.getElementById('storeList');
  if (!listEl) return;
  listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0;">Loading...</p>';

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) { listEl.innerHTML = '<p style="color:#ef4444;font-size:13px;">Not authenticated</p>'; return; }

    const [{ data: stores }, { data: settings }] = await Promise.all([
      window.supabaseClient.from('stores').select('*').eq('owner_id', user.id).order('created_at', { ascending: true }),
      window.supabaseClient.from('user_settings').select('tier').eq('user_id', user.id).single()
    ]);

    const tier = settings?.tier || 'free';
    const limit = _storeLimitForTier(tier);
    const activeId = _getStoreId();
    const storeList = stores || [];

    if (storeList.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0;">No stores yet</p>';
    } else {
      listEl.innerHTML = storeList.map(s => {
        const isActive = s.id === activeId;
        const safeName = s.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `
        <div style="border:2px solid ${isActive ? '#06b6d4' : 'var(--border)'};border-radius:10px;margin-bottom:8px;overflow:hidden;">
          <!-- Store row -->
          <div data-store-id="${s.id}" data-store-name="${safeName}"
            onclick="switchStore(this.dataset.storeId, this.dataset.storeName)"
            style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:${isActive ? 'rgba(6,182,212,0.07)' : 'var(--bg-inner)'};transition:background 0.15s;"
            onmouseover="if(!${isActive})this.style.background='var(--bg-panel)'"
            onmouseout="if(!${isActive})this.style.background='var(--bg-inner)'">
            <div style="flex:1;font-size:14px;font-weight:600;color:var(--text-main);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.name}</div>
            ${isActive ? '<span style="font-size:10px;font-weight:800;color:#06b6d4;text-transform:uppercase;letter-spacing:0.06em;background:rgba(6,182,212,0.12);padding:3px 8px;border-radius:6px;flex-shrink:0;">Active</span>' : ''}
          </div>
          <!-- Actions row (manage mode only) -->
          <div id="actionsRow_${s.id}" style="display:${manage ? 'flex' : 'none'};border-top:1px solid var(--border);">
            <button data-store-id="${s.id}" data-store-name="${s.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"
              onclick="event.stopPropagation();startRenameStore(this.dataset.storeId,this.dataset.storeName)"
              style="flex:1;padding:8px;background:none;border:none;border-right:1px solid var(--border);cursor:pointer;color:var(--text-muted);font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px;transition:background 0.15s;"
              onmouseover="this.style.background='var(--bg-inner)'" onmouseout="this.style.background='none'">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Rename
            </button>
            <button data-store-id="${s.id}"
              onclick="event.stopPropagation();${isActive ? '' : 'promptDeleteStore(this.dataset.storeId)'}"
              ${isActive ? 'disabled title="Cannot delete the active store"' : ''}
              style="flex:1;padding:8px;background:none;border:none;${isActive ? 'cursor:not-allowed;opacity:0.35;' : 'cursor:pointer;'}color:#ef4444;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px;transition:background 0.15s;"
              ${isActive ? '' : 'onmouseover="this.style.background=\'rgba(239,68,68,0.05)\'" onmouseout="this.style.background=\'none\'"'}>
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete
            </button>
          </div>
          <!-- Inline rename form (manage mode only) -->
          <div id="renameForm_${s.id}" style="display:none;${manage ? '' : 'visibility:hidden;'}padding:10px 14px;border-top:1px solid var(--border);background:var(--bg-inner);">
            <input id="renameInput_${s.id}" type="text"
              style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-panel);color:var(--text-main);font-size:13px;box-sizing:border-box;font-family:inherit;margin-bottom:8px;"
              data-store-id="${s.id}"
              onkeydown="if(event.key==='Enter')saveRenameStore(this.dataset.storeId);if(event.key==='Escape')cancelRenameStore(this.dataset.storeId);" />
            <div style="display:flex;gap:6px;">
              <button data-store-id="${s.id}" onclick="saveRenameStore(this.dataset.storeId)"
                style="flex:1;padding:7px;background:#06b6d4;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">Save</button>
              <button data-store-id="${s.id}" onclick="cancelRenameStore(this.dataset.storeId)"
                style="flex:1;padding:7px;background:var(--bg-panel);color:var(--text-muted);border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    const addBtn = document.getElementById('addStoreBtn');
    if (addBtn) {
      const atLimit = storeList.length >= limit;
      addBtn.disabled = atLimit;
      addBtn.style.opacity = atLimit ? '0.45' : '1';
      addBtn.style.cursor = atLimit ? 'not-allowed' : 'pointer';
      addBtn.title = atLimit
        ? ({ 1: 'Free plan: 1 store.', 5: 'Starter plan: up to 5 stores.' }[limit] || '') + ' Upgrade to add more.'
        : '';
    }
  } catch (err) {
    console.error('Store list error:', err);
    listEl.innerHTML = '<p style="color:#ef4444;font-size:13px;text-align:center;">Failed to load stores</p>';
  }
}

function switchStore(storeId, storeName) {
  if (storeId === _getStoreId()) { closeStoreModal(); return; }
  localStorage.setItem('shelfy_store_id', storeId);
  localStorage.setItem('shelfy_store_name', storeName);
  // Every page's own "instant load from local cache" optimization keys its
  // cache flatly (not scoped per store), so without this the reload below
  // would briefly render the PREVIOUS store's real orders/ingredients/etc.
  // before the fresh, newly store-scoped fetch overwrote it moments later.
  if (typeof clearShelfyDataCaches === 'function') clearShelfyDataCaches();
  window.location.reload();
}

function showNewStoreForm() {
  const btn = document.getElementById('addStoreBtn');
  if (btn && btn.disabled) return;
  document.getElementById('newStoreForm').style.display = 'block';
  setTimeout(() => document.getElementById('newStoreName')?.focus(), 50);
}

async function createStore() {
  const input = document.getElementById('newStoreName');
  const name = input?.value?.trim();
  if (!name) { if (input) { input.style.borderColor = '#ef4444'; input.focus(); } return; }
  const btn = document.getElementById('createStoreBtn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: store, error } = await window.supabaseClient
      .from('stores').insert({ owner_id: user.id, name }).select().single();
    if (error) throw error;
    switchStore(store.id, store.name);
  } catch (err) {
    console.error('Create store error:', err);
    if (btn) { btn.textContent = 'Create Store'; btn.disabled = false; }
    if (input) { input.style.borderColor = '#ef4444'; input.focus(); }
  }
}

// ── rename ───────────────────────────────────────────────────

function startRenameStore(storeId, currentName) {
  const form = document.getElementById(`renameForm_${storeId}`);
  const input = document.getElementById(`renameInput_${storeId}`);
  const actions = document.getElementById(`actionsRow_${storeId}`);
  if (actions) actions.style.display = 'none';
  if (form) form.style.display = 'block';
  if (input) { input.value = currentName; setTimeout(() => { input.focus(); input.select(); }, 50); }
}

function cancelRenameStore(storeId) {
  const form = document.getElementById(`renameForm_${storeId}`);
  const actions = document.getElementById(`actionsRow_${storeId}`);
  if (form) form.style.display = 'none';
  if (actions) actions.style.display = 'flex';
}

async function saveRenameStore(storeId) {
  const input = document.getElementById(`renameInput_${storeId}`);
  const name = input?.value?.trim();
  if (!name) { if (input) input.style.borderColor = '#ef4444'; return; }
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await window.supabaseClient
      .from('stores').update({ name }).eq('id', storeId).eq('owner_id', user.id);
    if (error) throw error;
    if (storeId === _getStoreId()) {
      localStorage.setItem('shelfy_store_name', name);
      window.currentStoreName = name;
      const storeEl = document.getElementById('userMenuStore');
      if (storeEl) storeEl.textContent = name;
    }
    await _loadStoreList();
  } catch (err) {
    console.error('Rename error:', err);
    if (input) input.style.borderColor = '#ef4444';
    cancelRenameStore(storeId);
  }
}

// ── delete ───────────────────────────────────────────────────

function promptDeleteStore(storeId) {
  _pendingDeleteStoreId = storeId;
  const modal = document.getElementById('storeDeleteModal');
  if (modal) modal.classList.add('active');
}

function closeStoreDeleteModal() {
  _pendingDeleteStoreId = null;
  const modal = document.getElementById('storeDeleteModal');
  if (modal) modal.classList.remove('active');
  const input = document.getElementById('deleteStoreConfirmInput');
  if (input) input.value = '';
  const btn = document.getElementById('confirmDeleteStoreBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; btn.style.cursor = 'not-allowed'; }
}

function _onDeleteStoreInput() {
  const input = document.getElementById('deleteStoreConfirmInput');
  const btn = document.getElementById('confirmDeleteStoreBtn');
  if (!input || !btn) return;
  const match = input.value.trim() === 'DELETE STORE';
  btn.disabled = !match;
  btn.style.opacity = match ? '1' : '0.4';
  btn.style.cursor = match ? 'pointer' : 'not-allowed';
}

async function _doDeleteStore() {
  const storeId = _pendingDeleteStoreId;
  if (!storeId) return;
  const btn = document.getElementById('confirmDeleteStoreBtn');
  if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }
  try {
    const { error } = await window.supabaseClient.from('stores').delete().eq('id', storeId);
    if (error) throw error;
    closeStoreDeleteModal();
    // If deleted store was active, clear and reload to pick a new one
    if (storeId === _getStoreId()) {
      localStorage.removeItem('shelfy_store_id');
      localStorage.removeItem('shelfy_store_name');
      if (typeof clearShelfyDataCaches === 'function') clearShelfyDataCaches();
      window.currentStoreId = null;
      window.currentStoreName = null;
      window.location.reload();
    } else {
      await _loadStoreList();
    }
  } catch (err) {
    console.error('Delete store error:', err);
    if (btn) { btn.textContent = 'Delete Store'; btn.disabled = false; }
  }
}
