import { describe, expect, it, vi } from 'vitest';
import { WorkerClient } from './worker-client';

class FakeWorker {
  sent: any[] = [];
  onmessage?: (event: { data: any }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage(data: any) { this.sent.push(data); }
  answer(id: number, result: unknown) { this.onmessage?.({ data: { id, result } }); }
}
describe('background task lifecycle', () => {
  it('matches out-of-order responses to their own callers', async () => {
    const worker = new FakeWorker(); const client = new WorkerClient(() => worker as unknown as Worker);
    const a = client.request('fetch', 'a'); const b = client.request('fetch', 'b');
    worker.answer(worker.sent[1].id, 'second'); worker.answer(worker.sent[0].id, 'first');
    expect(await Promise.all([a, b])).toEqual(['first', 'second']);
    expect(client.load).toBe(0); client.dispose();
  });
  it('cancels one source without losing unrelated in-flight sources', async () => {
    const worker = new FakeWorker(); const client = new WorkerClient(() => worker as unknown as Worker);
    const controller = new AbortController();
    const cancelled = client.request('fetch', 'a', controller.signal).catch(error => error.name);
    const other = client.request('fetch', 'b');
    controller.abort();
    expect(worker.sent.at(-1).method).toBe('cancel');
    worker.answer(worker.sent[0].id, 'late result'); worker.answer(worker.sent[1].id, 'remaining source');
    expect(await cancelled).toBe('AbortError'); expect(await other).toBe('remaining source');
    expect(client.load).toBe(0); client.dispose();
  });
  it('rejects pending jobs on a crash and starts a fresh worker on retry', async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; });
    const failed = client.request('fetch', 'a').catch(error => error.message);
    workers[0].onerror?.();
    expect(await failed).toContain('failed'); expect(workers[0].terminate).toHaveBeenCalledOnce();
    const retry = client.request('fetch', 'a'); workers[1].answer(workers[1].sent[0].id, 'recovered');
    expect(await retry).toBe('recovered'); client.dispose();
  });
});
