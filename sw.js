const CACHE_NAME = 'tn-forest-survey-v15';
const TILE_CACHE = 'tn-forest-tiles-v1';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './tn_divisions_ranges.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'
];

// 1x1 Transparent PNG response for missing tiles when completely offline without cache
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

  // STRATEGY 1: SATELLITE MAP TILES (Cache-First with Parent-Zoom Scaling)
  if (isMapTile) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (tileCache) => {
        // 1. Check if exact tile is in local offline cache
        const cached = await tileCache.match(e.request);
        if (cached) return cached;

        // 2. If online, fetch from network and cache
        if (navigator.onLine) {
          try {
            const netRes = await fetch(e.request);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
              tileCache.put(e.request, netRes.clone());
            }
            return netRes;
          } catch (err) {}
        }

        // 3. Offline in forest: Look for parent zoom tile in cache (z-1)
        const googleMatch = url.match(/[?&]x=(\d+)&y=(\d+)&z=(\d+)/);
        if (googleMatch) {
          const x = parseInt(googleMatch[1]);
          const y = parseInt(googleMatch[2]);
          const z = parseInt(googleMatch[3]);
          if (z > 10) {
            const parentUrl = url.replace(`x=${x}`, `x=${Math.floor(x / 2)}`)
                                 .replace(`y=${y}`, `y=${Math.floor(y / 2)}`)
                                 .replace(`z=${z}`, `z=${z - 1}`);
            const parentCached = await tileCache.match(parentUrl);
            if (parentCached) return parentCached;
          }
        }

        // 4. Return clean transparent tile (Leaflet will display underlying cached layers smoothly)
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
