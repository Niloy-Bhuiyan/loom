import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk';

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('d', '  \n\n ')).toEqual([]);
  });

  it('keeps short documents in one passage', () => {
    expect(chunkText('d', 'Just a short note.')).toEqual([{ docId: 'd', text: 'Just a short note.' }]);
  });

  it('splits long text into passages near the target size', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const passages = chunkText('d', text, 200, 40);
    expect(passages.length).toBeGreaterThan(5);
    for (const p of passages) expect(p.text.length).toBeLessThanOrEqual(200);
  });

  it('prefers ending passages at sentence boundaries', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Fact ${i} is true.`).join(' ');
    for (const p of chunkText('d', text, 120, 20).slice(0, -1)) expect(p.text.endsWith('.')).toBe(true);
  });

  it('overlaps neighbouring passages so nothing falls between the cracks', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Item ${i} costs ${i * 3} dollars.`).join(' ');
    const [a, b] = chunkText('d', text, 150, 60);
    const tail = a!.text.slice(-25);
    expect(b!.text).toContain(tail.slice(tail.indexOf(' ') + 1));
  });

  it('covers the whole document', () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const joined = chunkText('d', text, 60, 10).map((p) => p.text).join(' ');
    for (let i = 0; i < 50; i++) expect(joined).toContain(`word${i}`);
  });

  it('normalises whitespace and line endings', () => {
    expect(chunkText('d', 'a\r\n\r\n\r\n\r\nb   c')[0]!.text).toBe('a\n\nb c');
  });
});
