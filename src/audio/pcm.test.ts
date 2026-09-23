import { describe, expect, it } from 'vitest';
import { concatChunks, isLikelySilence, rms } from './pcm';

describe('pcm helpers', () => {
  it('concatenates chunks in order', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([]), new Float32Array([3])]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('computes RMS', () => {
    expect(rms(new Float32Array([]))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('flags short or quiet recordings as silence', () => {
    const rate = 16_000;
    expect(isLikelySilence(new Float32Array(rate * 0.1).fill(0.3), rate)).toBe(true);
    expect(isLikelySilence(new Float32Array(rate).fill(0.001), rate)).toBe(true);
    expect(isLikelySilence(new Float32Array(rate).fill(0.1), rate)).toBe(false);
  });
});
