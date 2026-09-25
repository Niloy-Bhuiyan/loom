import { ModelRegistry } from '@huggingface/transformers';
import { serveWorker } from '../workers/host';
import { hubUrl, runtimeUrls } from '../workers/hub-url';
import type { ModelItem } from './plan';

export interface ManifestRequest {
  models: ModelItem[];
  extraUrls: string[];
}

export interface ManifestFile {
  url: string;
  /** Bytes, from a HEAD request; null if the server didn't say. */
  size: number | null;
}

async function sizeOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const size = Number(response.headers.get('content-length'));
    return response.ok && size > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Turns an offline plan into concrete downloads — exactly the files and cache
 * keys Transformers.js will look for, plus ONNX Runtime's WASM — with their
 * real sizes, so progress can be shown honestly.
 */
serveWorker<Record<string, never>, ManifestRequest, ManifestFile[], never>({
  async load() {
    return 'cpu';
  },
  async run({ models, extraUrls }) {
    const urls = new Set<string>(runtimeUrls());
    for (const { task, model, dtype, device } of models) {
      const files = await ModelRegistry.get_pipeline_files(task, model, { dtype: dtype as never, device });
      for (const file of files) urls.add(hubUrl(model, file));
    }
    for (const url of extraUrls) urls.add(url);
    const result = await Promise.all([...urls].map(async (url) => ({ url, size: await sizeOf(url) })));
    return { result };
  },
});
