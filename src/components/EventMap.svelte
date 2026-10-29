<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { Maximize2, MapPin, X } from '@lucide/svelte';
  import { WorkerClient } from '../lib/worker-client';
  import type { MapMark } from '../lib/map-index';
  import { mapPoint } from '../lib/map-points';
  import type { EventRecord } from '../lib/types';
  import type { GeoBounds } from '../lib/location';
  let { events = [], selectedId = '', onSelect = (_event: EventRecord) => {}, center, bounds, onPick, picked, filterKey = '' }: {
    events?: EventRecord[]; selectedId?: string; onSelect?: (event: EventRecord) => void;
    center?: [number, number]; onPick?: (lat: number, lon: number) => void; picked?: [number, number];
    filterKey?: string;
    bounds?: GeoBounds;
  } = $props();
  let container: HTMLDivElement;
  let clusterPanel = $state<HTMLDivElement>();
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;
  let tileError = $state(false);
  let busy = $state(false);
  let error = $state('');
  let cluster = $state<{ id: number; count: number; offset: number; ids: string[]; latitude: number; longitude: number; expanded: boolean } | null>(null);
  let panelBusy = $state(false);
  const client = new WorkerClient(() => new Worker(new URL('../workers/map.worker.ts', import.meta.url), { type: 'module', name: 'map-clusters' }));
  let revision = 0; let readyRevision = 0; let request = 0; let panelRequest = 0; let disposed = false;
  let userMoved = false; let fitting = false; let clusterMove = false; let previousFilter = ''; let previousCenter = '';
  let allowAutoExpand = true;
  let viewport = $state({ latitude: 20, longitude: 10, zoom: 2 });
  let visibleCount = $state(0);
  let unplacedLimit = $state(20);
  let rebuildTimer: ReturnType<typeof setTimeout>;
  const points = $derived(events.flatMap(event => { const point = mapPoint(event); return point ? [point] : []; }));
  const estimates = $derived(points.filter(point => point.kind === 'city').length);
  const streetEstimates = $derived(points.filter(point => point.kind === 'street').length);
  const addressMatches = $derived(points.filter(point => point.kind === 'address').length);
  const unplaced = $derived(events.filter(event => !mapPoint(event)));
  const eventById = $derived(new globalThis.Map(events.map(event => [event.id, event])));
  const palette: Record<string, string> = { Music: '#d58451', 'Arts & culture': '#857ab0', 'Games & chess': '#558b81', 'Sport & outdoors': '#809d64', Learning: '#c6a34e', Community: '#af7188', Other: '#85918a' };
  function closeCluster() { allowAutoExpand = false; cluster = null; panelRequest++; panelBusy = false; void renderView(); }
  function fit() {
    if (!map) return;
    cluster = null; panelRequest++; panelBusy = false;
    fitting = true;
    if (points.length) map.fitBounds(L.latLngBounds(points.map(point => [point.latitude, point.longitude] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 13, animate: false });
    else if (center) map.setView(center, 12, { animate: false });
    else if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12, animate: false });
    else map.setView([20, 10], 2, { animate: false });
    fitting = false;
    void renderView();
  }
  async function showCluster(mark: MapMark) {
    if (!map || mark.clusterId === undefined || readyRevision !== revision) return;
    userMoved = true;
    const current = revision;
    try {
      const zoom = await client.request<number>('expand', { revision, clusterId: mark.clusterId });
      if (disposed || current !== revision) return;
      const expanded = zoom > 19 || zoom <= map.getZoom();
      // A click always reveals the event list, even when geographic zoom cannot
      // separate identical coordinates. Terminal groups fan out in screen pixels.
      await clusterPage(mark.clusterId, mark.count, 0, { latitude: mark.latitude, longitude: mark.longitude, expanded });
      if (disposed || current !== revision || !cluster || cluster.id !== mark.clusterId) return;
      if (!expanded) {
        clusterMove = true;
        map.setView([mark.latitude, mark.longitude], zoom, { animate: false });
        clusterMove = false;
      }
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
  }
  async function clusterPage(id: number, count: number, offset: number, position: { latitude: number; longitude: number; expanded: boolean } | null = cluster) {
    if (!position) return;
    const current = revision; const sequence = ++panelRequest; panelBusy = true;
    try {
      const ids = await client.request<string[]>('leaves', { revision, clusterId: id, offset });
      if (!disposed && current === revision && sequence === panelRequest) {
        cluster = { id, count, offset, ids, latitude: position.latitude, longitude: position.longitude, expanded: position.expanded };
        await tick();
        if (disposed || current !== revision || sequence !== panelRequest) return;
        clusterPanel?.focus({ preventScroll: true });
        await renderView();
      }
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
    finally { if (sequence === panelRequest) panelBusy = false; }
  }
  function eventTitle(event: EventRecord) {
    const position = mapPoint(event);
    return `${event.title}${position?.kind === 'street' ? ` — street-level estimate: ${event.addressLocation?.label}` : position?.kind === 'address' ? ` — address match: ${event.addressLocation?.label}` : position?.approximate ? ` — approximate city location: ${event.city}; venue coordinates unavailable` : ''}`;
  }
  function eventMarker(event: EventRecord, position: L.LatLngExpression, spread = false) {
    const approximate = !!mapPoint(event)?.approximate;
    const color = palette[event.categories[0]] || '#85918a';
    const title = `${eventTitle(event)}${spread ? ' — separated for selection; shared map location' : ''}`;
    const icon = L.divIcon({ className: `commons-pin${approximate ? ' approximate-location' : ''}${event.id === selectedId ? ' active' : ''}${spread ? ' expanded-event' : ''}`,
      html: approximate ? '<div class="estimate-marker" aria-hidden="true">≈</div>' : `<svg class="venue-marker" aria-hidden="true" width="28" height="36" viewBox="0 0 28 36"><path d="M14 34C11 30 2 21 2 14a12 12 0 0 1 24 0c0 7-9 16-12 20Z" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="14" cy="14" r="4" fill="white"/></svg>`,
      iconSize: [44, 44], iconAnchor: approximate ? [22, 22] : [22, 38], tooltipAnchor: [0, -18] });
    const marker = L.marker(position, { icon, keyboard: true, title, alt: title, zIndexOffset: spread ? 500 : 0 });
    const label = document.createElement('span'); label.textContent = title;
    marker.bindTooltip(label).on('click', () => { const current = eventById.get(event.id); if (current) onSelect(current); }).addTo(layer);
    const element = marker.getElement();
    if (element) { element.dataset.eventCount = '1'; element.dataset.estimateCount = approximate ? '1' : '0'; }
  }
  function renderExpanded() {
    if (!map || !cluster?.expanded) return;
    const anchor = map.latLngToContainerPoint([cluster.latitude, cluster.longitude]);
    const size = map.getSize();
    // Reserve the bottom of the map for the event chooser. Offsets are visual
    // only; the stored coordinates and distance filtering never change.
    const columns = Math.min(5, Math.max(2, Math.floor((size.x - 30) / 44)));
    const rows = Math.ceil(cluster.ids.length / columns);
    const halfWidth = (columns - 1) * 21; const halfHeight = (rows - 1) * 19;
    const markerBottom = size.y * .5 - 16;
    const centre = L.point(Math.max(20 + halfWidth, Math.min(size.x - 20 - halfWidth, anchor.x)), Math.max(35 + halfHeight, Math.min(markerBottom - halfHeight, anchor.y)));
    cluster.ids.forEach((id, i) => {
      const event = eventById.get(id); if (!event) return;
      const countInRow = Math.min(columns, cluster!.ids.length - Math.floor(i / columns) * columns);
      const x = centre.x + (i % columns - (countInRow - 1) / 2) * 42;
      const y = centre.y + (Math.floor(i / columns) - (rows - 1) / 2) * 38;
      const point = map!.containerPointToLatLng([Math.max(20, Math.min(size.x - 20, x)), Math.max(35, Math.min(markerBottom, y))]);
      L.polyline([[cluster!.latitude, cluster!.longitude], point], { color: '#65756b', weight: 1, opacity: .55, dashArray: '3 4', interactive: false }).addTo(layer);
      eventMarker(event, point, true);
    });
  }
  async function renderView() {
    if (!map || onPick || readyRevision !== revision || !readyRevision) return;
    const current = revision; const sequence = ++request;
    const bounds = map.getBounds();
    try {
      const marks = await client.request<MapMark[]>('view', { revision, bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom: map.getZoom() });
      if (disposed || current !== revision || sequence !== request) return;
      layer.clearLayers();
      visibleCount = marks.reduce((sum, mark) => sum + mark.count, 0);
      for (const mark of marks) {
        const event = mark.id ? eventById.get(mark.id) : undefined;
        if (mark.clusterId === undefined && !event) continue;
        if (event) { eventMarker(event, [mark.latitude, mark.longitude]); continue; }
        if (cluster?.expanded && mark.clusterId === cluster.id) continue;
        const title = `${mark.count} events${mark.approximateCount ? `, including ${mark.approximateCount} approximate locations` : ''}. Select to see events.`;
        const icon = L.divIcon({ className: `commons-cluster${mark.approximateCount ? ' approximate-location' : ''}`, html: `<span>${mark.count}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] });
        const marker = L.marker([mark.latitude, mark.longitude], { icon, keyboard: true, title, alt: title });
        const label = document.createElement('span'); label.textContent = title;
        marker.bindTooltip(label).on('click', () => {
          if (mark.clusterId !== undefined) void showCluster(mark);
          else { const current = eventById.get(mark.id!); if (current) onSelect(current); }
        }).addTo(layer);
        const element = marker.getElement();
        if (element) { element.dataset.eventCount = String(mark.count); element.dataset.estimateCount = String(mark.approximateCount); }
      }
      renderExpanded();
      // At maximum zoom, a remaining group cannot separate geographically.
      // Open one automatically; other groups remain available by selection.
      if (map.getZoom() === 19 && !cluster && allowAutoExpand) {
        const shared = marks.find(mark => mark.clusterId !== undefined);
        if (shared) { userMoved = true; await clusterPage(shared.clusterId!, shared.count, 0, { ...shared, expanded: true }); }
      }
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
  }
  onMount(() => {
    const instance = L.map(container, { zoomControl: false, scrollWheelZoom: false, maxZoom: 19, worldCopyJump: true }).setView(center || [20, 10], onPick ? 12 : 2);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => tileError = true).addTo(instance);
    layer = L.layerGroup().addTo(instance);
    instance.on('moveend', () => { const point = instance.getCenter(); viewport = { latitude: point.lat, longitude: point.lng, zoom: instance.getZoom() }; void renderView(); });
    instance.on('dragstart zoomstart', () => { if (!fitting && !clusterMove) { userMoved = true; allowAutoExpand = true; cluster = null; panelRequest++; panelBusy = false; } });
    if (onPick) instance.on('click', event => onPick?.(event.latlng.lat, event.latlng.lng));
    const observer = new ResizeObserver(() => { instance.invalidateSize(); if (!onPick && !userMoved) fit(); }); observer.observe(container);
    map = instance;
    return () => { disposed = true; clearTimeout(rebuildTimer); client.dispose(); observer.disconnect(); instance.remove(); map = null; };
  });
  $effect(() => {
    if (!map || onPick) return;
    const positions = points;
    const focus = JSON.stringify([center, bounds]);
    if (previousFilter !== filterKey || previousCenter !== focus) { userMoved = false; allowAutoExpand = true; previousFilter = filterKey; previousCenter = focus; }
    const current = ++revision; busy = true; error = ''; cluster = null; panelRequest++; panelBusy = false;
    layer.clearLayers(); visibleCount = 0; unplacedLimit = 20;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      try {
        await client.request('load', { points: positions, revision: current });
        if (disposed || current !== revision) return;
        readyRevision = current; busy = false;
        if (!userMoved) fit();
        await renderView();
      } catch (reason) { if (!disposed && current === revision) { busy = false; error = (reason as Error).message; } }
    }, 180);
  });
  $effect(() => { selectedId; untrack(() => { if (map) void renderView(); }); });
  $effect(() => {
    if (!map || !onPick) return;
    if (center) map.setView(center, 12);
    layer.clearLayers();
    if (picked) L.circleMarker(picked, { color: '#355b45', fillOpacity: 0.8, radius: 9 }).addTo(layer);
  });
</script>

<style>
  :global(.approximate-location > span) { border: 3px dashed #986b22; }
  :global(.commons-pin) { display: grid; place-items: center; }
  :global(.venue-marker) { display: block; width: 28px; height: 36px; filter: drop-shadow(0 2px 2px #22372940); }
  :global(.estimate-marker) { display: grid; place-items: center; width: 28px; height: 28px; border: 2px dashed #986b22; border-radius: 50%; background: #fff4d9; color: #735019; font: 700 17px/1 system-ui; box-shadow: 0 1px 4px #22372930; }
  :global(.commons-pin:hover .venue-marker), :global(.commons-pin.active .venue-marker), :global(.commons-pin:focus-visible .venue-marker) { filter: drop-shadow(0 0 3px #365c43); }
  :global(.commons-pin:focus-visible), :global(.commons-cluster:focus-visible) { outline: 3px solid #365c43; border-radius: 8px; }
  .map-wrapper.has-cluster { min-height: 440px; }
  .cluster-events { position: absolute; z-index: 500; bottom: 12px; left: 12px; right: 54px; max-height: 44%; display: flex; flex-direction: column; box-shadow: 0 3px 16px #22372930; padding: 8px; }
  .cluster-events .source-actions { margin: 0; flex-shrink: 0; font-size: 11px; }
  .cluster-events .source-actions strong { flex: 1; }
  .cluster-events .icon-button { min-width: 36px; min-height: 36px; }
  .cluster-events p { margin: 0 0 6px; font-size: 10px; line-height: 1.4; }
  .cluster-list { overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
  .cluster-event { font-size: 12px; }
  .estimate-label { display: block; font-size: 11px; color: #735019; margin-top: 4px; }
  .unplaced-events { margin-top: 12px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
  .unplaced-events summary { cursor: pointer; font-size: 12px; }
  .unplaced-events p { margin: 10px 0; }
  .map-footer { flex-wrap: wrap; gap: 6px; }
</style>

<div class="map-wrapper" class:picker={!!onPick} class:has-cluster={!!cluster} data-latitude={viewport.latitude} data-longitude={viewport.longitude} data-zoom={viewport.zoom}>
  <div bind:this={container} class="map-canvas" role="region" aria-label={onPick ? 'Click the map to select the event location' : 'Clustered event locations; zoom in for details'}></div>
  {#if !onPick}<div class="map-topline"><span>{busy ? 'Updating map…' : `${points.length} located events · ${visibleCount} in view`}</span><button class="map-button" onclick={() => { userMoved = false; fit(); }} aria-label="Fit all events on map"><Maximize2 size={16} /></button></div>{/if}
  {#if onPick}<span class="map-pick-hint"><MapPin size={14} /> Click to place the event</span>{/if}
  {#if error || tileError}<div class="map-notice" role="status">{error || 'Map tiles could not load. Events remain available in the list.'}</div>{/if}
  {#if cluster}
    <div class="cluster-events" bind:this={clusterPanel} role="region" aria-label="Events in selected map group" tabindex="-1">
      <div class="source-actions"><strong>{cluster.count} events in this group</strong><button class="icon-button" aria-label="Close cluster events" onclick={closeCluster}><X size={16} /></button></div>
      {#if cluster.expanded}<p>Markers are spread out for selection. Their actual map location is shared or too close to separate at this zoom.</p>{/if}
      <div class="cluster-list">{#each cluster.ids as id}{@const event = eventById.get(id)}{#if event}
        <button class="cluster-event" onclick={() => onSelect(event)}>{event.title}
          {#if event.addressLocation}<small class="estimate-label">{event.addressLocation.precision === 'address' ? 'Address match' : 'Street estimate'} · {event.addressLocation.label}</small>
          {:else if mapPoint(event)?.approximate}<small class="estimate-label">City-centre estimate · {event.city}{event.cityBasis === 'source' ? ' (calendar coverage)' : ''}</small>{/if}
        </button>
      {/if}{/each}</div>
      <div class="source-actions"><button class="text-button" disabled={panelBusy || cluster.offset === 0} onclick={() => cluster && clusterPage(cluster.id, cluster.count, Math.max(0, cluster.offset - 20))}>Previous events</button><span>{cluster.offset + 1}–{Math.min(cluster.offset + 20, cluster.count)}</span><button class="text-button" disabled={panelBusy || cluster.offset + 20 >= cluster.count} onclick={() => cluster && clusterPage(cluster.id, cluster.count, cluster.offset + 20)}>Next events</button></div>
    </div>
  {/if}
</div>
{#if !onPick}
  <div class="map-footer" aria-label="Map event coverage"><span>{points.length - estimates - streetEstimates - addressMatches} venue locations</span>{#if addressMatches}<span>{addressMatches} address matches</span>{/if}{#if streetEstimates}<span>{streetEstimates} street estimates</span>{/if}<span>{estimates} city estimates</span><span>{unplaced.length} unplaced</span></div>
  <p class="map-hint">Select a numbered marker to see its events. Shared locations spread out for selection. Dashed markers indicate city or street estimates.</p>
  {#if !busy && visibleCount < points.length}<button class="text-button map-outside" onclick={() => { userMoved = false; fit(); }}>Show all {points.length} events on map</button>{/if}
  {#if unplaced.length}<details class="unplaced-events"><summary>{unplaced.length} events without a mappable location</summary><p class="small muted">No usable venue coordinates or city centre were supplied. These events remain available here and in the list.</p>{#each unplaced.slice(0, unplacedLimit) as event (event.id)}<button class="cluster-event" onclick={() => onSelect(event)}>{event.title}</button>{/each}{#if unplaced.length > unplacedLimit}<button class="text-button" onclick={() => unplacedLimit += 20}>Show more unplaced events</button>{/if}</details>{/if}
{/if}
