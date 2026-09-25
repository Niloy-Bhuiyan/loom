import type { ModelProgressEvent } from '../core/progress';
import { errorMessage } from '../core/errors';
import { CANCELLED, type FromWorker, type ToWorker } from './protocol';

export interface LoadContext {
  progress(event: ModelProgressEvent): void;
  phase(phase: string): void;
}

export interface RunContext<Partial> {
  partial(data: Partial): void;
}

export interface RunOutput<Res> {
  result: Res;
  transfer?: Transferable[];
}

export interface WorkerHandlers<Config, Req, Res, Partial> {
  /** Load the model; resolve with the device it ended up on. */
  load(config: Config, ctx: LoadContext): Promise<string>;
  run(req: Req, ctx: RunContext<Partial>): Promise<RunOutput<Res>>;
  interrupt?(): void;
}

/** Wire a worker's handlers to the shared message protocol. Runs are processed one at a time. */
export function serveWorker<Config, Req, Res, Partial>(handlers: WorkerHandlers<Config, Req, Res, Partial>): void {
  // The project compiles against the DOM lib, so describe the bits of the worker scope we use.
  const scope = self as unknown as {
    postMessage(message: unknown, transfer: Transferable[]): void;
    addEventListener(type: 'message', listener: (e: MessageEvent<ToWorker<Config, Req>>) => void): void;
  };
  const send = (msg: FromWorker<Res, Partial>, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

  // Inference sessions are not re-entrant, so queue runs behind each other.
  let queue: Promise<void> = Promise.resolve();
  // Runs the client no longer wants; skipped if they haven't started yet.
  const cancelled = new Set<number>();

  scope.addEventListener('message', (e: MessageEvent<ToWorker<Config, Req>>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'load':
        handlers
          .load(msg.config, {
            progress: (event) => send({ type: 'progress', event }),
            phase: (phase) => send({ type: 'phase', phase }),
          })
          .then((device) => send({ type: 'ready', device }))
          .catch((err: unknown) => send({ type: 'load-error', message: errorMessage(err) }));
        break;
      case 'run': {
        const { id, req } = msg;
        queue = queue.then(() => {
          if (cancelled.delete(id)) return send({ type: 'error', id, message: CANCELLED });
          return handlers
            .run(req, { partial: (data) => send({ type: 'partial', id, data }) })
            .then(({ result, transfer }) => send({ type: 'result', id, data: result }, transfer))
            .catch((err: unknown) => send({ type: 'error', id, message: errorMessage(err) }));
        });
        break;
      }
      case 'cancel':
        cancelled.add(msg.id);
        break;
      case 'interrupt':
        handlers.interrupt?.();
        break;
    }
  });
}
