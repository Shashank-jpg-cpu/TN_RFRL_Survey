const CACHE_NAME = 'tn-forest-survey-v14';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js',
  './tn_divisions_ranges.js',
  './TN_Forest_All_51_Divisions_DFO_Credentials.pdf',
  './TN_Forest_All_51_Divisions_DFO_Credentials.html',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'
];

// High-tech Cadastral Survey Grid SVG placeholder for offline map tiles
const OFFLINE_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#0d1f16" stroke="#163826" stroke-width="1"/>
  <line x1="0" y1="64" x2="256" y2="64" stroke="#173b28" stroke-width="0.5" stroke-dasharray="3,3"/>
  <line x1="0" y1="128" x2="256" y2="128" stroke="#1f4d35" stroke-width="0.8"/>
  <line x1="0" y1="192" x2="256" y2="192" stroke="#173b28" stroke-width="0.5" stroke-dasharray="3,3"/>
  <line x1="64" y1="0" x2="64" y2="256" stroke="#173b28" stroke-width="0.5" stroke-dasharray="3,3"/>
  <line x1="128" y1="0" x2="128" y2="256" stroke="#1f4d35" stroke-width="0.8"/>
  <line x1="192" y1="0" x2="192" y2="256" stroke="#173b28" stroke-width="0.5" stroke-dasharray="3,3"/>
  <circle cx="128" cy="128" r="2.5" fill="#22c55e" opacity="0.4"/>
  <text x="128" y="132" fill="#22c55e" font-size="8.5" font-family="-apple-system, sans-serif" text-anchor="middle" font-weight="bold" opacity="0.5">OFFLINE CADASTRE GRID</text>
</svg>`;

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
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Network-First with offline cache fallback (Never serves stale code when online!)
self.addEventListener('fetch', (e) => {
  // Never intercept API routes or APK file downloads
  if (e.request.url.includes('/api/') || e.request.url.endsWith('.apk')) {
    return;
  }

  const url = e.request.url;
  const isMapTile = url.includes('/vt/') || 
                    url.includes('/tile/') || 
                    url.includes('arcgisonline.com') || 
                    url.includes('cartocdn.com') || 
                    e.request.destination === 'image';

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Cache both standard responses and opaque cross-origin tile responses
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque') && e.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline in forest: check cache first
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          
          // If offline map tile is not cached, serve Cadastral Grid SVG (NEVER return HTML!)
          if (isMapTile) {
            return new Response(OFFLINE_TILE_SVG, {
              status: 200,
              headers: { 'Content-Type': 'image/svg+xml' }
            });
          }

          // For page navigations offline, serve index.html
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html');
          }

          return null;
        });
      })
  );
});
