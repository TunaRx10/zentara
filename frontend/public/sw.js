/**
 * Zentara Service Worker — Round 36.
 *
 * Responsabilités :
 *   1. Cache-first pour le shell statique (HTML, JS, CSS, fonts).
 *   2. Network-first pour l'API Zentara (les réponses réseau priment
 *      sur le cache API ; seules les réponses seed sont mises en cache).
 *   3. Heartbeat /api/tasks/heartbeat toutes les 4 min pour prouver
 *      que le backend est joignable même quand l'utilisateur a caché
 *      l'onglet (Background Sync API).
 *   4. Push notifications (placeholder) si 'push' arrive.
 *
 * Lifecycle SW : `install` → skipWaiting (on force la nouvelle version),
 * `activate` → claim clients. La stratégie ApiOnly demande toujours
 * un fallback "stale" si l'utilisateur est offline.
 */
const CACHE_VERSION = 'zentara-r70-v10';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const API_CACHE = `${CACHE_VERSION}-api`;

const PRECACHE_ASSETS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Round 69 — on NE precache plus le shell HTML (sinon on garde
      // un index.html obsolète qui référence d'anciens hashes de chunks
      // chunkés, causant "Failed to fetch dynamically imported module"
      // après chaque rebuild). On ne garde que pour les rares offline
      // fallback (cache-first APK offline).
      const cache = await caches.open(ASSET_CACHE);
      try {
        // Plus de cache.addAll(PRECACHE_ASSETS) ; c'est fait au runtime
        // par networkFirstHtmlFallback().
      } catch (_e) {
        // Ignoré — install toujours tolérant.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Supprimer les vieux caches (r-35, etc.).
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// =====================================================================
// helpers
// =====================================================================

function isApiRequest(url) {
  return typeof url === 'string' && /\/api\//.test(url);
}

function isAssetRequest(url) {
  return typeof url === 'string'
    && /\.(?:js|mjs|css|html|svg|png|jpg|jpeg|webp|woff2?|ttf|ico)(?:\?.*)?$/.test(url);
}

async function cacheFirstNetworkFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Offline total → renvoie le shell HTML s'il existe pour permettre
    // l'affichage offline de la SPA.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Offline (service worker)' },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function networkFirstCacheFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'API offline (service worker)' },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Network-first pour le shell HTML.
 *
 * Round 69 — le shell est petit, on veut TOUJOURS la dernière version
 * car elle embarque les hashes de chunks valides (sinon "Failed to
 * fetch dynamically imported module"). Offline → on retombe sur la
 * dernière version cachée (cache-first shell HTML en fallback).
 */
async function networkFirstHtmlFallback(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200 && response.type === 'basic') {
      const cache = await caches.open(ASSET_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    // Offline → fallback cache : sert la dernière version du shell
    // pour que l'app reste utilisable (boot-screen + retry).
    const cache = await caches.open(ASSET_CACHE);
    const cached =
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/'));
    if (cached) return cached;
    return new Response('<!doctype html><meta charset="utf-8"><title>Zentara offline</title>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Network-first pour chunks JS.
 *
 * Round 69 — si le chunk demandé n'existe plus sur le serveur (suite à
 * un rebuild qui a ré-hashé), on NE le sert PAS depuis le cache (qui
 * causerait un crash React.lazy). On renvoie plutôt un 404 attendu :
 * le `LazyChunkErrorBoundary` détecte ce 404 et déclenche un reload
 * avec `CACHE_CLEAR`. C'est l'inverse de la stratégie cache-first
 * habituelle pour les bundles Vite.
 */
async function networkFirstChunkFallback(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    // On ne met PAS en cache les chunks (ils changent à chaque build).
    return response;
  } catch (_err) {
    return new Response('', { status: 404, statusText: 'Chunk not found' });
  }
}

// =====================================================================
// fetch handler
// =====================================================================

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Round 142 — backend EMBARQUÉ : /api/health répond localement pour que
  // l'auto-heal et les pings bruts (heartbeat foreground, PeriodicSync)
  // fonctionnent sans aucun serveur distant. Le routeur embarqué (côté
  // page) répond à tous les autres /api/* avant même d'atteindre fetch.
  if (isApiRequest(url) && /\/api\/health$/.test(url)) {
    event.respondWith(Response.json({
      success: true,
      data: { status: 'ok', mode: 'embedded' },
      meta: { mode: 'embedded' },
    }));
    return;
  }

  // API → network-first (les données fraîches priment)
  if (isApiRequest(url)) {
    // Heartbeat : on log la trace pour debugging (silent si dead).
    if (/\/api\/tasks\/heartbeat/.test(url)) {
      event.respondWith(networkFirstCacheFallback(req, API_CACHE));
      return;
    }
    // GET /api/tasks → on conserve le dernier résultat 60s max
    if (/\/api\/tasks(\/|\?|$)/.test(url) || /\/api\/analytics\//.test(url)) {
      event.respondWith(networkFirstCacheFallback(req, API_CACHE));
      return;
    }
    // Autres APIs : network-first sans cache (mutations imposent fresh data).
    event.respondWith(networkFirstCacheFallback(req, API_CACHE));
    return;
  }

  // Round 69 — navigation HTML : network-first strict (fresh index.html
  // = fresh chunk hashes, plus de "Failed to fetch dynamically
  // imported module" après un rebuild).
  if (req.mode === 'navigate' || (typeof url === 'string' && url.endsWith('/index.html'))) {
    event.respondWith(networkFirstHtmlFallback(req));
    return;
  }

  // Round 69 — chunks JS hashés : network-first sans cache (les hashes
  // changent à chaque build ; on évite de servir un chunk obsolète).
  if (
    typeof url === 'string'
    && url.includes('/assets/')
    && /\.js(?:$|\?)/.test(url)
  ) {
    event.respondWith(networkFirstChunkFallback(req));
    return;
  }

  // Assets statiques non-JS (CSS, fonts, images) → cache-first ok.
  if (isAssetRequest(url)) {
    event.respondWith(cacheFirstNetworkFallback(req, ASSET_CACHE));
    return;
  }

  // Default → passe-plat
});

// =====================================================================
// Periodic Background Sync (optionnel) — heartbeat toutes les 4 min
// =====================================================================

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'zentara-heartbeat') {
    event.waitUntil(doBackgroundHeartbeat());
  }
});

async function doBackgroundHeartbeat() {
  try {
    // Round 36 — ping heartbeat depuis l'API_BASE relative.
    const apiBase = self.registration.scope.replace(/\/$/, '') + '/api';
    const res = await fetch(`${apiBase}/tasks/heartbeat`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.data?.server_time) {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      all.forEach((c) => {
        try { c.postMessage({ type: 'heartbeat', server_time: data.data.server_time }); }
        catch (_e) { /* dead client */ }
      });
    }
  } catch (_e) {
    // Pas critique, on attend la prochaine sync.
  }
}

// =====================================================================
// Messages (depuis la page)
// =====================================================================

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CACHE_CLEAR') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
  }
});

// =====================================================================
// Push notifications (squelette — Round 36 ne fait pas le push server)
// =====================================================================

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch (_) { payload = { title: 'Zentara', body: event.data.text() }; }
  const title = payload.title || 'Zentara';
  const options = {
    body: payload.body || 'Mise à jour',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data || {},
    tag: payload.tag || 'zentara-task',
    silent: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { c.focus(); c.navigate(link); return; } catch (_e) { /* continue */ }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
});
