import { EMBED_DTYPE, EMBED_MODEL, findLlm, findStt, SUPERTONIC_MODEL, voiceUrl } from '../config/models';
import type { Settings } from '../config/settings';
import { pickDtype } from '../llm/transformers-llm';

/** One model as Transformers.js will load it. */
export interface ModelItem {
  task: string;
  model: string;
  dtype?: string | Record<string, string>;
  device: 'webgpu' | 'wasm';
}

export interface OfflinePlan {
  models: ModelItem[];
  /** Files outside Transformers.js's loader (e.g. voice styles). */
  extraUrls: string[];
}

/**
 * Everything Loom needs on disk to run fully offline with these settings:
 * ears, the *chosen* brain (not just the fast-start one), voice, and the
 * document-search model.
 */
export function offlinePlan(settings: Settings, shaderF16: boolean): OfflinePlan {
  const stt = findStt(settings.stt);
  const llm = findLlm(settings.llm);
  const models: ModelItem[] = [
    { task: 'automatic-speech-recognition', model: stt.model, dtype: stt.dtype, device: 'webgpu' },
    { task: 'text-generation', model: llm.model, dtype: pickDtype(llm, shaderF16 && settings.f16), device: 'webgpu' },
    { task: 'feature-extraction', model: EMBED_MODEL, dtype: EMBED_DTYPE, device: 'wasm' },
  ];
  const extraUrls: string[] = [];
  if (settings.tts === 'supertonic') {
    models.push({ task: 'text-to-speech', model: SUPERTONIC_MODEL, device: 'webgpu' });
    extraUrls.push(voiceUrl(settings.voice));
  }
  return { models, extraUrls };
}

/** Transformers.js's Cache API bucket, and the one Loom keeps voice styles in. */
export const MODEL_CACHE = 'transformers-cache';
export const VOICE_CACHE = 'loom-voices';

/** Which cache a downloaded file belongs in (mirrored in public/sw.js). */
export function cacheNameFor(url: string): string {
  return /\/voices\/[^/]+\.bin$/.test(url) ? VOICE_CACHE : MODEL_CACHE;
}
