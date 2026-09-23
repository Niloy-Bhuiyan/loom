import * as ort from 'onnxruntime-web/wasm';
import { StreamingResampler } from '../audio/resampler';
import { errorMessage } from '../core/errors';
import { RELAXED, STRICT, VAD_FRAME, VadSegmenter } from './segmenter';

export type ToVad =
  | { type: 'start'; modelUrl: string; sampleRate: number; audio: MessagePort }
  | { type: 'strict'; value: boolean };

export type FromVad =
  | { type: 'ready' }
  | { type: 'speech-start' }
  | { type: 'speech-end'; audio: Float32Array }
  | { type: 'error'; message: string };

/** Silero v5 expects the last 64 samples of the previous frame prepended to each frame. */
const CONTEXT = 64;

const scope = self as unknown as {
  postMessage(message: FromVad, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<ToVad>) => void): void;
};

const segmenter = new VadSegmenter();
let session: ort.InferenceSession | null = null;
let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
const sr = new ort.Tensor('int64', BigInt64Array.from([16_000n]), []);
let context = new Float32Array(CONTEXT);

let resampler: StreamingResampler | null = null;
let pending = new Float32Array(0);
/** Frames are processed strictly in order, one inference at a time. */
let chain: Promise<void> = Promise.resolve();

async function probability(frame: Float32Array): Promise<number> {
  const input = new Float32Array(CONTEXT + VAD_FRAME);
  input.set(context);
  input.set(frame, CONTEXT);
  const out = await session!.run({ input: new ort.Tensor('float32', input, [1, input.length]), state, sr });
  state = out.stateN!;
  context = frame.slice(-CONTEXT);
  return (out.output!.data as Float32Array)[0]!;
}

function onAudio(chunk: Float32Array): void {
  if (!resampler || !session) return;
  const resampled = resampler.push(chunk);
  const merged = new Float32Array(pending.length + resampled.length);
  merged.set(pending);
  merged.set(resampled, pending.length);

  let offset = 0;
  for (; offset + VAD_FRAME <= merged.length; offset += VAD_FRAME) {
    const frame = merged.slice(offset, offset + VAD_FRAME);
    chain = chain.then(async () => {
      for (const event of segmenter.process(frame, await probability(frame))) {
        if (event.type === 'start') scope.postMessage({ type: 'speech-start' });
        else scope.postMessage({ type: 'speech-end', audio: event.audio }, [event.audio.buffer]);
      }
    });
  }
  pending = merged.slice(offset);
  chain = chain.catch((err: unknown) => scope.postMessage({ type: 'error', message: errorMessage(err) }));
}

scope.addEventListener('message', async (e) => {
  const msg = e.data;
  if (msg.type === 'strict') {
    segmenter.setThresholds(msg.value ? STRICT : RELAXED);
    return;
  }
  try {
    // A tiny model: plain single-threaded WASM is plenty and leaves the GPU to the big models.
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(msg.modelUrl, { executionProviders: ['wasm'] });
    resampler = new StreamingResampler(msg.sampleRate, 16_000);
    msg.audio.onmessage = (ev: MessageEvent<Float32Array>) => onAudio(ev.data);
    scope.postMessage({ type: 'ready' });
  } catch (err) {
    scope.postMessage({ type: 'error', message: errorMessage(err) });
  }
});
