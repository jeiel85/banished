/* Ashborne: Feudal Manor 서비스워커: 오프라인 실행과 설치형 PWA 지원.
 * - 내비게이션: network-first, 실패 시 캐시된 index.html
 * - 같은 출처 정적 자산: stale-while-revalidate
 * 배포 내용이 바뀌어 캐시를 강제로 비워야 하면 CACHE_VERSION을 올린다. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `banished-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('banished-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 캐시 저장은 best-effort: 저장 공간 초과 등으로 put이 실패해도 받은 응답은 그대로 돌려준다.
async function putIfOk(request, response) {
  if (response && response.ok && response.type === 'basic') {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn('Service worker cache write failed:', request.url, error);
    }
  }
  return response;
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    return await putIfOk(request, response);
  } catch (error) {
    const cached = (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match(new URL('./index.html', self.registration.scope).href))
      || (await caches.match(self.registration.scope));
    if (cached) return cached;
    throw error;
  }
}

async function handleAsset(event) {
  const { request } = event;
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => putIfOk(request, response))
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  event.respondWith(handleAsset(event));
});
