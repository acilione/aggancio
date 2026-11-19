<script lang="ts">
  import { untrack } from 'svelte';
  import Dialog from './Dialog.svelte';
  import CitySearch from './CitySearch.svelte';
  import { countryName, type CityLocation } from '../lib/location';
  let { saved, onSave, onDismiss }: {
    saved: CityLocation[];
    onSave: (values: CityLocation[]) => Promise<void>;
    onDismiss: () => void;
  } = $props();
  let cities = $state<CityLocation[]>(untrack(() => [...saved]));
  let error = $state('');
  let saving = $state(false);
  function add(city: CityLocation) {
    if (!cities.some(item => item.id === city.id)) cities = [...cities, city];
  }
  async function save() {
    saving = true;
    try { await onSave($state.snapshot(cities)); }
    catch { error = 'City preferences could not be saved on this device. Please try again.'; }
    finally { saving = false; }
  }
</script>
<Dialog title="City preferences" {onDismiss}>
  <p class="dialog-intro">Open Explore with events from any of these cities. Leave the list empty to see all cities.</p>
  <CitySearch label="Find a preferred city" onSelect={add} />
  <ul class="preferred-list">
    {#each cities as city (city.id)}
      <li><span>{city.name} · {countryName(city.countryCode)}{city.admin ? ' · ' + city.admin : ''}</span>
        <button class="text-button" aria-label={'Remove ' + city.name} onclick={() => cities = cities.filter(item => item.id !== city.id)}>Remove</button></li>
    {/each}
  </ul>
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="source-actions"><button class="primary-button" disabled={saving} onclick={save}>Save city preferences</button><button class="text-button" onclick={onDismiss}>Cancel</button></div>
</Dialog>
<style>
  .preferred-list { list-style: none; padding: 0; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding: 8px 0; }
</style>
