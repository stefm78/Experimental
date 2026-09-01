const VERSION = 'offline-interview-v13';
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL = [
  './', './index.html', './styles.css', './app.js?v=13',
  './interview.json', './manifest.webmanifest', './icon.svg',
  './stt-benchmark.html', './stt-benchmark.js?v=9',
  './stt-deep-benchmark.html', './stt-deep-benchmark.js?v=9',
  './device-stt-capability.html', './device-stt-capability.js?v=3', './stt-lab-audio.js?v=4', './stt-lab-engines.js?v=4', './stt-lab-fixtures.js?v=3'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Remove all previous app-owned caches, including the old external runtime
    // cache. Transformers.js owns its own "transformers-cache" and remains
    // responsible for model/offline assets.
    await Promise.all(
      keys
        .filter(k => k.startsWith('offline-interview-') && k !== SHELL_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never intercept third-party model/runtime traffic. Transformers.js has
  // its own browser cache. Double-caching large ONNX files wastes storage and
  // risks stale model artifacts.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response?.ok) {
          try {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(request, response.clone());
          } catch {}
        }
        return response;
      } catch {
        const exact = await caches.match(request, { ignoreSearch: true });
        if (exact) return exact;
        if (url.pathname.endsWith('/device-stt-capability.html')) return caches.match('./device-stt-capability.html');
        if (url.pathname.endsWith('/stt-deep-benchmark.html')) return caches.match('./stt-deep-benchmark.html');
        if (url.pathname.endsWith('/stt-benchmark.html')) return caches.match('./stt-benchmark.html');
        return caches.match('./index.html');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const response = await fetch(request);
    if (response?.ok) {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  })());
});
