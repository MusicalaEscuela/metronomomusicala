/* Service worker del Metrónomo Musicala.
   Estrategia por tipo de recurso:
   - Código de la app (HTML, JS, CSS, manifest): RED PRIMERO. Si hay internet
     siempre se ve la última versión publicada; la caché solo entra como
     respaldo cuando no hay conexión.
   - Medios que no cambian (.wav, .svg): CACHÉ PRIMERO, que es lo que hace
     que la app arranque sin internet en el salón.

   La versión anterior era caché primero para todo, así que una vez instalada
   servía el index.html viejo para siempre: había que entrar en incógnito para
   ver los cambios. */

const VERSION = 'v5.1';
const CACHE   = 'metronomo-musicala-' + VERSION;

// Se precargan los medios pesados; el código se toma de la red al vuelo.
const PRECACHE = [
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

const isMedia = url => /\.(wav|mp3|ogg|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(a => c.add(a))))
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

// Permite forzar la actualización desde la página.
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(req, cache) {
  try {
    // no-cache: revalida contra el servidor y no se queda con la copia HTTP vieja.
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw new Error('sin red y sin caché');
  }
}

async function cacheFirst(req, cache) {
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // fuentes de Google: red directa

  e.respondWith(
    caches.open(CACHE).then(cache =>
      (req.mode === 'navigate' || !isMedia(url))
        ? networkFirst(req, cache)
        : cacheFirst(req, cache)
    )
  );
});
