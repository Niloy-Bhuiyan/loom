/**
 * Gapless playback of PCM chunks (one per synthesized sentence), with an
 * analyser so the UI can visualise the AI's voice.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private nextStart = 0;
  private active = new Set<AudioBufferSourceNode>();
  private idleWaiters: (() => void)[] = [];

  /** Must be called from a user gesture at least once so autoplay policies allow sound. */
  unlock(): void {
    void this.context().resume();
  }

  play(samples: Float32Array, sampleRate: number): void {
    const ctx = this.context();
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);

    // A short gap between sentences sounds more natural than none.
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration + 0.12;

    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      if (this.active.size === 0) this.notifyIdle();
    };
  }

  stop(): void {
    for (const source of this.active) {
      source.onended = null;
      source.stop();
    }
    this.active.clear();
    this.nextStart = 0;
    this.notifyIdle();
  }

  get playing(): boolean {
    return this.active.size > 0;
  }

  whenIdle(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Current output loudness, roughly 0..1. */
  level(): number {
    if (!this.analyser || !this.levelBuf || this.active.size === 0) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.levelBuf = new Float32Array(this.analyser.fftSize);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
