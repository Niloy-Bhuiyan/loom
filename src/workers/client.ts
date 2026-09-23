import { ProgressTracker } from '../core/progress';
import type { ProgressListener } from '../pipeline/types';
import type { FromWorker, ToWorker } from './protocol';

interface Pending<Res, Partial> {
  resolve(value: Res): void;
  reject(reason: Error): void;
  onPartial?: (data: Partial) => void;
}

/** Main-thread side of the worker protocol: promise-based load/run with progress. */
export class WorkerClient<Config, Req, Res, Partial = never> {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending<Res, Partial>>();
  private loading: { resolve(device: string): void; reject(reason: Error): void; onProgress: ProgressListener } | null = null;
  private tracker = new ProgressTracker();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', (e: MessageEvent<FromWorker<Res, Partial>>) => this.handle(e.data));
    this.worker.addEventListener('error', (e) => this.failAll(new Error(e.message || 'Worker crashed')));
  }

  /** Load the model in the worker; resolves with the device it runs on. */
  load(config: Config, onProgress: ProgressListener): Promise<string> {
    return new Promise((resolve, reject) => {
      this.loading = { resolve, reject, onProgress };
      this.post({ type: 'load', config });
    });
  }

  run(req: Req, onPartial?: (data: Partial) => void): Promise<Res> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onPartial });
      this.post({ type: 'run', id, req });
    });
  }

  interrupt(): void {
    this.post({ type: 'interrupt' });
  }

  terminate(): void {
    this.worker.terminate();
    this.failAll(new Error('Worker terminated'));
  }

  private post(msg: ToWorker<Config, Req>): void {
    this.worker.postMessage(msg);
  }

  private handle(msg: FromWorker<Res, Partial>): void {
    switch (msg.type) {
      case 'progress':
        this.loading?.onProgress(this.tracker.update(msg.event));
        break;
      case 'phase':
        this.loading?.onProgress(this.tracker.snapshot(msg.phase));
        break;
      case 'ready':
        this.loading?.resolve(msg.device);
        this.loading = null;
        break;
      case 'load-error':
        this.loading?.reject(new Error(msg.message));
        this.loading = null;
        break;
      case 'partial':
        this.pending.get(msg.id)?.onPartial?.(msg.data);
        break;
      case 'result':
        this.pending.get(msg.id)?.resolve(msg.data);
        this.pending.delete(msg.id);
        break;
      case 'error':
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
        break;
    }
  }

  private failAll(error: Error): void {
    this.loading?.reject(error);
    this.loading = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
