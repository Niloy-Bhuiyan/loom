/**
 * Register the app-shell service worker so Loom can be reloaded offline.
 * Production only: in dev it would cache Vite's unbundled modules and get in the way.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err: unknown) => {
      console.warn('[loom] service worker registration failed', err);
    });
  });
}
