import { pipeline, type TextToAudioPipeline } from '@huggingface/transformers';
import type { ModelProgressEvent } from '../core/progress';
import { serveWorker } from '../workers/host';

export interface SupertonicConfig {
  model: string;
  voice: string;
}

export interface SupertonicRequest {
  text: string;
  voice: string;
}

export interface SupertonicAudio {
  audio: Float32Array;
  sampleRate: number;
}

const VOICE_CACHE = 'loom-voices';

let synthesizer: TextToAudioPipeline | null = null;
let modelId = '';
const voices = new Map<string, Float32Array>();

/**
 * Voice style vectors are tiny files outside Transformers.js's own cache,
 * so cache them ourselves to keep the voice working offline.
 */
async function loadVoice(id: string): Promise<Float32Array> {
  const cached = voices.get(id);
  if (cached) return cached;

  const url = `https://huggingface.co/${modelId}/resolve/main/voices/${id}.bin`;
  const cache = 'caches' in self ? await caches.open(VOICE_CACHE) : null;
  let response = await cache?.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch voice ${id}: HTTP ${response.status}`);
    await cache?.put(url, response.clone());
  }
  const embedding = new Float32Array(await response.arrayBuffer());
  voices.set(id, embedding);
  return embedding;
}

async function synthesize(text: string, voice: string): Promise<SupertonicAudio> {
  if (!synthesizer) throw new Error('Text-to-speech model is not loaded');
  const speaker_embeddings = await loadVoice(voice);
  const output = await synthesizer(text, { speaker_embeddings });
  // RawAudio may be multi-channel; Supertonic is mono.
  const audio = Array.isArray(output.audio) ? output.audio[0]! : output.audio;
  return { audio, sampleRate: output.sampling_rate };
}

serveWorker<SupertonicConfig, SupertonicRequest, SupertonicAudio, never>({
  async load({ model, voice }, ctx) {
    modelId = model;
    synthesizer = (await pipeline('text-to-speech', model, {
      device: 'webgpu',
      progress_callback: (info) => ctx.progress(info as ModelProgressEvent),
    })) as TextToAudioPipeline;

    ctx.phase('Warming up GPU');
    await synthesize('Hello.', voice);
    return 'webgpu';
  },

  async run({ text, voice }) {
    const result = await synthesize(text, voice);
    return { result, transfer: [result.audio.buffer] };
  },
});
