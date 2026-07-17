const CACHE_NAME = 'rantauflow-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/login.html',
  '/manifest.json',
  '/public/icon-512.png?v=2'
];

// Saat aplikasi pertama kali diinstal
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Menangani request jaringan
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Kembalikan dari cache jika ada, jika tidak, ambil dari internet
        return response || fetch(event.request);
      })
  );
});