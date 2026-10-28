import Dexie, { type Table } from 'dexie';
import type { EventRecord, Source } from './types';

class CommonsDatabase extends Dexie {
  events!: Table<EventRecord>;
  drafts!: Table<EventRecord>;
  settings!: Table<{ key: string; value: unknown }>;
  constructor() {
    super('commons-local');
    this.version(1).stores({ events: '&id, sourceId', drafts: '&id', settings: '&key' });
  }
}
export const db = new CommonsDatabase();
export async function saveSources(sources: Source[]) { await db.settings.put({ key: 'sources', value: JSON.parse(JSON.stringify(sources)) }); }
export async function saveSourceEvents(sourceId: string, events: EventRecord[]) {
  await db.transaction('rw', db.events, async () => {
    await db.events.where('sourceId').equals(sourceId).delete();
    await db.events.bulkPut(events);
  });
}
