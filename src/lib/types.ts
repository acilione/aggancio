export type Category = 'All' | 'Music' | 'Arts & culture' | 'Games & chess' | 'Sport & outdoors' | 'Learning' | 'Community' | 'Other';
export const categories: Category[] = ['All', 'Music', 'Arts & culture', 'Games & chess', 'Sport & outdoors', 'Learning', 'Community', 'Other'];
export interface Occurrence { start: string; end?: string }
export interface Source {
  id: string;
  name: string;
  url: string;
  kind: 'gancio' | 'snapshot';
  city: string;
  timezone: string;
  enabled: boolean;
  region?: string;
  discoveredAt?: string[];
  aliases?: string[];
  checkedAt?: string;
  access?: 'available' | 'cors-blocked' | 'unavailable';
  checkMessage?: string;
  confirmedGancio?: boolean;
  timezoneUnconfirmed?: boolean;
}
export interface EventRecord {
  id: string;
  title: string;
  description: string;
  venue: string;
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
  categories: Category[];
  tags: string[];
  occurrences: Occurrence[];
  timezone: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  canonicalUrl?: string;
  imageUrl?: string;
  status: 'scheduled' | 'cancelled' | 'postponed';
  local: boolean;
  updatedAt: string;
  cachedAt: string;
  imageBlob?: Blob;
}
export interface SourceState { status: 'idle' | 'loading' | 'ready' | 'error'; count: number; message: string; fetchedAt?: string }
export interface PosterSuggestion { title: string; description: string; venue: string; city: string; category: Category; dates: string[]; time: string; warnings: string[] }
