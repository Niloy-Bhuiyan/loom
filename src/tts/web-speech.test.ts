import { describe, expect, it } from 'vitest';
import { pickLocalVoice } from './web-speech';

const voice = (name: string, lang: string, localService: boolean, isDefault = false) =>
  ({ name, lang, localService, default: isDefault, voiceURI: name }) as SpeechSynthesisVoice;

describe('pickLocalVoice', () => {
  it('never picks a cloud voice', () => {
    expect(pickLocalVoice([voice('Google US English', 'en-US', false)])).toBeNull();
  });

  it('prefers the default local English voice', () => {
    const picked = pickLocalVoice([
      voice('Cloud', 'en-US', false, true),
      voice('Local A', 'en-GB', true),
      voice('Local B', 'en-US', true, true),
    ]);
    expect(picked?.name).toBe('Local B');
  });

  it('falls back to any local voice', () => {
    expect(pickLocalVoice([voice('Anna', 'de-DE', true)])?.name).toBe('Anna');
  });
});
