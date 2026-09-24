import { describe, expect, it } from 'vitest';
import { dot, formatContext, topMatches, type IndexedPassage } from './search';

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

describe('topMatches', () => {
  const index = [passage('cats', unit(1, 0, 0)), passage('dogs', unit(0.8, 0.6, 0)), passage('cars', unit(0, 0, 1))];

  it('ranks by similarity', () => {
    expect(topMatches(unit(1, 0.1, 0), index, 2).map((m) => m.passage.text)).toEqual(['cats', 'dogs']);
  });

  it('drops weak matches', () => {
    expect(topMatches(unit(0, 1, 0), index, 3).map((m) => m.passage.text)).toEqual(['dogs']);
  });

  it('returns nothing for an empty index', () => {
    expect(topMatches(unit(1, 0, 0), [], 3)).toEqual([]);
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
