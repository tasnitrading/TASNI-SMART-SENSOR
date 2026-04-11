// TASNI® Water Monitor — Service Worker v2.0
const CACHE_NAME = 'tasni-water-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/mqtt/4.3.7/mqtt.min.js',
];

// ============ INSTALL ============
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// ============ ACTIVATE ============
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ============ FETCH — cache-first for app shell ============
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Skip non-GET and external APIs
  if (event.request.method !== 'GET') return;
  if (url.includes('emqx') || url.includes('mqtt')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// ============ PUSH NOTIFICATIONS ============
self.addEventListener('push', (event) => {
  let data = { title: 'TASNI® Water Monitor', body: 'Tank level alert!', type: 'info' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text(); }
  }

  const options = {
    body: data.body,
    icon: 'icon-192.png',
    badge: 'icon-72.png',
    tag: 'tasni-water-alert',
    renotify: true,
    requireInteraction: data.type === 'danger',
    vibrate: data.type === 'danger' ? [200,100,200,100,400] : [200,100,200],
    data: { url: self.registration.scope, type: data.type },
    actions: [
      { action: 'open',    title: '📊 Open App' },
      { action: 'dismiss', title: '✕ Dismiss'   },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ============ NOTIFICATION CLICK ============
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data?.url || self.registration.scope);
      }
    })
  );
});

// ============ BACKGROUND SYNC (optional) ============
self.addEventListener('sync', (event) => {
  if (event.tag === 'tasni-sync') {
    event.waitUntil(
      clients.matchAll().then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'sync' }));
      })
    );
  }
});
