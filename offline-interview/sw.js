const VERSION = 'offline-interview-v5';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL = ['./', './index.html', './styles.css', './app.js?v=5', './interview.json', './manifest.webmanifest', './icon.svg', './stt-benchmark.html', './stt-benchmark.js?v=1', './stt-deep-benchmark.html', './stt-deep-benchmark.js?v=1', './stt-lab-audio.js', './stt-lab-engines.js'];

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

  // Transformers.js 4.2 uses HTTP Range requests (206 Partial Content)
  // to discover tokenizer/processor files. Cache Storage does not support
  // storing partial responses; attempting cache.put(206) rejects the fetch
  // and makes Transformers believe required files do not exist.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response?.ok) {
          try {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(request, response.clone());
          } catch (error) {
            console.warn('offline-interview navigation cache write skipped', error);
          }
        }
        return response;
      } catch {
        const exact = await caches.match(request, { ignoreSearch: true });
        if (exact) return exact;

        const fallback = url.pathname.endsWith('/stt-benchmark.html')
          ? await caches.match('./stt-benchmark.html')
          : await caches.match('./index.html');
        return fallback;
      }
    })());
    return;
  }

  if (url.origin === self.location.origin || isRuntimeDependency(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);

      // Never allow a cache write failure to turn a successful network
      // response into an application failure.
      if (response && (response.status === 200 || response.type === 'opaque')) {
        try {
          const cache = await caches.open(url.origin === self.location.origin ? SHELL_CACHE : RUNTIME_CACHE);
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn('offline-interview cache write skipped', error);
        }
      }
      return response;
    })());
  }
});
