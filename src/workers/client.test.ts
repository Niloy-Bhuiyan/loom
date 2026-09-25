import { describe, expect, it } from 'vitest';
import { WorkerClient } from './client';
import type { FromWorker, ToWorker } from './protocol';

/** A fake Worker whose "remote side" is driven by the test. */
class FakeWorker extends EventTarget {
  sent: ToWorker<unknown, unknown>[] = [];
  postMessage(msg: ToWorker<unknown, unknown>) {
    this.sent.push(msg);
  }
  reply(msg: FromWorker<unknown, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: msg }));
  }
  terminate() {}
}

function setup() {
  const fake = new FakeWorker();
  const client = new WorkerClient<{ model: string }, string, string, string>(fake as unknown as Worker);
  return { fake, client };
}

describe('WorkerClient', () => {
  it('reports progress and resolves load with the device', async () => {
    const { fake, client } = setup();
    const seen: (number | null)[] = [];
    const loaded = client.load({ model: 'm' }, (p) => seen.push(p.fraction));
    expect(fake.sent[0]).toEqual({ type: 'load', config: { model: 'm' } });

    fake.reply({ type: 'progress', event: { status: 'progress', file: 'a', loaded: 5, total: 10 } });
    fake.reply({ type: 'phase', phase: 'Warming up' });
    fake.reply({ type: 'ready', device: 'webgpu' });

    await expect(loaded).resolves.toBe('webgpu');
    expect(seen).toEqual([0.5, 0.5]);
  });

  it('rejects load on load-error', async () => {
    const { fake, client } = setup();
    const loaded = client.load({ model: 'm' }, () => {});
    fake.reply({ type: 'load-error', message: 'out of memory' });
    await expect(loaded).rejects.toThrow('out of memory');
  });

  it('routes partials and results by request id', async () => {
    const { fake, client } = setup();
    const partialsA: string[] = [];
    const a = client.run('first', (p) => partialsA.push(p));
    const b = client.run('second');

    fake.reply({ type: 'partial', id: 1, data: 'tok' });
    fake.reply({ type: 'result', id: 2, data: 'B' });
    fake.reply({ type: 'result', id: 1, data: 'A' });

    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
    expect(partialsA).toEqual(['tok']);
  });

  it('rejects a run on error', async () => {
    const { fake, client } = setup();
    const run = client.run('x');
    fake.reply({ type: 'error', id: 1, message: 'nope' });
    await expect(run).rejects.toThrow('nope');
  });

  it('cancels a run when its signal aborts, ignoring a late result', async () => {
    const { fake, client } = setup();
    const controller = new AbortController();
    const run = client.run('stale', undefined, controller.signal);
    controller.abort();

    await expect(run).rejects.toThrow('Aborted');
    expect(fake.sent.at(-1)).toEqual({ type: 'cancel', id: 1 });
    expect(() => fake.reply({ type: 'result', id: 1, data: 'late' })).not.toThrow();
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const { fake, client } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(client.run('x', undefined, controller.signal)).rejects.toThrow('Aborted');
    expect(fake.sent).toEqual([]);
  });

  it('fails everything in flight when terminated', async () => {
    const { client } = setup();
    const run = client.run('x');
    client.terminate();
    await expect(run).rejects.toThrow('terminated');
  });
});
