<script lang="ts">
  import type { EventRecord } from '../lib/types';
  let props: { events?: EventRecord[]; selectedId?: string; onSelect?: (event: EventRecord) => void; center?: [number, number]; onPick?: (lat: number, lon: number) => void; picked?: [number, number] } = $props();
  const component = import('./EventMap.svelte');
</script>
{#await component}<div class="map-loading" role="status">Loading map…</div>
{:then module}<module.default {...props} />
{:catch}<p role="alert">The map could not load. Events remain available in the list. Close and reopen the map to retry.</p>{/await}
