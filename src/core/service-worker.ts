/** Must match SHELL_CACHE in public/sw.js. */
const SHELL_CACHE = 'loom-shell-v1';

/**
 * Register the app-shell service worker so Loom can be reloaded offline.
 * Production only: in dev it would cache Vite's unbundled modules and get in the way.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .then(cacheLoadedAssets)
      .catch((err: unknown) => console.warn('[loom] service worker setup failed', err));
  });
}

/**
 * On the first visit the page's own scripts and styles load before the service
 * worker takes control, so it never sees them. Cache them now so the very
 * first offline reload already works.
 */
async function cacheLoadedAssets(): Promise<void> {
  const urls = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((url) => new URL(url).origin === location.origin);
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(urls.map((url) => cache.add(url).catch(() => {})));
}
