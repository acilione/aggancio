import type { Source } from './types';

// Read the JSON used to build the official directory and the project's wider
// catalogue. Both endpoints support browser requests from localhost.
const directories = [
  { name: 'Aggancio catalogue', url: 'https://raw.githubusercontent.com/acilione/aggancio/main/src/data/gancio-sources.json' },
  { name: 'Gancio directory', url: 'https://framagit.org/api/v4/projects/les%2Fgancio/repository/files/docs%2Finstances.json/raw?ref=main' },
];

export interface ScanReport {
  at: string;
  added: string[];
  known: number;
  removed: number;
  failed: string[];
}

export function calendarOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.origin;
  } catch { /* A malformed directory entry cannot identify a calendar. */ }
}

async function readDirectory(directory: typeof directories[number]): Promise<Source[]> {
  const response = await fetch(directory.url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload?.sources;
  if (!Array.isArray(rows)) throw new Error('Unsupported directory format');
  const sources: Source[] = [];
  for (const row of rows) {
    const url = calendarOrigin(row?.url);
    if (!url || (row.kind && row.kind !== 'gancio')) continue;
    let timezone = typeof row.timezone === 'string' ? row.timezone : '';
    try { if (timezone) new Intl.DateTimeFormat('en', { timeZone: timezone }); }
    catch { timezone = ''; }
    const host = new URL(url).host;
    sources.push({
      id: `gancio:${host}`, kind: 'gancio', url, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : host,
      aliases: Array.isArray(row.aliases) ? row.aliases.map(calendarOrigin).filter(Boolean) : [],
      timezone: timezone || 'UTC', timezoneUnconfirmed: !timezone || !!row.timezoneUnconfirmed,
      city: typeof row.city === 'string' ? row.city : '', region: String(row.region || row.place || ''),
      enabled: false, discoveredAt: [directory.url],
    });
  }
  if (!sources.length) throw new Error('Empty directory');
  return sources;
}

export async function scanDirectories() {
  const results = await Promise.allSettled(directories.map(readDirectory));
  const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const failed = directories.filter((_, i) => results[i].status === 'rejected').map(directory => directory.name);
  if (!entries.length) throw new Error('The directories could not be read. Check your connection and try again.');
  return { entries, failed };
}

export function reconcileScan(saved: Source[], seen: string[], entries: Source[]) {
  const sources = [...saved];
  const identities = (s: Source) => [s.url, ...(s.aliases || [])].map(calendarOrigin).filter((url): url is string => !!url);
  const present = new Map<string, Source>();
  for (const source of saved) if (source.kind === 'gancio') for (const url of identities(source)) present.set(url, source);
  const remembered = new Set(seen);
  const added = new Set<string>();
  const known = new Set<string>();
  const removed = new Set<string>();
  for (const entry of entries) {
    const urls = identities(entry);
    const match = urls.map(url => present.get(url)).find(source => !!source);
    if (match) {
      if (!added.has(match.id)) known.add(match.id);
      const freshAliases = urls.filter(url => !present.has(url));
      if (freshAliases.length) {
        const updated = { ...match, aliases: [...(match.aliases || []), ...freshAliases] };
        sources[sources.indexOf(match)] = updated;
        for (const url of identities(updated)) present.set(url, updated);
      }
    } else if (urls.some(url => remembered.has(url))) {
      removed.add(entry.url);
    } else {
      sources.push(entry);
      added.add(entry.id);
      for (const url of urls) present.set(url, entry);
    }
    for (const url of urls) remembered.add(url);
  }
  return { sources, seen: [...remembered], added: [...added], known: known.size, removed: removed.size };
}
