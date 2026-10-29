import { describe, expect, it } from 'vitest';
import { countEventDays, deduplicate, textOnly } from './events';
import { MapIndex } from './map-index';
import { mapPoint } from './map-points';
import type { EventRecord } from './types';

function event(id: string, occurrences: EventRecord['occurrences'], timezone = 'Europe/Rome'): EventRecord {
  return { id, title: id, description: '', venue: '', address: '', city: 'Torino', categories: ['Other'], tags: [], occurrences, timezone, sourceId: id, sourceName: id, sourceUrl: 'https://example.org/event/1', canonicalUrl: 'https://example.org/event/1', local: false, status: 'scheduled', updatedAt: '', cachedAt: '' };
}
describe('daily counts', () => {
  it('counts unique events once per day across sources and repeated sessions', () => {
    const one = event('a', [{ start: '2030-11-03T17:00:00Z' }, { start: '2030-11-03T19:00:00Z' }]);
    const two = event('b', [{ start: '2030-11-03T17:00:00Z' }, { start: '2030-11-05T17:00:00Z' }]);
    expect(countEventDays(deduplicate([one, two]).map(group => group.event), ['2030-11-03', '2030-11-04', '2030-11-05'])).toEqual({ '2030-11-03': 1, '2030-11-04': 0, '2030-11-05': 1 });
  });
  it('counts each occupied day using the event timezone and an exclusive end', () => {
    const spanning = event('span', [{ start: '2030-11-03T22:00:00Z', end: '2030-11-05T23:00:00Z' }]);
    expect(countEventDays([spanning], ['2030-11-03', '2030-11-04', '2030-11-05', '2030-11-06'])).toEqual({ '2030-11-03': 1, '2030-11-04': 1, '2030-11-05': 1, '2030-11-06': 0 });
    expect(countEventDays([event('ny', [{ start: '2030-11-04T01:00:00Z' }], 'America/New_York')], ['2030-11-03', '2030-11-04'])).toEqual({ '2030-11-03': 1, '2030-11-04': 0 });
  });
});
describe('worker-safe text normalization', () => {
  it('decodes entities, preserves readable text and excludes executable content without a DOM', () => {
    expect(textOnly('Music &amp; chess &#9823; <b>today</b><script>alert(1)</script><style>body{}</style><iframe>hidden</iframe>')).toBe('Music & chess ♟ today');
  });
});
describe('spatial indexing', () => {
  it('accounts for venue positions, city estimates, invalid coordinates and unplaced records', () => {
    const original = event('city', [{ start: '2030-11-03T17:00:00Z' }]);
    original.cityLocation = { latitude: 45.46, longitude: 9.19 };
    expect(mapPoint(original)).toEqual({ id: 'city', latitude: 45.46, longitude: 9.19, approximate: true, kind: 'city' });
    expect(original.latitude).toBeUndefined();
    expect(mapPoint({ ...original, latitude: 45.5, longitude: 9.2 })?.approximate).toBe(false);
    expect(mapPoint({ ...original, latitude: NaN, longitude: 200 })?.approximate).toBe(true);
    expect(mapPoint({ ...original, cityLocation: undefined, latitude: Infinity })).toBeNull();
    expect(mapPoint({ ...original, cityLocation: { latitude: 100, longitude: 0 } })).toBeNull();
    expect(mapPoint({ ...original, latitude: 0, longitude: 9 })?.approximate).toBe(false);
  });
  it('keeps estimates distinguishable and every co-located event reachable through cluster pages', () => {
    const index = new MapIndex();
    index.load(Array.from({ length: 45 }, (_, i) => ({ id: String(i), latitude: 45.46, longitude: 9.19, approximate: i < 30 })));
    const marks = index.view([9, 45, 10, 46], 19);
    expect(marks).toHaveLength(1); expect(marks[0]).toMatchObject({ count: 45, approximateCount: 30 });
    const ids = [0, 20, 40].flatMap(offset => index.leaves(marks[0].clusterId!, offset));
    expect(new Set(ids).size).toBe(45);
  });
  it('does not lose visible edge points when a densely populated viewport is queried', () => {
    const index = new MapIndex();
    const points = Array.from({ length: 600 }, (_, i) => ({ id: String(i), latitude: 45 + i * .0001, longitude: 9 + (i % 5) * .001 }));
    index.load([...points, ...Array.from({ length: 1000 }, (_, i) => ({ id: `outside-${i}`, latitude: 45 + i * .0001, longitude: 8.999 }))]);
    const marks = index.view([9, 44.99, 9.005, 45.07], 19);
    expect(marks.reduce((sum, mark) => sum + mark.count, 0)).toBe(points.length);
  });
  it('reduces a large global catalogue to clusters and preserves every event in their counts', () => {
    const index = new MapIndex();
    const points = Array.from({ length: 12000 }, (_, i) => ({ id: String(i), latitude: -60 + (i % 120) * 1, longitude: -170 + Math.floor(i / 120) * 3.4 }));
    index.load(points);
    const marks = index.view([-180, -85, 180, 85], 2);
    expect(marks.length).toBeLessThan(400);
    expect(marks.reduce((sum, mark) => sum + mark.count, 0)).toBe(points.length);
    expect(index.view([10, 10, 11, 11], 19).length).toBeLessThan(10);
  });
  it('reveals individual events as zoom increases', () => {
    const index = new MapIndex();
    index.load([{ id: 'one', latitude: 45, longitude: 7 }, { id: 'two', latitude: 45.01, longitude: 7.01 }]);
    const overview = index.view([-180, -85, 180, 85], 2);
    expect(overview).toHaveLength(1);
    expect(overview[0].count).toBe(2);
    expect(index.expand(overview[0].clusterId!)).toBeGreaterThan(2);
    expect(index.view([6, 44, 8, 46], 19).map(mark => mark.id).sort()).toEqual(['one', 'two']);
  });
  it('keeps co-located events browsable in pages without making thousands of markers', () => {
    const index = new MapIndex();
    index.load(Array.from({ length: 45 }, (_, i) => ({ id: String(i), latitude: 45, longitude: 7 })));
    const marks = index.view([6, 44, 8, 46], 19);
    expect(marks).toHaveLength(1);
    const id = marks[0].clusterId!;
    expect(index.expand(id)).toBe(20);
    const ids = [...index.leaves(id), ...index.leaves(id, 20), ...index.leaves(id, 40)];
    expect(new Set(ids).size).toBe(45);
    index.load([]);
    expect(index.view([-180, -85, 180, 85], 2)).toEqual([]);
  });
});
