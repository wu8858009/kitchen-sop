/* 離線快取：頁面網路優先，其他資源快取優先並於背景更新 */
const CACHE = 'kitchen-sop-v36';
const ASSETS = [
  './', 'index.html', 'styles.css?v=36', 'config.js?v=36', 'units.js?v=36', 'vi.js?v=36', 'app.js?v=36', 'vendor/niimbluelib.min.js?v=36', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Google 同步請求不經過快取
  if (req.mode === 'navigate') {
    // no-cache：每次都向伺服器確認首頁是否有新版（GitHub Pages 預設會快取 10 分鐘）
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
