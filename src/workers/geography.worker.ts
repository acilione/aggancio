import { countryBounds, enrichLocation, resolveCity, searchCities, sourceLocation } from '../lib/geography-index';
import type { EventRecord, Source } from '../lib/types';
self.onmessage = ({ data: { id, method, payload } }) => {
  if (method === 'cancel') return;
  try {
    let result;
    if (method === 'search') result = searchCities(payload.query, payload.country);
    else if (method === 'resolve') result = resolveCity(payload.city, payload.country);
    else if (method === 'bounds') result = countryBounds(payload);
    else if (method === 'sources') result = payload.map((source: Source) => sourceLocation(source)).filter(Boolean);
    else {
      const sources = new Map<string, Source>((payload.sources || []).map((source: Source) => [source.id, source]));
      result = payload.events.map((event: EventRecord) => enrichLocation(event, payload.source || sources.get(event.sourceId)));
    }
    self.postMessage({ id, result });
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error('Location lookup failed.');
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  }
};
