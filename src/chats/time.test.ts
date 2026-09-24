import { describe, expect, it } from 'vitest';
import { timeAgo } from './time';

const now = new Date('2026-06-15T12:00:00').getTime();
const ago = (ms: number) => timeAgo(now - ms, now);

describe('timeAgo', () => {
  it('describes recent times in words', () => {
    expect(ago(20_000)).toBe('just now');
    expect(ago(5 * 60_000)).toBe('5 min ago');
    expect(ago(3 * 3_600_000)).toBe('3 h ago');
    expect(ago(30 * 3_600_000)).toBe('yesterday');
  });

  it('falls back to a short date', () => {
    expect(ago(10 * 86_400_000)).toMatch(/Jun|5/);
  });
});
