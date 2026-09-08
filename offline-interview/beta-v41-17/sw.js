const VERSION='offline-interview-v41.17-quality-lanes';
const CACHE=`${VERSION}-shell`;
const SHELL=[
  './','./index.html','./quality-controller.js','./interview.json',
  '../beta/styles.css','../beta/app.js','../beta/system-stt.js','../beta/audio-window.js','../beta/whisper-quality.js','../beta/direct-interview-link.js',
  '../beta/manifest.webmanifest','../beta/icon.svg'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('offline-interview-v41.17')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html'))));
});
