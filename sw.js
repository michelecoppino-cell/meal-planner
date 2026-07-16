// Service worker: network-first con fallback alla cache (per l'uso offline al supermercato).
// Le chiamate al Worker Cloudflare (origine diversa) non vengono intercettate.
const CACHE = "cm-cache-v1";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => {
        if (r) return r;
        // Fallback a index.html solo per le navigazioni: un asset (icona, manifest)
        // non deve mai ricevere HTML al suo posto
        if (e.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }))
  );
});
