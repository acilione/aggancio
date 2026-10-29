import { describe, expect, it } from 'vitest';
import { countryBounds, enrichLocation, searchCities, resolveCity, sourceLocation } from './geography-index';
import { countryCode, distanceKm, matchesLocation } from './location';
import { parseImport } from './export';
import type { EventRecord, Source } from './types';
const source: Source = { id: 'amsterdam', name: 'Offbeat Amsterdam', url: 'https://offbeat.amsterdam', kind: 'gancio', city: '', region: 'Amsterdam', timezone: 'Europe/Amsterdam', enabled: true };
const event = (values: Partial<EventRecord> = {}): EventRecord => ({ id: 'a', title: 'Event', description: '', venue: '', address: '', city: '', categories: ['Other'], tags: [], occurrences: [{ start: '2030-11-03T17:00:00Z' }], timezone: 'Europe/Amsterdam', sourceId: source.id, sourceName: source.name, sourceUrl: source.url, local: false, status: 'scheduled', updatedAt: '2030-10-01T00:00:00Z', cachedAt: '2030-10-01T00:00:00Z', ...values });
describe('worldwide city lookup', () => {
  it('supplies country bounds for map navigation even with no matching events', () => {
    const japan = countryBounds('JP')!;
    expect(japan[0][0]).toBeLessThan(36); expect(japan[1][0]).toBeGreaterThan(36);
    expect(japan[0][1]).toBeLessThan(139); expect(japan[1][1]).toBeGreaterThan(139);
    const fiji = countryBounds('FJ')!;
    expect(fiji[1][1]).toBeGreaterThan(fiji[0][1]);
    expect(fiji[1][1] - fiji[0][1]).toBeLessThan(30);
    expect(countryBounds('unknown')).toBeNull();
  });
  it('finds Amsterdam, accented names, Italian exonyms and country-qualified matches', () => {
    expect(searchCities('amster')[0]).toMatchObject({ name: 'Amsterdam', countryCode: 'NL' });
    expect(searchCities('koln')[0].countryCode).toBe('DE');
    expect(searchCities('Torino')[0].name).toBe('Torino');
    expect(searchCities('Genova')[0].name).toBe('Genova');
    expect(searchCities('Wien')[0].name).toBe('Vienna');
    expect(searchCities('Munchen')[0].countryCode).toBe('DE');
    expect(searchCities('London', 'CA')[0].countryCode).toBe('CA');
    expect(searchCities('Cambridge, United States').every(city => city.countryCode === 'US')).toBe(true);
    expect(countryCode('Italia')).toBe('IT'); expect(countryCode('Nederland')).toBe('NL');
    expect(sourceLocation(source)).toMatchObject({ name: 'Amsterdam', countryCode: 'NL' });
  });
  it('repairs missing city labels from Gancio addresses and migrates old incorrect labels', () => {
    const fresh = enrichLocation(event({ address: 'Warmoesstraat 139, 1012 JB Amsterdam', latitude: 52.3737514, longitude: 4.8959885 }), source);
    expect(fresh).toMatchObject({ city: 'Amsterdam', countryCode: 'NL', cityBasis: 'address', geographyVersion: 2 });
    const old = enrichLocation(event({ city: 'London', address: 'Tolstraat 160, 1074 VM Amsterdam', latitude: 52.3526, longitude: 4.9063 }), source);
    expect(old.city).toBe('Amsterdam');
    expect(enrichLocation(fresh, source)).toBe(fresh);
  });
  it('does not force federated events into the source city or infer countries from timezones', () => {
    const foreign = enrichLocation(event({ address: 'Berlin, Germany', latitude: 52.52, longitude: 13.405 }), source);
    expect(foreign).toMatchObject({ city: 'Berlin', countryCode: 'DE' });
    expect(enrichLocation(event({ address: 'Hamburg' }), { ...source, region: 'Barcelona, Spain' })).toMatchObject({ city: 'Hamburg', countryCode: 'DE' });
    const unknown = enrichLocation(event({ timezone: 'Europe/Amsterdam' }));
    expect(unknown.city).toBe(''); expect(unknown.countryCode).toBeUndefined();
  });
  it('labels calendar fallbacks without inventing venue coordinates', () => {
    const result = enrichLocation(event(), source);
    expect(result).toMatchObject({ city: 'Amsterdam', cityBasis: 'source', countryCode: 'NL' });
    expect(result.latitude).toBeUndefined(); expect(result.longitude).toBeUndefined();
    expect(enrichLocation(event({ city: 'Unknown village', countryCode: 'IT', cityBasis: 'provided' }), source)).toMatchObject({ city: 'Unknown village', countryCode: 'IT' });
  });
  it('uses country polygons instead of assuming the nearest city lies in the same country', () => {
    const belgium = enrichLocation(event({ latitude: 50.85, longitude: 4.35 }), source);
    expect(belgium.countryCode).toBe('BE');
    const canada = enrichLocation(event({ latitude: 42.98339, longitude: -81.23304 }), source);
    expect(canada).toMatchObject({ city: 'London', countryCode: 'CA' });
  });
  it('repairs cached Gancio zero pairs and inferred metadata using the Reggio address', () => {
    const old = event({ geographyVersion: 1, address: 'Via Quarnaro 1, 89135 Reggio Calabria, RC', city: 'Street', cityBasis: 'address', countryCode: 'GB', countryBasis: 'city', latitude: 0, longitude: 0 });
    const repaired = enrichLocation(old, source);
    expect(repaired).toMatchObject({ geographyVersion: 2, city: 'Reggio Calabria', countryCode: 'IT', cityBasis: 'address', cityLocation: { latitude: 38.11047, longitude: 15.66129 } });
    expect(repaired.latitude).toBeUndefined(); expect(repaired.longitude).toBeUndefined();
    expect(enrichLocation(event({ local: true, latitude: 0, longitude: 0 })).latitude).toBe(0);
    expect(enrichLocation(event({ latitude: 0, longitude: 32 }), source).longitude).toBe(32);
    expect(enrichLocation(event({ latitude: 51.5, longitude: 0 }), source).longitude).toBe(0);
    expect(enrichLocation(event({ latitude: 38.1 }), source).latitude).toBeUndefined();
  });
  it('does not mistake street names for cities or retain previously inferred bad labels', () => {
    for (const address of ['2100 Guy Street, suite 205', '529 Bloor Street West', '12 Clinton Street', 'Via Roma 12']) {
      const result = enrichLocation(event({ address, city: 'Street', cityBasis: 'address', countryCode: 'GB', countryBasis: 'city', geographyVersion: 1 }));
      expect(result.city).toBe(''); expect(result.countryCode).toBeUndefined(); expect(result.cityLocation).toBeUndefined();
    }
    expect(enrichLocation(event({ address: 'Via Roma 12, Bologna' })).city).toBe('Bologna');
    expect(enrichLocation(event({ address: 'Via Quarnaro 1 89135 Reggio Calabria' })).city).toBe('Reggio Calabria');
    expect(enrichLocation(event({ address: 'Street, United Kingdom' })).city).toBe('Street');
  });
});
describe('location filtering and portable drafts', () => {
  const amsterdam = resolveCity('Amsterdam', 'NL')!;
  it('uses venue coordinates first, with optional city estimates for missing coordinates', () => {
    const haarlem = { city: 'Haarlem', countryCode: 'NL', latitude: 52.3874, longitude: 4.6462 };
    expect(distanceKm(amsterdam, haarlem)).toBeGreaterThan(15); expect(distanceKm(amsterdam, haarlem)).toBeLessThan(20);
    expect(matchesLocation(haarlem, 'Amsterdam|NL', '', amsterdam, 25)).toBe(true);
    expect(matchesLocation(haarlem, 'Amsterdam|NL', '', amsterdam, 10)).toBe(false);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'NL' }, 'Amsterdam|NL', '', amsterdam, 25)).toBe(true);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'NL' }, 'Amsterdam|NL', '', amsterdam, 25, true)).toBe(false);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'US' }, 'Amsterdam|NL', '', amsterdam, 25)).toBe(false);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'NL', latitude: 52.52, longitude: 13.405 }, 'Amsterdam|NL', '', amsterdam, 25)).toBe(false);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'NL' }, 'Amsterdam|NL', '', amsterdam, 0)).toBe(true);
    expect(matchesLocation({ city: 'Amsterdam', countryCode: 'NL', cityId: amsterdam.id + 1 }, 'Amsterdam|NL', '', amsterdam, 0)).toBe(false);
  });
  it('keeps Reggio address-only events in radius results and includes nearby city estimates', () => {
    const reggio = resolveCity('Reggio Calabria', 'IT')!;
    const local = enrichLocation(event({ address: 'Via Nino Bixio 44, Reggio Calabria, RC' }), source);
    const nearby = enrichLocation(event({ address: 'Messina, Italy' }), source);
    const far = enrichLocation(event({ address: 'Catania, Italy' }), source);
    expect(matchesLocation(local, 'Reggio Calabria|IT', '', reggio, 0)).toBe(true);
    for (const radius of [5, 10, 25, 50, 100, 250, 500]) expect(matchesLocation(local, 'Reggio Calabria|IT', '', reggio, radius)).toBe(true);
    expect(matchesLocation(nearby, 'Reggio Calabria|IT', '', reggio, 25)).toBe(true);
    expect(matchesLocation(nearby, 'Reggio Calabria|IT', '', reggio, 5)).toBe(false);
    expect(matchesLocation(far, 'Reggio Calabria|IT', '', reggio, 25)).toBe(false);
    expect(matchesLocation(local, 'Reggio Calabria|IT', '', reggio, 25, true)).toBe(false);
    expect(local.latitude).toBeUndefined(); expect(nearby.latitude).toBeUndefined();
    expect(matchesLocation(event(), 'Reggio Calabria|IT', '', reggio, 500)).toBe(false);
  });
  it('supports country alone and optional country restriction on cross-border radii', () => {
    const berlin = resolveCity('Berlin', 'DE')!;
    expect(matchesLocation({ city: 'Berlin', countryCode: 'DE' }, '', 'DE', null, 0)).toBe(true);
    expect(matchesLocation({ city: 'London', countryCode: 'CA' }, 'London|GB', '', null, 0)).toBe(false);
    expect(matchesLocation({ city: '', latitude: 0, longitude: 0 }, '', 'unknown', null, 0)).toBe(true);
    expect(matchesLocation({ city: 'Example', countryCode: 'PL', latitude: 52.5, longitude: 14.6 }, 'Berlin', '', berlin, 100)).toBe(true);
    expect(matchesLocation({ city: 'Example', countryCode: 'PL', latitude: 52.5, longitude: 14.6 }, 'Berlin', 'DE', berlin, 100)).toBe(false);
  });
  it('handles longitude wrap and preserves the country when importing a draft', () => {
    expect(distanceKm({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 })).toBeLessThan(23);
    const imported = parseImport({ format: 'commons-events', version: 1, events: [event({ city: 'Amsterdam', countryCode: 'NL' })] });
    expect(imported[0].countryCode).toBe('NL');
  });
});
