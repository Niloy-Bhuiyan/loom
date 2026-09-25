import { WorkerClient } from '../workers/client';
import type { ManifestFile, ManifestRequest } from './manifest.worker';
import { cacheNameFor, type OfflinePlan } from './plan';

export interface Readiness {
  total: number;
  cached: number;
  missing: string[];
  /** Sizes as reported by the servers (files without a known size count as 0). */
  missingBytes: number;
  totalBytes: number;
}

export interface DownloadProgress {
  /** Bytes fetched so far (null when the browser doesn't report it). */
  downloaded: number | null;
  /** Files done out of total (in-page downloads only). */
  files?: { done: number; total: number };
  /** Everything arrived; it's being written into the browser's storage. */
  storing?: boolean;
}

/** Background Fetch isn't in TypeScript's DOM types yet; describe the parts we use. */
interface BackgroundFetchRegistration extends EventTarget {
  id: string;
  downloaded: number;
  downloadTotal: number;
  result: '' | 'success' | 'failure';
  failureReason: string;
  abort(): Promise<boolean>;
}
interface BackgroundFetchManager {
  fetch(id: string, requests: string[], options?: { title?: string; icons?: { src: string; sizes: string; type: string }[]; downloadTotal?: number }): Promise<BackgroundFetchRegistration>;
  get(id: string): Promise<BackgroundFetchRegistration | undefined>;
  getIds(): Promise<string[]>;
}

const FETCH_ID = 'loom-offline-models';

/** Exact URLs (= cache keys) and sizes for everything in the plan. */
export async function offlineFiles(plan: OfflinePlan): Promise<ManifestFile[]> {
  const client = new WorkerClient<Record<string, never>, ManifestRequest, ManifestFile[]>(
    new Worker(new URL('./manifest.worker.ts', import.meta.url), { type: 'module', name: 'loom-manifest' }),
  );
  try {
    await client.load({}, () => {});
    return await client.run({ models: plan.models, extraUrls: plan.extraUrls });
  } finally {
    client.terminate();
  }
}

/** Which files are already in the browser cache, and how many bytes are still to come. */
export async function checkReadiness(files: readonly ManifestFile[]): Promise<Readiness> {
  const missing: string[] = [];
  let missingBytes = 0;
  let totalBytes = 0;
  const opened = new Map<string, Cache>();
  for (const { url, size } of files) {
    const name = cacheNameFor(url);
    if (!opened.has(name)) opened.set(name, await caches.open(name));
    totalBytes += size ?? 0;
    if (!(await opened.get(name)!.match(url))) {
      missing.push(url);
      missingBytes += size ?? 0;
    }
  }
  return { total: files.length, cached: files.length - missing.length, missing, missingBytes, totalBytes };
}

async function backgroundFetchManager(): Promise<BackgroundFetchManager | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = (await navigator.serviceWorker.getRegistration()) as (ServiceWorkerRegistration & { backgroundFetch?: BackgroundFetchManager }) | undefined;
  return reg?.backgroundFetch ?? null;
}

/** True where downloads can continue after the tab is closed (Chromium with the service worker active). */
export async function canDownloadInBackground(): Promise<boolean> {
  try {
    if (localStorage.getItem(BROKEN_KEY)) return false;
  } catch {
    // Storage unavailable: just ask the browser.
  }
  return (await backgroundFetchManager()) !== null;
}

/** 'stalled': the browser accepted the download but never started it. */
export type BackgroundResult = 'done' | 'failed' | 'stalled';

/**
 * Start (or re-attach to) a Background Fetch. The browser shows its own
 * progress UI and keeps going if the tab is closed; the service worker files
 * everything into the caches when it finishes.
 */
export async function downloadInBackground(urls: string[], onProgress: (p: DownloadProgress) => void): Promise<BackgroundResult> {
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

/** Is a background download still in progress (e.g. started before the tab was closed)? */
export async function hasBackgroundDownload(): Promise<boolean> {
  return Boolean(await (await backgroundFetchManager())?.get(FETCH_ID));
}

/** If a background download is running (e.g. started before a reload), follow it. */
export async function resumeBackgroundDownload(onProgress: (p: DownloadProgress) => void): Promise<BackgroundResult | null> {
  const registration = await (await backgroundFetchManager())?.get(FETCH_ID);
  return registration ? watchBackgroundFetch(registration, onProgress) : null;
}

/**
 * Some Chromium-based browsers expose the Background Fetch API but never
 * download anything (seen in an Electron-based browser: stuck at 0 bytes).
 * If nothing arrives in this long, give up on it and remember not to offer it again.
 */
const STALL_MS = 20_000;
/** How long to wait for the service worker to finish storing a completed download. */
const STORE_TIMEOUT_MS = 5 * 60_000;
const BROKEN_KEY = 'loom.background-fetch-broken';

function watchBackgroundFetch(registration: BackgroundFetchRegistration, onProgress: (p: DownloadProgress) => void): Promise<BackgroundResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const finish = (result: BackgroundResult) => {
      clearInterval(watchdog);
      resolve(result);
    };
    const settle = () => {
      // "success" means the bytes arrived; the service worker may still be copying them
      // into the caches, so wait for its "ready" message (the caller double-checks the cache).
      if (registration.result === 'success') {
        onProgress({ downloaded: registration.downloaded, storing: true });
        setTimeout(() => finish('done'), STORE_TIMEOUT_MS);
      } else if (registration.result === 'failure') finish('failed');
    };
    const watchdog = setInterval(() => {
      if (registration.downloaded > 0 || performance.now() - started < STALL_MS) return;
      void registration.abort();
      try {
        localStorage.setItem(BROKEN_KEY, '1');
      } catch {
        // Only means we might offer it again next time.
      }
      finish('stalled');
    }, 2000);

    onProgress({ downloaded: registration.downloaded });
    registration.addEventListener('progress', () => {
      onProgress({ downloaded: registration.downloaded });
      settle();
    });
    // The service worker announces when it has finished filing responses into the caches.
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'loom-offline-ready') finish('done');
      if (e.data?.type === 'loom-offline-failed') finish('failed');
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
