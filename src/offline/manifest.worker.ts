import { ModelRegistry } from '@huggingface/transformers';
import { serveWorker } from '../workers/host';
import { hubUrl, runtimeUrls } from '../workers/hub-url';
import type { ModelItem } from './plan';

export interface ManifestRequest {
  models: ModelItem[];
}

/**
 * Turns an offline plan into concrete download URLs — exactly the files and
 * cache keys Transformers.js will look for — plus ONNX Runtime's WASM.
 */
serveWorker<Record<string, never>, ManifestRequest, string[], never>({
  async load() {
    return 'cpu';
  },
  async run({ models }) {
    const urls = new Set<string>(runtimeUrls());
    for (const { task, model, dtype, device } of models) {
      const files = await ModelRegistry.get_pipeline_files(task, model, { dtype: dtype as never, device });
      for (const file of files) urls.add(hubUrl(model, file));
    }
    return { result: [...urls] };
  },
});
