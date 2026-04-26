// ═══════════════════════════════════════════════════════════
//  TASNI Water Monitor — Service Worker v3.0
//  Background MQTT polling + aggressive notifications
//  Works when app is closed, in sleep, screen off
// ═══════════════════════════════════════════════════════════

const CACHE = 'tasni-v3';
const ASSETS = ['./index.html', './manifest.json', './icon.svg'];

// ── Background sync state (shared via IndexedDB) ──
const DB_NAME = 'tasni_sw_db';
const DB_STORE = 'state';

// ═══════════════════════════════
//  INSTALL & ACTIVATE
// ═══════════════════════════════
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════
//  FETCH — cache-first for assets
// ═══════════════════════════════
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/sensor-reading') || e.request.url.includes('/save-')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const c = res.clone();
          caches.open(CACHE).then(ch => ch.put(e.request, c));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// ═══════════════════════════════
//  PUSH — rich notifications
// ═══════════════════════════════
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'TASNI Alert', body: 'Water level update' };
  const opts = {
    body: d.body || '',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: d.tag || 'tasni-alert',
    requireInteraction: !!d.critical,
    renotify: true,
    vibrate: d.critical ? [200, 80, 200, 80, 400, 80, 400] : [150, 60, 150],
    data: { url: './', level: d.level, type: d.type },
    actions: d.critical ? [
      { action: 'view', title: '📊 Open Dashboard' },
      { action: 'dismiss', title: 'Dismiss' }
    ] : [
      { action: 'view', title: 'View Dashboard' }
    ]
  };
  e.waitUntil(self.registration.showNotification(d.title || 'TASNI Water Monitor', opts));
});

// ═══════════════════════════════
//  NOTIFICATION CLICK
// ═══════════════════════════════
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

// ═══════════════════════════════
//  BACKGROUND SYNC
//  Fires when network comes back online
// ═══════════════════════════════
self.addEventListener('sync', e => {
  if (e.tag === 'tasni-check') {
    e.waitUntil(backgroundCheck());
  }
});

// ═══════════════════════════════
//  PERIODIC BACKGROUND SYNC
//  Android Chrome: fires every ~15 min when app is closed
//  Requires site to be installed as PWA with high engagement score
// ═══════════════════════════════
self.addEventListener('periodicsync', e => {
  if (e.tag === 'tasni-monitor') {
    e.waitUntil(backgroundCheck());
  }
});

// ═══════════════════════════════
//  MESSAGE — receive commands from main app
// ═══════════════════════════════
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'STORE_CONFIG') {
    storeSwState('config', e.data.config);
  }
  if (e.data && e.data.type === 'STORE_LEVEL') {
    storeSwState('lastLevel', e.data.level);
    storeSwState('lastTs', Date.now());
  }
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════
//  BACKGROUND CHECK — poll device IP when woken
// ═══════════════════════════════
async function backgroundCheck() {
  try {
    const cfg = await getSwState('config');
    if (!cfg || !cfg.ip) return;

    const lastLevel = await getSwState('lastLevel');
    const lastTs = await getSwState('lastTs') || 0;
    const staleSec = (Date.now() - lastTs) / 1000;

    // Poll the device IP
    const res = await fetch(`http://${cfg.ip}/sensor-reading`, {
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);

    if (!res || !res.ok) {
      // Device unreachable — alert if stale > 10 minutes
      if (staleSec > 600) {
        await self.registration.showNotification('⚠️ TASNI Device Offline', {
          body: `No data for ${Math.round(staleSec / 60)} minutes. Check your device.`,
          icon: './icon.svg',
          badge: './icon.svg',
          tag: 'tasni-offline',
          requireInteraction: false,
          vibrate: [200, 100, 200],
          data: { url: './' }
        });
      }
      return;
    }

    const d = await res.json();
    const level = parseInt(d.m || d.level || 0);
    const isFull = parseInt(d.isFull || 0);

    // Store new level
    await storeSwState('lastLevel', level);
    await storeSwState('lastTs', Date.now());

    // ── Alert logic when app is closed ──
    const critThreshold = cfg.alertCrit !== false;
    const lowThreshold = cfg.alertLow !== false;

    if (level < 10 && critThreshold) {
      await self.registration.showNotification('🚨 CRITICAL: Tank Almost Empty!', {
        body: `Tank is at ${level}% — only ${d.vol || '?'}L remaining. Refill immediately!`,
        icon: './icon.svg',
        badge: './icon.svg',
        tag: 'tasni-critical',
        requireInteraction: true,
        renotify: true,
        vibrate: [300, 100, 300, 100, 600, 100, 300],
        data: { url: './', level, type: 'critical' },
        actions: [{ action: 'view', title: '📊 Open Dashboard' }]
      });
    } else if (level < 30 && lastLevel !== null && lastLevel >= 30 && lowThreshold) {
      await self.registration.showNotification('⚠️ TASNI: Tank Running Low', {
        body: `Tank dropped to ${level}%. Schedule a refill soon.`,
        icon: './icon.svg',
        badge: './icon.svg',
        tag: 'tasni-low',
        requireInteraction: false,
        vibrate: [200, 80, 200],
        data: { url: './', level, type: 'low' }
      });
    } else if (isFull === 1 && lastLevel !== null && lastLevel < 95) {
      await self.registration.showNotification('💧 TASNI: Tank is Full!', {
        body: 'Water tank has been completely filled.',
        icon: './icon.svg',
        badge: './icon.svg',
        tag: 'tasni-full',
        requireInteraction: false,
        vibrate: [100, 50, 100],
        data: { url: './', level: 100, type: 'full' }
      });
    }

  } catch (err) {
    console.warn('[TASNI SW] backgroundCheck error:', err);
  }
}

// ═══════════════════════════════
//  IndexedDB helpers
// ═══════════════════════════════
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
async function storeSwState(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
async function getSwState(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}
