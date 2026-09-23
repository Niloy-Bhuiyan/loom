import { defineConfig } from 'vite';

// Loom is a fully static site: no server code, no API routes.
// `base: './'` keeps every asset path relative so the build works when served
// from any sub-path (e.g. https://<user>.github.io/loom/).
export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Transformers.js loads ONNX Runtime's WASM/JSEP glue dynamically;
    // pre-bundling it breaks those relative imports in dev.
    exclude: ['@huggingface/transformers'],
  },
  build: {
    target: 'es2022',
  },
});
