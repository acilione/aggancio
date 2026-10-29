import { countryName, distanceKm, hasCoordinates, normalizedName } from './location';
import type { AddressLocation, EventRecord } from './types';

export const defaultGeocoder = 'https://photon.komoot.io/api/';
export interface AddressCacheEntry { key: string; checkedAt: number; location: AddressLocation | null }
export type AddressCache = Record<string, AddressCacheEntry>;
type AddressEvent = Pick<EventRecord, 'address' | 'city' | 'countryCode' | 'cityLocation'>;
export function normalizeAddress(value: string) {
  return normalizedName(value.replace(/\bp\.?\s*za\b/gi, 'piazza').replace(/\bp\.?\s*le\b/gi, 'piazzale').replace(/\bv\.?\s*le\b/gi, 'viale'));
}
export function geocoderURL(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS Photon API endpoint, or an HTTP endpoint on localhost.');
  return url.href;
}
export function addressKey(event: AddressEvent, provider = defaultGeocoder) {
  return `${provider}|${normalizeAddress(event.address)}|${normalizedName(event.city)}|${event.countryCode || ''}`;
}
export function hasStreetAddress(event: AddressEvent) {
  const address = normalizeAddress(event.address);
  if (!address || address === normalizedName(event.city)) return false;
  return address.split(' ').filter(part => !normalizedName(`${event.city} ${countryName(event.countryCode)}`).split(' ').includes(part) && !/^\d{4,6}$/.test(part)).length >= 2;
}
export function freshEntry(entry?: AddressCacheEntry) {
  return !!entry && Date.now() - entry.checkedAt < (entry.location ? 30 : 1) * 86400000;
}
export function validAddressLocation(value: unknown, event: AddressEvent): AddressLocation | undefined {
  const place = value as AddressLocation | undefined;
  if (!place || !hasCoordinates(place) || !['address', 'street'].includes(place.precision) || typeof place.label !== 'string' || place.label.length > 1000 || typeof place.provider !== 'string') return;
  try { if (geocoderURL(place.provider) !== place.provider || place.key !== addressKey(event, place.provider)) return; } catch { return; }
  if (!/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(place.osmUrl)) return;
  return place;
}
export function applyAddressCache(event: EventRecord, cache: AddressCache, provider = defaultGeocoder): EventRecord {
  if (hasCoordinates(event)) return event;
  const entry = cache[addressKey(event, provider)];
  const location = freshEntry(entry) ? validAddressLocation(entry.location, event) : undefined;
  return location ? { ...event, addressLocation: location } : event;
}

const roadWords = new Set(['via', 'viale', 'piazza', 'piazzale', 'corso', 'largo', 'street', 'st', 'road', 'rd', 'avenue', 'ave', 'rue', 'calle', 'strasse', 'straße']);
export function selectAddressMatch(payload: unknown, event: AddressEvent, provider = defaultGeocoder): AddressLocation | null {
  const features = (payload as { features?: any[] })?.features;
  if (!Array.isArray(features)) throw new Error('The address service returned an invalid response.');
  const address = normalizeAddress(event.address);
  const candidates: AddressLocation[] = [];
  for (const feature of features.slice(0, 20)) {
    const p = feature?.properties; const coordinates = feature?.geometry?.coordinates;
    if (!p || feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
    const point = { latitude: coordinates[1], longitude: coordinates[0] };
    if (!hasCoordinates(point) || point.latitude === 0 && point.longitude === 0) continue;
    if (event.countryCode && String(p.countrycode).toUpperCase() !== event.countryCode) continue;
    const knownCity = event.cityLocation;
    // Country/city checks disambiguate identically named streets in different towns.
    if (knownCity && distanceKm(knownCity, point) > 30) continue;
    if (p.city && event.city && normalizedName(p.city) !== normalizedName(event.city) && (!knownCity || distanceKm(knownCity, point) > 5)) continue;
    if (!knownCity && (!event.city || normalizedName(p.city || '') !== normalizedName(event.city))) continue;
    const street = String(p.street || (p.type === 'street' || p.osm_key === 'highway' ? p.name || '' : ''));
    const streetTokens = normalizeAddress(street).split(' ').filter(token => token && !roadWords.has(token));
    // Require the informative words of the supplied street, allowing expanded
    // names such as "P.za Stuparich" -> "Piazza Carlo Stuparich".
    const addressTokens = address.split(' ').filter(token => !roadWords.has(token) && !normalizedName(`${event.city} ${countryName(event.countryCode)}`).split(' ').includes(token) && !/^\d/.test(token));
    if (!streetTokens.length || !addressTokens.length || !addressTokens.some(token => streetTokens.includes(token))) continue;
    const suppliedStreet = normalizeAddress(event.address.split(',')[0]).split(' ').filter(token => !roadWords.has(token) && !/^\d/.test(token) && !normalizedName(event.city).split(' ').includes(token));
    if (!suppliedStreet.length || !suppliedStreet.every(token => streetTokens.includes(token))) continue;
    const house = normalizedName(String(p.housenumber || ''));
    const streetLine = normalizeAddress(event.address.split(',')[0]);
    const number = streetLine.match(/\b(\d{1,4}[a-z]?)$/)?.[1] || streetLine.match(/^(\d{1,4}[a-z]?)\b/)?.[1];
    const numbers = number ? [number] : [];
    if (house && !numbers.includes(house)) continue;
    const precision = house ? 'address' : 'street';
    if (precision === 'street' && p.type !== 'street' && p.osm_key !== 'highway') continue;
    const osmType = ({ N: 'node', W: 'way', R: 'relation' } as Record<string, string>)[p.osm_type];
    if (!osmType || !/^\d+$/.test(String(p.osm_id))) continue;
    candidates.push({ ...point, precision, label: [street, house, p.city, p.country].filter(Boolean).join(', '), provider, osmUrl: `https://www.openstreetmap.org/${osmType}/${p.osm_id}`, key: addressKey(event, provider) });
  }
  const precise = candidates.filter(place => place.precision === 'address');
  const preferred = precise.length ? precise : candidates;
  if (!preferred.length) return null;
  // Multiple OSM objects at one address are normal; distant alternatives are ambiguous.
  if (preferred.some(place => distanceKm(preferred[0], place) > (precise.length ? .15 : 1))) return null;
  return preferred[0];
}

let queue: Promise<unknown> = Promise.resolve(); let lastRequest = 0;
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function lookupAddress(event: AddressEvent, provider: string, signal: AbortSignal): Promise<AddressCacheEntry> {
  const run = queue.then(async () => {
    await delay(Math.min(1100, Math.max(0, 1100 - (Date.now() - lastRequest))), signal);
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const url = new URL(geocoderURL(provider));
      url.searchParams.set('q', [normalizeAddress(event.address), event.city, countryName(event.countryCode)].filter(Boolean).join(', '));
      url.searchParams.set('limit', '5');
      if (event.countryCode) url.searchParams.set('countrycode', event.countryCode);
      if (event.cityLocation) { url.searchParams.set('lat', String(event.cityLocation.latitude)); url.searchParams.set('lon', String(event.cityLocation.longitude)); }
      lastRequest = Date.now();
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429 ? 'Address service is busy. Please try again later.' : `Address service returned HTTP ${response.status}.`);
      const location = selectAddressMatch(await response.json(), event, provider);
      return { key: addressKey(event, provider), checkedAt: Date.now(), location };
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  });
  queue = run.catch(() => {}); return run;
}
