import type { EventRecord } from './types';
import { categories } from './types';
import { coordinate, safeUrl } from './events';
import { countryCode } from './location';

const escapeICS = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const utc = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function foldLine(line: string): string {
  const encoder = new TextEncoder(); let out = '', current = '', size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) { out += current + '\r\n'; current = ' '; size = 1; }
    current += char; size += bytes;
  }
  return out + current;
}
export function calendarExport(events: EventRecord[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Commons//Local event explorer//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) for (const occurrence of event.occurrences) {
    lines.push('BEGIN:VEVENT', `UID:${encodeURIComponent(event.id)}-${Date.parse(occurrence.start)}@commons.local`, `DTSTAMP:${utc(event.updatedAt)}`,
      `DTSTART:${utc(occurrence.start)}`, ...(occurrence.end ? [`DTEND:${utc(occurrence.end)}`] : []),
      `SUMMARY:${escapeICS(event.title)}`, `DESCRIPTION:${escapeICS(event.description + (event.local ? '\nLocal draft — not publicly published.' : `\nSource: ${event.sourceName}\n${event.sourceUrl}`))}`,
      `LOCATION:${escapeICS([event.venue, event.address, event.city].filter(Boolean).join(', '))}`,
      ...(safeUrl(event.sourceUrl) ? [`URL:${safeUrl(event.sourceUrl)}`] : []),
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : event.local ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
export function download(content: Blob | string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
}
export async function jsonExport(events: EventRecord[]): Promise<string> {
  const values = await Promise.all(events.map(async ({ imageBlob, ...event }) => ({ ...event, ...(imageBlob ? { poster: await blobDataUrl(imageBlob) } : {}) })));
  return JSON.stringify({ format: 'commons-events', version: 1, exportedAt: new Date().toISOString(), events: values }, null, 2);
}
export function parseImport(json: unknown, source?: { id: string; name: string; url: string }): EventRecord[] {
  const root = json as any;
  if (root?.format !== 'commons-events' || root.version !== 1 || !Array.isArray(root.events) || root.events.length > 5000) throw new Error('Choose a Commons JSON export (format commons-events, version 1; up to 5,000 events).');
  return root.events.map((raw: any, index: number) => {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || !Array.isArray(raw.occurrences) || !raw.occurrences.length || raw.occurrences.length > 366) throw new Error(`Event ${index + 1} has an invalid title or date list.`);
    const occurrences = raw.occurrences.map((occ: any) => {
      if (!Number.isFinite(Date.parse(occ.start)) || (occ.end && (!Number.isFinite(Date.parse(occ.end)) || Date.parse(occ.end) < Date.parse(occ.start)))) throw new Error(`Event ${index + 1} has an invalid date.`);
      return { start: new Date(occ.start).toISOString(), ...(occ.end ? { end: new Date(occ.end).toISOString() } : {}) };
    });
    const timezone = typeof raw.timezone === 'string' ? raw.timezone : 'Europe/Rome';
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error(`Event ${index + 1} has an invalid timezone.`); }
    const str = (field: string) => typeof raw[field] === 'string' ? raw[field].slice(0, 50000) : '';
    const now = new Date().toISOString();
    let imageBlob: Blob | undefined;
    if (typeof raw.poster === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(raw.poster)) {
      const [prefix, data] = raw.poster.split(',');
      if (data.length > 24_000_000) throw new Error('An embedded poster exceeds the 18 MB limit.');
      try { imageBlob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: prefix.slice(5, -7) }); } catch { throw new Error('An embedded poster is invalid.'); }
    }
    const local = !source;
    return {
      id: source ? `${source.id}:${str('id') || index}` : `draft:${crypto.randomUUID()}`, title: str('title'), description: str('description'), venue: str('venue'), address: str('address'), city: str('city'),
      latitude: coordinate(raw.latitude, 90), longitude: coordinate(raw.longitude, 180),
      countryCode: countryCode(raw.countryCode) || undefined, cityBasis: str('city') ? 'provided' : undefined,
      categories: Array.isArray(raw.categories) && raw.categories.some((c: any) => categories.includes(c) && c !== 'All') ? raw.categories.filter((c: any) => categories.includes(c) && c !== 'All') : ['Other'],
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === 'string').slice(0, 100) : [], occurrences, timezone,
      sourceId: source?.id || 'local', sourceName: source?.name || 'Local draft', sourceUrl: safeUrl(raw.sourceUrl) || source?.url || '',
      canonicalUrl: safeUrl(raw.canonicalUrl) || safeUrl(raw.sourceUrl) || undefined,
      imageUrl: safeUrl(raw.imageUrl) || undefined, imageBlob,
      status: ['cancelled', 'postponed'].includes(raw.status) ? raw.status : 'scheduled', local,
      updatedAt: Number.isFinite(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : now, cachedAt: now,
    } as EventRecord;
  });
}
