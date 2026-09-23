import { describe, expect, it } from 'vitest';
import { areModelsCached, clearModelCache, markModelsCached } from './model-cache';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('model cache flags', () => {
  it('is empty at first', () => {
    expect(areModelsCached(['a'], memoryStore())).toBe(false);
  });

  it('requires every model to be marked', () => {
    const store = memoryStore();
    markModelsCached(['a', 'b'], store);
    expect(areModelsCached(['a', 'b'], store)).toBe(true);
    expect(areModelsCached(['a', 'c'], store)).toBe(false);
  });

  it('accumulates across calls without duplicates', () => {
    const store = memoryStore();
    markModelsCached(['a'], store);
    markModelsCached(['a', 'b'], store);
    expect(JSON.parse(store.getItem('loom.cached-models.v1')!)).toEqual(['a', 'b']);
  });

  it('survives corrupted storage', () => {
    const store = memoryStore();
    store.setItem('loom.cached-models.v1', '{not json');
    expect(areModelsCached(['a'], store)).toBe(false);
    markModelsCached(['a'], store);
    expect(areModelsCached(['a'], store)).toBe(true);
  });

  it('forgets everything when cleared', async () => {
    const store = memoryStore();
    markModelsCached(['a'], store);
    await clearModelCache(store);
    expect(areModelsCached(['a'], store)).toBe(false);
  });
});
