/* Service worker del Metrónomo Musicala.
   Cache-first sobre los estáticos: la app funciona sin internet en el salón. */
const CACHE = 'metronomo-musicala-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './sounds.js',
  './manifest.json',
  './icon.svg',
  './bombo.wav',
  './platillo.wav',
  './redoblante.wav',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // fuentes de Google: red directa

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
