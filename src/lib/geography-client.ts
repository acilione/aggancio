import { WorkerClient } from './worker-client';
import type { EventRecord, Source } from './types';
import type { CityLocation } from './location';
const client = new WorkerClient(() => new Worker(new URL('../workers/geography.worker.ts', import.meta.url), { type: 'module', name: 'geography' }));
async function request<T>(method: string, payload: any): Promise<T> {
  if (typeof Worker !== 'undefined') return client.request<T>(method, payload);
  const index = await import('./geography-index');
  if (method === 'search') return index.searchCities(payload.query, payload.country) as T;
  if (method === 'resolve') return index.resolveCity(payload.city, payload.country) as T;
  if (method === 'sources') return payload.map((source: Source) => index.sourceLocation(source)).filter(Boolean) as T;
  const sources = new Map<string, Source>((payload.sources || []).map((source: Source) => [source.id, source]));
  return payload.events.map((event: EventRecord) => index.enrichLocation(event, payload.source || sources.get(event.sourceId))) as T;
}
export const geography = {
  search: (query: string, country: string) => request<CityLocation[]>('search', { query, country }),
  resolve: (city: string, country = '') => request<CityLocation | null>('resolve', { city, country }),
  sources: (sources: Source[]) => request<CityLocation[]>('sources', sources),
  enrich: (events: EventRecord[], source?: Source, sources?: Source[]) => request<EventRecord[]>('enrich', { events, source, sources }),
  dispose: () => client.dispose(),
};
