/*
 * Offline support for AI Grid Trader.
 * After the first visit every file is cached, so the demo opens with no internet connection
 * (handy at venues with bad Wi-Fi). Files are served from the cache instantly and refreshed in
 * the background, so a new version shows up on the next visit after it is published.
 */
const CACHE = "agt-v5";
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/style.css",
  "assets/engine.js",
  "assets/app.js",
  "assets/data/markets.js",
  "assets/vendor/plotly-basic-2.35.2.min.js",
  "assets/img/qr-linkedin.svg",
  "assets/img/profile.jpg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  // Cache files one by one so a single missing file can't block installation.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Every page load (?kiosk=1, ?embed=1, …) is served by the same cached index page.
  const key = req.mode === "navigate" ? new Request(new URL("./", self.registration.scope)) : req;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })
  );
});
