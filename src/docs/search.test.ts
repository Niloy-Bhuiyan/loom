import { describe, expect, it } from 'vitest';
import { dot, formatContext, keywordScore, topMatches, type IndexedPassage } from './search';

const unit = (...v: number[]) => {
  const len = Math.hypot(...v);
  return Float32Array.from(v.map((x) => x / len));
};
const passage = (text: string, vector: Float32Array, docId = 'd1'): IndexedPassage => ({ docId, text, vector });

describe('dot', () => {
  it('computes the dot product', () => {
    expect(dot(Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6]))).toBe(32);
  });
});

describe('keywordScore', () => {
  it('counts meaningful query words found in the text', () => {
    expect(keywordScore('What is the wifi password?', 'Free wifi password: river123.')).toBe(1);
    expect(keywordScore('wifi speed', 'Free wifi here')).toBe(0.5);
  });

  it('ignores stopwords and case', () => {
    expect(keywordScore('What is THE Soup', 'soup of the day')).toBe(1);
    expect(keywordScore('what is the', 'anything')).toBe(0);
  });
});

describe('topMatches', () => {
  const index = [passage('cats purr', unit(1, 0, 0)), passage('dogs bark', unit(0.8, 0.6, 0)), passage('cars honk', unit(0, 0, 1))];

  it('ranks by meaning', () => {
    expect(topMatches(unit(1, 0.1, 0), 'pets', index, 2).map((m) => m.passage.text)).toEqual(['cats purr', 'dogs bark']);
  });

  it('lets exact keywords rescue a passage the embedding misses', () => {
    // The embedding slightly prefers "cats" (as with the mixed-topic passages seen in practice)…
    const top = topMatches(unit(1, 0, 0.8), 'why do cars honk', index, 1)[0];
    expect(top?.passage.text).toBe('cars honk');
  });

  it('always returns the best passage, but filters weak extras', () => {
    const matches = topMatches(unit(0, 0.2, -1), 'unrelated', index, 3);
    expect(matches).toHaveLength(1);
  });

  it('returns nothing for an empty index', () => {
    expect(topMatches(unit(1, 0, 0), 'x', [], 3)).toEqual([]);
  });
});

describe('formatContext', () => {
  const names = new Map([['d1', 'report.pdf']]);

  it('labels each excerpt with its document', () => {
    const text = formatContext([{ passage: passage('Revenue grew 12%.', unit(1)), score: 0.9 }], names);
    expect(text).toBe('[From “report.pdf”]\nRevenue grew 12%.');
  });

  it('respects the character budget but always includes the best match', () => {
    const long = 'x'.repeat(300);
    const matches = [1, 2, 3].map((i) => ({ passage: passage(`${i}${long}`, unit(1)), score: 1 - i / 10 }));
    const text = formatContext(matches, names, 500);
    expect(text).toContain(`1${long}`);
    expect(text).not.toContain(`2${long}`);
  });
});
