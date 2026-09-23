import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('returns defaults for missing or malformed input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps known values', () => {
    const s = parseSettings({ stt: 'whisper-tiny.en', llm: 'qwen2.5-0.5b', tts: 'web-speech', voice: 'M2' });
    expect(s).toEqual({ stt: 'whisper-tiny.en', llm: 'qwen2.5-0.5b', tts: 'web-speech', voice: 'M2' });
  });

  it('replaces unknown values individually', () => {
    const s = parseSettings({ stt: 'whisper-huge', llm: 'qwen2.5-0.5b', tts: 42, voice: 'Z9' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, llm: 'qwen2.5-0.5b' });
  });
});
