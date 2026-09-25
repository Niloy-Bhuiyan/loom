import type { SttPreset } from '../config/models';
import type { ProgressListener, SpeechToText } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import type { WhisperConfig } from './whisper.worker';

/** Whisper via Transformers.js on WebGPU, running in its own worker. */
export class WhisperSTT implements SpeechToText {
  private client = new WorkerClient<WhisperConfig, Float32Array, string>(
    new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'loom-stt' }),
  );

  constructor(private preset: SttPreset) {}

  async load(onProgress: ProgressListener): Promise<void> {
    await this.client.load({ model: this.preset.model, dtype: this.preset.dtype }, onProgress);
  }

  async transcribe(audio: Float32Array, signal?: AbortSignal): Promise<string> {
    return cleanTranscript(await this.client.run(audio, undefined, signal));
  }

  dispose(): void {
    this.client.terminate();
  }
}

/**
 * Whisper marks non-speech with tags like "[BLANK_AUDIO]" or "(music)", and
 * on near-silence tends to hallucinate a lone "you" or "Thank you.".
 */
export function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(you|thank you|thanks for watching)[.!]?$/i.test(cleaned) ? '' : cleaned;
}
