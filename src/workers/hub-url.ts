import { env } from '@huggingface/transformers';

/**
 * The URL Transformers.js downloads a model file from — which is also the key
 * it stores it under in the Cache API, so files fetched elsewhere (prefetch,
 * background fetch) are found by its loader later.
 */
export function hubUrl(model: string, file: string): string {
  const path = env.remotePathTemplate.replace('{model}', model).replace('{revision}', 'main');
  return `${env.remoteHost}${path}${file}`;
}

/** ONNX Runtime's WASM glue, which Transformers.js fetches from a CDN and caches. */
export function runtimeUrls(): string[] {
  const paths = env.backends.onnx.wasm?.wasmPaths;
  if (paths && typeof paths === 'object' && paths.mjs && paths.wasm) return [String(paths.mjs), String(paths.wasm)];
  const version = env.backends.onnx.versions?.web;
  if (!version) return [];
  const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded.asyncify`;
  return [`${prefix}.mjs`, `${prefix}.wasm`];
}
