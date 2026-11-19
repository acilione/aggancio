<script lang="ts">
  import CitySearch from './CitySearch.svelte';
  import { preferredCityFilter } from '../lib/city-preferences';
  import { countryOptions, countryName, type CityLocation } from '../lib/location';
  let { city = $bindable(''), country = $bindable(''), radius = $bindable(0), center = $bindable<CityLocation | null>(null), exactOnly = $bindable(false) }: { city?: string; country?: string; radius?: number; center?: CityLocation | null; exactOnly?: boolean } = $props();
  function choose(value: CityLocation) { center = value; city = `${value.name}|${value.countryCode}`; }
  function changeCountry(value: string) { country = value; city = ''; center = null; radius = 0; }
</script>
<div class="location-filters">
  <CitySearch country={country === 'unknown' ? '' : country} onSelect={choose} />
  <label class="field">Country<select aria-label="Country" value={country} onchange={event => changeCountry(event.currentTarget.value)}><option value="">All countries</option>{#each countryOptions as item}<option value={item.code}>{item.name}</option>{/each}<option value="unknown">Country not supplied</option></select></label>
  <label class="field">Distance<select aria-label="Distance" bind:value={radius} disabled={!center}><option value={0}>City only</option>{#each [5, 10, 25, 50, 100, 250, 500] as km}<option value={km}>Within {km} km</option>{/each}</select></label>
</div>
{#if center && radius > 0}<p class="location-explanation">Within {radius} km of {center.name}, {countryName(center.countryCode)} (city centre). Distance uses venue coordinates or house-number matches. Street and city estimates are marked “Distance unverified” and may lie outside the radius. <button class="inline-link" onclick={() => radius = 0}>City only</button></p>
<label class="location-explanation"><input type="checkbox" bind:checked={exactOnly} /> Only events with venue coordinates</label>
{:else if city && city !== preferredCityFilter && !center}<p class="location-explanation">Choose a city from search to enable distance filtering.</p>{/if}
<p class="location-attribution">City search runs on this device. <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p>
