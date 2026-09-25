import { env, ModelRegistry } from '@huggingface/transformers';
import { PHASE_DOWNLOADING } from '../core/progress';
import { serveWorker, type LoadContext } from '../workers/host';
import { hubUrl } from '../workers/hub-url';

export interface PrefetchConfig {
  task: string;
  model: string;
  dtype: string;
}

/** Report byte progress at most this often per file, to keep messages cheap. */
const PROGRESS_STEP = 1024 * 1024;

/**
 * Downloads a model's files straight into Transformers.js's cache without
 * creating any GPU session, so a bigger model can arrive in the background
 * while the user is already chatting with a small one.
 */
serveWorker<PrefetchConfig, never, never, never>({
  async load({ task, model, dtype }, ctx) {
    ctx.phase(PHASE_DOWNLOADING);
    const files = await ModelRegistry.get_pipeline_files(task, model, { dtype: dtype as never, device: 'webgpu' });
    const cache = await caches.open(env.cacheKey);
    // One file at a time: the weights dominate and this leaves bandwidth for everything else.
    for (const file of files) await download(model, file, cache, ctx);
    return 'cache';
  },
  async run() {
    throw new Error('The prefetch worker only downloads');
  },
});

async function download(model: string, file: string, cache: Cache, ctx: LoadContext): Promise<void> {
  // Same URL Transformers.js uses as the cache key, so its loader finds these files later.
  const url = hubUrl(model, file);
  const cached = await cache.match(url);
  if (cached) {
    const size = Number(cached.headers.get('content-length')) || 0;
    ctx.progress({ status: 'progress', file, loaded: size, total: size });
    return;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Failed to fetch ${file}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;

  const [toCache, toCount] = response.body.tee();
  const stored = cache.put(url, new Response(toCache, { headers: response.headers }));
  const reader = toCount.getReader();
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    if (loaded - reported >= PROGRESS_STEP) {
      reported = loaded;
      ctx.progress({ status: 'progress', file, loaded, total: total || loaded });
    }
  }
  await stored;
  ctx.progress({ status: 'progress', file, loaded, total: total || loaded });
}
