/**
 * Real-time resampler for a continuous mic stream (e.g. 48 kHz → 16 kHz).
 *
 * Each output sample is the average of the input samples it covers ("area"
 * resampling). The averaging doubles as a simple anti-aliasing filter, which
 * is plenty for speech detection and recognition.
 */
export class StreamingResampler {
  private readonly ratio: number;
  /** Unconsumed input; buf[0] is absolute input index `bufStart`. */
  private buf = new Float32Array(0);
  private bufStart = 0;
  /** Absolute input position where the next output sample's window ends. */
  private nextEnd: number;

  constructor(fromRate: number, toRate: number) {
    this.ratio = fromRate / toRate;
    this.nextEnd = this.ratio;
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice();

    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;

    const available = this.bufStart + this.buf.length;
    const out = new Float32Array(Math.max(0, Math.floor((available - this.nextEnd) / this.ratio) + 1));
    let n = 0;
    while (this.nextEnd <= available) {
      const from = Math.floor(this.nextEnd - this.ratio) - this.bufStart;
      const to = Math.floor(this.nextEnd) - this.bufStart;
      let sum = 0;
      for (let i = from; i < to; i++) sum += this.buf[i]!;
      out[n++] = sum / Math.max(1, to - from);
      this.nextEnd += this.ratio;
    }

    // Keep only what the next window still needs.
    const keepFrom = Math.floor(this.nextEnd - this.ratio);
    this.buf = this.buf.slice(keepFrom - this.bufStart);
    this.bufStart = keepFrom;
    return out.subarray(0, n);
  }
}
