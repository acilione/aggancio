import { WorkerClient } from './worker-client';
import { fetchGancio } from './events';
import type { EventRecord, Source } from './types';
import { geography } from './geography-client';

export class SourceWorkers {
  readonly size = typeof Worker === 'undefined' ? 0 : Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  readonly concurrency = this.size ? this.size * 4 : 6;
  private clients = Array.from({ length: this.size }, () => new WorkerClient(() => new Worker(new URL('../workers/source.worker.ts', import.meta.url), { type: 'module', name: 'source-update' })));
  async fetch(source: Source, signal: AbortSignal) {
    const worker = this.size ? this.clients.reduce((a, b) => a.load <= b.load ? a : b) : undefined;
    const result = worker ? await worker.request<{ events: EventRecord[]; limited: boolean }>('fetch', source, signal) : await fetchGancio(source, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { ...result, events: await geography.enrich(result.events, source) };
  }
  dispose() { this.clients.forEach(client => client.dispose()); }
}
