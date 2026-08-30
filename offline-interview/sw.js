const VERSION = 'offline-interview-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL = ['./', './index.html', './styles.css', './app.js', './interview.json', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('offline-interview-') && ![SHELL_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isRuntimeDependency(url) {
  return url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'huggingface.co' || url.hostname.endsWith('.huggingface.co');
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then(cache => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  if (url.origin === self.location.origin || isRuntimeDependency(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(url.origin === self.location.origin ? SHELL_CACHE : RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
