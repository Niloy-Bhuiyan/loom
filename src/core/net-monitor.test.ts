import { describe, expect, it, vi } from 'vitest';
import { NetMonitor } from './net-monitor';

type Recorder = { record(url: string, at: number): void };

describe('NetMonitor', () => {
  it('only counts network requests made after Loom became ready', () => {
    const monitor = new NetMonitor();
    const recorder = monitor as unknown as Recorder;
    recorder.record('https://huggingface.co/model.onnx', Date.now()); // model download, before ready
    monitor.markReady();
    recorder.record('blob:http://localhost/abc', Date.now() + 1); // local
    recorder.record('data:text/plain,hi', Date.now() + 1); // local
    expect(monitor.sinceReady).toEqual([]);

    recorder.record('https://example.com/track', Date.now() + 5);
    expect(monitor.sinceReady.map((r) => r.url)).toEqual(['https://example.com/track']);
  });

  it('notifies listeners', () => {
    const monitor = new NetMonitor();
    const listener = vi.fn();
    monitor.onChange(listener);
    monitor.markReady();
    (monitor as unknown as Recorder).record('https://x.test/', Date.now() + 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
