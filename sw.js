// Service Worker — TerMate
// Estrategia offline-first: sirve desde cache, actualiza en fondo

const CACHE_NAME = 'termate-v1';
const TILE_CACHE = 'termate-tiles-v1';
const API_CACHE = 'termate-api-v1';

// Recursos core que se cachean en la instalación
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Instalación: precachear recursos core
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activación: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: estrategias según el tipo de request
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Tiles del mapa (CartoDB / OSM) → Cache First, luego red
  if (
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('tile.openstreetmap.org')
  ) {
    event.respondWith(cacheThenNetwork(event.request, TILE_CACHE));
    return;
  }

  // 2. APIs de georeferencia argentina → Network First, fallback cache
  if (
    url.hostname.includes('apis.datos.gob.ar') ||
    url.hostname.includes('api.openrouteservice.org') ||
    url.hostname.includes('nominatim.openstreetmap.org')
  ) {
    event.respondWith(networkThenCache(event.request, API_CACHE));
    return;
  }

  // 3. Recursos core → Cache First
  if (
    url.hostname === self.location.hostname ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(cacheThenNetwork(event.request, CACHE_NAME));
    return;
  }
});

// Cache First (ideal para tiles estáticos)
async function cacheThenNetwork(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      // No guardar tiles si el cache está por encima de 150MB
      const estimate = await navigator.storage?.estimate?.();
      const usageMB = estimate ? estimate.usage / (1024 * 1024) : 0;
      if (usageMB < 150) {
        cache.put(request, fresh.clone());
      }
    }
    return fresh;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Network First (ideal para APIs que cambian)
async function networkThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'sin_conexion' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503
    });
  }
}
