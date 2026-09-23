import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { ModelProgressEvent } from '../core/progress';
import { serveWorker } from '../workers/host';

export interface WhisperConfig {
  model: string;
  dtype: Record<string, string>;
}

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

serveWorker<WhisperConfig, Float32Array, string, never>({
  async load({ model, dtype }, ctx) {
    transcriber = (await pipeline('automatic-speech-recognition', model, {
      device: 'webgpu',
      dtype: dtype as never,
      progress_callback: (info) => ctx.progress(info as ModelProgressEvent),
    })) as AutomaticSpeechRecognitionPipeline;

    // The first WebGPU run compiles shaders; do it now rather than on the user's first sentence.
    ctx.phase('Warming up GPU');
    await transcriber(new Float32Array(16_000));
    return 'webgpu';
  },

  async run(audio) {
    if (!transcriber) throw new Error('Speech recognition model is not loaded');
    const output = await transcriber(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text;
    return { result: text };
  },
});
