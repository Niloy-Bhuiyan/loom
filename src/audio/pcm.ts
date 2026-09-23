/** Whisper expects 16 kHz mono. */
export const WHISPER_SAMPLE_RATE = 16_000;

export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Root-mean-square amplitude, 0..1. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

/**
 * Too short or too quiet to be worth transcribing? Whisper hallucinates on
 * silence, so it's better not to send it at all.
 */
export function isLikelySilence(samples: Float32Array, sampleRate: number): boolean {
  return samples.length < sampleRate * 0.3 || rms(samples) < 0.004;
}

/** Resample mono audio with the browser's own (high quality) resampler. */
export async function resample(samples: Float32Array, fromRate: number, toRate = WHISPER_SAMPLE_RATE): Promise<Float32Array> {
  if (fromRate === toRate || samples.length === 0) return samples;
  const length = Math.ceil((samples.length * toRate) / fromRate);
  const offline = new OfflineAudioContext(1, length, toRate);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}
