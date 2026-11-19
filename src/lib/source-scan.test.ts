import { describe, expect, it } from 'vitest';
import type { Source } from './types';
import { reconcileScan } from './source-scan';

const source = (url: string): Source => ({
  id: url, name: url, url, kind: 'gancio', city: '', timezone: 'UTC', enabled: false,
});
describe('directory rescan', () => {
  it('recognizes custom URLs and aliases, remembers removals and preserves local settings', () => {
    const custom = { ...source('https://old.example'), id: 'custom:1', name: 'My calendar', enabled: true };
    const renamed = { ...source('https://new.example'), aliases: [custom.url] };
    const fresh = source('https://fresh.example');
    const removed = source('https://removed.example');
    const first = reconcileScan([custom], [removed.url], [renamed, custom, fresh, fresh, removed]);
    expect(first).toMatchObject({ added: [fresh.id], known: 1, removed: 1 });
    expect(first.sources).toEqual([{ ...custom, aliases: [renamed.url] }, fresh]);
    const second = reconcileScan(first.sources, first.seen, [renamed, fresh, removed]);
    expect(second).toMatchObject({ sources: first.sources, added: [], known: 2, removed: 1 });
  });
});
