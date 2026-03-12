// MyCalendar Service Worker
// キャッシュ戦略: App Shell（HTML/CSS/JS）はキャッシュ優先、API呼び出しはネットワーク優先

const CACHE_NAME = 'mycalendar-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
];

// インストール時: App Shellをプリキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 有効化時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ時: API呼び出しはネットワーク優先、その他はキャッシュ優先
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Google API呼び出しは常にネットワークから取得
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // バックグラウンドで更新
        fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
