import type { ModelProgressEvent } from '../core/progress';

/**
 * One tiny message protocol shared by the STT, LLM and TTS workers, so each
 * worker only has to implement `load` and `run`.
 */

export type ToWorker<Config, Req> =
  | { type: 'load'; config: Config }
  | { type: 'run'; id: number; req: Req }
  /** Drop a queued run that hasn't started (e.g. a transcription made stale by a newer one). */
  | { type: 'cancel'; id: number }
  | { type: 'interrupt' };

/** Error message for a run cancelled before it started. */
export const CANCELLED = 'Cancelled';

export type FromWorker<Res, Partial> =
  | { type: 'progress'; event: ModelProgressEvent }
  | { type: 'phase'; phase: string }
  | { type: 'ready'; device: string }
  | { type: 'load-error'; message: string }
  | { type: 'partial'; id: number; data: Partial }
  | { type: 'result'; id: number; data: Res }
  | { type: 'error'; id: number; message: string };
