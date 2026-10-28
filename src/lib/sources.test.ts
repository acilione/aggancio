import { describe, expect, it } from 'vitest';
import { defaultSources, mergeCatalogue, runSourceQueue } from './sources';
import type { Source } from './types';

const source = (host: string, enabled = true): Source => ({ id: host, name: host, url: `https://${host}`, kind: 'gancio', city: '', timezone: 'UTC', enabled });
describe('source catalogue', () => {
  it('contains unique source identities, provenance and valid timezones', () => {
    expect(defaultSources.length).toBeGreaterThan(200);
    expect(new Set(defaultSources.map(item => item.id)).size).toBe(defaultSources.length);
    expect(new Set(defaultSources.map(item => item.url)).size).toBe(defaultSources.length);
    for (const item of defaultSources) {
      expect(item.discoveredAt?.length).toBeGreaterThan(0);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: item.timezone })).not.toThrow();
      if (item.enabled) {
        expect(item.access).toBe('available');
        expect(item.timezoneUnconfirmed).toBe(false);
      }
    }
  });
  it('seeds fresh browsers and adds only unseen sources on upgrades', () => {
    const defaults = [source('one.test'), source('two.test')];
    const first = mergeCatalogue(undefined, undefined, defaults);
    expect(first.sources).toEqual(defaults);
    const saved = [{ ...first.sources[0], enabled: false }, source('custom.test')];
    const upgrade = mergeCatalogue(saved, first.seen, [...defaults, source('three.test')]);
    expect(upgrade.sources.map(item => item.url)).toEqual(['https://one.test', 'https://custom.test', 'https://three.test']);
    expect(upgrade.sources[0].enabled).toBe(false);
    expect(mergeCatalogue(upgrade.sources, upgrade.seen, defaults).sources).toEqual(upgrade.sources);
  });
  it('preserves deliberate removals from the original two-source prototype', () => {
    const result = mergeCatalogue([], undefined, [source('gancio.cisti.org'), source('demo.gancio.org'), source('new.test')]);
    expect(result.sources.map(item => item.id)).toEqual(['new.test']);
  });
  it('preserves custom IDs, snapshots and aliases without adding duplicate feeds', () => {
    const saved = [{ ...source('old.test', false), id: 'custom-id' }, { ...source('new.test'), kind: 'snapshot' as const, id: 'snapshot' }];
    const defaults = [{ ...source('new.test'), aliases: ['https://old.test'] }];
    const result = mergeCatalogue(saved, [], defaults);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].id).toBe('custom-id');
    expect(result.sources[0].enabled).toBe(false);
  });
  it('bounds concurrency and continues when individual sources fail', async () => {
    let active = 0; let peak = 0; const completed: number[] = [];
    await runSourceQueue([0,1,2,3,4,5,6,7], async item => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--; completed.push(item);
      if (item === 2) throw new Error('Offline source');
    }, 3);
    expect(peak).toBe(3);
    expect(completed.sort()).toEqual([0,1,2,3,4,5,6,7]);
    expect(active).toBe(0);
  });
});
