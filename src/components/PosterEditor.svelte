<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Upload, ScanLine, Plus, Trash2, ArrowRight, LoaderCircle, MapPin, FileText, AlertCircle } from '@lucide/svelte';
  import type { EventRecord, Category } from '../lib/types';
  import { categories } from '../lib/types';
  import { cities, coordinate } from '../lib/events';
  import { extractPoster, localDateTime, zonedDateTimeToISO } from '../lib/poster';
  import EventMap from './LazyMap.svelte';
  let { draft, onSave, onCancel }: { draft?: EventRecord; onSave: (event: EventRecord) => Promise<void>; onCancel: () => void } = $props();
  // Each dialog mounts a fresh editor. Initialize once so typing isn't overwritten by prop changes.
  const initialDraft = untrack(() => draft);
  let title = $state(initialDraft?.title || '');
  let description = $state(initialDraft?.description || '');
  let venue = $state(initialDraft?.venue || '');
  let city = $state(initialDraft?.city || '');
  let address = $state(initialDraft?.address || '');
  let category = $state<Category>(initialDraft?.categories[0] || 'Other');
  let timezone = $state(initialDraft?.timezone || 'Europe/Rome');
  let latitude = $state(initialDraft?.latitude?.toString() || '');
  let longitude = $state(initialDraft?.longitude?.toString() || '');
  let dates = $state(initialDraft?.occurrences.map(occ => ({ start: localDateTime(occ.start, initialDraft.timezone), end: occ.end ? localDateTime(occ.end, initialDraft.timezone) : '' })) || [{ start: '', end: '' }]);
  let imageBlob = $state<Blob | undefined>(initialDraft?.imageBlob);
  let imagePreview = $state(initialDraft?.imageBlob ? URL.createObjectURL(initialDraft.imageBlob) : '');
  let rawText = $state('');
  let referenceYear = $state(new Date().getFullYear());
  let warnings = $state<string[]>([]);
  let error = $state('');
  let busy = $state(false);
  let saving = $state(false);
  let progress = $state('');
  let showText = $state(false);
  let showMap = $state(false);
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
  let disposed = false;
  onDestroy(() => { disposed = true; if (imagePreview) URL.revokeObjectURL(imagePreview); void worker?.terminate().catch(() => {}); });
  async function chooseImage(file?: File) {
    if (!file) return;
    error = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { error = 'Choose a JPEG, PNG or WebP poster.'; return; }
    if (file.size > 15 * 1024 * 1024) { error = 'Choose an image smaller than 15 MB.'; return; }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    imagePreview = URL.createObjectURL(file); imageBlob = file;
    await scan();
  }
  function applyText() {
    const suggestion = extractPoster(rawText, referenceYear);
    title = suggestion.title; description = suggestion.description; venue = suggestion.venue; city = suggestion.city;
    category = suggestion.category; warnings = suggestion.warnings;
    // An incomplete datetime-local value is invalid. Keep the detected day separately visible until a time is supplied.
    suggestedDays = suggestion.dates;
    dates = suggestion.dates.length ? suggestion.dates.map(date => ({ start: suggestion.time ? `${date}T${suggestion.time}` : '', end: '' })) : [{ start: '', end: '' }];
  }
  let suggestedDays = $state<string[]>([]);
  async function scan() {
    if (!imageBlob || busy) return;
    busy = true; error = ''; progress = 'Preparing local text recognition…';
    try {
      const { createWorker } = await import('tesseract.js');
      if (disposed) return;
      worker = await createWorker(['ita', 'eng'], 1, {
        workerPath: new URL('ocr/worker.min.js', document.baseURI).href,
        corePath: new URL('ocr/', document.baseURI).href,
        logger: message => { if (!disposed) progress = `${message.status} ${Math.round(message.progress * 100)}%`; },
      });
      if (disposed) { await worker.terminate(); return; }
      const result = await worker.recognize(imageBlob);
      if (!disposed) { rawText = result.data.text; applyText(); showText = true; }
    } catch { if (!disposed) error = 'Text recognition could not finish. You can paste the poster text or fill in the fields manually. Language downloads require an internet connection.'; }
    finally { await worker?.terminate().catch(() => {}); worker = undefined; if (!disposed) busy = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); error = ''; saving = true;
    try {
      if (!title.trim() || !city.trim()) throw new Error('Add a title and city or area.');
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error('Enter a valid IANA timezone, such as Europe/Rome or America/New_York.'); }
      const occurrences = dates.map(date => {
        if (!date.start) throw new Error('Every occurrence needs a start date and time.');
        const start = zonedDateTimeToISO(date.start, timezone);
        const end = date.end ? zonedDateTimeToISO(date.end, timezone) : undefined;
        if (end && end <= start) throw new Error('An end time must be after its start.');
        return { start, ...(end ? { end } : {}) };
      }).sort((a, b) => a.start.localeCompare(b.start));
      if (new Set(occurrences.map(occ => occ.start)).size !== occurrences.length) throw new Error('Two occurrences have the same start. Remove the duplicate or adjust the time.');
      const lat = coordinate(latitude, 90), lon = coordinate(longitude, 180);
      if ((latitude && lat === undefined) || (longitude && lon === undefined) || Boolean(latitude) !== Boolean(longitude)) throw new Error('Enter both valid coordinates, or leave both empty.');
      const now = new Date().toISOString();
      await onSave({ id: draft?.id || `draft:${crypto.randomUUID()}`, title: title.trim(), description, venue, address, city: city.trim(), latitude: lat, longitude: lon,
        categories: [category], tags: [...(draft?.tags || [])], occurrences, timezone, sourceId: 'local', sourceName: 'Local draft', sourceUrl: '', local: true,
        status: draft?.status || 'scheduled', updatedAt: now, cachedAt: now, imageBlob });
    } catch (reason) { error = reason instanceof Error ? reason.message : 'The draft could not be saved. Try exporting or freeing browser storage.'; }
    finally { saving = false; }
  }
</script>

<div class="editor-intro"><p>Upload a poster or enter event details. Your image and draft stay on this device.</p></div>
<div class="editor-grid">
  <div class="poster-column">
    <label class="poster-upload" class:has-image={!!imagePreview}>
      {#if imagePreview}<img src={imagePreview} alt="Your event poster" />{:else}<div class="upload-art"><ScanLine size={44} strokeWidth={1} /></div><strong>Upload poster</strong><span>Choose an image from your device</span><small>JPG, PNG or WebP · up to 15 MB</small>{/if}
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose poster image" disabled={busy} onchange={event => chooseImage(event.currentTarget.files?.[0])} />
      {#if imagePreview}<span class="replace-poster"><Upload size={14} /> Replace poster</span>{/if}
    </label>
    {#if busy}<div class="ocr-progress" role="status"><LoaderCircle size={16} class="spin" /> {progress}</div>{/if}
    {#if imagePreview}<button class="text-button" disabled={busy} onclick={scan}><ScanLine size={15} /> Read poster again</button>{/if}
    <p class="small muted">Recognition runs in your browser. Italian and English language files download on first use. Posters are never sent to an AI service.</p>
    <button class="text-button" onclick={() => showText = !showText}><FileText size={15} /> {showText ? 'Hide extracted text' : 'Paste or inspect poster text'}</button>
    {#if showText}
      <label class="field">Poster text<textarea rows="8" bind:value={rawText} placeholder="Paste the text if recognition misses something…"></textarea></label>
      <label class="field">Year when not printed<input type="number" min="2000" max="2100" bind:value={referenceYear} /></label>
      <button class="secondary-button" disabled={!rawText.trim() || busy} onclick={applyText}>Extract event details <ArrowRight size={15} /></button>
      <p class="small muted">Extraction replaces the form suggestions. Check them before saving.</p>
    {/if}
  </div>
  <form class="draft-form" onsubmit={save}>
    {#if warnings.length}<div class="notice"><AlertCircle size={17} /><div>{#each warnings as warning}<p>{warning}</p>{/each}</div></div>{/if}
    <label class="field">Event title <span class="required">*</span><input required maxlength="250" bind:value={title} placeholder="Event title" /></label>
    <div class="two-fields"><label class="field">Category<select bind:value={category}>{#each categories.filter(c => c !== 'All') as value}<option>{value}</option>{/each}</select></label><label class="field">City or area <span class="required">*</span><input required bind:value={city} list="draft-cities" placeholder="e.g. Reggio Calabria" /><datalist id="draft-cities">{#each Object.keys(cities) as value}<option value={value}></option>{/each}</datalist></label></div>
    <label class="field">Venue<input bind:value={venue} placeholder="Library, community space, park…" /></label>
    <label class="field">Public address<input bind:value={address} placeholder="Optional — share only the precision you want public" /></label>
    <button type="button" class="text-button" onclick={() => showMap = !showMap}><MapPin size={15} /> {showMap ? 'Hide location picker' : 'Choose a location on the map'}</button>
    {#if showMap}<EventMap center={cities[city] || cities['Reggio Calabria']} picked={latitude && longitude ? [Number(latitude), Number(longitude)] : undefined} onPick={(lat, lon) => { latitude = lat.toFixed(6); longitude = lon.toFixed(6); }} />{/if}
    <div class="two-fields"><label class="field">Latitude <span class="muted">optional</span><input type="number" min="-90" max="90" step="any" value={latitude} oninput={event => latitude = event.currentTarget.value} /></label><label class="field">Longitude <span class="muted">optional</span><input type="number" min="-180" max="180" step="any" value={longitude} oninput={event => longitude = event.currentTarget.value} /></label></div>
    <div class="field-label">Dates & times <span class="required">*</span></div><p class="small muted">Add separate occurrences for separate days. For a continuous event, set its end date.</p>
    <label class="field">Event timezone<input required list="event-timezones" bind:value={timezone} placeholder="e.g. Europe/Rome" /><datalist id="event-timezones"><option>Europe/Rome</option><option>Europe/London</option><option>Europe/Paris</option><option>America/New_York</option><option>America/Los_Angeles</option><option>Asia/Tokyo</option><option>Australia/Sydney</option><option>UTC</option></datalist></label>
    {#each dates as occurrence, i}
      <div class="occurrence-editor"><div class="occurrence-top"><strong>Occurrence {i + 1}</strong>{#if dates.length > 1}<button type="button" class="icon-button" aria-label={`Remove occurrence ${i + 1}`} onclick={() => dates = dates.filter((_, index) => index !== i)}><Trash2 size={15} /></button>{/if}</div>
        {#if suggestedDays[i] && !occurrence.start}<p class="small">Detected day: <strong>{suggestedDays[i]}</strong>. Choose its date and time below.</p>{/if}
        <label class="field">Starts<input type="datetime-local" required bind:value={occurrence.start} /></label><label class="field">Ends <span class="muted">optional</span><input type="datetime-local" bind:value={occurrence.end} /></label>
      </div>
    {/each}
    <button type="button" class="text-button" onclick={() => dates = [...dates, { start: '', end: '' }]}><Plus size={15} /> Add another occurrence</button>
    <label class="field">Description<textarea rows="5" bind:value={description} placeholder="What should someone know before joining?"></textarea></label>
    {#if error}<p class="error-message" role="alert">{error}</p>{/if}
    <div class="editor-actions"><button type="button" class="secondary-button" onclick={onCancel}>Cancel</button><button class="primary-button" disabled={busy || saving}>{saving ? 'Saving…' : 'Save local draft'} <ArrowRight size={16} /></button></div>
    <p class="small muted">Saving does not publish this event. You can export it as JSON or a calendar file.</p>
  </form>
</div>
