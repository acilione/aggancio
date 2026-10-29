<script lang="ts">
  import { onDestroy } from 'svelte';
  import { addressKey, freshEntry, geocoderURL, hasStreetAddress, lookupAddress, type AddressCache, type AddressCacheEntry } from '../lib/address-lookup';
  import { hasCoordinates } from '../lib/location';
  import type { EventRecord } from '../lib/types';
  let { events, cache, provider, filterKey, focused, onResult, onProvider }: { events: EventRecord[]; cache: AddressCache; provider: string; filterKey: string; focused: boolean; onResult: (entry: AddressCacheEntry) => Promise<void>; onProvider: (url: string) => Promise<void> } = $props();
  let busy = $state(false); let message = $state(''); let error = $state(''); let includeDrafts = $state(false); let endpoint = $state('');
  let controller: AbortController | undefined;
  let previousFilter = ''; let disposed = false;
  const pending = $derived([...new Map(events.filter(event => !hasCoordinates(event) && (includeDrafts || !event.local) && hasStreetAddress(event) && !freshEntry(cache[addressKey(event, provider)])).map(event => [addressKey(event, provider), event])).values()]);
  $effect(() => { if (previousFilter !== filterKey) { controller?.abort(); previousFilter = filterKey; message = ''; error = ''; } });
  $effect(() => { endpoint = provider; controller?.abort(); });
  onDestroy(() => { disposed = true; controller?.abort(); });
  async function locate() {
    if (busy || !focused) return;
    const batch = pending.slice(0, 20); const current = new AbortController(); controller = current;
    busy = true; error = ''; let matched = 0; let completed = 0;
    try {
      for (const event of batch) {
        if (current.signal.aborted) break;
        message = `Looking up address ${completed + 1} of ${batch.length}…`;
        const entry = await lookupAddress(event, provider, current.signal);
        if (current.signal.aborted || disposed) break;
        await onResult(entry); completed++; if (entry.location) matched++;
      }
      if (!disposed && !current.signal.aborted) message = `${matched} of ${completed} addresses located. Unmatched or ambiguous addresses keep their previous marker.`;
    } catch (reason) {
      if (!disposed && !current.signal.aborted) error = reason instanceof Error && reason.name !== 'AbortError' ? reason.message : 'Address lookup timed out. Try again later.';
    } finally { if (!disposed) { busy = false; if (current.signal.aborted) message = 'Address lookup stopped.'; } }
  }
  async function saveProvider() {
    try { await onProvider(geocoderURL(endpoint)); error = ''; message = 'Address service updated.'; }
    catch (reason) { error = (reason as Error).message; }
  }
</script>
<div class="address-lookup">
  <div class="lookup-actions"><button class="text-button" disabled={busy || !focused || !pending.length} onclick={locate}>Locate street addresses{pending.length ? ` (${Math.min(20, pending.length)})` : ''}</button>{#if busy}<button class="text-button" onclick={() => controller?.abort()}>Stop lookup</button>{/if}</div>
  <p class="small muted">This action sends the listed addresses to <a href={provider} target="_blank" rel="noopener noreferrer">Photon</a> to find street locations. Results are saved on this device. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.</p>
  {#if !focused}<p class="small muted">Choose a city or narrow the results to 20 events before looking up addresses.</p>{/if}
  {#if events.some(event => event.local)}<label class="small"><input type="checkbox" bind:checked={includeDrafts} disabled={busy} /> Include local draft addresses in this lookup</label>{/if}
  {#if message}<p class="small" role="status">{message}</p>{/if}{#if error}<p class="small error-text" role="alert">{error}</p>{/if}
  <details><summary>Address service</summary><label class="field">Photon API endpoint<input type="url" bind:value={endpoint} disabled={busy} /></label><button class="text-button" disabled={busy} onclick={saveProvider}>Save address service</button></details>
</div>
<style>
  .address-lookup { padding: 10px 0; border-top: 1px solid var(--line); margin-top: 12px; }
  .lookup-actions { display: flex; justify-content: space-between; gap: 10px; }
  p { margin: 6px 0; }
  summary { font-size: 11px; cursor: pointer; margin-top: 8px; }
  .field { margin-top: 8px; }
</style>
