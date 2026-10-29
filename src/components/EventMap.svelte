<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { Maximize2, MapPin, X } from '@lucide/svelte';
  import { WorkerClient } from '../lib/worker-client';
  import type { MapMark } from '../lib/map-index';
  import { mapPoint } from '../lib/map-points';
  import type { EventRecord } from '../lib/types';
  let { events = [], selectedId = '', onSelect = (_event: EventRecord) => {}, center, onPick, picked, filterKey = '' }: {
    events?: EventRecord[]; selectedId?: string; onSelect?: (event: EventRecord) => void;
    center?: [number, number]; onPick?: (lat: number, lon: number) => void; picked?: [number, number];
    filterKey?: string;
  } = $props();
  let container: HTMLDivElement;
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;
  let tileError = $state(false);
  let busy = $state(false);
  let error = $state('');
  let cluster = $state<{ id: number; count: number; offset: number; ids: string[] } | null>(null);
  let panelBusy = $state(false);
  const client = new WorkerClient(() => new Worker(new URL('../workers/map.worker.ts', import.meta.url), { type: 'module', name: 'map-clusters' }));
  let revision = 0; let readyRevision = 0; let request = 0; let panelRequest = 0; let disposed = false;
  let userMoved = false; let fitting = false; let previousFilter = '';
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
  function fit() {
    if (!map || !points.length) return;
    fitting = true;
    map.fitBounds(L.latLngBounds(points.map(point => [point.latitude, point.longitude] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 13, animate: false });
    fitting = false;
    void renderView();
  }
  async function showCluster(mark: MapMark) {
    if (!map || mark.clusterId === undefined || readyRevision !== revision) return;
    const current = revision;
    try {
      const zoom = await client.request<number>('expand', { revision, clusterId: mark.clusterId });
      if (disposed || current !== revision) return;
      if (zoom <= 19 && zoom > map.getZoom()) map.setView([mark.latitude, mark.longitude], zoom);
      else await clusterPage(mark.clusterId, mark.count, 0);
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
  }
  async function clusterPage(id: number, count: number, offset: number) {
    const current = revision; const sequence = ++panelRequest; panelBusy = true;
    try {
      const ids = await client.request<string[]>('leaves', { revision, clusterId: id, offset });
      if (!disposed && current === revision && sequence === panelRequest) cluster = { id, count, offset, ids };
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
    finally { if (sequence === panelRequest) panelBusy = false; }
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
        const position = event ? mapPoint(event) : null;
        const title = event ? `${event.title}${position?.kind === 'street' ? ` — street-level estimate: ${event.addressLocation?.label}` : position?.kind === 'address' ? ` — address match: ${event.addressLocation?.label}` : mark.approximateCount ? ` — approximate city location: ${event.city}; venue coordinates unavailable` : ''}` : `${mark.count} events${mark.approximateCount ? `, including ${mark.approximateCount} approximate locations` : ''}. Zoom in or select to explore.`;
        const color = event ? palette[event.categories[0]] || '#85918a' : '#365c43';
        const icon = L.divIcon({ className: `${mark.clusterId === undefined ? 'commons-pin' : 'commons-cluster'}${mark.approximateCount ? ' approximate-location' : ''}`, html: mark.clusterId === undefined ? `<span style="--pin-color:${color}" class="${event?.id === selectedId ? 'active' : ''}">${mark.approximateCount ? '≈' : '•'}</span>` : `<span>${mark.count}</span>`, iconSize: [40, 42], iconAnchor: [20, 21] });
        const marker = L.marker([mark.latitude, mark.longitude], { icon, keyboard: true, title, alt: title });
        const label = document.createElement('span'); label.textContent = title;
        marker.bindTooltip(label).on('click', () => {
          if (mark.clusterId !== undefined) void showCluster(mark);
          else { const current = eventById.get(mark.id!); if (current) onSelect(current); }
        }).addTo(layer);
        const element = marker.getElement();
        if (element) { element.dataset.eventCount = String(mark.count); element.dataset.estimateCount = String(mark.approximateCount); }
      }
    } catch (reason) { if (!disposed && current === revision) error = (reason as Error).message; }
  }
  onMount(() => {
    const instance = L.map(container, { zoomControl: false, scrollWheelZoom: false, maxZoom: 19, worldCopyJump: true }).setView(center || [20, 10], onPick ? 12 : 2);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxZoom: 19 }).on('tileerror', () => tileError = true).addTo(instance);
    layer = L.layerGroup().addTo(instance);
    instance.on('moveend', () => void renderView());
    instance.on('dragstart zoomstart', () => { if (!fitting) userMoved = true; });
    if (onPick) instance.on('click', event => onPick?.(event.latlng.lat, event.latlng.lng));
    const observer = new ResizeObserver(() => { instance.invalidateSize(); if (!onPick && !userMoved) fit(); }); observer.observe(container);
    map = instance;
    return () => { disposed = true; clearTimeout(rebuildTimer); client.dispose(); observer.disconnect(); instance.remove(); map = null; };
  });
  $effect(() => {
    if (!map || onPick) return;
    const positions = points;
    if (previousFilter !== filterKey) { userMoved = false; previousFilter = filterKey; }
    const current = ++revision; busy = true; error = ''; cluster = null; panelRequest++; panelBusy = false;
    layer.clearLayers(); visibleCount = 0; unplacedLimit = 20;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      try {
        await client.request('load', { points: positions, revision: current });
        if (disposed || current !== revision) return;
        readyRevision = current; busy = false;
        if (!userMoved && positions.length) fit();
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
  :global(.commons-pin.approximate-location > span) { background: #fff4d9; color: #735019; }
  .estimate-label { display: block; font-size: 11px; color: #735019; margin-top: 4px; }
  .unplaced-events { margin-top: 12px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; }
  .unplaced-events summary { cursor: pointer; font-size: 12px; }
  .unplaced-events p { margin: 10px 0; }
  .map-footer { flex-wrap: wrap; gap: 6px; }
</style>

<div class="map-wrapper" class:picker={!!onPick}>
  <div bind:this={container} class="map-canvas" role="region" aria-label={onPick ? 'Click the map to select the event location' : 'Clustered event locations; zoom in for details'}></div>
  {#if !onPick}<div class="map-topline"><span>{busy ? 'Updating map…' : `${points.length} located events · ${visibleCount} in view`}</span><button class="map-button" onclick={() => { userMoved = false; fit(); }} aria-label="Fit all events on map"><Maximize2 size={16} /></button></div>{/if}
  {#if onPick}<span class="map-pick-hint"><MapPin size={14} /> Click to place the event</span>{/if}
  {#if error || tileError}<div class="map-notice" role="status">{error || 'Map tiles could not load. Events remain available in the list.'}</div>{/if}
</div>
{#if !onPick}
  <div class="map-footer" aria-label="Map event coverage"><span>{points.length - estimates - streetEstimates - addressMatches} venue locations</span>{#if addressMatches}<span>{addressMatches} address matches</span>{/if}{#if streetEstimates}<span>{streetEstimates} street estimates</span>{/if}<span>{estimates} city estimates</span><span>{unplaced.length} unplaced</span></div>
  <p class="map-hint">Numbered markers contain multiple events. Dashed markers include city or street estimates, not venue locations.</p>
  {#if !busy && visibleCount < points.length}<button class="text-button map-outside" onclick={() => { userMoved = false; fit(); }}>Show all {points.length} events on map</button>{/if}
  {#if unplaced.length}<details class="unplaced-events"><summary>{unplaced.length} events without a mappable location</summary><p class="small muted">No usable venue coordinates or city centre were supplied. These events remain available here and in the list.</p>{#each unplaced.slice(0, unplacedLimit) as event (event.id)}<button class="cluster-event" onclick={() => onSelect(event)}>{event.title}</button>{/each}{#if unplaced.length > unplacedLimit}<button class="text-button" onclick={() => unplacedLimit += 20}>Show more unplaced events</button>{/if}</details>{/if}
{/if}
{#if cluster}<div class="cluster-events"><div class="source-actions"><strong>{cluster.count} events in this group</strong><button class="icon-button" aria-label="Close cluster events" onclick={() => { cluster = null; panelRequest++; panelBusy = false; }}><X size={16} /></button></div>{#each cluster.ids as id}{@const event = eventById.get(id)}{#if event}<button class="cluster-event" onclick={() => onSelect(event)}>{event.title}{#if event.addressLocation}<small class="estimate-label">{event.addressLocation.precision === 'address' ? 'Address match' : 'Street estimate'} · {event.addressLocation.label}</small>{:else if mapPoint(event)?.approximate}<small class="estimate-label">City-centre estimate · {event.city}{event.cityBasis === 'source' ? ' (calendar coverage)' : ''}</small>{/if}</button>{/if}{/each}<div class="source-actions"><button class="text-button" disabled={panelBusy || cluster.offset === 0} onclick={() => cluster && clusterPage(cluster.id, cluster.count, Math.max(0, cluster.offset - 20))}>Previous events</button><span>{cluster.offset + 1}–{Math.min(cluster.offset + 20, cluster.count)}</span><button class="text-button" disabled={panelBusy || cluster.offset + 20 >= cluster.count} onclick={() => cluster && clusterPage(cluster.id, cluster.count, cluster.offset + 20)}>Next events</button></div></div>{/if}
