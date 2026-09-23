import type { LoadProgress } from '../pipeline/types';

/**
 * The subset of Transformers.js `ProgressInfo` events we care about.
 * Declared locally so main-thread code doesn't import the library.
 */
export type ModelProgressEvent =
  | { status: 'initiate' | 'download' | 'done'; file: string }
  | { status: 'progress'; file: string; loaded: number; total: number }
  | { status: 'progress_total'; loaded: number; total: number }
  | { status: 'ready' };

/**
 * Aggregates per-file download events into one progress value for a stage.
 * Files are fetched in parallel, so we sum bytes across all of them.
 */
export const PHASE_DOWNLOADING = 'Downloading';
export const PHASE_FROM_CACHE = 'Loading from cache';

export class ProgressTracker {
  private files = new Map<string, { loaded: number; total: number }>();
  private phase = PHASE_DOWNLOADING;

  update(event: ModelProgressEvent): LoadProgress {
    if (event.status === 'progress') {
      this.files.set(event.file, { loaded: event.loaded, total: event.total });
    } else if (event.status === 'done' && 'file' in event) {
      const f = this.files.get(event.file);
      if (f) f.loaded = f.total;
    }
    return this.snapshot();
  }

  /** Current progress; passing a phase makes it the phase for later updates too. */
  snapshot(phase?: string): LoadProgress {
    if (phase) this.phase = phase;
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    return {
      fraction: total > 0 ? Math.min(1, loaded / total) : null,
      loadedBytes: loaded,
      totalBytes: total,
      phase: this.phase,
    };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
