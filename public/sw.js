/*
 * Loom's service worker:
 *  - caches the app shell (HTML, JS, CSS, WASM) so the page reloads with no network;
 *  - files finished Background Fetch downloads (model weights) into the caches
 *    Transformers.js reads from, so models can download with the tab closed;
 *  - reports every request that actually reaches the network, so the app's
 *    "proof" panel can show that a conversation uses none.
 */
const SHELL_CACHE = 'loom-shell-v1';
const network = new BroadcastChannel('loom-network');

/** Mirrors cacheNameFor() in src/offline/plan.ts. */
const cacheNameFor = (url) => (/\/voices\/[^/]+\.bin$/.test(url) ? 'loom-voices' : 'transformers-cache');

const reportNetwork = (request) => network.postMessage({ url: request.url, method: request.method, at: Date.now() });

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(['./', './index.html', './favicon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('loom-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    // Not ours to cache (models are cached by Transformers.js) — but it is network traffic.
    reportNetwork(request);
    return;
  }

  if (request.mode === 'navigate') {
    // Network first for the page so deploys show up; fall back to the cached shell offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          reportNetwork(request);
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Built assets have content hashes in their names, so cache-first is safe.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      reportNetwork(request);
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

// ── Background Fetch: model downloads that survive closing the tab ──

async function storeRecords(registration) {
  const records = await registration.matchAll();
  let stored = 0;
  await Promise.all(
    records.map(async (record) => {
      const response = await record.responseReady.catch(() => null);
      if (!response || !response.ok) return;
      const cache = await caches.open(cacheNameFor(record.request.url));
      await cache.put(record.request.url, response);
      stored++;
    }),
  );
  return { stored, total: records.length };
}

async function tellPages(type) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage({ type });
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  event.waitUntil(
    (async () => {
      await storeRecords(event.registration);
      await event.updateUI({ title: 'Loom is ready to use offline' });
      await tellPages('loom-offline-ready');
    })(),
  );
});

self.addEventListener('backgroundfetchfail', (event) => {
  event.waitUntil(
    (async () => {
      // Keep whatever did arrive; a retry only fetches what's missing.
      await storeRecords(event.registration);
      await event.updateUI({ title: 'Loom’s download didn’t finish — open Loom to resume' });
      await tellPages('loom-offline-failed');
    })(),
  );
});

self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil(self.clients.openWindow('./'));
});
