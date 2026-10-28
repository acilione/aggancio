<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ArrowUpRight, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Compass, Download, ExternalLink, FilePlus2, Globe2, Heart, Layers3, List, LoaderCircle, Map, MapPin, Music2, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sprout, Trash2, Upload, X, Pencil, Copy, Check, AlertCircle, Gamepad2, Palette, Footprints, BookOpen, Users } from '@lucide/svelte';
  import { categories, type Category, type EventRecord, type Source, type SourceState } from './lib/types';
  import { addDays, countEventDays, dayKey, deduplicate, defaultSources, formatEventDate, formatEventTime, overlapsDays, primaryOccurrence, safeUrl } from './lib/events';
  import { SourceWorkers } from './lib/source-workers';
  import { geography } from './lib/geography-client';
  import { countryName, matchesLocation, type CityLocation } from './lib/location';
  import LocationFilters from './components/LocationFilters.svelte';
  import { db, saveSourceEvents, saveSources } from './lib/storage';
  import { catalogueCheckedAt, mergeCatalogue, runSourceQueue } from './lib/sources';
  import { calendarExport, download, jsonExport, parseImport } from './lib/export';
  import Dialog from './components/Dialog.svelte';
  import EventMap from './components/LazyMap.svelte';
  import PosterEditor from './components/PosterEditor.svelte';

  let sources = $state<Source[]>([]);
  let events = $state.raw<EventRecord[]>([]);
  let drafts = $state<EventRecord[]>([]);
  let states = $state<Record<string, SourceState>>({});
  let initialized = $state(false);
  let refreshing = $state(false);
  let view = $state<'explore' | 'drafts'>('explore');
  let query = $state('');
  let city = $state('');
  let country = $state('');
  let radius = $state(0);
  let cityCenter = $state<CityLocation | null>(null);
  let sourceCities = $state<CityLocation[]>([]);
  let locationError = $state('');
  let cityResolve = 0;
  async function selectCity(value: string) {
    city = value; cityCenter = null; radius = 0;
    const current = ++cityResolve;
    if (!value) return;
    const [name, code] = value.split('|');
    const nation = code || cityChoices.find(item => item.value === value)?.countryCode || country;
    try {
      const result = await geography.resolve(name, nation);
      if (current === cityResolve && city === value) {
        cityCenter = result;
        if (result) city = `${result.name}|${result.countryCode}`;
      }
    }
    catch { locationError = 'City coordinates could not load. You can still filter by city name.'; }
  }
  let category = $state<Category>('All');
  let dateMode = $state('upcoming');
  let selectedDay = $state(dayKey(new Date()));
  let weekStart = $state(dayKey(new Date()));
  let showMap = $state(false);
  let selected = $state<EventRecord | null>(null);
  let showSources = $state(false);
  let showEditor = $state(false);
  let editing = $state<EventRecord | undefined>();
  let notice = $state('');
  let storageError = $state('');
  let detailPoster = $state('');
  let sourceName = $state('');
  let sourceUrl = $state('');
  let sourceCity = $state('');
  let sourceTimezone = $state('Europe/Rome');
  let sourceError = $state('');
  let sourceQuery = $state('');
  let sourceFilter = $state('all');
  let refreshCompleted = $state(0);
  let refreshTotal = $state(0);
  let snapshotName = $state('');
  let snapshotUrl = $state('');
  let visibleLimit = $state(30);
  let localImport: HTMLInputElement;
  let snapshotImport = $state<HTMLInputElement>();
  let savedIds = $state<string[]>([]);
  let onlySaved = $state(false);
  const controllers = new globalThis.Map<string, AbortController>();
  const workers = new SourceWorkers();
  const incoming = new globalThis.Map<string, EventRecord[]>();
  let flushTimer: ReturnType<typeof setTimeout>;
  let disposed = false;
  function flushEvents() {
    clearTimeout(flushTimer);
    if (!incoming.size || disposed) return;
    const replacements = new globalThis.Map([...incoming].filter(([id]) => sources.some(source => source.id === id && source.enabled)));
    incoming.clear();
    if (replacements.size) events = [...events.filter(event => !replacements.has(event.sourceId)), ...[...replacements.values()].flat()];
  }
  let toastTimeout: ReturnType<typeof setTimeout>;
  const today = dayKey(new Date());
  const iconFor: Record<string, typeof Music2> = { Music: Music2, 'Arts & culture': Palette, 'Games & chess': Gamepad2, 'Sport & outdoors': Footprints, Learning: BookOpen, Community: Users, Other: Sprout };

  function toast(message: string) { notice = message; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => notice = '', 6000); }
  onDestroy(() => { disposed = true; controllers.forEach(controller => controller.abort()); workers.dispose(); geography.dispose(); clearTimeout(flushTimer); clearTimeout(toastTimeout); });
  onMount(async () => {
    try {
      const [sourceSetting, cached, local, saved, catalogueSeen] = await Promise.all([db.settings.get('sources'), db.events.toArray(), db.drafts.toArray(), db.settings.get('saved'), db.settings.get('catalogue-seen')]);
      const merged = mergeCatalogue(Array.isArray(sourceSetting?.value) ? sourceSetting.value as Source[] : undefined, Array.isArray(catalogueSeen?.value) ? catalogueSeen.value as string[] : undefined);
      sources = merged.sources;
      await db.transaction('rw', db.settings, async () => {
        await saveSources(merged.sources);
        await db.settings.put({ key: 'catalogue-seen', value: merged.seen });
      });
      events = cached; drafts = local; savedIds = Array.isArray(saved?.value) ? saved.value as string[] : [];
      try {
        const [enriched, enrichedDrafts, locations] = await Promise.all([geography.enrich(cached, undefined, merged.sources), geography.enrich(local), geography.sources(merged.sources.filter(source => source.enabled))]);
        events = enriched; drafts = enrichedDrafts; sourceCities = locations;
      } catch { locationError = 'Some city and country labels could not be resolved. Refresh to retry.'; }
      for (const source of sources) {
        const cachedEvents = cached.filter(event => event.sourceId === source.id);
        states[source.id] = { status: 'idle', count: cachedEvents.length, message: source.kind === 'snapshot' ? 'Imported snapshot; refresh by importing a new file.' : 'Saved catalogue. Refreshing…', fetchedAt: cachedEvents[0]?.cachedAt };
      }
    } catch { sources = defaultSources; storageError = 'Browser storage is unavailable. Imported events can still be explored, but drafts cannot be saved until storage is available.'; }
    initialized = true;
    await refresh();
  });
  async function refreshSource(source: Source) {
    if (disposed || source.kind !== 'gancio' || !source.enabled || controllers.has(source.id)) return;
    const controller = new AbortController(); controllers.set(source.id, controller);
    const timeout = setTimeout(() => controller.abort(), 35000);
    states[source.id] = { ...states[source.id], status: 'loading', count: states[source.id]?.count || 0, message: 'Fetching public events…' };
    try {
      const result = await workers.fetch($state.snapshot(source), controller.signal);
      if (disposed || controller.signal.aborted || !sources.some(item => item.id === source.id && item.enabled)) return;
      const fetchedAt = new Date().toISOString();
      incoming.set(source.id, result.events);
      if (incoming.size === 1) flushTimer = setTimeout(flushEvents, 120);
      states[source.id] = { status: 'ready', count: result.events.length, fetchedAt, message: result.limited ? 'Partial catalogue: source pagination limit reached.' : 'Live catalogue loaded.' };
      try { await saveSourceEvents(source.id, result.events); } catch { storageError = 'The latest events could not be cached. They remain available until this page closes.'; }
    } catch (reason) {
      if (disposed || !sources.some(item => item.id === source.id && item.enabled)) return;
      const count = events.filter(event => event.sourceId === source.id).length;
      states[source.id] = { ...states[source.id], status: 'error', count, message: `${reason instanceof Error && reason.name === 'AbortError' ? 'Request timed out.' : reason instanceof TypeError ? 'Could not connect. The source may be offline or block browser access (CORS).' : reason instanceof Error ? reason.message : 'Source unavailable.'} ${count ? 'Showing the last saved catalogue; it may be outdated.' : 'No events loaded from this source.'}` };
    } finally { clearTimeout(timeout); controllers.delete(source.id); }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const pending = sources.filter(source => source.enabled && source.kind === 'gancio');
    refreshTotal = pending.length; refreshCompleted = 0;
    try {
      await runSourceQueue(pending, async source => {
        try { if (!disposed && sources.some(item => item.id === source.id && item.enabled)) await refreshSource(source); }
        finally { refreshCompleted++; }
      }, workers.concurrency);
    } finally { flushEvents(); refreshing = false; }
  }
  const matchingSources = $derived(sources.filter(source =>
    [source.name, source.url, source.city, source.region || ''].join(' ').toLowerCase().includes(sourceQuery.toLowerCase()) &&
    (sourceFilter === 'all' || (sourceFilter === 'enabled' ? source.enabled : sourceFilter === 'disabled' ? !source.enabled : states[source.id]?.status === 'error'))
  ));
  async function setMatchingEnabled(enabled: boolean) {
    const ids = new Set(matchingSources.map(source => source.id));
    const next = sources.map(source => ids.has(source.id) ? { ...source, enabled } : source);
    try { await saveSources(next); sources = next; if (enabled) await refresh(); }
    catch { sourceError = 'Could not update sources in browser storage.'; }
  }
  const enabledIds = $derived(new Set(sources.filter(source => source.enabled).map(source => source.id)));
  $effect(() => {
    for (const [id, controller] of controllers) if (!enabledIds.has(id)) controller.abort();
    for (const id of incoming.keys()) if (!enabledIds.has(id)) incoming.delete(id);
  });
  const allEvents = $derived([...events.filter(event => enabledIds.has(event.sourceId)), ...drafts]);
  const cityChoices = $derived.by(() => {
    const values = [...allEvents.map(event => ({ name: event.city, countryCode: event.countryCode || '' })), ...sourceCities, { name: 'Reggio Calabria', countryCode: 'IT' }, ...(cityCenter ? [cityCenter] : [])].filter(value => value.name && (!country || (country === 'unknown' ? !value.countryCode : value.countryCode === country)));
    const unique = [...new globalThis.Map(values.map(value => [`${value.name}|${value.countryCode}`, value])).values()];
    const names = new globalThis.Map<string, number>();
    unique.forEach(value => names.set(value.name, (names.get(value.name) || 0) + 1));
    return unique.map(value => ({ countryCode: value.countryCode, value: value.countryCode && (city === `${value.name}|${value.countryCode}` || names.get(value.name)! > 1) ? `${value.name}|${value.countryCode}` : value.name, label: `${value.name}${value.countryCode ? ` · ${countryName(value.countryCode)}` : ''}` })).sort((a,b) => a.label.localeCompare(b.label));
  });
  const failedSources = $derived(sources.filter(source => source.enabled && states[source.id]?.status === 'error'));
  const partialSources = $derived(sources.filter(source => source.enabled && states[source.id]?.message.startsWith('Partial')));
  const readySources = $derived(sources.filter(source => source.enabled && states[source.id]?.status === 'ready').length);
  const dateWindow = $derived.by(() => {
    if (dateMode === 'any') return ['0001-01-01', '9999-12-31'];
    if (dateMode === 'day') return [selectedDay, selectedDay];
    if (dateMode === 'week') return [today, addDays(today, 6)];
    if (dateMode === 'weekend') {
      const weekday = new Date(`${today}T12:00:00`).getDay();
      const offset = weekday === 0 ? 0 : (6 - weekday + 7) % 7;
      return [addDays(today, offset), addDays(today, offset + (weekday === 0 ? 0 : 1))];
    }
    return [today, '9999-12-31'];
  });
  const matchingEvents = $derived(deduplicate(allEvents.filter(event =>
    (view !== 'drafts' || event.local) && (!onlySaved || savedIds.includes(event.id)) &&
    matchesLocation(event, city, country, cityCenter, radius) &&
    (category === 'All' || event.categories.includes(category)) &&
    (!query.trim() || [event.title, event.description, event.venue, event.city, ...event.tags].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  )));
  const filtered = $derived(matchingEvents.filter(group => overlapsDays(group.event, dateWindow[0], dateWindow[1])).map(group => ({ group, start: primaryOccurrence(group.event, dateWindow[0]).start })).sort((a, b) => a.start.localeCompare(b.start)).map(item => item.group));
  const displayEvents = $derived(filtered.map(group => group.event));
  const weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
  const dailyCounts = $derived(countEventDays(matchingEvents.map(group => group.event), weekDays));
  function clearFilters() { query = ''; city = ''; country = ''; radius = 0; cityCenter = null; cityResolve++; category = 'All'; dateMode = view === 'drafts' ? 'any' : 'upcoming'; selectedDay = today; weekStart = today; onlySaved = false; visibleLimit = 30; }
  function changeView(next: 'explore' | 'drafts') { view = next; clearFilters(); }
  function createDraft() { editing = undefined; showEditor = true; }
  function openEvent(event: EventRecord) { selected = event; }
  $effect(() => {
    const url = selected?.imageBlob ? URL.createObjectURL(selected.imageBlob) : '';
    detailPoster = url;
    return () => { if (url) URL.revokeObjectURL(url); };
  });
  async function saveDraft(event: EventRecord) {
    [event] = await geography.enrich([$state.snapshot(event)]);
    await db.drafts.put($state.snapshot(event));
    drafts = [...drafts.filter(draft => draft.id !== event.id), event];
    showEditor = false; selected = null; changeView('drafts'); toast('Draft saved on this device. It has not been published.');
  }
  async function exportJSON(values: EventRecord[]) {
    try { download(await jsonExport(values), 'commons-events.json'); toast('JSON exported. Keep this file to restore or move your drafts.'); } catch { toast('Export failed. Try exporting a smaller selection.'); }
  }
  function exportICS(values: EventRecord[]) { download(calendarExport(values), 'commons-events.ics', 'text/calendar;charset=utf-8'); }
  async function toggleSaved(id: string) {
    const next = savedIds.includes(id) ? savedIds.filter(value => value !== id) : [...savedIds, id];
    try { await db.settings.put({ key: 'saved', value: next }); savedIds = next; } catch { toast('Could not save this bookmark in browser storage.'); }
  }
  async function removeDraft(event: EventRecord) {
    try { await db.drafts.delete(event.id); drafts = drafts.filter(draft => draft.id !== event.id); selected = null; toast('Local draft deleted.'); } catch { toast('The draft could not be deleted.'); }
  }
  async function importFile(file: File | undefined, asSource = false) {
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Choose a JSON file smaller than 30 MB.');
      if (asSource && (!snapshotName.trim() || !safeUrl(snapshotUrl))) throw new Error('Enter a source name and original website URL first.');
      const existing = asSource ? sources.find(source => source.kind === 'snapshot' && source.url === safeUrl(snapshotUrl)) : undefined;
      const source = asSource ? { id: existing?.id || `snapshot:${crypto.randomUUID()}`, name: snapshotName.trim(), url: safeUrl(snapshotUrl) } : undefined;
      const values = await geography.enrich(parseImport(JSON.parse(await file.text()), source));
      if (source) {
        const next = [...sources.filter(item => item.id !== source.id), { ...source, kind: 'snapshot' as const, city: '', timezone: 'Europe/Rome', enabled: true }];
        await saveSourceEvents(source.id, values); await saveSources(next);
        sources = next; events = [...events.filter(event => event.sourceId !== source.id), ...values];
        states[source.id] = { status: 'ready', count: values.length, message: 'Static snapshot. Import a replacement file to update it.', fetchedAt: new Date().toISOString() };
        snapshotName = ''; snapshotUrl = '';
      } else { await db.drafts.bulkPut(values); drafts = [...drafts, ...values]; changeView('drafts'); }
      toast(`Imported ${values.length} ${asSource ? 'source events' : 'local drafts'}.`);
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Could not import this file.'; if (asSource) sourceError = message; else toast(message); }
    finally { if (localImport) localImport.value = ''; if (snapshotImport) snapshotImport.value = ''; }
  }
  async function addSource(event: SubmitEvent) {
    event.preventDefault(); sourceError = '';
    try {
      const url = safeUrl(sourceUrl);
      if (!url || !sourceName.trim()) throw new Error('Enter a source name and valid HTTP(S) address.');
      const origin = new URL(url).origin;
      if (location.protocol === 'https:' && !origin.startsWith('https:')) throw new Error('An HTTPS website needs an HTTPS source.');
      if (sources.some(source => source.url === origin)) throw new Error('This source is already in your list.');
      try { new Intl.DateTimeFormat('en', { timeZone: sourceTimezone }); } catch { throw new Error('Enter a valid IANA timezone, such as Europe/Rome or America/New_York.'); }
      const source: Source = { id: `gancio:${crypto.randomUUID()}`, kind: 'gancio', name: sourceName.trim(), url: origin, city: sourceCity.trim(), timezone: sourceTimezone, enabled: true };
      await saveSources([...sources, source]); sources = [...sources, source];
      sourceName = ''; sourceUrl = ''; sourceCity = '';
      await refreshSource(source);
    } catch (reason) { sourceError = reason instanceof Error ? reason.message : 'Could not save the source.'; }
  }
  async function toggleSource(source: Source) {
    try {
      const next = sources.map(item => item.id === source.id ? { ...item, enabled: !item.enabled } : item);
      await saveSources(next); sources = next;
      if (!source.enabled && !events.some(event => event.sourceId === source.id)) await refreshSource({ ...source, enabled: true });
    } catch { sourceError = 'Could not update the source in local storage.'; }
  }
  async function removeSource(source: Source) {
    try {
      const next = sources.filter(item => item.id !== source.id); await saveSources(next); await db.events.where('sourceId').equals(source.id).delete();
      sources = next; events = events.filter(event => event.sourceId !== source.id); delete states[source.id];
    } catch { sourceError = 'Could not remove this source.'; }
  }
</script>

<svelte:head><title>{view === 'drafts' ? 'Your local drafts' : 'Explore'} · Commons</title></svelte:head>
<a href="#main" class="skip-link">Skip to events</a>
<div class="app-shell">
  <aside class="sidebar">
    <button class="brand" onclick={() => changeView('explore')} aria-label="Commons home"><span class="brand-mark"><Sprout size={27} strokeWidth={1.6} /></span><span>commons<span class="brand-dot">.</span></span></button>
    <nav aria-label="Main navigation">
      <button class:active={view === 'explore'} onclick={() => changeView('explore')}><Compass size={19} /> Explore <ArrowUpRight size={15} class="nav-arrow" /></button>
      <button class:active={view === 'drafts'} onclick={() => changeView('drafts')}><FilePlus2 size={19} /> Local drafts <span class="nav-count">{drafts.length}</span></button>
      <button onclick={() => showSources = true}><Layers3 size={19} /> Your sources <span class="nav-count">{sources.filter(source => source.enabled).length}</span></button>
    </nav>
    <div class="sidebar-bottom"><button onclick={() => showSources = true}>Sources & privacy <ArrowUpRight size={13} /></button></div>
  </aside>

  <main id="main">
    <header class="topbar"><div class="breadcrumb">Commons <span> / </span> {view === 'drafts' ? 'Local drafts' : 'Explore'}</div><button class="primary-button" onclick={createDraft}><Plus size={17} /> Add an event</button></header>
<section class="intro"><h1>{view === 'explore' ? 'Explore events' : 'Local drafts'}</h1>{#if view === 'drafts'}<p class="intro-description">Saved on this device. Export a backup to keep a copy.</p>{/if}</section>
    {#if storageError}<div class="page-notice warning" role="alert"><AlertCircle size={17} /> {storageError}</div>{/if}

    <section class="search-panel" aria-label="Filter events">
      <LocationFilters bind:city bind:country bind:radius bind:center={cityCenter} />
      {#if locationError}<p class="location-explanation" role="status">{locationError}</p>{/if}
      <div class="search-fields">
        <label class="city-search"><MapPin size={19} /><span class="sr-only">City</span><select aria-label="City" value={city} onchange={event => selectCity(event.currentTarget.value)}><option value="">All cities</option>{#each cityChoices as item}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <label class="text-search"><Search size={19} /><span class="sr-only">Search events</span><input type="search" bind:value={query} placeholder="Search events, venues or topics…" /></label>
        <label class="date-search"><CalendarDays size={18} /><span class="sr-only">Date range</span><select aria-label="Date range" bind:value={dateMode}><option value="upcoming">Upcoming</option><option value="week">Next 7 days</option><option value="weekend">This weekend</option><option value="day">Choose a day</option><option value="any">Any date</option></select></label>
      </div>
      <div class="category-row" aria-label="Event categories">{#each categories as item}{@const Icon = iconFor[item]}<button class:chosen={category === item} onclick={() => category = item}>{#if item === 'All'}<SlidersHorizontal size={14} />{:else if Icon}<Icon size={15} />{/if}{item === 'All' ? 'Everything' : item}</button>{/each}</div>
    </section>

    <section class="results-toolbar">
      <div class="results-heading"><h2>{view === 'drafts' ? 'Drafts' : onlySaved ? 'Saved events' : 'Events'}</h2><span class="result-count">{filtered.length}</span></div>
      <div class="view-controls">
        {#if view === 'drafts'}<button class="text-button" onclick={() => localImport.click()}><Upload size={15} /> Import</button><button class="text-button" disabled={!drafts.length} onclick={() => exportJSON(drafts)}><Download size={15} /> Export all</button>{/if}
        <button class="icon-button" class:is-saved={onlySaved} aria-label="Show saved events" aria-pressed={onlySaved} onclick={() => onlySaved = !onlySaved}><Heart size={17} fill={onlySaved ? 'currentColor' : 'none'} /></button>
        <div class="segmented"><button class:chosen={!showMap} onclick={() => showMap = false} aria-label="List view" aria-pressed={!showMap}><List size={16} /><span>List</span></button><button class:chosen={showMap} onclick={() => showMap = true} aria-label="Map and list view" aria-pressed={showMap}><Map size={16} /><span>Map</span></button></div>
      </div>
    </section>

    <div class="date-strip"><button class="icon-button" aria-label="Previous seven days" onclick={() => weekStart = addDays(weekStart, -7)}><ChevronLeft size={17} /></button><div class="day-options">{#each weekDays as day}<button data-day={day} aria-label={`${day}: ${dailyCounts[day]} ${dailyCounts[day] === 1 ? 'event' : 'events'}`} aria-pressed={dateMode === 'day' && selectedDay === day} class:chosen={dateMode === 'day' && selectedDay === day} onclick={() => { selectedDay = day; dateMode = 'day'; }}><small>{day === today ? 'TODAY' : new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${day}T12:00:00`)).toUpperCase()}</small><strong>{Number(day.slice(-2))}</strong><span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(`${day}T12:00:00`))}</span><span class="day-count">{dailyCounts[day]}<span class="sr-only"> events</span></span></button>{/each}</div><button class="icon-button" aria-label="Next seven days" onclick={() => weekStart = addDays(weekStart, 7)}><ChevronRight size={17} /></button><label class="calendar-picker"><CalendarDays size={18} /><input aria-label="Select a specific day" type="date" value={selectedDay} onchange={event => { if (event.currentTarget.value) { selectedDay = event.currentTarget.value; weekStart = selectedDay; dateMode = 'day'; } }} /></label></div>
    <p class="day-count-note">Daily counts use the current filters; select a day to view its events.{#if refreshing}{' '}Counts update as sources load.{/if}</p>
    <div class="coverage-line"><span>{#if refreshing}<LoaderCircle size={12} class="spin" /> Updating sources: {refreshCompleted}/{refreshTotal}{:else}<span class="live-dot"></span>{readySources} live {readySources === 1 ? 'source' : 'sources'} · {sources.filter(s => s.enabled && s.kind === 'snapshot').length} snapshots{/if}</span><button class="text-button" onclick={refresh} disabled={refreshing || !initialized}><RefreshCw size={12} /> Refresh</button></div>
    {#if failedSources.length}<div class="page-notice warning"><AlertCircle size={16} /><span>{failedSources.length} {failedSources.length === 1 ? 'source is' : 'sources are'} unavailable. Cached events may be outdated. <button class="inline-link" onclick={() => showSources = true}>View source status</button></span></div>{/if}
    {#if partialSources.length}<div class="page-notice"><Layers3 size={16} /><span>{partialSources.map(source => source.name).join(', ')}: showing a partial catalogue. <button class="inline-link" onclick={() => showSources = true}>Source details</button></span></div>{/if}

    <section class="explorer-layout" class:without-map={!showMap} aria-label="Events">
      <div class="event-list">
        {#if !initialized || (refreshing && !allEvents.length)}
          <div class="loading-state" role="status"><LoaderCircle size={26} class="spin" /><h3>Loading events…</h3><p>Events appear as each source responds.</p></div>
        {:else if !filtered.length}
          <div class="empty-state"><span class="empty-icon"><Sprout size={36} strokeWidth={1.3} /></span><h3>{view === 'drafts' ? 'No local drafts' : 'No matching events'}</h3><p>{view === 'drafts' ? 'Turn a poster into your first local draft, or import a previous export.' : 'There are no loaded events matching these filters. Try another day or city, or add a community calendar.'}</p><button class="secondary-button" onclick={view === 'drafts' ? createDraft : clearFilters}>{view === 'drafts' ? 'Create a draft' : 'Reset filters'} <ArrowRight size={15} /></button>{#if view === 'explore'}<button class="text-button" onclick={() => showSources = true}>Explore your sources <ArrowUpRight size={14} /></button>{/if}</div>
        {/if}
        {#each filtered.slice(0, visibleLimit) as group (group.event.id)}
          {@const event = group.event}{@const Icon = iconFor[event.categories[0]] || Sprout}
          <article class="event-card" class:cancelled={event.status === 'cancelled'}>
            <button class="event-thumbnail" class:poster={!!event.imageUrl} data-category={event.categories[0]} onclick={() => openEvent(event)} aria-label={`View ${event.title}`}>
              {#if event.imageUrl}<img src={event.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={event => (event.currentTarget as HTMLImageElement).style.display = 'none'} />{/if}
              <span class="thumbnail-symbol"><Icon size={34} strokeWidth={1.2} /></span>
            </button>
            <div class="event-card-body"><div class="event-date">{formatEventDate(event, dateWindow[0])}<span>·</span>{formatEventTime(event, dateWindow[0])}{#if event.occurrences.length > 1}<span class="occurrence-count">+{event.occurrences.length - 1} dates</span>{/if}</div>
              <button class="event-title" onclick={() => openEvent(event)}><h3>{event.title}</h3></button>
              <p class="event-place"><MapPin size={13} /><span>{[event.venue, event.city, countryName(event.countryCode)].filter(Boolean).join(' · ') || event.address || 'Location not supplied'}</span></p>
              <div class="event-meta"><span class="category-tag" data-category={event.categories[0]}>{event.categories[0] || 'Other'}</span>{#if event.local}<span class="draft-tag">Local draft</span>{:else}<a class="source-link" href={event.sourceUrl} target="_blank" rel="noopener noreferrer">{event.sourceName}<ArrowUpRight size={11} /></a>{/if}{#if event.status !== 'scheduled'}<span class="status-tag">{event.status}</span>{/if}</div>
              {#if group.sources.length > 1}<small class="muted">Also listed by {group.sources.slice(1).map(source => source.name).join(', ')}</small>{/if}
            </div><button class="save-event" class:is-saved={savedIds.includes(event.id)} aria-label={`${savedIds.includes(event.id) ? 'Unsave' : 'Save'} ${event.title}`} aria-pressed={savedIds.includes(event.id)} onclick={() => toggleSaved(event.id)}><Heart size={17} fill={savedIds.includes(event.id) ? 'currentColor' : 'none'} /></button>
          </article>
        {/each}
        {#if filtered.length > visibleLimit}<button class="load-more secondary-button" onclick={() => visibleLimit += 30}>Show next {Math.min(30, filtered.length - visibleLimit)} events <Plus size={16} /></button>{/if}
      </div>
      {#if showMap}<aside class="map-panel"><EventMap events={displayEvents} selectedId={selected?.id} onSelect={openEvent} /><div class="map-footer"><span><MapPin size={13} /> Exact locations only</span><span>{displayEvents.filter(event => event.latitude === undefined || event.longitude === undefined).length} without coordinates</span></div><p class="map-privacy">Map tiles load from OpenStreetMap. Location is never requested automatically.</p></aside>{/if}
    </section>
    <footer class="main-footer"><button class="text-button" onclick={() => showSources = true}>Sources & privacy <ArrowUpRight size={13} /></button></footer>
  </main>
</div>
<input class="hidden" type="file" accept="application/json,.json" bind:this={localImport} onchange={event => importFile(event.currentTarget.files?.[0])} aria-label="Import local drafts" />
{#if notice}<div class="toast" role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss notification" onclick={() => notice = ''}><X size={16} /></button></div>{/if}

{#if showEditor}<Dialog title={editing ? 'Edit your draft' : 'Add an event'} wide onDismiss={() => showEditor = false}><PosterEditor draft={editing} onSave={saveDraft} onCancel={() => showEditor = false} /></Dialog>{/if}

{#if selected}
  <Dialog title={selected.local ? 'Local draft' : 'Event details'} onDismiss={() => selected = null}>
    {#if detailPoster || selected.imageUrl}<img class="detail-poster" src={detailPoster || selected.imageUrl} alt={`Poster for ${selected.title}`} referrerpolicy="no-referrer" />{/if}
    <div class="detail-tags"><span class="category-tag">{selected.categories[0]}</span>{#if selected.local}<span class="draft-tag">Local draft · only on this device</span>{/if}{#if selected.status !== 'scheduled'}<span class="status-tag">{selected.status}</span>{/if}</div>
    <h2 class="detail-title">{selected.title}</h2><p class="detail-location"><MapPin size={17} />{[selected.venue, selected.address, selected.city, countryName(selected.countryCode)].filter(Boolean).join(' · ') || 'Location not supplied'}</p>
    {#if selected.cityBasis && selected.cityBasis !== 'provided'}<p class="small muted">City inferred from {selected.cityBasis === 'source' ? 'calendar coverage' : selected.cityBasis === 'coordinates' ? 'a nearby city; the label is approximate' : 'the event address'}.</p>{/if}
    <div class="detail-dates">{#each selected.occurrences as occurrence}<p><CalendarDays size={16} /><span>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: selected.timezone }).format(new Date(occurrence.start))}{#if occurrence.end}<br /><span class="muted">Until {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: selected.timezone }).format(new Date(occurrence.end))}</span>{/if}</span></p>{/each}<small class="muted">Times shown in {selected.timezone}.</small></div>
    <p class="detail-description">{selected.description || (selected.local ? 'No description added yet.' : 'This calendar listing does not include a description. Visit the original event for the full details.')}</p>
    {#if selected.tags.length}<div class="tag-list">{#each selected.tags as tag}<span>#{tag}</span>{/each}</div>{/if}
    {#if !selected.local}<div class="provenance"><span class="eyebrow">ORIGINAL SOURCE</span><a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{selected.sourceName}<ExternalLink size={15} /></a><p class="small muted">Catalogue fetched {new Date(selected.cachedAt).toLocaleString()}. Check the original for changes and participation details.</p>{#each deduplicate(allEvents).find(group => group.event.id === selected?.id)?.sources.slice(1) || [] as source}<a href={source.url} target="_blank" rel="noopener noreferrer">Also on {source.name}<ExternalLink size={13} /></a>{/each}</div>{/if}
    <div class="detail-actions"><button class="primary-button" onclick={() => selected && exportICS([selected])}><CalendarDays size={16} /> Add to calendar</button><button class="secondary-button" onclick={() => selected && exportJSON([selected])}><Download size={16} /> Export JSON</button></div>
    {#if selected.local}<div class="detail-actions"><button class="text-button" onclick={() => { editing = selected!; selected = null; showEditor = true; }}><Pencil size={15} /> Edit draft</button><button class="text-button" onclick={() => { editing = { ...selected!, id: `draft:${crypto.randomUUID()}`, title: `${selected!.title} (copy)` }; selected = null; showEditor = true; }}><Copy size={15} /> Duplicate</button><button class="text-button danger" onclick={() => selected && removeDraft(selected)}><Trash2 size={15} /> Delete draft</button></div><p class="small muted">Export a backup before clearing browser data. Local drafts are not shared with other visitors.</p>{/if}
  </Dialog>
{/if}

{#if showSources}
  <Dialog title="Sources" onDismiss={() => showSources = false}>
    <p class="dialog-intro">Choose the calendars you want to see. Commons reads their public events directly; your preferences stay in this browser.</p>
    <p class="small muted">{sources.length} sources · catalogue checked {new Date(catalogueCheckedAt).toLocaleDateString()}. Unavailable sources, test instances and sources with unconfirmed timezones or software start disabled. Availability can change.</p>
    <div class="source-controls"><label class="field">Search sources<input type="search" bind:value={sourceQuery} placeholder="Name, city, region or domain" /></label><label class="field">Show sources<select bind:value={sourceFilter}><option value="all">All sources</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="failed">Failed this session</option></select></label></div>
    <div class="source-actions"><span class="small muted">{matchingSources.length} matching · {sources.filter(source => source.enabled).length} enabled</span><button class="text-button" disabled={refreshing || !matchingSources.length} onclick={() => setMatchingEnabled(true)}>Enable matching</button><button class="text-button" disabled={!matchingSources.length} onclick={() => setMatchingEnabled(false)}>Disable matching</button></div>
    <div class="source-list">{#each matchingSources as source (source.id)}<div class="source-card"><div class="source-card-top"><span class="source-icon"><Globe2 size={20} /></span><div><strong>{source.name}</strong><a href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).host} <ArrowUpRight size={11} /></a></div><button class="toggle" class:enabled={source.enabled} role="switch" aria-checked={source.enabled} aria-label={`Enable ${source.name}`} onclick={() => toggleSource(source)}><span></span></button></div><p class:error-text={states[source.id]?.status === 'error'} class="source-status">{#if states[source.id]?.status === 'loading'}<LoaderCircle size={13} class="spin" />{/if}{!source.enabled ? 'Disabled — no requests or events from this source.' : states[source.id]?.message || 'Ready to load.'}</p><div class="source-check small muted">{#if source.region}<p>{source.region}</p>{/if}{#if source.checkedAt}<p>Last check: {source.checkMessage}{#if source.timezoneUnconfirmed} Timezone unconfirmed; UTC fallback.{/if}</p>{/if}{#if source.discoveredAt?.length}<a href={source.discoveredAt[0]} target="_blank" rel="noopener noreferrer">Discovery record <ArrowUpRight size={11} /></a>{/if}</div><div class="source-card-bottom"><small>{states[source.id]?.count || 0} events · {source.kind === 'snapshot' ? 'Snapshot' : 'Gancio API'}{#if states[source.id]?.fetchedAt} · {new Date(states[source.id].fetchedAt!).toLocaleDateString()}{/if}</small><button class="icon-button" aria-label={`Remove ${source.name}`} onclick={() => removeSource(source)}><Trash2 size={14} /></button></div></div>{/each}</div>
    <form class="source-form" onsubmit={addSource}><h3>Add a Gancio calendar</h3><label class="field">Name<input required bind:value={sourceName} placeholder="Your community calendar" /></label><label class="field">Instance URL<input required type="url" bind:value={sourceUrl} placeholder="https://calendar.example.org" /></label><div class="two-fields"><label class="field">Fallback city / area<input bind:value={sourceCity} placeholder="Optional; used when missing" /></label><label class="field">Source timezone<input required list="source-timezones" bind:value={sourceTimezone} placeholder="e.g. Europe/Rome" /><datalist id="source-timezones"><option>Europe/Rome</option><option>Europe/London</option><option>Europe/Paris</option><option>America/New_York</option><option>Asia/Tokyo</option><option>UTC</option></datalist></label></div><button class="secondary-button"><Plus size={16} /> Add source</button></form>
    <div class="source-form"><h3>Import another source</h3><p class="small muted">Import an agreed Commons-format JSON snapshot. Importing the same source website again replaces its previous snapshot.</p><label class="field">Source name<input bind:value={snapshotName} placeholder="e.g. Bungarang · Reggio Calabria" /></label><label class="field">Original website<input type="url" bind:value={snapshotUrl} placeholder="https://reggiocalabria.bungarang.com" /></label><button class="secondary-button" onclick={() => snapshotImport?.click()}><Upload size={16} /> Choose source JSON</button><input class="hidden" type="file" accept="application/json,.json" bind:this={snapshotImport} onchange={event => importFile(event.currentTarget.files?.[0], true)} /></div>
    {#if sourceError}<p class="error-message" role="alert">{sourceError}</p>{/if}
    <div class="notice"><AlertCircle size={17} /><div><strong>About Bungarang</strong><p>Its event API rejected requests from an unrelated website during our check. Direct integration needs a supported feed or permission for this website’s origin. You can import an agreed snapshot meanwhile.</p><a href="https://reggiocalabria.bungarang.com/it/evento/lista-completa" target="_blank" rel="noopener noreferrer">Visit the original calendar ↗</a></div></div>
    <div class="privacy-note"><ShieldCheck size={20} /><div><h3>Privacy and coverage</h3><p>No account, analytics, or remote preference profile. Sources and map providers receive ordinary network requests, including your IP address. Poster recognition stays local; language assets download on first use. Categories are inferred from source tags and titles. Coverage is limited to enabled sources and their available upcoming events.</p><p>Missing coordinates remain missing. Calendar downloads are snapshots and will not automatically receive later cancellations.</p></div></div>
  </Dialog>
{/if}
