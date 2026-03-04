// AniMatch V3 — Service Worker
const CACHE_NAME = 'animatch-v3';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Cache images from Jikan CDN
    if (url.hostname.includes('cdn.myanimelist.net')) {
        e.respondWith(
            caches.open(CACHE_NAME).then(cache =>
                cache.match(e.request).then(cached => {
                    if (cached) return cached;
                    return fetch(e.request).then(res => {
                        if (res.ok) cache.put(e.request, res.clone());
                        return res;
                    }).catch(() => cached);
                })
            )
        );
        return;
    }

    // Network-first for API, cache-first for static assets
    if (url.hostname.includes('api.jikan.moe')) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
    } else {
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
    }
});
