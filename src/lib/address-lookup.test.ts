import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressKey, applyAddressCache, defaultGeocoder, freshEntry, geocoderURL, hasStreetAddress, lookupAddress, normalizeAddress, selectAddressMatch } from './address-lookup';
import { mapPoint } from './map-points';
import { matchesLocation, venuePosition } from './location';
import { jsonExport, parseImport } from './export';
import type { EventRecord } from './types';
const event: EventRecord = { id: 'address-test', title: 'Private title never in query', description: '', venue: '', address: 'via Federico Confalonieri 3, Milano', city: 'Milano', countryCode: 'IT', cityLocation: { latitude: 45.46427, longitude: 9.18951 }, categories: ['Other'], tags: [], occurrences: [{ start: '2030-11-03T17:00:00Z' }], timezone: 'Europe/Rome', sourceId: 'test', sourceName: 'Test', sourceUrl: 'https://example.org/event', local: false, status: 'scheduled', updatedAt: '', cachedAt: '' };
const feature = (properties: Record<string, unknown> = {}, coordinates = [9.1898187, 45.4865532]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { type: 'house', street: 'Via Federico Confalonieri', housenumber: '3', city: 'Milano', countrycode: 'IT', country: 'Italia', osm_type: 'N', osm_id: 2456060997, ...properties } });
const payload = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('street-address lookup', () => {
  it('matches the supplied street and number, and handles Italian abbreviations', () => {
    expect(selectAddressMatch(payload(feature()), event)).toMatchObject({ latitude: 45.4865532, longitude: 9.1898187, precision: 'address', osmUrl: 'https://www.openstreetmap.org/node/2456060997' });
    expect(normalizeAddress('P.za Stuparich 18')).toBe('piazza stuparich 18');
    expect(selectAddressMatch(payload(feature({ street: 'Piazza Carlo Stuparich', housenumber: '18' })), { ...event, address: 'P.za Stuparich 18, Milano' })?.precision).toBe('address');
    expect(hasStreetAddress({ ...event, address: 'milano' })).toBe(false);
    expect(hasStreetAddress(event)).toBe(true);
  });
  it('rejects wrong house numbers, other streets, cities, countries, invalid positions and ambiguous alternatives', () => {
    for (const result of [feature({ housenumber: '3a' }), feature({ street: 'Via Federico Borromeo' }), feature({ city: 'Masate' }, [9.4592491, 45.5613937]), feature({ countrycode: 'DE' }), feature({}, [300, 45]), feature({ osm_type: 'invalid' })]) expect(selectAddressMatch(payload(result), event)).toBeNull();
    expect(selectAddressMatch(payload(feature(), feature({}, [9.20, 45.49])), event)).toBeNull();
    expect(selectAddressMatch(payload(feature(), feature({}, [9.1899719, 45.4865452])), event)?.precision).toBe('address');
    expect(selectAddressMatch(payload(feature({ type: 'city', street: undefined, housenumber: undefined, name: 'Milano' })), event)).toBeNull();
    expect(selectAddressMatch(payload(feature({ street: 'Via 12 Ottobre', housenumber: '12' })), { ...event, address: 'Via 12 Ottobre 3, Milano' })).toBeNull();
  });
  it('keeps street estimates distinct from matched house numbers in map and radius filtering', () => {
    const street = selectAddressMatch(payload(feature({ type: 'street', housenumber: undefined })), event)!;
    const estimated = { ...event, addressLocation: street };
    expect(street.precision).toBe('street'); expect(mapPoint(estimated)).toMatchObject({ approximate: true, kind: 'street' });
    expect(venuePosition(estimated)).toBeNull();
    const center = { ...event.cityLocation!, id: 3173435, name: 'Milano', countryCode: 'IT', admin: '09' };
    expect(matchesLocation(estimated, 'Milano|IT', '', center, 5)).toBe(true);
    expect(matchesLocation(estimated, 'Milano|IT', '', center, 5, true)).toBe(false);
    const matched = { ...event, addressLocation: selectAddressMatch(payload(feature()), event)! };
    expect(matchesLocation(matched, 'Milano|IT', '', center, 5, true)).toBe(true);
    expect(mapPoint(matched)).toMatchObject({ approximate: false, kind: 'address' });
  });
  it('reuses cached matches without changing source coordinates and invalidates changed addresses', async () => {
    const location = selectAddressMatch(payload(feature()), event)!;
    const entry = { key: addressKey(event), checkedAt: Date.now(), location };
    const cache = { [entry.key]: entry };
    const enriched = applyAddressCache(event, cache);
    expect(enriched.addressLocation).toEqual(location); expect(enriched.latitude).toBeUndefined();
    const supplied = { ...event, latitude: 45.47, longitude: 9.2 };
    expect(applyAddressCache(supplied, cache)).toBe(supplied);
    expect(applyAddressCache({ ...event, address: 'Via Federico Confalonieri 7, Milano' }, cache).addressLocation).toBeUndefined();
    expect(freshEntry({ ...entry, checkedAt: Date.now() - 31 * 86400000 })).toBe(false);
    expect(freshEntry({ ...entry, location: null, checkedAt: Date.now() - 2 * 86400000 })).toBe(false);
    expect(parseImport(JSON.parse(await jsonExport([enriched])))[0].addressLocation).toEqual(location);
    expect(geocoderURL('https://geocoder.example/api/')).toBe('https://geocoder.example/api/');
    expect(() => geocoderURL('javascript:alert(1)')).toThrow();
    expect(() => geocoderURL('https://user:secret@example.org/api/')).toThrow();
  });
  it('serializes requests, spaces them out, omits credentials, and cancels pending work', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => payload(feature()) })); vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController();
    const first = lookupAddress(event, defaultGeocoder, signal.signal);
    await vi.advanceTimersByTimeAsync(0); await first;
    const second = lookupAddress(event, defaultGeocoder, signal.signal);
    await vi.advanceTimersByTimeAsync(1000); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); await second; expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('q')).not.toContain(event.title);
    expect(options.credentials).toBe('omit'); expect(options.referrerPolicy).toBe('no-referrer');
    signal.abort(); await expect(lookupAddress(event, defaultGeocoder, signal.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
