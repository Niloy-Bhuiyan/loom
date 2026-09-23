import { ModelRegistry } from '@huggingface/transformers';
import { PHASE_DOWNLOADING, PHASE_FROM_CACHE } from '../core/progress';
import type { LoadContext } from './host';

/**
 * Tell the UI whether this model will be read from the browser cache or
 * downloaded, by asking Transformers.js which files are actually cached
 * (a "we loaded it before" flag can be stale if the browser evicted the cache).
 */
export async function reportCacheStatus(
  task: string,
  model: string,
  options: Parameters<typeof ModelRegistry.is_pipeline_cached>[2],
  ctx: LoadContext,
): Promise<void> {
  let cached = false;
  try {
    cached = await ModelRegistry.is_pipeline_cached(task, model, options);
  } catch {
    // Unknown: assume a download, which is the conservative message.
  }
  ctx.phase(cached ? PHASE_FROM_CACHE : PHASE_DOWNLOADING);
}
