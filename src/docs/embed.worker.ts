import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { ModelProgressEvent } from '../core/progress';
import { reportCacheStatus } from '../workers/cache-status';
import { serveWorker } from '../workers/host';

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface EmbedRequest {
  texts: string[];
}

/** Embeddings in request order; each is unit length. */
export type EmbedResult = Float32Array[];

/** Partial progress: how many texts are done so far. */
export type EmbedProgress = number;

const BATCH = 8;
let extractor: FeatureExtractionPipeline | null = null;

serveWorker<Record<string, never>, EmbedRequest, EmbedResult, EmbedProgress>({
  async load(_config, ctx) {
    // Small (23 MB, 8-bit) and on the CPU, so it never competes with the chat model for GPU memory.
    await reportCacheStatus('feature-extraction', EMBED_MODEL, { dtype: 'q8', device: 'wasm' }, ctx);
    extractor = (await pipeline('feature-extraction', EMBED_MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (info) => ctx.progress(info as ModelProgressEvent),
    })) as FeatureExtractionPipeline;
    return 'wasm';
  },

  async run({ texts }, ctx) {
    if (!extractor) throw new Error('Embedding model is not loaded');
    const vectors: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const output = await extractor(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
      const [rows, dim] = output.dims as [number, number];
      const data = output.data as Float32Array;
      for (let r = 0; r < rows; r++) vectors.push(data.slice(r * dim, (r + 1) * dim));
      ctx.partial(vectors.length);
    }
    return { result: vectors, transfer: vectors.map((v) => v.buffer) };
  },
});
