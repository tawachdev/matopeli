const VERSION = '__MATOPELI_VERSION__';
const HASHED = [/*__MATOPELI_ASSETS__*/];
const CORE = ['./', './index.html', './engine.wasm', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png', './apple-touch-icon.png'];
const PRECACHE = [...CORE, ...HASHED];
const CACHE = 'matopeli-' + VERSION;
const PREFIX = 'matopeli-';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function stash(req, res) {
  if (!res.ok) return;
  caches.open(CACHE).then((cache) => cache.put(req, res.clone())).catch(() => {});
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          stash(req, res);
          return res;
        })
        .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          stash(req, res);
          return res;
        })
    )
  );
});
