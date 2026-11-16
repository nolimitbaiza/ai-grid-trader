/*
 * Offline support for baizakisaev.com (home page and the AI Grid Trader demo).
 * After the first visit every file is cached, so the site opens with no internet connection
 * (handy at venues with bad Wi-Fi). Files are served from the cache instantly and refreshed in
 * the background.
 *
 * Versioning: the Dockerfile replaces __BUILD__ with a new stamp on every deploy. That renames this
 * cache and changes the address of every stamped file (style.css?v=…), so a new release is never
 * mixed with old copies held by the browser or by a CDN such as Cloudflare. The pages reload once
 * when a new release takes over (about.js / app.js; a worker-side client.navigate() crashed Chromium).
 */
const BUILD = "__BUILD__";
const CACHE = `agt-${BUILD}`;
const V = `?v=${BUILD}`;
const ASSETS = [
  "./",                                   // home page (about me)
  "ai-grid-trader",                       // the demo (clean URL for ai-grid-trader.html)
  "manifest.webmanifest",
  "assets/style.css" + V,
  "assets/about.js" + V,
  "assets/engine.js" + V,
  "assets/app.js" + V,
  "assets/data/markets.js" + V,
  "assets/data/services.js" + V,
  "assets/data/prices-caiso.js" + V,
  "assets/data/prices-de.js" + V,
  "assets/data/prices-sa.js" + V,
  "assets/img/profile.jpg" + V,
  "assets/img/project-chart.png" + V,
  "assets/vendor/plotly-basic-2.35.2.min.js",
  "assets/img/qr-linkedin.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

// Always ask the server, never a stored HTTP copy (browsers and CDNs may hold old ones).
const fresh = (req) => fetch(new Request(req, { cache: "no-cache" }));

self.addEventListener("install", (event) => {
  // Cache files one by one so a single missing file can't block installation.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((url) =>
        fresh(new Request(url)).then((res) => (res.ok ? cache.put(url, res) : null)).catch(() => {}))))
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
  // Pages are cached by page, ignoring ?kiosk=1 / #… and the .html / index.html spelling:
  // "/", "/index.html" -> "/"; "/ai-grid-trader", "/ai-grid-trader.html" -> "/ai-grid-trader".
  // Other files are cached by their exact address, including the ?v= build stamp.
  let key = req;
  if (req.mode === "navigate") {
    const path = new URL(req.url).pathname.replace(/index\.html$/, "").replace(/\.html$/, "");
    key = new Request(new URL(path, self.location.origin));
  }
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const network = fetch(req.mode === "navigate" ? req : new Request(req, { cache: "no-cache" }))
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
