import { hasCoordinates } from './location';
import type { EventRecord } from './types';
import type { MapPoint } from './map-index';

// Display positions are separate from venue coordinates. Never export an estimate
// as a venue, use it for a precise radius check, or pretend an unknown city is known.
export function mapPoint(event: EventRecord): MapPoint | null {
  if (hasCoordinates(event)) return { id: event.id, latitude: event.latitude, longitude: event.longitude, approximate: false, kind: 'venue' };
  if (event.addressLocation && hasCoordinates(event.addressLocation)) return { id: event.id, latitude: event.addressLocation.latitude, longitude: event.addressLocation.longitude, approximate: event.addressLocation.precision === 'street', kind: event.addressLocation.precision };
  if (event.cityLocation && hasCoordinates(event.cityLocation)) return { id: event.id, ...event.cityLocation, approximate: true, kind: 'city' };
  return null;
}
