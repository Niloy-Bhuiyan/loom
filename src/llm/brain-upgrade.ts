import type { LlmPreset } from '../config/models';
import type { LanguageModel, ProgressListener } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import type { PrefetchConfig } from './prefetch.worker';

export interface UpgradeCallbacks {
  /** Progress of the background download, then of loading onto the GPU. */
  onProgress: ProgressListener;
  /** Called with the ready model; the caller swaps it in when convenient. */
  onReady(llm: LanguageModel): void;
  onError(error: unknown): void;
}

/**
 * Fast start: while the user chats with a small model, download the bigger
 * one in the background (straight into the browser cache, no GPU memory),
 * then load it and hand it over.
 */
export async function upgradeBrain(target: LlmPreset, dtype: string, createLlm: () => LanguageModel, cb: UpgradeCallbacks): Promise<void> {
  const prefetch = new WorkerClient<PrefetchConfig, never, never>(
    new Worker(new URL('./prefetch.worker.ts', import.meta.url), { type: 'module', name: 'loom-prefetch' }),
  );
  try {
    await prefetch.load({ task: 'text-generation', model: target.model, dtype }, cb.onProgress);
    prefetch.terminate();

    const llm = createLlm();
    await llm.load(cb.onProgress);
    cb.onReady(llm);
  } catch (err) {
    prefetch.terminate();
    cb.onError(err);
  }
}
