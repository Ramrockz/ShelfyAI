// ============================================================
// Store Modal — inject HTML + define all store functions
// ============================================================

// Inject modal HTML as soon as DOM is ready
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
  return 1; // free
}

function _getStoreId() {
  return window.currentStoreId || localStorage.getItem('shelfy_store_id');
}

function _openSwitchAccountModal() {
  const m = document.getElementById('switchAccountModal');
  if (m) m.classList.add('active');
}

// ── public API ───────────────────────────────────────────────

async function openStoreModal() {
  const modal = document.getElementById('storeModal');
  if (!modal) return;
  modal.classList.add('active');
  await _loadStoreList();
}

function closeStoreModal() {
  const modal = document.getElementById('storeModal');
  if (modal) modal.classList.remove('active');
  const form = document.getElementById('newStoreForm');
  if (form) form.style.display = 'none';
  const input = document.getElementById('newStoreName');
  if (input) input.value = '';
}

async function _loadStoreList() {
  const listEl = document.getElementById('storeList');
  if (!listEl) return;
  listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0;">Loading...</p>';

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) { listEl.innerHTML = '<p style="color:var(--danger);font-size:13px;">Not authenticated</p>'; return; }

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
      listEl.innerHTML = storeList.map(s => `
        <div onclick="switchStore('${s.id}',${JSON.stringify(s.name).replace(/</g,'&lt;')})"
          style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;cursor:pointer;
                 border:2px solid ${s.id === activeId ? '#06b6d4' : 'var(--border)'};
                 background:${s.id === activeId ? 'rgba(6,182,212,0.07)' : 'var(--bg-inner)'};
                 margin-bottom:8px;transition:all 0.15s;"
          onmouseover="if('${s.id}'!=='${activeId}')this.style.borderColor='#06b6d4'"
          onmouseout="if('${s.id}'!=='${activeId}')this.style.borderColor='var(--border)'">
          <div style="flex:1;font-size:14px;font-weight:600;color:var(--text-main);">${s.name}</div>
          ${s.id === activeId
            ? '<span style="font-size:10px;font-weight:800;color:#06b6d4;text-transform:uppercase;letter-spacing:0.06em;background:rgba(6,182,212,0.12);padding:3px 8px;border-radius:6px;">Active</span>'
            : '<svg fill="none" stroke="var(--text-muted)" stroke-width="2" width="18" height="18" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>'}
        </div>`).join('');
    }

    // Add store button state
    const addBtn = document.getElementById('addStoreBtn');
    if (addBtn) {
      const atLimit = storeList.length >= limit;
      addBtn.disabled = atLimit;
      addBtn.style.opacity = atLimit ? '0.45' : '1';
      addBtn.style.cursor = atLimit ? 'not-allowed' : 'pointer';
      if (atLimit) {
        const labelMap = { 1: 'Free plan includes 1 store.', 5: 'Starter plan includes up to 5 stores.' };
        addBtn.title = (labelMap[limit] || '') + ' Upgrade to add more.';
      } else {
        addBtn.title = '';
      }
    }

  } catch (err) {
    console.error('Store list error:', err);
    listEl.innerHTML = '<p style="color:var(--danger);font-size:13px;text-align:center;">Failed to load stores</p>';
  }
}

function switchStore(storeId, storeName) {
  if (storeId === _getStoreId()) { closeStoreModal(); return; }
  localStorage.setItem('shelfy_store_id', storeId);
  localStorage.setItem('shelfy_store_name', storeName);
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
  if (!name) { if (input) { input.style.borderColor = 'var(--danger)'; input.focus(); } return; }

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
    if (input) { input.style.borderColor = 'var(--danger)'; input.focus(); }
  }
}
