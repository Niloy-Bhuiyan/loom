export type WaveMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface WaveSources {
  /** Live microphone analyser while recording. */
  mic(): AnalyserNode | null;
  /** Loudness of Loom's own voice, 0..1 (may be unavailable for some TTS engines). */
  output(): number | null;
}

const BARS = 72;
const COLORS: Record<WaveMode, string> = {
  idle: '124, 240, 197',
  listening: '255, 122, 138',
  thinking: '167, 139, 250',
  speaking: '167, 139, 250',
};

/** A radial audio visualiser drawn around the talk button. */
export class Waveform {
  private ctx: CanvasRenderingContext2D;
  private mode: WaveMode = 'idle';
  private levels = new Float32Array(BARS);
  private freq = new Uint8Array(512);
  private raf = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private button: HTMLElement,
    private sources: WaveSources,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  setMode(mode: WaveMode): void {
    this.mode = mode;
  }

  start(): void {
    const frame = (t: number) => {
      this.draw(t / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private targets(time: number): Float32Array {
    const out = new Float32Array(BARS);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    switch (this.mode) {
      case 'listening': {
        const analyser = this.sources.mic();
        if (!analyser) break;
        analyser.getByteFrequencyData(this.freq);
        // Speech lives in the lower bins; mirror them so the ring is symmetric.
        const usable = Math.min(this.freq.length, analyser.frequencyBinCount) * 0.35;
        for (let i = 0; i < BARS; i++) {
          const mirrored = i < BARS / 2 ? i : BARS - 1 - i;
          const bin = Math.floor((mirrored / (BARS / 2)) * usable);
          out[i] = (this.freq[bin] ?? 0) / 255;
        }
        break;
      }
      case 'speaking': {
        const level = this.sources.output() ?? 0.35 + 0.25 * Math.sin(time * 6);
        for (let i = 0; i < BARS; i++) {
          const wobble = 0.55 + 0.45 * Math.sin(i * 0.7 + time * 9) * Math.sin(i * 0.23 - time * 4);
          out[i] = Math.max(0.05, level * wobble);
        }
        break;
      }
      case 'thinking': {
        const head = reduceMotion ? 0 : (time * 1.6) % (Math.PI * 2);
        for (let i = 0; i < BARS; i++) {
          const angle = (i / BARS) * Math.PI * 2;
          const d = Math.atan2(Math.sin(angle - head), Math.cos(angle - head));
          out[i] = 0.08 + 0.6 * Math.exp(-(d * d) / 0.35);
        }
        break;
      }
      case 'idle':
        for (let i = 0; i < BARS; i++) out[i] = 0.06 + (reduceMotion ? 0 : 0.04 * Math.sin(time * 1.5 + i * 0.35));
        break;
    }
    return out;
  }

  private draw(time: number): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const target = this.targets(time);
    const cx = w / 2;
    const cy = hgt / 2;
    const inner = this.button.offsetWidth / 2 + 7;
    const maxLen = Math.max(6, hgt / 2 - inner - 2);
    const color = COLORS[this.mode];

    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < BARS; i++) {
      // Rise fast, fall slowly — looks like a VU meter.
      const current = this.levels[i]!;
      const next = target[i]!;
      this.levels[i] = next > current ? current + (next - current) * 0.5 : current + (next - current) * 0.12;

      const level = this.levels[i]!;
      const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
      const len = 2 + level * maxLen;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.strokeStyle = `rgba(${color}, ${0.25 + level * 0.75})`;
      ctx.beginPath();
      ctx.moveTo(cx + cos * inner, cy + sin * inner);
      ctx.lineTo(cx + cos * (inner + len), cy + sin * (inner + len));
      ctx.stroke();
    }
  }
}
