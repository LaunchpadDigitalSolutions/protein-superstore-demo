/* Launchpad — service worker template
   Copy to /sw.js in a client app and edit CONFIG. Nothing else needs changing.

   WHAT THIS DOES THAT THE OLD ONES DIDN'T
   The three existing service workers were network-only — they passed every
   request straight through and cached nothing. A PWA that shows a blank
   screen when the wifi drops is a bookmark with extra steps, and "keeps
   working when the signal goes" is most of why a café wants one.

   The strategy here is deliberately split:

     App shell (html, css, js, icons)   cache first, update in background
       -> the app opens instantly and works with no signal at all

     Menu data                          network first, fall back to cache
       -> always current when online; last known menu when not

     Orders, bookings, payments         network ONLY, never cached
       -> a stale order is worse than no order. If it can't reach the
          server it must fail loudly so the customer knows.

   AND: no kill switch. launchserve-demo/sw.js intercepts every navigation
   and returns a hardcoded "Coming Soon" page. Because a service worker
   persists on the device, anyone who installed that demo still sees it.
*/

const CONFIG = {
  /* Bump this on every deploy. It's what triggers the update. */
  version: 'v1.2.0',
  appName: 'protein-superstore',

  /* Cached on install — the app must open with these alone. */
  shell: [
    './',
    './index.html',
    './css/psp.css?v=1.2.0',
    './css/staff.css?v=1.2.0',
    './css/psp-screens.css?v=1.2.0',
    './core/tokens.css?v=1.2.0',
    './core/ui.css?v=1.2.0',
    './icon-192.png',
    './icon-512.png',
    './assets/logo.jpg?v=1.2.0',
    './assets/hero.jpg?v=1.2.0',
    './assets/slush-hero.jpg?v=1.2.0',
    './assets/slush-pair.jpg?v=1.2.0'
  ],

  /* Network first, cache as a fallback. */
  networkFirst: [
    '/rest/v1/ls_menu_categories',
    '/rest/v1/ls_menu_items'
  ],

  /* Never cached, never served stale. */
  neverCache: [
    '/rest/v1/ls_orders',
    '/rest/v1/ls_bookings',
    '/rest/v1/ls_booking_preorders',
    '/rest/v1/ls_customers',
    '/rest/v1/ls_loyalty',
    '/rest/v1/book_queue',
    '/rest/v1/rpc/',
    '/auth/v1/'
  ]
};

const CACHE = `${CONFIG.appName}-${CONFIG.version}`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CONFIG.shell))
      /* One missing file must not stop the whole worker installing. */
      .catch(err => console.warn('LP-233: shell cache incomplete', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(CONFIG.appName) && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* The page asks for this when the user accepts an update. */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                    /* never cache writes */

  const url = new URL(req.url);

  if (CONFIG.neverCache.some(p => url.pathname.includes(p))) return;

  if (CONFIG.networkFirst.some(p => url.pathname.includes(p))) {
    event.respondWith(networkFirst(req));
    return;
  }

  /* A navigation with no signal falls back to the cached shell rather than
     the browser's offline page. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* Code is network first, artwork is cache first.

     This was wrong on the first build: everything same-origin was cache
     first, keyed on a URL that never changed between deploys. A phone that
     had opened the app once kept the old stylesheet forever while happily
     taking the new HTML, so the app rendered new markup with old CSS and
     looked broken. Scripts and stylesheets now always try the network and
     only fall back to cache when there is no signal. */
  if (url.origin === self.location.origin) {
    const isCode = /\.(js|css)(\?|$)/.test(url.pathname + url.search);
    event.respondWith(isCode ? networkFirst(req) : cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    /* Refresh in the background so the next open is current. */
    fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    /* An empty list is a sensible offline answer for a data request. It is
       NOT a sensible answer for a stylesheet — served as JSON it would break
       the page rather than degrade it. */
    const isData = /\/rest\/v1\//.test(new URL(req.url).pathname);
    if (!isData) return new Response('', { status: 504, statusText: 'Offline' });
    return new Response(JSON.stringify([]), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
}

/* ---------- order ready notifications ---------- */
/* Kept from the originals, with the client's own name rather than a
   hardcoded one — two demos were pushing notifications titled "The Dancing
   Cup" from other venues' apps. */

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || CONFIG.appName;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Update on your order',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: data.tag || 'order',
      requireInteraction: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => (list.length ? list[0].focus() : self.clients.openWindow('/')))
  );
});
