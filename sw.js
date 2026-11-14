// Service Worker – App-Hülle offline verfügbar machen. Bei jeder Änderung CACHE hochzählen.
const CACHE = 'gesundheitscockpit-v2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/firebase-config.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Firebase-SDK von gstatic: einmal laden, dann aus dem Cache
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }

  // Eigene Dateien: zuerst Netz (immer aktuell), sonst Cache (offline)
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
    );
  }
  // Alles andere (Firestore, Auth) läuft direkt übers Netz
});
