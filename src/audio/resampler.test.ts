import { describe, expect, it } from 'vitest';
import { StreamingResampler } from './resampler';

function sine(length: number, rate: number, freq: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * freq * i) / rate));
}

function pushInChunks(r: StreamingResampler, input: Float32Array, chunk: number): Float32Array {
  const parts: number[] = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(...r.push(input.subarray(i, i + chunk)));
  return Float32Array.from(parts);
}

describe('StreamingResampler', () => {
  it('passes audio through unchanged at the same rate', () => {
    const input = Float32Array.from([0.1, 0.2, 0.3]);
    expect(Array.from(new StreamingResampler(16_000, 16_000).push(input))).toEqual(Array.from(input));
  });

  it('downsamples 48 kHz to 16 kHz by averaging groups of three', () => {
    const out = new StreamingResampler(48_000, 16_000).push(Float32Array.from([1, 2, 3, 4, 5, 6]));
    expect(Array.from(out)).toEqual([2, 5]);
  });

  it('produces the right number of samples for non-integer ratios', () => {
    const second = new Float32Array(44_100);
    const out = new StreamingResampler(44_100, 16_000).push(second);
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
  });

  it('gives the same result regardless of chunk size', () => {
    const input = sine(48_000, 48_000, 440);
    const whole = new StreamingResampler(48_000, 16_000).push(input);
    const chunked = pushInChunks(new StreamingResampler(48_000, 16_000), input, 128);
    expect(chunked.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(chunked[i]).toBeCloseTo(whole[i]!, 6);
  });

  it('keeps a speech-band tone intact', () => {
    const out = new StreamingResampler(48_000, 16_000).push(sine(48_000, 48_000, 300));
    const peak = Math.max(...Array.from(out.subarray(100)).map(Math.abs));
    expect(peak).toBeGreaterThan(0.95);
  });
});
