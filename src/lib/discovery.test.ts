import { describe, expect, it } from 'vitest';
import { countEventDays, deduplicate, textOnly } from './events';
import { MapIndex } from './map-index';
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
