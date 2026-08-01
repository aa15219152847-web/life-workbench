/* 生活工作台 Service Worker v2.0
   缓存策略：
   - HTML / manifest：network-first（永远拿最新版，避免旧缓存）
   - 图片等静态资源：cache-first（离线可用）
   更新策略：新 SW 安装后 skipWaiting + clients.claim 立即接管 */
const CACHE_NAME = 'life-workbench-v2';

// 安装：预缓存基础资源
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        './',
        './index.html',
        './manifest.json',
        './app-icon-v3-180.png',
        './app-icon-v3-192.png',
        './app-icon-v3-512.png',
        './avatar.png'
      ]))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存 + 立即接管
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 请求处理
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // 第三方请求（RSS 等）不缓存
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // HTML / manifest：network-first（保持最新，离线回退缓存）
  const isHTML = path === '/' ||
    path.endsWith('index.html') ||
    path.endsWith('manifest.json');
  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 图片等静态资源：cache-first
  const isImage = path.endsWith('.png') || path.endsWith('.jpg') ||
    path.endsWith('.jpeg') || path.endsWith('.webp') || path.endsWith('.svg');
  if (isImage) {
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

// 版本更新通知
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
