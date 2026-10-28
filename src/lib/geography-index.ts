import data from '../data/geography.json';
import topology from 'world-atlas/countries-50m.json';
import { feature } from 'topojson-client';
import { geoBounds, geoContains } from 'd3-geo';
import { countryCode, normalizedName, hasCoordinates, distanceKm, type CityLocation } from './location';
import type { EventRecord, Source } from './types';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

const labels: Record<number, string> = { 3165524: 'Torino', 3169070: 'Roma', 3173435: 'Milano', 3172394: 'Napoli', 3176959: 'Firenze', 3176219: 'Genova', 3171728: 'Padova', 3164603: 'Venezia' };
const aliasGroups = [['Torino', 'Turin'], ['Roma', 'Rome'], ['Milano', 'Milan'], ['Napoli', 'Naples'], ['Firenze', 'Florence'], ['Genova', 'Genoa'], ['Padova', 'Padua'], ['Venezia', 'Venice'], ['Den Haag', 'The Hague'], ['München', 'Munich', 'Monaco di Baviera'], ['Köln', 'Cologne'], ['Wien', 'Vienna'], ['Lisboa', 'Lisbon'], ['Praha', 'Prague'], ['København', 'Copenhagen'], ['Bruxelles', 'Brussels'], ['New York City', 'New York']];
const extraNames = new Map(aliasGroups.flatMap(group => group.map(name => [normalizedName(name), group] as const)));
const cities: (CityLocation & { population: number; names: string[] })[] = data.cities.map(row => {
  const [id, name, ascii, country, latitude, longitude, population, admin] = row as [number, string, string, string, number, number, number, string];
  const label = labels[id] || name;
  return { id, name: label, countryCode: country, latitude, longitude, population, admin, names: [...new Set([label, name, ascii, ...(extraNames.get(normalizedName(label)) || [])].map(normalizedName))] };
});
const byName = new Map<string, typeof cities>();
const grid = new Map<string, typeof cities>();
for (const city of cities) {
  for (const name of city.names) byName.set(name, [...(byName.get(name) || []), city]);
  const cell = `${Math.floor(city.latitude)},${Math.floor(city.longitude)}`;
  const entries = grid.get(cell) || []; entries.push(city); grid.set(cell, entries);
}
const numericCodes = new Map(Object.entries(data.countries).map(([code, country]) => [country.numeric, code]));
const shapes = (feature(topology as any, topology.objects.countries as any) as unknown as { features: Feature<Polygon | MultiPolygon>[] }).features.map(shape => ({ shape, bounds: geoBounds(shape), code: numericCodes.get(String(shape.id).padStart(3, '0')) || '' }));
const countryCache = new Map<string, string>();
function coordinateCountry(latitude: number, longitude: number) {
  const key = `${latitude},${longitude}`;
  if (countryCache.has(key)) return countryCache.get(key)!;
  const match = shapes.find(({ shape, bounds: [[west, south], [east, north]] }) => latitude >= south && latitude <= north && (west <= east ? longitude >= west && longitude <= east : longitude >= west || longitude <= east) && geoContains(shape, [longitude, latitude]));
  const code = match?.code || '';
  if (countryCache.size > 20000) countryCache.clear();
  countryCache.set(key, code); return code;
}
function publicCity(city: typeof cities[number]): CityLocation {
  return { id: city.id, name: city.name, countryCode: city.countryCode, latitude: city.latitude, longitude: city.longitude, admin: city.admin };
}
export function searchCities(query: string, country = ''): CityLocation[] {
  const parts = query.split(',').map(normalizedName); const needle = parts[0];
  if (needle.length < 2) return [];
  const nation = country || countryCode(parts[1]);
  const eligible = cities.filter(city => (!nation || city.countryCode === nation) && city.names.some(name => name.includes(needle)));
  return eligible.sort((a, b) => Number(b.names.includes(needle)) - Number(a.names.includes(needle)) || Number(b.names.some(name => name.startsWith(needle))) - Number(a.names.some(name => name.startsWith(needle))) || b.population - a.population).slice(0, 12).map(publicCity);
}
export function resolveCity(name: string, country = '', point?: { latitude: number; longitude: number }): CityLocation | null {
  let candidates = (byName.get(normalizedName(name)) || []).filter(city => !country || city.countryCode === country);
  if (point) candidates = candidates.filter(city => distanceKm(point, city) <= 60).sort((a,b) => distanceKm(point,a) - distanceKm(point,b));
  if (!candidates.length) return null;
  if (!point && !country && candidates.length > 1 && candidates[0].population < candidates[1].population * 5) return null;
  return publicCity(candidates[0]);
}
export function sourceLocation(source?: Pick<Source, 'city' | 'region' | 'countryCode'>): CityLocation | null {
  if (!source) return null;
  const parts = (source.region || '').split(',').map(part => part.trim());
  return resolveCity(source.city || parts[0], countryCode(source.countryCode) || countryCode(parts.at(-1)));
}
function nearestCity(point: { latitude: number; longitude: number }, country: string): CityLocation | null {
  let nearest: typeof cities[number] | undefined; let distance = 25;
  const lonSpan = Math.min(12, Math.ceil(1 / Math.max(0.1, Math.cos(point.latitude * Math.PI / 180))));
  for (let lat = Math.floor(point.latitude) - 1; lat <= Math.floor(point.latitude) + 1; lat++) {
    for (let lon = Math.floor(point.longitude) - lonSpan; lon <= Math.floor(point.longitude) + lonSpan; lon++) {
      const wrap = ((lon + 180) % 360 + 360) % 360 - 180;
      for (const city of grid.get(`${lat},${wrap}`) || []) {
        if (country && city.countryCode !== country) continue;
        const km = distanceKm(point, city); if (km < distance) { distance = km; nearest = city; }
      }
    }
  }
  return nearest ? publicCity(nearest) : null;
}
function addressCity(address: string, country: string, point?: { latitude: number; longitude: number }) {
  const tokens = normalizedName(address).split(' ');
  for (let end = tokens.length; end > 0; end--) {
    for (let size = Math.min(6, end); size >= 1; size--) {
      const name = tokens.slice(end - size, end).join(' ');
      if (name.length < 4) continue;
      const match = resolveCity(name, country, point); if (match) return match;
    }
  }
  return null;
}
export function enrichLocation(event: EventRecord, source?: Source): EventRecord {
  if (event.geographyVersion === 1) return event;
  const result = { ...event, geographyVersion: 1 };
  const point = hasCoordinates(event) ? { latitude: event.latitude, longitude: event.longitude } : undefined;
  const explicitCountry = countryCode(event.countryCode);
  const geoCountry = point ? coordinateCountry(point.latitude, point.longitude) : '';
  const addressCountry = countryCode(event.address.split(',').at(-1));
  const hint = sourceLocation(source);
  const regionCountry = countryCode(source?.countryCode) || countryCode(source?.region?.split(',').at(-1)) || hint?.countryCode || '';
  let country = explicitCountry || geoCountry || addressCountry;
  result.countryBasis = explicitCountry ? 'provided' : geoCountry ? 'coordinates' : addressCountry ? 'address' : undefined;
  // Old caches used a narrow city heuristic. Re-read their address/coordinates before trusting that label.
  const supplied = event.cityBasis === 'provided' || event.local || source?.kind === 'snapshot';
  let city = supplied && event.city ? resolveCity(event.city, country || (!point ? regionCountry : ''), point) || (!country ? resolveCity(event.city, '', point) : null) : null;
  let basis: EventRecord['cityBasis'] = city ? 'provided' : undefined;
  if (!city) {
    city = addressCity(event.address, country || (!point ? regionCountry : ''), point);
    if (!city && !country && !point && regionCountry) city = addressCity(event.address, '');
    if (city) basis = 'address';
  }
  if (!city && point) { city = nearestCity(point, country); if (city) basis = 'coordinates'; }
  if (!city && !point && !event.address && !event.city && hint) { city = hint; basis = 'source'; }
  // City-scoped calendars can supply a fallback only if the event has no identifiable alternative city.
  if (!city && !point && !supplied && hint) { city = hint; basis = 'source'; }
  if (!city && event.city) { city = resolveCity(event.city, country || regionCountry); if (city) basis = supplied ? 'provided' : 'source'; }
  if (city) { result.city = city.name; result.cityId = city.id; result.cityBasis = basis; }
  else { result.city = supplied ? event.city : ''; result.cityId = undefined; result.cityBasis = supplied && event.city ? 'provided' : undefined; }
  if (!country && city) { country = city.countryCode; result.countryBasis = basis === 'source' ? 'source' : 'city'; }
  if (!country && !point && !event.city && regionCountry) { country = regionCountry; result.countryBasis = 'source'; }
  result.countryCode = country || undefined;
  return result;
}
