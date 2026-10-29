import countries from '../data/countries.json';
import type { AddressLocation } from './types';
export interface CityLocation { id: number; name: string; countryCode: string; latitude: number; longitude: number; admin: string }
export type GeoBounds = [[number, number], [number, number]];
export const countryOptions = Object.entries(countries).map(([code, value]) => ({ code, name: value.name })).sort((a, b) => a.name.localeCompare(b.name));
export const countryName = (code?: string) => countryOptions.find(country => country.code === code)?.name || '';
export function normalizedName(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
const countryNames = new Map(countryOptions.map(country => [normalizedName(country.name), country.code]));
for (const locale of ['it', 'nl', 'fr', 'de', 'es']) {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  for (const country of countryOptions) countryNames.set(normalizedName(names.of(country.code) || country.name), country.code);
}
for (const [name, code] of Object.entries({ UK: 'GB', USA: 'US', 'United States of America': 'US', Holland: 'NL', Czechia: 'CZ' })) countryNames.set(normalizedName(name), code);
export function countryCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const code = value.trim().toUpperCase();
  return code in countries ? code : countryNames.get(normalizedName(value)) || '';
}
export function hasCoordinates(value: { latitude?: number; longitude?: number }): value is { latitude: number; longitude: number } {
  return typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad; const dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function venuePosition(event: { latitude?: number; longitude?: number; addressLocation?: AddressLocation }) {
  if (hasCoordinates(event)) return { latitude: event.latitude, longitude: event.longitude };
  if (event.addressLocation?.precision === 'address' && hasCoordinates(event.addressLocation)) return event.addressLocation;
  return null;
}
export function matchesLocation(event: { city: string; cityId?: number; cityLocation?: { latitude: number; longitude: number }; addressLocation?: AddressLocation; countryCode?: string; latitude?: number; longitude?: number }, city: string, country: string, center: CityLocation | null, radius: number, exactOnly = false): boolean {
  if (country === 'unknown' ? !!event.countryCode : country && event.countryCode !== country) return false;
  if (radius > 0) {
    if (!center) return false;
    const venue = venuePosition(event);
    if (venue) return distanceKm(center, venue) <= radius;
    if (exactOnly) return false;
    if (event.addressLocation && hasCoordinates(event.addressLocation)) return distanceKm(center, event.addressLocation) <= radius;
    // City centres remain separate estimates, never venue coordinates.
    if (event.cityLocation && hasCoordinates(event.cityLocation)) return distanceKm(center, event.cityLocation) <= radius;
    return event.cityId ? event.cityId === center.id : normalizedName(event.city) === normalizedName(center.name) && event.countryCode === center.countryCode;
  }
  if (city && center && event.cityId) return event.cityId === center.id;
  const [name, code] = city.split('|');
  return !name || (normalizedName(event.city) === normalizedName(name) && (!code || event.countryCode === code));
}
