import type { MicRecorder } from '../audio/recorder';
import type { FromVad, ToVad } from './vad.worker';

const MODEL_URL = new URL(`${import.meta.env.BASE_URL}models/silero-vad.onnx`, location.href).href;

export interface HandsFreeEvents {
  /** The user has clearly started talking. */
  onSpeechStart(): void;
  /** The user finished a sentence: 16 kHz mono audio. */
  onSpeechEnd(audio: Float32Array): void;
  onError(error: Error): void;
}

/**
 * "Phone call" mode: the mic stays open and Silero VAD decides when you start
 * and stop talking, so there is no button to press.
 */
export class HandsFree {
  private worker: Worker | null = null;

  constructor(
    private recorder: MicRecorder,
    private events: HandsFreeEvents,
  ) {}

  get active(): boolean {
    return this.worker !== null;
  }

  async start(): Promise<void> {
    if (this.worker) return;
    const worker = new Worker(new URL('./vad.worker.ts', import.meta.url), { type: 'module', name: 'loom-vad' });
    this.worker = worker;
    const { port1, port2 } = new MessageChannel();

    try {
      await this.recorder.start(port1);
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        worker.onmessage = (e: MessageEvent<FromVad>) => {
          const msg = e.data;
          if (msg.type === 'ready') {
            ready = true;
            resolve();
          } else if (msg.type === 'speech-start') this.events.onSpeechStart();
          else if (msg.type === 'speech-end') this.events.onSpeechEnd(msg.audio);
          else if (msg.type === 'error') {
            // Before "ready" the caller of start() reports it; afterwards it's a runtime error.
            const error = new Error(msg.message);
            if (ready) this.events.onError(error);
            else reject(error);
          }
        };
        worker.onerror = (e) => reject(new Error(e.message || 'Voice detection failed to start'));
        this.post({ type: 'start', modelUrl: MODEL_URL, sampleRate: this.recorder.sampleRate, audio: port2 }, [port2]);
      });
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    await this.recorder.stop();
  }

  /** While Loom is speaking, require clearer speech so its own voice doesn't trigger a barge-in. */
  setStrict(strict: boolean): void {
    this.post({ type: 'strict', value: strict });
  }

  private post(msg: ToVad, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }
}
