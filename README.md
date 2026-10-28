# Commons

A static, browser-run community event explorer. Built with Svelte, TypeScript and Vite. No application server, account, shared database, or paid AI API is required.

## Run locally

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
- Map and equivalent list; filters for city, category, search text, individual days, next seven days, and weekend.
- Source loading with six concurrent requests, progress counts, retries through Refresh, pagination with a visible 1,000-row/source limit, explicit errors, and stale-cache fallback.
- Event-source links, original tags, inferred categories, and conservative deduplication by canonical URL. Separate occurrences are preserved.
- Local bookmarks, source configuration, event caches, and drafts in IndexedDB using Dexie.
- Poster OCR using Tesseract.js, with Italian/English text extraction and an editable review form. Alternatively paste text or enter an event manually.
- Multiple dated occurrences, event timezone, optional end times, and optional map coordinates.
- Local draft editing, duplication, deletion, JSON export/import including the original poster, and ICS calendar export.
- Source snapshots in the Commons JSON format. Reimporting the same source website replaces its cached snapshot.

## Boundaries

New drafts are **only on the current browser/device**. Saving does not publish them. Export JSON to back them up or move devices; clearing site data deletes local drafts. Calendar downloads are one-time snapshots and will not receive later edits/cancellations automatically. Calendar entries for drafts are marked tentative.

Gancio installations differ. Read access requires the source to allow the browser's origin through CORS. Fetching uses public endpoints without credentials. The browser only knows events supplied by enabled sources; it does not offer a complete worldwide catalogue. The default query retrieves upcoming events, including multi-day/recurrent entries when provided. A maximum of ten 100-row pages per source bounds requests and memory; the UI marks partial results. Private preferences and text searches are not sent to an application backend.

Some listing APIs omit descriptions and coordinates. The original event link is provided for full details. Missing coordinates stay off the map. A source's optional fallback city is a coverage assumption, not a geocoded address. Set source timezones explicitly; day filtering uses each event's timezone. Categories are simple, inspectable keyword mappings in `src/lib/events.ts` and can be wrong.

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
```

On Windows these use the installed Chrome at its standard path. On Linux install a Playwright Chromium browser, or set `COMMONS_BROWSER` to an existing compatible browser executable. `COMMONS_URL` overrides localhost:5173.

The smoke script checks real source reads, three-date extraction, draft persistence/editing, exports, day filtering, and mobile layout. The feature script uses explicitly mocked event APIs to exercise source toggles and network failures, then tests the actual OCR worker using a generated test poster and verifies poster JSON roundtripping. Screenshots go to ignored `test-results/`. No test data is injected into the application itself.

## Structure

`src/lib/events.ts` contains the Gancio adapter, category mappings and date filtering. `poster.ts` handles date extraction and timezone conversion. `storage.ts` defines local persistence. `export.ts` handles portable files. The Svelte components implement the map, poster review form and native accessible dialogs.

The original `phylosophical_specs.txt` remains the broader product vision. Public submission, remote moderation, management links, and integrated reservations are outside this local-first prototype.
