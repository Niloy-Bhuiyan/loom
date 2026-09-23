/**
 * Remembers which models have been fully downloaded, so returning visitors
 * skip the "download 1.7 GB?" prompt and load straight from the browser cache.
 *
 * The weights themselves live in the Cache API, managed by Transformers.js.
 */

const KEY = 'loom.cached-models.v1';
/** Cache API buckets used by Transformers.js (models + ONNX Runtime WASM) and by our voice loader. */
export const CACHE_NAMES = ['transformers-cache', 'loom-voices'];

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function read(store: KeyValueStore): string[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function areModelsCached(models: string[], store: KeyValueStore = localStorage): boolean {
  const cached = new Set(read(store));
  return models.every((m) => cached.has(m));
}

export function markModelsCached(models: string[], store: KeyValueStore = localStorage): void {
  try {
    store.setItem(KEY, JSON.stringify([...new Set([...read(store), ...models])]));
  } catch {
    // Non-fatal: we'd just ask before loading next time.
  }
}

/** Delete every downloaded model from this browser. */
export async function clearModelCache(store: KeyValueStore = localStorage): Promise<void> {
  store.removeItem(KEY);
  if ('caches' in globalThis) await Promise.all(CACHE_NAMES.map((name) => caches.delete(name)));
}

/** Ask the browser not to evict our (large) cache under storage pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort only.
  }
}
