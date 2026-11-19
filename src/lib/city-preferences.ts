import { hasCoordinates, normalizedName, type CityLocation } from './location';
import type { EventRecord } from './types';

export const preferredCityFilter = '@preferred';

export function readPreferredCities(value: unknown): CityLocation[] {
  if (!Array.isArray(value)) return [];
  return [...new Map(value.filter(city => city && Number.isSafeInteger(city.id) && typeof city.name === 'string'
    && typeof city.countryCode === 'string' && hasCoordinates(city)).map((city: CityLocation) => [city.id, city])).values()];
}

export function preferredCityMatcher(cities: CityLocation[]) {
  const key = (name: string, country?: string) => normalizedName(name) + '|' + country;
  const ids = new Set(cities.map(city => city.id));
  const names = new Set(cities.map(city => key(city.name, city.countryCode)));
  return (event: EventRecord) => event.cityId ? ids.has(event.cityId) : names.has(key(event.city, event.countryCode));
}
