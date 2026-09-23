import { PcmPlayer } from '../audio/player';
import { SUPERTONIC_MODEL } from '../config/models';
import type { ProgressListener, TextToSpeech } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import type { SupertonicAudio, SupertonicConfig, SupertonicRequest } from './supertonic.worker';

/** Neural TTS (Supertonic) running locally via Transformers.js; the default voice. */
export class SupertonicTTS implements TextToSpeech {
  private client = new WorkerClient<SupertonicConfig, SupertonicRequest, SupertonicAudio>(
    new Worker(new URL('./supertonic.worker.ts', import.meta.url), { type: 'module', name: 'loom-tts' }),
  );
  private player = new PcmPlayer();
  /** Bumped by stop() so audio synthesized for a cancelled reply is dropped. */
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(public voice: string) {}

  async load(onProgress: ProgressListener): Promise<void> {
    await this.client.load({ model: SUPERTONIC_MODEL, voice: this.voice }, onProgress);
  }

  speak(text: string): void {
    const generation = this.generation;
    const job = this.client
      .run({ text, voice: this.voice })
      .then(({ audio, sampleRate }) => {
        if (generation === this.generation) this.player.play(audio, sampleRate);
      })
      .catch((err: unknown) => console.warn('[loom] TTS failed for a sentence', err));
    this.tail = this.tail.then(() => job);
  }

  stop(): void {
    this.generation++;
    this.player.stop();
  }

  async drain(): Promise<void> {
    await this.tail;
    await this.player.whenIdle();
  }

  level(): number {
    return this.player.level();
  }

  dispose(): void {
    this.stop();
    this.client.terminate();
  }
}
