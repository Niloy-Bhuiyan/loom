import { describe, expect, it } from 'vitest';
import { cleanTranscript } from './whisper';

describe('cleanTranscript', () => {
  it('trims ordinary speech', () => {
    expect(cleanTranscript('  What is the capital of France?  ')).toBe('What is the capital of France?');
  });

  it('removes non-speech tags', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript('(music) hello *laughs* there')).toBe('hello there');
  });

  it('drops common silence hallucinations', () => {
    expect(cleanTranscript(' you')).toBe('');
    expect(cleanTranscript('Thank you.')).toBe('');
    expect(cleanTranscript('Thank you for the help.')).toBe('Thank you for the help.');
  });
});
