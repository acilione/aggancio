<script lang="ts">
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { Maximize2, MapPin } from '@lucide/svelte';
  import type { EventRecord } from '../lib/types';
  let { events = [], selectedId = '', onSelect = (_event: EventRecord) => {}, center, onPick, picked }: {
    events?: EventRecord[]; selectedId?: string; onSelect?: (event: EventRecord) => void;
    center?: [number, number]; onPick?: (lat: number, lon: number) => void; picked?: [number, number];
  } = $props();
  let container: HTMLDivElement;
  let map = $state.raw<L.Map | null>(null);
  let layer: L.LayerGroup;
  const markers = new globalThis.Map<string, { marker: L.Marker; event: EventRecord; style: string }>();
  let pickedMarker: L.CircleMarker | undefined;
  let tileError = $state(false);
  let lastBoundsKey = '';
  const located = $derived(events.filter(event => event.latitude !== undefined && event.longitude !== undefined));
  const palette: Record<string, string> = { Music: '#d58451', 'Arts & culture': '#857ab0', 'Games & chess': '#558b81', 'Sport & outdoors': '#809d64', Learning: '#c6a34e', Community: '#af7188', Other: '#85918a' };
  function fit() {
    if (!map || !located.length) return;
    map.fitBounds(L.latLngBounds(located.map(event => [event.latitude!, event.longitude!] as L.LatLngTuple)), { padding: [48, 48], maxZoom: 13 });
  }
  onMount(() => {
    const instance = L.map(container, { zoomControl: false, scrollWheelZoom: false }).setView(center || [45.0703, 7.6869], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxZoom: 19,
    }).on('tileerror', () => { tileError = true; }).addTo(instance);
    layer = L.layerGroup().addTo(instance);
    if (onPick) instance.on('click', event => onPick?.(event.latlng.lat, event.latlng.lng));
    const observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container);
    map = instance;
    return () => { observer.disconnect(); instance.remove(); map = null; };
  });
  $effect(() => {
    if (!map || !layer) return;
    const visible = new Set(located.map(event => event.id));
    for (const [id, item] of markers) {
      if (!visible.has(id)) { layer.removeLayer(item.marker); markers.delete(id); }
    }
    for (const event of located) {
      const active = selectedId === event.id;
      const color = event.local ? '#5e7961' : palette[event.categories[0]] || '#85918a';
      const style = `${color}:${active}:${event.local}`;
      const existing = markers.get(event.id);
      const icon = () => L.divIcon({ className: 'commons-pin', html: `<span style="--pin-color:${color}" class="${active ? 'active' : ''}">${event.local ? '✎' : '•'}</span>`, iconSize: [34, 42], iconAnchor: [17, 38] });
      if (existing) {
        if (existing.style !== style) { existing.marker.setIcon(icon()); existing.style = style; }
        if (existing.event.latitude !== event.latitude || existing.event.longitude !== event.longitude) existing.marker.setLatLng([event.latitude!, event.longitude!]);
        if (existing.event.title !== event.title) {
          const label = document.createElement('span'); label.textContent = event.title;
          existing.marker.setTooltipContent(label);
          const element = existing.marker.getElement();
          if (element) { element.title = event.title; element.setAttribute('aria-label', event.title); }
        }
        existing.event = event;
      } else {
        const marker = L.marker([event.latitude!, event.longitude!], { icon: icon(), keyboard: true, title: event.title, alt: event.title });
        const label = document.createElement('span'); label.textContent = event.title;
        markers.set(event.id, { marker, event, style });
        marker.bindTooltip(label, { direction: 'top', offset: [0, -30] }).on('click', () => { const current = markers.get(event.id); if (current) onSelect(current.event); }).addTo(layer);
      }
    }
    if (pickedMarker) { layer.removeLayer(pickedMarker); pickedMarker = undefined; }
    if (picked) pickedMarker = L.circleMarker(picked, { color: '#355b45', fillColor: '#355b45', fillOpacity: 0.8, radius: 9 }).addTo(layer);
    const boundsKey = located.map(event => event.id).join('|');
    if (boundsKey && boundsKey !== lastBoundsKey) { lastBoundsKey = boundsKey; fit(); }
  });
  $effect(() => { if (map && onPick && center) map.setView(center, 12); });
</script>

<div class="map-wrapper" class:picker={!!onPick}>
  <div bind:this={container} class="map-canvas" role="region" aria-label={onPick ? 'Click the map to select the event location' : 'Event locations; the event list provides the same information'}></div>
  {#if !onPick}<div class="map-topline"><span><span class="live-dot"></span>{located.length} on the map</span><button class="map-button" onclick={fit} aria-label="Fit all events on map"><Maximize2 size={16} /></button></div>{/if}
  {#if onPick}<span class="map-pick-hint"><MapPin size={14} /> Click to place the event</span>{/if}
  {#if tileError}<div class="map-notice">Map tiles could not load. All events are still available in the list.</div>{/if}
</div>
