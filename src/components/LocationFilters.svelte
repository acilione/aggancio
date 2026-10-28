<script lang="ts">
  import { onDestroy } from 'svelte';
  import { geography } from '../lib/geography-client';
  import { countryOptions, countryName, type CityLocation } from '../lib/location';
  let { city = $bindable(''), country = $bindable(''), radius = $bindable(0), center = $bindable<CityLocation | null>(null) }: { city?: string; country?: string; radius?: number; center?: CityLocation | null } = $props();
  let search = $state(''); let suggestions = $state<CityLocation[]>([]); let busy = $state(false); let error = $state('');
  let sequence = 0; let disposed = false;
  onDestroy(() => { disposed = true; sequence++; });
  $effect(() => {
    const query = search.trim(); const nation = country === 'unknown' ? '' : country; const current = ++sequence;
    suggestions = []; error = ''; busy = query.length >= 2;
    if (query.length < 2) return;
    const timer = setTimeout(async () => {
      try { const result = await geography.search(query, nation); if (!disposed && current === sequence) suggestions = result; }
      catch { if (!disposed && current === sequence) error = 'City search could not load. Please try again.'; }
      finally { if (!disposed && current === sequence) busy = false; }
    }, 180);
    return () => clearTimeout(timer);
  });
  function choose(value: CityLocation) { center = value; city = `${value.name}|${value.countryCode}`; search = ''; suggestions = []; }
  function changeCountry(value: string) { country = value; city = ''; center = null; radius = 0; }
</script>
<div class="location-filters">
  <div class="city-lookup"><label class="field">Search city<input type="search" bind:value={search} placeholder="Amsterdam, Reggio Calabria…" autocomplete="off" /></label>
    {#if search.trim().length >= 2}<div class="city-suggestions" aria-label="City search results">
      {#if busy}<p role="status">Searching cities…</p>{:else if error}<p role="alert">{error}</p>{:else if !suggestions.length}<p>No city found. Try another spelling or country. Cities supplied by events are also in the dropdown.</p>{/if}
      {#each suggestions as item (item.id)}<button type="button" onclick={() => choose(item)}><strong>{item.name}</strong><span>{countryName(item.countryCode)} · {item.admin} · {item.latitude.toFixed(2)}, {item.longitude.toFixed(2)}</span></button>{/each}
    </div>{/if}
  </div>
  <label class="field">Country<select aria-label="Country" value={country} onchange={event => changeCountry(event.currentTarget.value)}><option value="">All countries</option>{#each countryOptions as item}<option value={item.code}>{item.name}</option>{/each}<option value="unknown">Country not supplied</option></select></label>
  <label class="field">Distance<select aria-label="Distance" bind:value={radius} disabled={!center}><option value={0}>City only</option>{#each [5, 10, 25, 50, 100, 250, 500] as km}<option value={km}>Within {km} km</option>{/each}</select></label>
</div>
{#if center && radius > 0}<p class="location-explanation">Within {radius} km of {center.name}, {countryName(center.countryCode)} (city centre). Distance uses venue coordinates; events without coordinates are excluded. <button class="inline-link" onclick={() => radius = 0}>City only</button></p>
{:else if city && !center}<p class="location-explanation">Choose a city from search to enable distance filtering.</p>{/if}
<p class="location-attribution">City search runs on this device. <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p>
