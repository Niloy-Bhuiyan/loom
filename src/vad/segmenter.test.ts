import { describe, expect, it } from 'vitest';
import { RELAXED, STRICT, VAD_FRAME, VadSegmenter, type VadEvent } from './segmenter';

/** Feed a sequence of per-frame probabilities; each frame's samples are filled with its index. */
function feed(seg: VadSegmenter, probs: number[], startIndex = 0): VadEvent[] {
  return probs.flatMap((p, i) => seg.process(new Float32Array(VAD_FRAME).fill(startIndex + i), p));
}

const silence = (n: number) => Array<number>(n).fill(0.01);
const speech = (n: number) => Array<number>(n).fill(0.95);

describe('VadSegmenter', () => {
  it('emits start once speech is confirmed and end after a pause', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, [...silence(20), ...speech(30), ...silence(30)]);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('includes a little audio from before speech was detected', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, [...silence(20), ...speech(30), ...silence(30)]);
    const end = events.find((e) => e.type === 'end') as { audio: Float32Array };
    // Frame 20 is the first speech frame; pre-roll starts earlier.
    expect(end.audio[0]).toBeLessThan(20);
    expect(end.audio[0]).toBeGreaterThan(5);
  });

  it('trims most trailing silence', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, [...speech(30), ...silence(40)]);
    const end = events.find((e) => e.type === 'end') as { audio: Float32Array };
    const lastFrame = end.audio[end.audio.length - 1]!;
    expect(lastFrame).toBeLessThan(30 + 10);
  });

  it('ignores short blips like coughs', () => {
    const seg = new VadSegmenter();
    expect(feed(seg, [...silence(10), ...speech(3), ...silence(40)])).toEqual([]);
  });

  it('keeps one utterance across short pauses', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, [...speech(20), ...silence(10), ...speech(20), ...silence(30)]);
    expect(events.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('needs longer, clearer speech in strict mode', () => {
    const relaxed = new VadSegmenter();
    const strict = new VadSegmenter();
    strict.setThresholds(STRICT);
    const probs = [...Array<number>(10).fill(0.7), ...silence(30)];
    expect(feed(relaxed, probs).map((e) => e.type)).toEqual(['start', 'end']);
    expect(feed(strict, probs)).toEqual([]);
    expect(STRICT.minSpeechFrames).toBeGreaterThan(RELAXED.minSpeechFrames);
  });

  it('ends very long utterances at the cap', () => {
    const seg = new VadSegmenter();
    const events = feed(seg, speech(1000));
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
  });
});
