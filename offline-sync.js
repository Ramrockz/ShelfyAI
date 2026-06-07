(function () {
  'use strict';

  // ─── IndexedDB setup ────────────────────────────────────────────────────────

  const DB_NAME = 'shelfy_offline_db';
  const DB_VERSION = 1;
  const STORE = 'write_queue';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function dbTx(mode, fn) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        if (req && req.onsuccess !== undefined) {
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = (e) => reject(e.target.error);
        } else {
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e.target.error);
        }
      });
    });
  }

  function enqueue(item) {
    return dbTx('readwrite', (store) => store.add(item));
  }

  function dequeue(id) {
    return dbTx('readwrite', (store) => store.delete(id));
  }

  function getAllPending() {
    return new Promise((resolve, reject) => {
      openDB().then((db) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }

  function updateRetries(id, retries) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const getReq = store.get(id);
        getReq.onsuccess = (e) => {
          const item = e.target.result;
          if (item) {
            item.retries = retries;
            const putReq = store.put(item);
            putReq.onsuccess = () => resolve();
            putReq.onerror = (e) => reject(e.target.error);
          } else {
            resolve();
          }
        };
        getReq.onerror = (e) => reject(e.target.error);
      });
    });
  }

  // ─── Banner ─────────────────────────────────────────────────────────────────

  let bannerEl = null;

  function ensureBanner() {
    if (bannerEl) return;
    bannerEl = document.createElement('div');
    bannerEl.id = 'shelfy-offline-banner';
    bannerEl.innerHTML =
      '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M6.343 6.343a9 9 0 000 12.728M9.172 9.172a5 5 0 000 6.656M12 12h.01"/></svg>' +
      '<span id="shelfy-offline-msg">You\'re offline</span>';
    document.body.insertBefore(bannerEl, document.body.firstChild);
  }

  function setBannerState(state, msg) {
    ensureBanner();
    bannerEl.className = state ? 'visible ' + state : 'visible';
    document.getElementById('shelfy-offline-msg').textContent = msg;
  }

  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.className = '';
  }

  async function refreshBannerCount() {
    const items = await getAllPending();
    const n = items.length;
    if (!navigator.onLine) {
      setBannerState('', n > 0
        ? 'You\'re offline — ' + n + ' change' + (n === 1 ? '' : 's') + ' pending sync'
        : 'You\'re offline');
    } else if (n > 0) {
      setBannerState('syncing', 'Syncing ' + n + ' change' + (n === 1 ? '' : 's') + '…');
    } else {
      hideBanner();
    }
  }

  // ─── Execute one queued item against Supabase ────────────────────────────────

  // Tables that are scoped to a store and need profile_id/store_id on insert.
  const STORE_SCOPED_TABLES = ['ingredients', 'recipes', 'sales', 'expenses'];

  async function executeItem(item, tempIdMap) {
    const client = window.supabaseClient;
    if (!client) throw new Error('supabaseClient not available');

    // Backfill profile_id / store_id for inserts that were created offline before
    // those values were available. We're online now, so resolve the authoritative
    // values from the live session and the active store.
    if (item.operation === 'insert' && item.payload && STORE_SCOPED_TABLES.includes(item.table)) {
      if (!item.payload.profile_id || !item.payload.store_id) {
        try {
          const { data: { session } } = await client.auth.getSession();
          const uid = session?.user?.id;
          const sid = window.currentStoreId || localStorage.getItem('shelfy_store_id');
          if (!item.payload.profile_id && uid) item.payload.profile_id = uid;
          if (!item.payload.store_id && sid)   item.payload.store_id   = sid;
        } catch (e) {}
      }
    }

    const matchValue = tempIdMap[item.matchValue] || item.matchValue;

    let query = client.from(item.table);

    if (item.operation === 'insert') {
      query = query.insert([item.payload]).select();
    } else if (item.operation === 'upsert') {
      query = query.upsert(item.payload).select();
    } else if (item.operation === 'update') {
      query = query.update(item.payload).eq(item.matchField, matchValue).select();
    } else if (item.operation === 'delete') {
      query = query.delete().eq(item.matchField, matchValue);
    }

    let { data, error } = await query;

    if (error) {
      if (error.status === 401 || error.status === 403) {
        await client.auth.refreshSession();
        // Recreate the query with the refreshed token — reusing the original
        // query object would send stale auth headers.
        let retryQuery = client.from(item.table);
        if (item.operation === 'insert') retryQuery = retryQuery.insert([item.payload]).select();
        else if (item.operation === 'upsert') retryQuery = retryQuery.upsert(item.payload).select();
        else if (item.operation === 'update') retryQuery = retryQuery.update(item.payload).eq(item.matchField, matchValue).select();
        else if (item.operation === 'delete') retryQuery = retryQuery.delete().eq(item.matchField, matchValue);
        const { data: d2, error: e2 } = await retryQuery;
        if (e2) throw e2;
        data = d2;
      } else {
        throw error;
      }
    }

    // Detect silent RLS rejection: Supabase returns {data: [], error: null} when
    // the row-level security policy denies an insert without raising an error.
    if (item.operation === 'insert' && (!data || data.length === 0)) {
      // Refresh the token and retry with a brand-new query
      await client.auth.refreshSession();
      const { data: d3, error: e3 } = await client
        .from(item.table).insert([item.payload]).select();
      if (e3) throw e3;
      if (!d3 || d3.length === 0) {
        throw new Error('[offline-sync] Insert rejected by server (possible RLS or auth issue)');
      }
      data = d3;
    }

    // For inserts, record tempId → realId mapping for downstream queue items
    if (item.operation === 'insert' && item.tempId && data && data[0]) {
      const realId = data[0].id;
      tempIdMap[item.tempId] = realId;
      window.dispatchEvent(new CustomEvent('shelfy:id-reconcile', {
        detail: { table: item.table, tempId: item.tempId, realId }
      }));
    }

    return data;
  }

  // ─── Drain queue ─────────────────────────────────────────────────────────────

  let draining = false;

  async function drainQueue() {
    if (draining || !navigator.onLine) return;
    draining = true;

    // Refresh the auth token before touching the database — prevents stale-JWT
    // silent failures where Supabase returns {data:[], error:null} instead of a row.
    try { await window.supabaseClient.auth.refreshSession(); } catch (e) {}

    try {
      const items = await getAllPending();
      if (items.length === 0) { hideBanner(); return; }

      const affectedTables = new Set();
      const tempIdMap = {};
      let hadError = false;

      setBannerState('syncing', 'Syncing ' + items.length + ' change' + (items.length === 1 ? '' : 's') + '…');

      for (const item of items) {
        try {
          await executeItem(item, tempIdMap);
          affectedTables.add(item.table);
          await dequeue(item.id);
        } catch (err) {
          console.warn('[offline-sync] Failed to replay item', item.id, err);
          const newRetries = (item.retries || 0) + 1;
          if (newRetries >= 3) {
            console.error('[offline-sync] Permanently failed after 3 retries, removing:', item);
            await dequeue(item.id);
            hadError = true;
          } else {
            await updateRetries(item.id, newRetries);
          }
        }
      }

      // Signal the page to re-fetch from Supabase and OVERWRITE the cache.
      // We intentionally do NOT removeItem here — if the re-fetch fails, the
      // existing cache (with optimistic items) must survive so the next offline
      // session still shows data instead of a blank page.
      window.dispatchEvent(new CustomEvent('shelfy:synced', {
        detail: { tables: [...affectedTables] }
      }));

      const remaining = await getAllPending();
      if (hadError) {
        setBannerState('error', 'Sync error — some changes could not be saved');
        setTimeout(hideBanner, 5000);
      } else if (remaining.length === 0) {
        setBannerState('syncing', 'All changes synced!');
        setTimeout(hideBanner, 2000);
      } else {
        await refreshBannerCount();
      }
    } finally {
      draining = false;
    }
  }

  // ─── offlineWrite ────────────────────────────────────────────────────────────

  async function offlineWrite(table, operation, payload, matchField, matchValue) {
    const isNetworkWrite = navigator.onLine;

    if (isNetworkWrite) {
      try {
        const client = window.supabaseClient;
        let query = client.from(table);
        if (operation === 'insert') query = query.insert(Array.isArray(payload) ? payload : [payload]).select();
        else if (operation === 'upsert') query = query.upsert(payload).select();
        else if (operation === 'update') query = query.update(payload).eq(matchField, matchValue).select();
        else if (operation === 'delete') query = query.delete().eq(matchField, matchValue);

        const { data, error } = await query;

        if (error) {
          // Supabase returned a logical error (constraint, validation) — surface it
          if (error.status) return { data: null, error, queued: false };
          // No status = network-level failure — fall through to offline path
          throw new TypeError('Network failure');
        }
        return { data, error: null, queued: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !err.message?.includes('fetch')) {
          // Re-throw non-network errors
          return { data: null, error: err, queued: false };
        }
        // Network error while supposedly online — fall through to queue
      }
    }

    // ── Offline path ──
    const tempId = (operation === 'insert') ? 'temp_' + crypto.randomUUID() : null;
    const optimisticData = payload ? { ...payload, ...(tempId ? { id: tempId } : {}) } : null;

    await enqueue({
      table,
      operation,
      payload: Array.isArray(payload) ? payload[0] : payload,
      matchField: matchField || null,
      matchValue: matchValue || null,
      tempId,
      createdAt: new Date().toISOString(),
      retries: 0,
    });

    await refreshBannerCount();

    return { data: optimisticData ? [optimisticData] : null, error: null, queued: true, tempId };
  }

  // ─── Online / offline events ─────────────────────────────────────────────────

  window.addEventListener('offline', () => {
    refreshBannerCount();
  });

  window.addEventListener('online', () => {
    drainQueue();
  });

  // ─── Init on DOM ready ────────────────────────────────────────────────────────

  function init() {
    ensureBanner();
    if (!navigator.onLine) {
      refreshBannerCount();
    } else {
      getAllPending().then((items) => {
        if (items.length > 0) drainQueue();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Expose globals ───────────────────────────────────────────────────────────

  window.offlineWrite = offlineWrite;
  window.drainQueue = drainQueue;

})();
