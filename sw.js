const CACHE_NAME = 'tn-forest-survey-v22';
const TILE_CACHE = 'tn-forest-tiles-v2';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './tn_offline_basemap.js',
  './tn_divisions_ranges.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'
];

const TRANSPARENT_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAAElFTkSuQmCC';

function getTransparentTile() {
  const binary = atob(TRANSPARENT_PNG_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'image/png' }
  });
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Master Request Handler
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Never intercept API endpoints or direct APK installer downloads
  if (url.includes('/api/') || url.endsWith('.apk')) {
    return;
  }

  const isMapTile = url.includes('/vt/') || 
                    url.includes('/tile/') || 
                    url.includes('arcgisonline.com') || 
                    url.includes('cartocdn.com');

  // STRATEGY 1: REAL SATELLITE MAP TILES (Offline Priority with Deep Zoom Scaling)
  if (isMapTile) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (tileCache) => {
        // Normalize Google tile subdomains (mt0, mt1, mt2, mt3 -> mt1)
        const normalizedUrl = url.replace(/mt[0-3]\.google\.com/, 'mt1.google.com');

        // 1. Check if exact tile is in local offline cache
        const cached = await tileCache.match(normalizedUrl) || await tileCache.match(url) || await tileCache.match(e.request);
        if (cached) return cached;

        // 2. If online, fetch from network and store in cache
        if (navigator.onLine) {
          try {
            const netRes = await fetch(e.request);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
              tileCache.put(normalizedUrl, netRes.clone());
            }
            return netRes;
          } catch (err) {}
        }

        // 3. Offline in forest: Return clean transparent tile if exact zoom is not cached
        // Leaflet natively hardware-scales the maxNativeZoom tile with CSS transforms (prevents 4-quadrant tile repetition glitch)
        return getTransparentTile();
      })
    );
    return;
  }

  // STRATEGY 2: CORE APPLICATION ASSETS (Network-First with Offline Cache Fallback)
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return null;
        });
      })
  );
});
