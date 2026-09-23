/** Silero VAD works on 512-sample frames at 16 kHz (32 ms each). */
export const VAD_FRAME = 512;
const FRAME_MS = (VAD_FRAME / 16_000) * 1000;
const frames = (ms: number) => Math.round(ms / FRAME_MS);

export interface VadThresholds {
  /** Probability at or above which a frame counts as speech. */
  positive: number;
  /** Probability below which a frame counts as silence (in between: neither). */
  negative: number;
  /** Speech must last this long before we treat it as the user talking. */
  minSpeechFrames: number;
}

/** Normal listening. */
export const RELAXED: VadThresholds = { positive: 0.5, negative: 0.35, minSpeechFrames: frames(200) };
/**
 * While Loom is talking: the mic may pick up Loom's own voice through the
 * speakers, so only clear, sustained speech counts as the user cutting in.
 */
export const STRICT: VadThresholds = { positive: 0.85, negative: 0.5, minSpeechFrames: frames(450) };

/** This much silence ends an utterance; long enough for a natural pause. */
const REDEMPTION_FRAMES = frames(800);
/** Audio kept from just before speech was detected, so first syllables aren't clipped. */
const PRE_SPEECH_FRAMES = frames(300);
/** Hard cap on one utterance (Whisper handles 30 s windows). */
const MAX_FRAMES = frames(28_000);

export type VadEvent = { type: 'start' } | { type: 'end'; audio: Float32Array };

/**
 * Turns per-frame speech probabilities into utterances:
 * "start" once speech is confirmed, "end" with the audio after a pause.
 * Blips shorter than `minSpeechFrames` (coughs, clicks) are dropped silently.
 */
export class VadSegmenter {
  private thresholds: VadThresholds = RELAXED;
  private pre: Float32Array[] = [];
  private utterance: Float32Array[] | null = null;
  private speechFrames = 0;
  private silentFrames = 0;
  private confirmed = false;

  setThresholds(t: VadThresholds): void {
    this.thresholds = t;
  }

  process(frame: Float32Array, probability: number): VadEvent[] {
    const { positive, negative, minSpeechFrames } = this.thresholds;
    const events: VadEvent[] = [];

    if (!this.utterance) {
      if (probability >= positive) {
        this.utterance = [...this.pre, frame];
        this.pre = [];
        this.speechFrames = 1;
        this.silentFrames = 0;
        this.confirmed = false;
      } else {
        this.pre.push(frame);
        if (this.pre.length > PRE_SPEECH_FRAMES) this.pre.shift();
        return events;
      }
    } else {
      this.utterance.push(frame);
      if (probability >= positive) {
        this.speechFrames++;
        this.silentFrames = 0;
      } else if (probability < negative) {
        this.silentFrames++;
      }
    }

    if (!this.confirmed && this.speechFrames >= minSpeechFrames) {
      this.confirmed = true;
      events.push({ type: 'start' });
    }

    const paused = this.silentFrames >= REDEMPTION_FRAMES;
    if (paused || this.utterance.length >= MAX_FRAMES) {
      if (this.confirmed) {
        // Trim most of the trailing silence; keep a little so words aren't cut off.
        const keep = this.utterance.length - Math.max(0, this.silentFrames - frames(200));
        events.push({ type: 'end', audio: join(this.utterance.slice(0, keep)) });
      }
      this.reset();
    }
    return events;
  }

  reset(): void {
    this.utterance = null;
    this.pre = [];
    this.speechFrames = 0;
    this.silentFrames = 0;
    this.confirmed = false;
  }
}

function join(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.length * VAD_FRAME);
  chunks.forEach((c, i) => out.set(c, i * VAD_FRAME));
  return out;
}
