import { WorkerClient } from './worker-client';
import { fetchGancio } from './events';
import type { EventRecord, Source } from './types';

export class SourceWorkers {
  readonly size = typeof Worker === 'undefined' ? 0 : Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  readonly concurrency = this.size ? this.size * 4 : 6;
  private clients = Array.from({ length: this.size }, () => new WorkerClient(() => new Worker(new URL('../workers/source.worker.ts', import.meta.url), { type: 'module', name: 'source-update' })));
  fetch(source: Source, signal: AbortSignal) {
    if (!this.size) return fetchGancio(source, signal);
    const worker = this.clients.reduce((a, b) => a.load <= b.load ? a : b);
    return worker.request<{ events: EventRecord[]; limited: boolean }>('fetch', source, signal);
  }
  dispose() { this.clients.forEach(client => client.dispose()); }
}
