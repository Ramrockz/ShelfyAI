const CACHE_NAME = 'shelfy-v70';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/ingredients.html',
  '/ingredient-detail.html',
  '/expenses.html',
  '/expense-detail.html',
  '/recipes.html',
  '/recipe-detail.html',
  '/sales.html',
  '/orders.html',
  '/order-detail.html',
  '/operations.html',
  '/shopping-list.html',
  '/settings.html',
  '/analytics.html',
  '/pricing.html',
  '/styles.css',
  '/chat-styles.css',
  '/notifications.css',
  '/auth.js',
  '/theme.js',
  '/mobile-menu.js',
  '/bottom-nav.js',
  '/notifications.js',
  '/chat-bot.js',
  '/store-modal.js',
  '/switch-account-modal.js',
  '/pwa-install.js',
  '/cookie-consent.js',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  '/loading_screen.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET and cross-origin requests (Supabase API, CDNs, etc.)
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  const isDocument = event.request.destination === 'document';

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Always fetch from network to keep cache fresh
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      });

      if (isDocument) {
        if (cached) {
          // Stale-while-revalidate: serve the cached page instantly (eliminates
          // the white flash between pages), update the cache in the background.
          networkFetch.catch(() => {});
          return cached;
        }
        // First visit — no cache yet, wait for network
        return networkFetch.catch(() =>
          new Response('Offline – Please check your connection', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      }

      // Static assets (CSS, JS, images): cache-first
      return cached || networkFetch;
    })
  );
});
