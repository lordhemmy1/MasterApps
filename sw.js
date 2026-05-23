/**
 * Stockdity IMS — Service Worker
 * Strategy: Cache First for app shell assets, Network First for external CDN.
 * Version bump CACHE_VERSION to force cache refresh on new deployments.
 */

const CACHE_VERSION = 'Stockdity-v1.0.0';
const CACHE_NAME = `${CACHE_VERSION}-shell`;

/**
 * All local app shell files to pre-cache on Service Worker install.
 * Every file listed here will be available fully offline.
 */
const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './assets/css/main.css',
  './assets/css/print.css',
  './assets/js/app.js',
  './assets/js/db.js',
  './assets/js/router.js',
  './assets/js/auth.js',
  './assets/js/ui.js',
  './assets/js/utils.js',
  './assets/js/dashboard.js',
  './assets/js/products.js',
  './assets/js/stock.js',
  './assets/js/sales.js',
  './assets/js/categories.js',
  './assets/js/suppliers.js',
  './assets/js/notifications.js',
  './assets/js/reports.js',
  './assets/js/users.js',
  './assets/js/settings.js',
  './assets/js/audit.js',
  './assets/images/logo-placeholder.png',
  './assets/images/empty-state.svg',
  './assets/images/favicon.ico',
  './assets/images/icon-72.png',
  './assets/images/icon-96.png',
  './assets/images/icon-128.png',
  './assets/images/icon-144.png',
  './assets/images/icon-152.png',
  './assets/images/icon-192.png',
  './assets/images/icon-384.png',
  './assets/images/icon-512.png'
];

/**
 * CDN domains — these use a Network First, fallback to cache strategy.
 * We cache them after the first network fetch so they work offline too.
 */
const CDN_DOMAINS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
/**
 * On install, pre-cache all app shell assets.
 * skipWaiting() ensures the new SW activates immediately without
 * waiting for existing tabs to close.
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Pre-caching app shell...');

      // Cache each file individually so a single failure doesn't
      // abort the entire install.
      const results = await Promise.allSettled(
        APP_SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache: ${url}`, err.message);
          })
        )
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[SW] ${failed.length} asset(s) failed to pre-cache.`);
      } else {
        console.log('[SW] All app shell assets cached successfully.');
      }
    })
  );

  self.skipWaiting();
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
/**
 * On activate, delete all old cache versions that don't match the
 * current CACHE_NAME. This cleans up stale caches after an update.
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);

  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      const deletePromises = cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        });

      await Promise.all(deletePromises);

      // Take control of all open clients immediately.
      await self.clients.claim();
      console.log('[SW] Now controlling all clients.');
    })
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests — never intercept POST/PUT/DELETE.
  if (request.method !== 'GET') return;

  // Never intercept chrome-extension or non-http(s) requests.
  if (!url.protocol.startsWith('http')) return;

  // Determine strategy based on origin.
  if (url.origin === self.location.origin) {
    // ── Local app files → Cache First ──────────────────────────────────────
    event.respondWith(cacheFirst(request));
  } else if (CDN_DOMAINS.some((domain) => url.hostname.includes(domain))) {
    // ── CDN resources → Network First, fallback to cache ───────────────────
    event.respondWith(networkFirst(request));
  }
  // All other origins (API calls, etc.) fall through to the browser naturally.
});

// ─── STRATEGY: CACHE FIRST ───────────────────────────────────────────────────
/**
 * Serve from cache if available. On cache miss, fetch from network,
 * store the response in cache, and return it.
 * If both fail (truly offline and not cached), return a fallback.
 */
async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // Not in cache — fetch from network and store.
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Both cache and network failed.
    console.warn('[SW] Cache first fetch failed:', request.url, err.message);

    // Return the cached index.html for navigation requests (SPA fallback).
    if (request.mode === 'navigate') {
      const cached = await caches.match('/index.html');
      if (cached) return cached;
    }

    return offlineFallbackResponse(request);
  }
}

// ─── STRATEGY: NETWORK FIRST ─────────────────────────────────────────────────
/**
 * Try the network first. If successful, cache the response.
 * If the network fails, serve from cache.
 * Used for CDN resources that may be updated.
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Network first fell back to cache:', request.url);
    const cached = await caches.match(request);
    if (cached) return cached;

    return offlineFallbackResponse(request);
  }
}

// ─── OFFLINE FALLBACK RESPONSE ───────────────────────────────────────────────
/**
 * Returns a minimal offline response when both cache and network fail.
 * For HTML requests: a simple offline notice page.
 * For everything else: a 503 response.
 */
function offlineFallbackResponse(request) {
  const acceptHeader = request.headers.get('Accept') || '';

  if (acceptHeader.includes('text/html')) {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
        <title>Offline — Stockdity IMS</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh; margin: 0; background: #f5f5f5; color: #333;
          }
          .box {
            text-align: center; padding: 2rem; background: #fff;
            border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.1);
            max-width: 400px;
          }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
          p { color: #666; margin: 0 0 1.5rem; }
          button {
            background: #4F46E5; color: #fff; border: none;
            padding: 0.75rem 1.5rem; border-radius: 8px;
            font-size: 1rem; cursor: pointer;
          }
          button:hover { background: #4338CA; }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="icon">📡</div>
          <h1>You're Offline</h1>
          <p>Stockdity IMS couldn't load this page. Please check your connection and try again. All your data is safely stored locally.</p>
          <button onclick="window.location.reload()">Try Again</button>
        </div>
      </body>
      </html>
    `;
    return new Response(html, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return new Response(
    JSON.stringify({ error: 'Offline', message: 'Network unavailable and resource not cached.' }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
/**
 * Listen for messages from the main thread.
 * Supports: SKIP_WAITING, CLEAR_CACHE, GET_VERSION
 */
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: CACHE_VERSION });
      break;

    default:
      break;
  }
});

// ─── BACKGROUND SYNC (future-ready stub) ────────────────────────────────────
/**
 * Background Sync is registered here for future use.
 * Currently all data goes directly to IndexedDB, so no sync is needed.
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'Stockdity-sync') {
    console.log('[SW] Background sync triggered (no-op in v1.0.0)');
  }
});

// ─── PUSH NOTIFICATIONS (future-ready stub) ──────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Stockdity IMS', body: event.data.text() };
  }

  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/assets/images/icon-192.png',
    badge: '/assets/images/icon-72.png',
    tag: data.tag || 'Stockdity-notification',
    renotify: false,
    data: { url: data.url || '/index.html#/notifications' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Stockdity IMS', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
