import { describe, expect, it } from 'vitest';
import { SentenceChunker } from './sentences';

function chunkAll(tokens: string[]): string[] {
  const chunker = new SentenceChunker();
  const out = tokens.flatMap((t) => chunker.push(t));
  return [...out, ...chunker.flush()];
}

describe('SentenceChunker', () => {
  it('emits a sentence as soon as the next token starts', () => {
    const chunker = new SentenceChunker();
    expect(chunker.push('Hello there')).toEqual([]);
    expect(chunker.push('.')).toEqual([]);
    expect(chunker.push(' How')).toEqual(['Hello there.']);
    expect(chunker.flush()).toEqual(['How']);
  });

  it('splits on ! ? and newlines', () => {
    expect(chunkAll(['Wow! Really? ', 'Yes.\nNext line'])).toEqual(['Wow!', 'Really?', 'Yes.', 'Next line']);
  });

  it('does not split decimals or common abbreviations', () => {
    expect(chunkAll(['Pi is 3.14 roughly. Ask Dr. Smith, e.g. tomorrow.'])).toEqual([
      'Pi is 3.14 roughly.',
      'Ask Dr. Smith, e.g. tomorrow.',
    ]);
  });

  it('keeps closing quotes with their sentence', () => {
    expect(chunkAll(['She said "hi." Then left.'])).toEqual(['She said "hi."', 'Then left.']);
  });

  it('soft-splits very long runs at a comma', () => {
    const long = 'word '.repeat(30) + 'and then, ' + 'more '.repeat(20);
    const chunker = new SentenceChunker();
    const [first] = chunker.push(long);
    expect(first?.endsWith('and then,')).toBe(true);
  });

  it('returns nothing for whitespace-only input', () => {
    expect(chunkAll(['  ', '\n'])).toEqual([]);
  });
});
