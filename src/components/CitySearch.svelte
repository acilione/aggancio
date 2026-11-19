<script lang="ts">
  import { onDestroy } from 'svelte';
  import { geography } from '../lib/geography-client';
  import { countryName, type CityLocation } from '../lib/location';
  let { label = 'Search city', country = '', onSelect }: { label?: string; country?: string; onSelect: (value: CityLocation) => void } = $props();
  let search = $state(''); let suggestions = $state<CityLocation[]>([]); let busy = $state(false); let error = $state('');
  let sequence = 0; let disposed = false;
  onDestroy(() => { disposed = true; sequence++; });
  $effect(() => {
    const query = search.trim(); const nation = country; const current = ++sequence;
    suggestions = []; error = ''; busy = query.length >= 2;
    if (query.length < 2) return;
    const timer = setTimeout(async () => {
      try { const result = await geography.search(query, nation); if (!disposed && current === sequence) suggestions = result; }
      catch { if (!disposed && current === sequence) error = 'City search could not load. Please try again.'; }
      finally { if (!disposed && current === sequence) busy = false; }
    }, 180);
    return () => clearTimeout(timer);
  });
  function choose(value: CityLocation) { search = ''; suggestions = []; onSelect(value); }
</script>
<div class="city-lookup"><label class="field">{label}<input type="search" bind:value={search} placeholder="Amsterdam, Reggio Calabria…" autocomplete="off" /></label>
    {#if search.trim().length >= 2}<div class="city-suggestions" aria-label={label + " results"}>
      {#if busy}<p role="status">Searching cities…</p>{:else if error}<p role="alert">{error}</p>{:else if !suggestions.length}<p>No city found. Try another spelling or country.</p>{/if}
      {#each suggestions as item (item.id)}<button type="button" onclick={() => choose(item)}><strong>{item.name}</strong><span>{countryName(item.countryCode)} · {item.admin} · {item.latitude.toFixed(2)}, {item.longitude.toFixed(2)}</span></button>{/each}
    </div>{/if}
  </div>
