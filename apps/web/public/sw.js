/*
 * Refearn service worker — FINANSAL APP icin GUVENLI offline stratejisi.
 *
 * Ilke: para/komisyon verisi ASLA cache'lenmez (bayat finansal veri tehlikeli). Yalniz
 * UYGULAMA KABUGU (HTML kabugu + statik JS/CSS/font/ikon) cache'lenir; boylece uygulama
 * cevrimdisi ACILIR ama "cevrimdisisiniz" diyerek canli veriyi yenilemeyi bekler.
 *
 * - API istekleri (farkli origin, :3101): dokunma (network-only) -> offline'da fetch hata verir,
 *   uygulama OfflineBanner ile nazikce bildirir.
 * - Navigasyon (sayfa gecisi): network-first -> hata olursa cache -> en son offline.html.
 * - Statik varliklar (_next/static, font, ikon): cache-first + arka planda tazele (hizli tekrar yukleme).
 * - HMR/hot-update: cache'lenmez (dev'de bayat chunk vermesin).
 */
const CACHE = 'refearn-shell-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE = ['/offline.html', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutasyonlar: yalniz network

  const url = new URL(req.url);

  // Baska origin (API :3101 dahil): cache'leme, tarayiciya birak (canli para verisi).
  if (url.origin !== self.location.origin) return;

  // HMR / hot-update: asla cache'leme (dev tutarliligi).
  if (url.pathname.includes('hot-update') || url.pathname.startsWith('/__nextjs')) return;

  // Navigasyon: network-first -> cache -> offline kabugu.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match(OFFLINE_URL))),
    );
    return;
  }

  // Statik varliklar: cache-first + arka planda yenile (stale-while-revalidate).
  if (
    url.pathname.startsWith('/_next/static') ||
    url.pathname.startsWith('/__nextjs_font') ||
    /\.(?:svg|png|ico|webmanifest|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(req);
        const network = fetch(req)
          .then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Diger same-origin GET: network-first, hata olursa cache.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ---- Web Push: gelen push'u bildirim olarak goster ----
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (e) { payload = { title: 'Refearn', body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'Refearn';
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.template || 'refearn',
      data,
    }),
  );
});

// ---- Bildirime tiklayinca: acik sekmeyi odakla, yoksa uygulamayi ac ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(target) && 'focus' in c) return c.focus();
      }
      for (const c of clients) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
