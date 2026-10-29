# Commons

A static, browser-run community event explorer. Built with Svelte, TypeScript and Vite. No application server, account, shared database, or paid AI API is required.

## Run locally

### Portable downloads — no development tools needed

Built files are in `releases/`. Give someone the one matching their operating system and processor:

| Computer | File | Start |
| --- | --- | --- |
| Windows Intel/AMD | `Commons-0.1.2-windows-x64.exe` | Double-click |
| Windows ARM | `Commons-0.1.2-windows-arm64.exe` | Double-click |
| Linux Intel/AMD | `Commons-0.1.2-linux-x64` | Allow execution in file permissions, then open |
| Linux ARM | `Commons-0.1.2-linux-arm64` | Allow execution in file permissions, then open |
| macOS Intel | `Commons-0.1.2-macos-intel.zip` | Extract, then open `Commons.app` |
| macOS Apple Silicon | `Commons-0.1.2-macos-apple-silicon.zip` | Extract, then open `Commons.app` |

The application opens `http://127.0.0.1:4173` in the default browser. No Node, Go, Python, Docker, administrator access, or application installation is required. Linux needs a desktop browser and `xdg-open`; some file managers require launching the executable from a terminal. macOS bundles target macOS 12 or newer. These builds are unsigned: Windows/macOS may require permission to open the download; macOS can offer **Open Anyway** in **System Settings → Privacy & Security** after the first attempt. Signed/notarized releases would need the distributor's signing credentials. Do not disable system protections globally.

Use **Quit local app** in the page footer to stop the server. Closing the browser tab alone leaves it running. Opening the executable again reopens the running instance. Quit before replacing it with an updated executable. If another program owns port 4173, the launcher reports the conflict instead of switching ports and making saved drafts appear lost.

The exact address and browser profile identify storage. Drafts and caches stay in the browser; they do not travel inside the executable. Export/import drafts when transferring computers or moving from `localhost:5173`/`localhost:4173` to `127.0.0.1:4173`. Live events, map tiles, remote posters, and the first OCR language download still need internet; the bundled interface, city search, and previously cached listings can work offline. Source CORS restrictions are unchanged.

The server listens only on IPv4 loopback, checks Host/Origin headers, serves only embedded files, and requires a per-run token for shutdown. It does not proxy sources or expose the filesystem. The bundled dependency licenses are available at `/THIRD-PARTY-NOTICES.txt`. Each release includes a SHA-256 checksum list and `START-HERE.txt` alongside the distributable files.

### Build portable releases

Maintainers need Node as below and Go 1.23 or newer (use a current patched Go release). Recipients need neither. From the repository root:

```sh
npm ci
npm run portable:build
```

This builds the frontend, compresses it into `portable/site.zip`, tests the Go launcher, and cross-compiles all six bundles. No third-party Go modules, ZIP utility, native C compiler, or hosting service is needed. To choose a local Go installation, set `COMMONS_GO` to its absolute executable path. Generated archives, toolchains, staging files, and releases are ignored by Git. After changing only launcher code, `node scripts/build-portable.mjs` can reuse the existing `dist/` build. Run Go tests from `portable/` after preparing `site.zip`.

For diagnostics, launch the executable with `--no-browser`; `--version` prints the release version. `--port` is available for isolated tests, but a changed port uses a different browser storage origin. macOS binaries live inside `Commons.app/Contents/MacOS/Commons`.

After building, `node scripts/browser-portable.mjs` tests the native Windows/Linux launcher, browser worker loading, duplicate launch handling, guarded shutdown and draft persistence across restarts. Set `COMMONS_EXECUTABLE` for a different binary; Windows developers can add `--wsl` to test Ubuntu's Linux build. On Linux, `node scripts/test-portable.mjs` verifies automatic browser opening through a test stand-in and occupied-port handling without opening a real browser. These checks start and stop their own servers.

### Development server

Use Node **22.12+ or 24 LTS**. This workspace has Node 24 installed through nvm in WSL:

```sh
cd /home/cilio/devProjects/events_app
nvm use 24
npm install
npm run dev
```

Open the localhost URL printed by Vite (normally `http://localhost:5173`). The `predev` step prepares local OCR worker/WebAssembly assets automatically. Keep the terminal running while using the app.

```sh
npm run check
npm test
npm run build
npm run preview
```

`dist/` is a static website suitable for static hosting, including a subdirectory. No deployment has been configured. Serve it over HTTP(S), rather than opening `index.html` as a `file://` document.

## Included

- A catalogue of 249 Gancio sources, covering all entries from both official directories plus additional instances found through Fedilist, Rumbly and an operator newsletter. Redirect aliases are retained. Search, enable, disable or remove sources in **Your sources**.
- List as the default view; filters for city, category, search text, individual days, next seven days, and weekend. Day buttons show unique-event counts for the current non-date filters, including saved events and enabled sources. Selecting one day keeps the other daily counts available for comparison. Recurring events count once per occupied day; multi-day events use their own timezone and an exclusive end time.
- Separate city search across 64,636 cities, a city dropdown with country labels, country-only filtering, and 5/10/25/50/100/250/500 km radii around a selected city centre. Radius filters include nearby towns and cross borders unless a country filter is selected. Country selection clears the previous city/radius. Daily counts and the optional map use the same location filters.
- Optional map loaded on demand, including its JavaScript and CSS. A dedicated worker builds a Supercluster spatial index; only clusters or individual markers in the visible viewport are rendered. Zooming in reveals more detail. Clicking a group opens an on-map event chooser, in pages of 20. When zoom cannot separate shared locations, the current page's markers spread apart for selection; these visual offsets never change stored coordinates or distance filtering. Remaining groups also expand at maximum zoom. Compact SVG pins identify venue locations; dashed circles identify estimates. Records with no usable location remain selectable in the map's **unplaced events** section. Coverage counts account for every filtered event, including events beyond the list's first page. Filter changes refit the map, centring on the selected city or country even when there are no matching events. Background updates preserve an intentional pan/zoom, while the initial load continues fitting newly arriving events. **Fit all events** resets the view. Closing the map releases its worker and markers.
- Source updates run in 2–4 Web Workers (depending on reported CPU capacity), with up to four source requests per worker: 8–16 concurrent sources. Fetching, JSON parsing and event normalization happen off the UI thread. Each source's pages remain sequential. Results are applied in short batches to avoid rerendering the catalogue for every response. Disabling a source cancels its current request; failures retain cached events. Browsers without Web Workers fall back to six concurrent sources on the main thread.
- Progress counts, retries through Refresh, pagination with a visible 1,000-row/source limit, explicit errors, and stale-cache fallback. Slow or unavailable source servers can still delay completion; events appear as successful sources finish.
- Event-source links, original tags, inferred categories, and conservative deduplication by canonical URL. Separate occurrences are preserved; available venue coordinates are retained when another duplicate lacks them.
- Local bookmarks, source configuration, event caches, and drafts in IndexedDB using Dexie.
- Poster OCR using Tesseract.js, with Italian/English text extraction and an editable review form. Alternatively paste text or enter an event manually.
- Multiple dated occurrences, event timezone, optional end times, and optional map coordinates.
- Local draft editing, duplication, deletion, JSON export/import including the original poster, and ICS calendar export.
- Source snapshots in the Commons JSON format. Reimporting the same source website replaces its cached snapshot.

## Boundaries

New drafts are **only on the current browser/device**. Saving does not publish them. Export JSON to back them up or move devices; clearing site data deletes local drafts. Calendar downloads are one-time snapshots and will not receive later edits/cancellations automatically. Calendar entries for drafts are marked tentative.

Gancio installations differ. Read access requires the source to allow the browser's origin through CORS. Fetching uses public endpoints without credentials. The browser only knows events supplied by enabled sources; it does not offer a complete worldwide catalogue. The default query retrieves upcoming events, including multi-day/recurrent entries when provided. A maximum of ten 100-row pages per source bounds requests and memory; the UI marks partial results. Private preferences and text searches are not sent to an application backend.

Some listing APIs omit descriptions and coordinates. The original event link is provided for full details. Radius uses straight-line distance from the selected city centre to source coordinates or a matched house-number address. Otherwise it uses an available street or city estimate and displays **Distance unverified**: the venue may lie outside the radius. Select **Only events with venue coordinates** to exclude approximate street/city positions. Events with no usable position cannot be included in radius results. Estimates appear as dashed markers or groups, are labelled in group details, and stay separate from actual venue coordinates in data and exports. Gancio's `(0,0)` placeholders and incomplete coordinate pairs are treated as missing; valid single zero coordinates are preserved. Existing cached locations are repaired on upgrade, including when sources are offline. Set source timezones explicitly; day filtering uses each event's timezone. Categories are simple, inspectable keyword mappings in `src/lib/events.ts` and can be wrong.

### Street-address markers

Open the map and click **Locate street addresses**. This explicitly sends up to 20 unique addresses from the filtered results to a Photon-compatible geocoder, one request at a time, at least 1.1 seconds apart. Choose a city first, or narrow the results to 20 events. It never scans the whole catalogue in the background. Local draft addresses are excluded unless **Include local draft addresses in this lookup** is checked. Only address/city/country and city-centre bias are sent; not titles, descriptions, posters, or GPS position. Requests omit credentials and referrer information. Closing the map, changing filters, or pressing **Stop lookup** cancels pending work.

The default is [Photon's public demo](https://github.com/komoot/photon#demo-server), which permits reasonable use but may throttle requests and has no availability guarantee. Change **Address service → Photon API endpoint** to use another compatible service without rebuilding; it must allow browser requests (CORS). Public services are unsuitable for unrestricted bulk geocoding. No backend, API key, or paid service is required for this limited lookup action.

Matches must agree with the supplied street and house number and pass city/country/proximity checks. Ambiguous or unmatched addresses keep their existing estimate; a street-only result remains a labelled **street estimate**, never a house-number match. Multiple nearby OSM objects at the same address are treated as one location. Source coordinates always win. The map refits to newly requested matches, and all matching events at an address reuse the result. A label and OpenStreetMap link explain each match; a geocoder match is not a guarantee of venue accuracy. Export/import retains the separate `addressLocation` metadata and attribution rather than inserting inferred coordinates into the original source fields.

Up to 2,000 results are cached in browser storage: matches for 30 days and no-match results for one day. The key includes provider, address, city and country, so changed addresses do not reuse stale locations. Network errors are not cached as no-match results. Cached results are reapplied after source refresh and reload. Map data is © OpenStreetMap contributors, under [ODbL](https://www.openstreetmap.org/copyright).

## City and country data

City search, city-name matching within addresses, and basic location enrichment run in a dedicated browser worker without sending searches or addresses to a geocoding service. Street-address lookup is a separate explicit action described above. No GPS permission is requested. The static geography worker includes about 5.2 MB of uncompressed city/boundary data and code, fetched once from the same site; HTTP compression can reduce transfer size. The UI and map remain separate from this data processing.

The bundled city index is derived from [GeoNames cities5000](https://download.geonames.org/export/dump/), downloaded on 28 October 2026, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It retains local/ASCII names, country, region code, population and centre coordinates, excludes historical/abandoned places and city subdivisions, and adds selected common exonyms. It is broad coverage, not every village worldwide. Run `python3 scripts/build-geography.py` to regenerate the attributed `src/data/geography.json` and `countries.json` files, then rebuild.

Explicit event city/country fields take priority where available. Missing cities are matched against addresses, then estimated from a nearby city within 25 km of supplied coordinates, or finally from a city-scoped calendar's declared coverage. Country inference uses supplied country information, generalized [Natural Earth boundaries distributed by world-atlas](https://github.com/topojson/world-atlas), address/city information, or source coverage. Timezones are never used as countries. Boundaries are the public-domain 1:50m Natural Earth v4.1.0 dataset and are approximate near borders and coastlines. Nearby-city labels are not municipal boundary determinations. Event details identify inferred city labels.

Existing cached events are re-enriched when opened, repairing the old limited city heuristic even if a source is offline. Source configuration and drafts are preserved. Country is optional on local drafts and survives JSON export/import. Unknown country remains selectable in the country filter.

**Bungarang is not connected live.** Its event-list API rejected an unrelated origin with `Invalid CORS request` during inspection. Obtain a supported feed/export or origin permission before enabling direct access. The snapshot importer is a working alternative for an agreed data export; it does not scrape arbitrary websites or bypass CORS. An adapter must normalize another site's format into the schema below.

OCR automatically proposes a draft; it does not guarantee correct programme interpretation. Multiple Italian/English dates are recognized. Missing years, times and ranges are flagged. Range endpoints are proposed for review rather than silently inventing daily sessions. Different activities on the same poster should become separate drafts (use Duplicate and edit). Styling, columns, ambiguous dates and small print may require manual corrections. Poster recognition currently uses a shared detected time for proposed occurrences; review each session's time.

## Source catalogue maintenance

The checked-in catalogue is `src/data/gancio-sources.json`. It records discovery links, coverage descriptions, API check results, timezones from public NodeInfo or the official directory, and redirect aliases. Discovery starts at [Gancio v2 instances](https://gancio.org/v2/instances), includes the [current official directory](https://gancio.org/instances), and expands through [Fedilist](https://fedilist.com/instance?software=gancio) and [Rumbly](https://rumbly.net/communities?project=gancio). Two further candidates come from the linked operator newsletter recorded on their entries. This is a dated catalogue of discovered instances, not a claim to know every Gancio installation worldwide.

The 28 October 2026 check found 250 unique candidate addresses, including one redirect alias: **249 sources, 234 responding APIs with cross-origin headers, 15 unavailable, and 228 enabled by default**. Test/demo calendars, unconfirmed Gancio installations, unavailable APIs and sources without a confirmed timezone remain listed but disabled. UTC is explicitly flagged as a fallback when necessary. The check uses a sample unrelated origin; a particular browser, origin, network or later source configuration may give different results. Runtime failures are shown in the source dialog.

Run `npm run sources:update` to rediscover and check sources, then review the JSON diff and rebuild. The maintenance script runs on the developer's machine; the deployed app needs only static files. It parses directory JSON without executing downloaded JavaScript and limits checks to six instances at a time. It does not publish events, create accounts, scrape event pages or use a CORS proxy.

New catalogue entries are added to existing browser settings on upgrade. Previously disabled sources stay disabled, custom sources remain, and a separate list of seen URLs prevents removed sources from reappearing. Coverage descriptions for regions are not treated as city coordinates. Live source choices remain local to the browser.

## Privacy and external requests

No analytics, tracking SDK, account system, or cloud preference storage is included. Source servers see normal HTTP requests, including IP addresses. Original poster thumbnails load from their publishing sources. Map tiles load from OpenStreetMap with attribution and normal referrer behavior; tiles are not bulk-downloaded, prefetched or placed in an offline service-worker cache. No GPS prompt is made.

The OCR worker and WebAssembly engine are served with the app. Tesseract language data downloads on first use from its default language CDN and is cached by the engine. **The poster's pixels and extracted text are processed on the device.** No remote AI service receives them. Exported JSON can contain the complete poster and any information the user entered; inspect it before sharing.

## Snapshot format

The JSON export is also the source-adapter interchange format:

```json
{
  "format": "commons-events",
  "version": 1,
  "events": [
    {
      "id": "source-event-123",
      "title": "Example event — replace with actual source data",
      "description": "Description from the source",
      "venue": "Public venue",
      "address": "",
      "city": "Reggio Calabria",
      "categories": ["Games & chess"],
      "tags": ["scacchi"],
      "occurrences": [
        { "start": "2030-11-03T17:00:00Z" },
        { "start": "2030-11-10T17:00:00Z" }
      ],
      "timezone": "Europe/Rome",
      "sourceUrl": "https://example.org/events/source-event-123",
      "canonicalUrl": "https://example.org/events/source-event-123",
      "status": "scheduled",
      "updatedAt": "2030-10-28T12:00:00Z"
    }
  ]
}
```

Optional `latitude` and `longitude` must be actual public coordinates; omit them when unknown. Optional `imageUrl` must be HTTP(S). Local draft exports can contain `poster` as a base64 PNG/JPEG/WebP data URL. The importer validates dates, timezones, coordinate ranges, URL protocols, and basic size limits. Import under **Local drafts** creates private editable copies; import under **Your sources** preserves source attribution as a snapshot.

## Browser checks

With a dev or preview server running:

```sh
node scripts/browser-smoke.mjs
node scripts/browser-features.mjs
node scripts/browser-performance.mjs
node scripts/browser-location.mjs
node scripts/browser-map-controls.mjs
node scripts/browser-map.mjs
node scripts/browser-address.mjs
```

On Windows these use the installed Chrome at its standard path. On Linux install a Playwright Chromium browser, or set `COMMONS_BROWSER` to an existing compatible browser executable. `COMMONS_URL` overrides localhost:5173.

The smoke script checks real source reads, three-date extraction, draft persistence/editing, exports, day filtering, and mobile layout. The feature script uses explicitly mocked event APIs to exercise source toggles and network failures, then tests the actual OCR worker using a generated test poster and verifies poster JSON roundtripping. Screenshots go to ignored `test-results/`. No test data is injected into the application itself.

The performance script uses controlled API fixtures with 3,003 unique events to verify actual worker threads and bounded download concurrency, absence of map assets/tiles before opening the map, daily counts under combined filters, deduplication, clustered viewport rendering, individual selection, co-located events, map teardown, and mobile layout. It reports fixture loading times and main-thread long tasks; these are not a guarantee of live-network timing.

The location script covers Amsterdam and Reggio Calabria addresses without city fields, country-only filtering, city search/dropdown selection, distance boundaries, city estimates and strict radius filtering, daily counts, map coverage, persistent offline cache migration and mobile layout. It also verifies that searches make no external geocoding requests. The map script reproduces Milano/today with more than 30 events, approximate groups, shared-source coordinates, unplaced records, filter refitting, pan preservation during refresh, strict radius mode and mobile layout.

The address script checks explicit-only requests, shared-address caching, rate limits, house/street/city distinctions, private-draft opt-in, attribution, radius filtering, automatic refitting after lookup, and cache reuse after refresh/reload. It uses controlled Photon responses; live checks should use a few public venue addresses, not bulk queries.

## Structure

`src/lib/events.ts` contains the Gancio adapter, category mappings and date filtering. `poster.ts` handles date extraction and timezone conversion. `storage.ts` defines local persistence. `export.ts` handles portable files. The Svelte components implement the map, poster review form and native accessible dialogs.

The original `phylosophical_specs.txt` remains the broader product vision. Public submission, remote moderation, management links, and integrated reservations are outside this local-first prototype.
