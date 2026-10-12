/* Cairn Web — offline cache. Bump VERSION when publishing a new build. */
const VERSION = 'cairn-web-1.4.0';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'vendor/jszip.min.js', 'vendor/marked.min.js', 'vendor/purify.min.js',
  'js/icons.js', 'js/util.js', 'js/store.js', 'js/model.js', 'js/ui.js', 'js/graph.js', 'js/rtf.js', 'js/view-auth.js', 'js/view-projects.js',
  'js/view-board.js', 'js/view-card.js', 'js/view-docs.js', 'js/view-roadmap.js', 'js/view-whiteboard.js', 'js/app.js',
  'assets/icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/ionicons.zip'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // network first (fresh after a new upload), cache when offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
