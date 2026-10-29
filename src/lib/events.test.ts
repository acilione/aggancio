import { describe, expect, it, vi } from 'vitest';
import { classify, coordinate, deduplicate, normalizeGancio, overlapsDays, safeUrl, defaultSources, fetchGancio } from './events';
import { extractPoster, zonedDateTimeToISO } from './poster';
import { calendarExport, parseImport } from './export';
import type { EventRecord } from './types';

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return { id: 'draft:one', title: 'Scacchi in biblioteca', description: 'Join us', venue: 'Biblioteca', address: '', city: 'Reggio Calabria', categories: ['Games & chess'], tags: [],
    occurrences: [{ start: '2030-11-03T17:00:00Z' }, { start: '2030-11-10T17:00:00Z' }, { start: '2030-11-17T17:00:00Z' }], timezone: 'Europe/Rome', sourceId: 'local', sourceName: 'Local draft', sourceUrl: '', local: true,
    status: 'scheduled', updatedAt: '2030-10-28T10:00:00Z', cachedAt: '2030-10-28T10:00:00Z', ...overrides };
}
describe('poster dates and event days', () => {
  it('extracts three separate Italian dates without inventing intervening days', () => {
    const parsed = extractPoster('SCACCHI IN BIBLIOTECA\n3, 10 e 17 novembre 2030\nore 18:00\nReggio Calabria');
    expect(parsed.dates).toEqual(['2030-11-03', '2030-11-10', '2030-11-17']);
    expect(parsed.time).toBe('18:00'); expect(parsed.category).toBe('Games & chess');
    expect(overlapsDays(event(), '2030-11-10', '2030-11-10')).toBe(true);
    expect(overlapsDays(event(), '2030-11-11', '2030-11-11')).toBe(false);
  });
  it('flags an inferred year, range endpoints and missing times', () => {
    const parsed = extractPoster('Festival\ndal 3 al 5 novembre', 2031);
    expect(parsed.dates).toEqual(['2031-11-03', '2031-11-05']);
    expect(parsed.warnings.join(' ')).toContain('2031');
    expect(parsed.warnings.join(' ')).toContain('range');
    expect(parsed.time).toBe('');
  });
  it('rejects impossible dates and does not interpret ore 18.00 as a date', () => {
    expect(extractPoster('Evento\n31/02/2030\nore 18.00').dates).toEqual([]);
  });
  it('uses the event timezone and exclusive end for overnight events', () => {
    const value = event({ occurrences: [{ start: '2030-11-03T22:00:00Z', end: '2030-11-04T01:00:00Z' }] });
    expect(overlapsDays(value, '2030-11-04', '2030-11-04')).toBe(true);
    const midnight = event({ occurrences: [{ start: '2030-11-03T22:00:00Z', end: '2030-11-03T23:00:00Z' }] });
    expect(overlapsDays(midnight, '2030-11-04', '2030-11-04')).toBe(false);
  });
  it('converts local dates independently of the computer timezone, including DST', () => {
    expect(zonedDateTimeToISO('2030-11-03T18:00', 'Europe/Rome')).toBe('2030-11-03T17:00:00.000Z');
    expect(zonedDateTimeToISO('2030-07-03T18:00', 'Europe/Rome')).toBe('2030-07-03T16:00:00.000Z');
    expect(() => zonedDateTimeToISO('2026-03-29T02:30', 'Europe/Rome')).toThrow('does not exist');
  });
});
describe('source boundaries', () => {
  it('preserves separate occurrences returned with the same source event ID', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [
      { id: 42, title: 'Weekly chess', start_datetime: 1919955600 },
      { id: 42, title: 'Weekly chess', start_datetime: 1920560400 },
    ] }));
    try {
      const result = await fetchGancio(defaultSources[0], new AbortController().signal);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].occurrences).toHaveLength(2);
    } finally { vi.unstubAllGlobals(); }
  });
  it('preserves missing coordinates instead of placing events at zero', () => {
    const normalized = normalizeGancio({ id: 2, title: 'Chess evening', start_datetime: 1919955600, place: { latitude: null, longitude: '', address: 'Torino' }, tags: ['scacchi'] }, defaultSources[0]);
    expect(normalized?.latitude).toBeUndefined(); expect(normalized?.longitude).toBeUndefined();
    expect(normalized?.categories).toContain('Games & chess');
    expect(normalized?.sourceUrl).toBe('https://gancio.cisti.org/event/2');
  });
  it('only merges identical canonical URLs and keeps provenance', () => {
    const a = event({ id: 'a', local: false, canonicalUrl: 'https://calendar.test/event/1', sourceName: 'A', sourceUrl: 'https://calendar.test/event/1' });
    const b = event({ ...a, id: 'b', sourceName: 'B' });
    const c = event({ ...a, id: 'c', canonicalUrl: 'https://calendar.test/event/2' });
    const groups = deduplicate([a, b, c]); expect(groups).toHaveLength(2); expect(groups[0].sources).toHaveLength(2);
  });
  it('retains the most precise available location when duplicate sources differ', () => {
    const missing = event({ id: 'missing', local: false, canonicalUrl: 'https://calendar.test/event/1', cityLocation: { latitude: 45.46, longitude: 9.19 }, sourceName: 'A' });
    const exact = { ...missing, id: 'exact', sourceName: 'B', latitude: 45.5, longitude: 9.2, venue: 'Actual venue', address: 'Milano', city: 'Milano' };
    for (const input of [[missing, exact], [exact, missing]]) {
      const [group] = deduplicate(input);
      expect(group.event).toMatchObject({ latitude: 45.5, longitude: 9.2, city: 'Milano', venue: 'Actual venue' });
      expect(group.sources).toHaveLength(2);
    }
    expect(missing.latitude).toBeUndefined();
  });
  it('rejects invalid coordinates and Gancio zero-pair placeholders, preserving valid single zeros', () => {
    for (const value of [' ', false, true, [], {}, null, undefined, 'NaN', Infinity, 91]) expect(coordinate(value, 90)).toBeUndefined();
    const normalize = (latitude: unknown, longitude: unknown) => normalizeGancio({ id: 2524, title: 'Fiera della Decrescita', start_datetime: 1919955600, place: { address: 'Via Quarnaro 1, 89135 Reggio Calabria, RC', latitude, longitude } }, defaultSources[0]);
    for (const [lat, lon] of [[0, 0], ['0', '0'], [38.1, null], [' ', 15.6], [false, 15.6]]) {
      expect(normalize(lat, lon)?.latitude).toBeUndefined(); expect(normalize(lat, lon)?.longitude).toBeUndefined();
    }
    expect(normalize(0, 32)).toMatchObject({ latitude: 0, longitude: 32 });
    expect(normalize(51.5, 0)).toMatchObject({ latitude: 51.5, longitude: 0 });
  });
  it('does not allow executable source URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBe(''); expect(safeUrl('data:text/html,test')).toBe('');
  });
  it('maps bilingual tags to the same category', () => {
    expect(classify('scacchi')).toEqual(classify('chess'));
  });
});
describe('portable exports', () => {
  it('exports each occurrence separately with stable identifiers and proper escaping', () => {
    const value = event({ title: 'Chess, tea; together\nBring a friend' });
    const first = calendarExport([value]);
    expect(first.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(first).toContain('SUMMARY:Chess\\, tea\\; together\\nBring a friend');
    expect(first).toContain('STATUS:TENTATIVE');
    expect(first).toBe(calendarExport([value]));
    expect(first).not.toContain('20301104');
  });
  it('folds UTF-8 calendar lines to at most 75 octets', () => {
    const output = calendarExport([event({ title: '🎵'.repeat(60) })]);
    for (const line of output.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it('validates imported dates and keeps imported local drafts private', () => {
    const imported = parseImport({ format: 'commons-events', version: 1, events: [event({ local: false })] });
    expect(imported[0].local).toBe(true); expect(imported[0].occurrences).toHaveLength(3);
    expect(() => parseImport({ format: 'commons-events', version: 1, events: [event({ occurrences: [{ start: 'not a date' }] })] })).toThrow('invalid date');
  });
});
