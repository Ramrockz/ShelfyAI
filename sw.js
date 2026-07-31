const CACHE_NAME = 'shelfy-v255';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  // Pre-cache both clean URLs and .html variants so offline works regardless
  // of which URL form the browser navigates to (start_url uses clean URLs).
  '/ingredients',   '/ingredients.html',
  '/ingredient-detail',  '/ingredient-detail.html',
  '/expenses',      '/expenses.html',
  '/expense-detail','/expense-detail.html',
  '/recipes',       '/recipes.html',
  '/recipe-detail', '/recipe-detail.html',
  '/sales',         '/sales.html',
  '/orders',        '/orders.html',
  '/order-detail',  '/order-detail.html',
  '/operations',    '/operations.html',
  '/settings',      '/settings.html',
  '/analytics',     '/analytics.html',
  '/pricing',       '/pricing.html',
  '/styles.css',
  '/chat-styles.css',
  '/notifications.css',
  '/auth.js',
  '/theme.js',
  '/mobile-menu.js',
  '/bottom-nav.js',
  '/notifications.js',
  '/create-modal.js',
  '/import-modal.js',
  '/inventory-impact.js',
  '/chat-bot.js',
  '/store-modal.js',
  '/switch-account-modal.js',
  '/pwa-install.js',
  '/cookie-consent.js',
  '/offline-sync.js',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  '/loading_screen.json',
  // CDN scripts needed for offline rendering
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// CDN hostnames whose scripts we cache for offline use
const CACHED_CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn('[sw] Failed to pre-cache:', url, err)
          )
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCachedCDN = CACHED_CDN_HOSTS.some((h) => url.hostname.endsWith(h));

  // Pass through everything that isn't same-origin or a CDN script we cache
  if (!isSameOrigin && !isCachedCDN) return;

  const isDocument = event.request.destination === 'document';

  // ── Documents: cache-first with background revalidation (stale-while-revalidate). ──
  //
  // Why cache-first (not network-first):
  //   • Offline launch from home screen is instant — the SW serves from cache
  //     the moment it wakes up, with no network attempt that could stall.
  //   • Code freshness is handled by bumping CACHE_NAME → new SW installs →
  //     auth.js "controllerchange" listener reloads the page automatically.
  //
  if (isDocument) {
    // no-store: without it, fetch() can be satisfied by the browser's own
    // HTTP cache, so "revalidation" silently re-caches the same stale bytes
    // instead of pulling the latest deploy — bypass it and always hit the
    // network directly.
    //
    // ignoreSearch: detail pages navigate with a query string
    // (/ingredient-detail?id=X), and every distinct id was otherwise its
    // own cache entry — revisiting the SAME item kept serving whatever was
    // cached the first time it was opened after a deploy, even after
    // CACHE_NAME bumped, since that specific ?id= was never re-fetched.
    // The underlying HTML/CSS/JS shell is identical regardless of id, so
    // matching without the query string lets any one cached copy serve
    // (and get revalidated for) every id.
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cached) => {
        // Revalidate in the background even when serving from cache
        const networkUpdate = fetch(event.request, { cache: 'no-store' }).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {});

        if (cached) {
          // Serve stale copy instantly; background fetch updates it for next time.
          return cached;
        }

        // No cache yet — wait for the network.
        return fetch(event.request, { cache: 'no-store' }).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(async () => {
          // Offline and no cache — try the clean-URL or .html variant, then index.
          const urlVariant = event.request.url.endsWith('.html')
            ? event.request.url.replace(/\.html$/, '')
            : event.request.url + '.html';
          const altCached = await caches.match(urlVariant);
          if (altCached) return altCached;
          const fallback = await caches.match('/index.html');
          return fallback || new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title>' +
            '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
            '<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f1f5f9">' +
            '<div style="text-align:center"><h2 style="color:#0f172a">You\'re offline</h2>' +
            '<p style="color:#64748b">Open the app once while online to enable offline mode.</p>' +
            '<button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:#06b6d4;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer">Retry</button>' +
            '</div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
    return;
  }

  // ── CDN scripts and static assets: cache-first, revalidate in background. ──
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(event.request, clonedResponse)
          );
        }
        return response;
      }).catch(() => {
        // Offline and not cached — return a benign empty response instead of
        // letting the rejection surface as an "Uncaught (in promise)" error.
        return cached || Response.error();
      });
      return cached || networkFetch;
    })
  );
});
