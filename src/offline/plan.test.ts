import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import { cacheNameFor, offlinePlan } from './plan';

describe('offlinePlan', () => {
  it('covers ears, the chosen brain, document search and the neural voice', () => {
    const plan = offlinePlan(DEFAULT_SETTINGS, true);
    expect(plan.models.map((m) => m.task)).toEqual(['automatic-speech-recognition', 'text-generation', 'feature-extraction', 'text-to-speech']);
    expect(plan.models[1]).toMatchObject({ model: 'onnx-community/Qwen2.5-1.5B-Instruct', dtype: 'q4f16' });
    expect(plan.extraUrls).toEqual(['https://huggingface.co/onnx-community/Supertonic-TTS-ONNX/resolve/main/voices/F1.bin']);
  });

  it('uses 32-bit weights when f16 is unavailable or turned off', () => {
    expect(offlinePlan(DEFAULT_SETTINGS, false).models[1]?.dtype).toBe('q4');
    expect(offlinePlan({ ...DEFAULT_SETTINGS, f16: false }, true).models[1]?.dtype).toBe('q4');
  });

  it('skips the neural voice when the built-in voice is chosen', () => {
    const plan = offlinePlan({ ...DEFAULT_SETTINGS, tts: 'web-speech' }, true);
    expect(plan.models.some((m) => m.task === 'text-to-speech')).toBe(false);
    expect(plan.extraUrls).toEqual([]);
  });
});

describe('cacheNameFor', () => {
  it('puts voice styles in Loom’s own cache and everything else in Transformers.js’s', () => {
    expect(cacheNameFor('https://huggingface.co/x/resolve/main/voices/F1.bin')).toBe('loom-voices');
    expect(cacheNameFor('https://huggingface.co/x/resolve/main/onnx/model.onnx')).toBe('transformers-cache');
    expect(cacheNameFor('https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/x.wasm')).toBe('transformers-cache');
  });
});
