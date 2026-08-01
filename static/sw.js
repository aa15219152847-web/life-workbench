/* 生活工作台 Service Worker v1.0
   缓存策略：核心资源 cache-first（离线可用），网络请求 network-first（保持新鲜）
   更新策略：新 SW 安装后进入 waiting，页面临时提示，用户确认后 skipWaiting + 刷新 */
const CACHE_NAME = 'life-workbench-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './app-icon-v3-180.png',
  './app-icon-v3-192.png',
  './app-icon-v3-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求：核心资源 cache-first；其他网络请求 network-first 兜底缓存
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // 第三方请求（RSS 等）不缓存
  if (url.origin !== self.location.origin) return;

  // 核心静态资源：cache-first
  if (CORE_ASSETS.some(a => e.request.url.endsWith(a) || url.pathname === '/' )) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // 其他同源请求：network-first，失败回退缓存
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// 版本更新通知：告知页面有新版本
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
