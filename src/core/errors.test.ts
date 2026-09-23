import { describe, expect, it } from 'vitest';
import { errorMessage, toFriendlyError } from './errors';

describe('toFriendlyError', () => {
  it.each([
    ['Error: Failed to allocate 1073741824 bytes', 'out-of-memory'],
    ['RangeError: Array buffer allocation failed', 'out-of-memory'],
    ['GPU device was lost: out of memory', 'out-of-memory'],
    ['TypeError: Failed to fetch', 'network'],
    ['Could not locate file: "https://huggingface.co/x/config.json"', 'network'],
    ['QuotaExceededError: storage full', 'storage'],
    ['no available backend found. ERR: [webgpu] ...', 'gpu'],
    ['NotAllowedError: Permission denied', 'microphone'],
    ['something odd', 'unknown'],
  ])('classifies %j as %s', (message, kind) => {
    expect(toFriendlyError(new Error(message)).kind).toBe(kind);
  });

  it('suggests a smaller model for memory problems but not for network ones', () => {
    expect(toFriendlyError('out of memory').suggestSmallerModel).toBe(true);
    expect(toFriendlyError('Failed to fetch').suggestSmallerModel).toBe(false);
  });

  it('keeps the raw message for debugging', () => {
    expect(toFriendlyError(new TypeError('boom')).raw).toBe('TypeError: boom');
  });
});

describe('errorMessage', () => {
  it('handles non-Error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});
