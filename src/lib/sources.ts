import catalogue from '../data/gancio-sources.json';
import type { Source } from './types';

export const catalogueCheckedAt = catalogue.checkedAt;
export const defaultSources = catalogue.sources as Source[];
const legacyUrls = ['https://gancio.cisti.org', 'https://demo.gancio.org'];
function key(url: string) { return new URL(url).origin.toLowerCase(); }
function urls(source: Source) { return [source.url, ...(source.aliases || [])].map(key); }

// A separate seen list makes catalogue upgrades additive without resurrecting removals.
export function mergeCatalogue(saved: Source[] | undefined, seen: string[] | undefined, catalogueSources = defaultSources) {
  const known = new Set((seen || (saved ? legacyUrls : [])).map(key));
  const next = (saved || []).map(source => {
    const entry = source.kind === 'gancio' ? catalogueSources.find(item => urls(item).includes(key(source.url))) : undefined;
    return entry ? { ...entry, ...source } : source;
  });
  const present = new Set(next.filter(source => source.kind === 'gancio').flatMap(urls));
  for (const source of catalogueSources) {
    const identities = urls(source);
    if (!identities.some(url => present.has(url) || known.has(url))) {
      next.push({ ...source });
      identities.forEach(url => present.add(url));
    }
    identities.forEach(url => known.add(url));
  }
  return { sources: next, seen: [...known] };
}

export async function runSourceQueue<T>(items: T[], work: (item: T) => Promise<void>, concurrency = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      // Each source may fail independently; keep draining the queue.
      await Promise.resolve().then(() => work(item)).catch(() => {});
    }
  }));
}
