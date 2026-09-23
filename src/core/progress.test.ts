import { describe, expect, it } from 'vitest';
import { formatBytes, ProgressTracker } from './progress';

describe('ProgressTracker', () => {
  it('starts with unknown progress', () => {
    expect(new ProgressTracker().snapshot()).toEqual({ fraction: null, loadedBytes: 0, totalBytes: 0, phase: 'Downloading' });
  });

  it('sums bytes across files downloading in parallel', () => {
    const t = new ProgressTracker();
    t.update({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 });
    const p = t.update({ status: 'progress', file: 'b.onnx', loaded: 0, total: 300 });
    expect(p.loadedBytes).toBe(50);
    expect(p.totalBytes).toBe(400);
    expect(p.fraction).toBeCloseTo(0.125);
  });

  it('treats a done file as fully loaded', () => {
    const t = new ProgressTracker();
    t.update({ status: 'progress', file: 'a.onnx', loaded: 10, total: 100 });
    expect(t.update({ status: 'done', file: 'a.onnx' }).fraction).toBe(1);
  });

  it('ignores unrelated events', () => {
    const t = new ProgressTracker();
    expect(t.update({ status: 'initiate', file: 'x' }).fraction).toBeNull();
    expect(t.update({ status: 'ready' }).fraction).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB');
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
  });
});
