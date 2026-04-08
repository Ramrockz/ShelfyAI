const CACHE_NAME = 'shelfy-v3';
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
  '/pricing.html',
  '/styles.css',
  '/chat-styles.css',
  '/notifications.css',
  '/auth.js',
  '/theme.js',
  '/mobile-menu.js',
  '/notifications.js',
  '/chat-bot.js',
  '/cookie-consent.js',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
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
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET and cross-origin requests (e.g. Supabase API)
  if (
    event.request.method !== 'GET' ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      // Network-first for HTML pages, cache-first for static assets
      if (event.request.destination === 'document') {
        return networkFetch;
      }
      return cached || networkFetch;
    })
  );
});
