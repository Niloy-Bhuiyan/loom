import { WorkerClient } from '../workers/client';
import type { ManifestRequest } from './manifest.worker';
import { cacheNameFor, type OfflinePlan } from './plan';

export interface Readiness {
  total: number;
  cached: number;
  missing: string[];
}

export interface DownloadProgress {
  /** Bytes fetched so far (null when the browser doesn't report it). */
  downloaded: number | null;
  /** Files done out of total (in-page downloads only). */
  files?: { done: number; total: number };
}

/** Background Fetch isn't in TypeScript's DOM types yet; describe the parts we use. */
interface BackgroundFetchRegistration extends EventTarget {
  id: string;
  downloaded: number;
  downloadTotal: number;
  result: '' | 'success' | 'failure';
  failureReason: string;
}
interface BackgroundFetchManager {
  fetch(id: string, requests: string[], options?: { title?: string; icons?: { src: string; sizes: string; type: string }[]; downloadTotal?: number }): Promise<BackgroundFetchRegistration>;
  get(id: string): Promise<BackgroundFetchRegistration | undefined>;
  getIds(): Promise<string[]>;
}

const FETCH_ID = 'loom-offline-models';

/** Exact URLs (= cache keys) for everything in the plan. */
export async function offlineUrls(plan: OfflinePlan): Promise<string[]> {
  const client = new WorkerClient<Record<string, never>, ManifestRequest, string[]>(
    new Worker(new URL('./manifest.worker.ts', import.meta.url), { type: 'module', name: 'loom-manifest' }),
  );
  try {
    await client.load({}, () => {});
    return [...(await client.run({ models: plan.models })), ...plan.extraUrls];
  } finally {
    client.terminate();
  }
}

/** Which of `urls` are already in the browser cache. */
export async function checkReadiness(urls: readonly string[]): Promise<Readiness> {
  const missing: string[] = [];
  const opened = new Map<string, Cache>();
  for (const url of urls) {
    const name = cacheNameFor(url);
    if (!opened.has(name)) opened.set(name, await caches.open(name));
    if (!(await opened.get(name)!.match(url))) missing.push(url);
  }
  return { total: urls.length, cached: urls.length - missing.length, missing };
}

async function backgroundFetchManager(): Promise<BackgroundFetchManager | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = (await navigator.serviceWorker.getRegistration()) as (ServiceWorkerRegistration & { backgroundFetch?: BackgroundFetchManager }) | undefined;
  return reg?.backgroundFetch ?? null;
}

/** True where downloads can continue after the tab is closed (Chromium with the service worker active). */
export async function canDownloadInBackground(): Promise<boolean> {
  return (await backgroundFetchManager()) !== null;
}

/**
 * Start (or re-attach to) a Background Fetch. The browser shows its own
 * progress UI and keeps going if the tab is closed; the service worker files
 * everything into the caches when it finishes.
 */
export async function downloadInBackground(urls: string[], onProgress: (p: DownloadProgress) => void): Promise<'done' | 'failed'> {
  const manager = await backgroundFetchManager();
  if (!manager) throw new Error('Background downloads are not supported in this browser');
  const registration =
    (await manager.get(FETCH_ID)) ??
    (await manager.fetch(FETCH_ID, urls, {
      title: 'Loom — downloading AI models for offline use',
      icons: [{ src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' }],
    }));
  return watchBackgroundFetch(registration, onProgress);
}

/** If a background download is running (e.g. started before a reload), follow it. */
export async function resumeBackgroundDownload(onProgress: (p: DownloadProgress) => void): Promise<'done' | 'failed' | null> {
  const registration = await (await backgroundFetchManager())?.get(FETCH_ID);
  return registration ? watchBackgroundFetch(registration, onProgress) : null;
}

function watchBackgroundFetch(registration: BackgroundFetchRegistration, onProgress: (p: DownloadProgress) => void): Promise<'done' | 'failed'> {
  return new Promise((resolve) => {
    const settle = () => {
      if (registration.result === 'success') resolve('done');
      else if (registration.result === 'failure') resolve('failed');
    };
    onProgress({ downloaded: registration.downloaded });
    registration.addEventListener('progress', () => {
      onProgress({ downloaded: registration.downloaded });
      settle();
    });
    // The service worker announces when it has finished filing responses into the caches.
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'loom-offline-ready') resolve('done');
      if (e.data?.type === 'loom-offline-failed') resolve('failed');
    });
    settle();
  });
}

/** Fallback without Background Fetch: download in this tab (it must stay open). */
export async function downloadInPage(urls: string[], onProgress: (p: DownloadProgress) => void): Promise<void> {
  let downloaded = 0;
  for (const [i, url] of urls.entries()) {
    for (let attempt = 1; ; attempt++) {
      const before = downloaded;
      try {
        const response = await fetch(url);
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
        const [toCache, toCount] = response.body.tee();
        const stored = caches.open(cacheNameFor(url)).then((cache) => cache.put(url, new Response(toCache, { headers: response.headers })));
        const reader = toCount.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          downloaded += value.length;
          onProgress({ downloaded, files: { done: i, total: urls.length } });
        }
        await stored;
        break;
      } catch (err) {
        downloaded = before; // the retry starts this file from zero
        if (attempt >= 3 || !navigator.onLine) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  onProgress({ downloaded, files: { done: urls.length, total: urls.length } });
}
