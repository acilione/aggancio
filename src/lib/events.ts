import type { Category, EventRecord, Source } from './types';
import { Parser } from 'htmlparser2';
import { countryCode, hasCoordinates } from './location';

export { defaultSources } from './sources';
export const cities: Record<string, [number, number]> = {
  'Torino': [45.0703, 7.6869], 'Reggio Calabria': [38.1113, 15.6473], 'London': [51.5072, -0.1276],
  'Milano': [45.4642, 9.19], 'Roma': [41.9028, 12.4964], 'Bologna': [44.4949, 11.3426],
  'Napoli': [40.8518, 14.2681], 'Firenze': [43.7696, 11.2558], 'Palermo': [38.1157, 13.3615],
};
const categoryWords: [Category, RegExp][] = [
  ['Music', /music|musica|concerto|concert|jam\b|dj\b|punk|techno|jazz|live\b|rock|dance|danza|ballo/i],
  ['Games & chess', /chess|scacchi|gioch|games?|ludic|board.?game|dungeons|gdr\b/i],
  ['Sport & outdoors', /sport|hiking|escursion|trekking|cycling|bici|yoga|passeggiat|cammin|outdoor|natura|running/i],
  ['Arts & culture', /art[es]?\b|cultur|cinema|film|teatr|theatr|mostra|exhibition|poes|poetry|letteratur|libri|book|lettura/i],
  ['Learning', /workshop|laborator|learn|corso|lezion|seminar|conferenz|talk\b|scienz|science|filosof|language|lingu/i],
  ['Community', /comunit|community|assemble|solidar|incontro|social|benefit|queer|trans|lgbt|salute|health|mutuo|cena|pranzo/i],
];
export function classify(text: string): Category[] {
  const found = categoryWords.filter(([, re]) => re.test(text)).map(([category]) => category);
  return found.length ? found : ['Other'];
}
export function safeUrl(value: unknown, base?: string): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value, base); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function textOnly(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (!/[<&]/.test(value)) return value.trim();
  // The same non-DOM parser runs in workers and on the main thread. No markup executes.
  let text = ''; let blocked = 0;
  const skip = new Set(['script', 'style', 'iframe']);
  const parser = new Parser({
    onopentag(name) { if (skip.has(name)) blocked++; if (!blocked && ['br', 'p', 'div', 'li'].includes(name)) text += '\n'; },
    onclosetag(name) { if (skip.has(name)) blocked = Math.max(0, blocked - 1); },
    ontext(value) { if (!blocked) text += value; },
  }, { decodeEntities: true });
  parser.end(value);
  return text.trim();
}
function timestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return;
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value));
  const date = numeric ? new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1)) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
export function coordinate(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return;
  const n = Number(value); return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined;
}
export function normalizeGancio(raw: Record<string, any>, source: Source): EventRecord | null {
  const start = timestamp(raw.start_datetime ?? raw.startDate);
  if (!start || !raw.title || raw.id === undefined) return null;
  const place = raw.place || {};
  const tags = Array.isArray(raw.tags) ? raw.tags.map((tag: any) => typeof tag === 'string' ? tag : tag.tag || tag.name || '').filter(Boolean) : [];
  const title = textOnly(raw.title);
  const description = textOnly(raw.description);
  const original = safeUrl(raw.ap_id ?? raw.apId ?? raw.external_url ?? raw.url);
  const sourceUrl = original || `${source.url}/event/${encodeURIComponent(raw.slug || raw.id)}`;
  const image = raw.media?.[0]?.url || raw.image;
  const now = new Date().toISOString();
  const statusText = String(raw.status || '').toLowerCase();
  let latitude = coordinate(place.latitude ?? place.lat, 90);
  let longitude = coordinate(place.longitude ?? place.lon ?? place.lng, 180);
  // Some Gancio venues encode an unknown position as the pair (0, 0).
  if (latitude === undefined || longitude === undefined || (latitude === 0 && longitude === 0)) latitude = longitude = undefined;
  return {
    id: `${source.id}:${raw.id}`, title, description, venue: textOnly(place.name), address: textOnly(place.address),
    city: textOnly(place.city), cityBasis: place.city ? 'provided' : undefined,
    countryCode: countryCode(place.country_code ?? place.countryCode ?? place.country) || undefined,
    latitude, longitude,
    categories: classify([...tags, title].join(' ')), tags, occurrences: [{ start, end: timestamp(raw.end_datetime ?? raw.endDate) }],
    timezone: source.timezone, sourceId: source.id, sourceName: source.name, sourceUrl, canonicalUrl: original || sourceUrl,
    imageUrl: image ? safeUrl(image, `${source.url}/media/`) : undefined,
    status: statusText.includes('cancel') ? 'cancelled' : statusText.includes('postpon') ? 'postponed' : 'scheduled',
    local: false, updatedAt: timestamp(raw.updatedAt ?? raw.updated_at) || now, cachedAt: now,
  };
}
export async function fetchGancio(source: Source, signal: AbortSignal): Promise<{ events: EventRecord[]; limited: boolean }> {
  const collected = new Map<string, EventRecord>();
  const signatures = new Set<string>();
  // Fetch the upcoming catalogue so ongoing events aren't lost to a start-time filter.
  // Stop at 1,000/source and report the limit rather than imply complete coverage.
  for (let page = 0; page < 10; page++) {
    const url = new URL('/api/events', source.url);
    url.search = new URLSearchParams({ max: '100', page: String(page), show_multidate: 'true', show_recurrent: 'true', show_federated: 'true' }).toString();
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const payload = await response.json();
    const rows: any[] = Array.isArray(payload) ? payload : payload.events;
    if (!Array.isArray(rows)) throw new Error('This endpoint did not return a supported event list.');
    const signature = rows.map(row => `${row.id}:${row.start_datetime ?? row.startDate}`).join(',');
    if (signatures.has(signature) && rows.length) return { events: [...collected.values()], limited: true };
    signatures.add(signature);
    for (const raw of rows) {
      const event = normalizeGancio(raw, source);
      if (!event) continue;
      const previous = collected.get(event.id);
      if (previous) {
        const occurrences = new Map([...previous.occurrences, ...event.occurrences].map(occurrence => [occurrence.start, occurrence]));
        event.occurrences = [...occurrences.values()].sort((a, b) => a.start.localeCompare(b.start));
      }
      collected.set(event.id, event);
    }
    if (rows.length < 100) return { events: [...collected.values()], limited: false };
  }
  return { events: [...collected.values()], limited: true };
}
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const dayCache = new Map<string, string>();
export function dayKey(date: Date | string, timezone?: string): string {
  const zone = timezone || '';
  const instant = typeof date === 'string' ? date : date.toISOString();
  const key = `${zone}:${instant}`;
  const cached = dayCache.get(key);
  if (cached) return cached;
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(date));
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  const result = `${part('year')}-${part('month')}-${part('day')}`;
  if (dayCache.size >= 50000) dayCache.clear();
  dayCache.set(key, result);
  return result;
}
export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function overlapsDays(event: EventRecord, from: string, to: string): boolean {
  return event.occurrences.some(occ => {
    const startDay = dayKey(occ.start, event.timezone);
    // End timestamps are exclusive: midnight ending doesn't add an extra event day.
    const endMs = occ.end ? Math.max(Date.parse(occ.start), Date.parse(occ.end) - 1) : Date.parse(occ.start);
    const endDay = dayKey(new Date(endMs), event.timezone);
    return startDay <= to && endDay >= from;
  });
}
export function countEventDays(events: EventRecord[], days: string[]): Record<string, number> {
  const counts = Object.fromEntries(days.map(day => [day, 0]));
  for (const event of events) {
    const matched = new Set<string>();
    for (const occurrence of event.occurrences) {
      const start = dayKey(occurrence.start, event.timezone);
      const end = dayKey(new Date(occurrence.end ? Math.max(Date.parse(occurrence.start), Date.parse(occurrence.end) - 1) : Date.parse(occurrence.start)), event.timezone);
      for (const day of days) if (day >= start && day <= end) matched.add(day);
    }
    for (const day of matched) counts[day]++;
  }
  return counts;
}
export function primaryOccurrence(event: EventRecord, from = dayKey(new Date())) {
  return event.occurrences.find(occ => dayKey(occ.end || occ.start, event.timezone) >= from) || event.occurrences[0];
}
export function formatEventDate(event: EventRecord, from?: string): string {
  const occ = primaryOccurrence(event, from);
  return new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(occ.start));
}
export function formatEventTime(event: EventRecord, from?: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(primaryOccurrence(event, from).start));
}
export function deduplicate(events: EventRecord[]): { event: EventRecord; sources: { name: string; url: string }[] }[] {
  const groups = new Map<string, { event: EventRecord; sources: { name: string; url: string }[] }>();
  for (const event of events) {
    const key = event.local ? event.id : event.canonicalUrl || event.id;
    const existing = groups.get(key);
    if (existing) {
      // A federated copy may supply a position missing from the first listing.
      const precision = (value: EventRecord) => hasCoordinates(value) ? 4 : value.addressLocation?.precision === 'address' ? 3 : value.addressLocation ? 2 : value.cityLocation ? 1 : 0;
      if (precision(event) > precision(existing.event)) {
        for (const key of ['venue', 'address', 'city', 'cityId', 'cityLocation', 'addressLocation', 'cityBasis', 'countryCode', 'countryBasis', 'latitude', 'longitude'] as const) {
          Object.assign(existing.event, { [key]: event[key] });
        }
      }
      if (!existing.sources.some(s => s.name === event.sourceName && s.url === event.sourceUrl)) existing.sources.push({ name: event.sourceName, url: event.sourceUrl });
      existing.event.occurrences = [...new Map([...existing.event.occurrences, ...event.occurrences].map(occurrence => [occurrence.start, occurrence])).values()].sort((a, b) => a.start.localeCompare(b.start));
    } else groups.set(key, { event: { ...event, occurrences: [...event.occurrences] }, sources: event.local ? [] : [{ name: event.sourceName, url: event.sourceUrl }] });
  }
  return [...groups.values()];
}
