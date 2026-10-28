// Public directory discovery and credential-free API checks. Run with Node 22+.
// Bundled directory data is parsed as JSON, never evaluated as JavaScript.
import { mkdir, writeFile } from 'node:fs/promises';

const directories = ['https://gancio.org/v2/instances', 'https://gancio.org/instances'];
const fedilist = 'https://fedilist.com/instance?software=gancio';
const rumbly = 'https://rumbly.net/communities?project=gancio';
const candidates = new Map();
const discovery = [];
const origin = 'https://commons.example';
async function get(url, headers = {}) {
  return fetch(url, { headers, signal: AbortSignal.timeout(12000) });
}
function add(url, discoveredAt, details = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return;
  const key = parsed.origin;
  const previous = candidates.get(key);
  candidates.set(key, { ...details, ...previous, url: key, discoveredAt: [...new Set([...(previous?.discoveredAt || []), discoveredAt])] });
}
for (const directory of directories) {
  const page = await get(directory);
  if (!page.ok) throw new Error(`Directory HTTP ${page.status}: ${directory}`);
  const html = await page.text();
  const asset = html.match(/(?:src|href)="([^"]*instances\.md\.[^"]*\.lean\.js)"/)?.[1];
  if (!asset) throw new Error(`Directory format changed: ${directory}`);
  const bundle = await (await get(new URL(asset, directory))).text();
  const json = bundle.match(/JSON\.parse\(`(\[.*?\])`\)/s)?.[1];
  if (!json) throw new Error(`Directory JSON missing: ${directory}`);
  const entries = JSON.parse(json);
  for (const entry of entries) add(entry.url, directory, { name: entry.name, region: (entry.place || '').replace(/^\(|\)$/g, ''), timezone: entry.timezone, official: true });
  discovery.push({ url: directory, entries: entries.length });
}
for (const directory of [fedilist, rumbly]) {
  try {
    const response = await get(directory);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const matches = directory === fedilist
      ? [...html.matchAll(/<a\s+href="(https:[^"]+)"[^>]*class="instance-link"/g)]
      : [...html.matchAll(/<h3><a\s+href=['"](https:[^'"]+)['"]/g)];
    if (!matches.length) throw new Error('No instance links; directory format may have changed');
    for (const match of matches) add(match[1], directory);
    discovery.push({ url: directory, entries: matches.length });
  } catch (error) { throw new Error(`Discovery failed for ${directory}: ${error.message}`); }
}
// Operator newsletter supplies two calendars absent from the other directories.
const newsletter = 'https://blogs.sindominio.net/blog/boletin-sindominio-marzo-2024-cast-cat-fr-eus/';
for (const url of ['https://agenda.eskoria.eus', 'https://agenda.lanbroa.eus']) add(url, newsletter);
console.log(`Checking ${candidates.size} candidate instances (six at a time)...`);
const checkedAt = new Date().toISOString();
const results = [];
const queue = [...candidates.values()];
let completed = 0;
async function inspect(candidate) {
  const result = { ...candidate, checkedAt, access: 'unavailable', checkMessage: '', confirmedGancio: false };
  const checks = await Promise.allSettled([
    (async () => {
      const response = await get(`${candidate.url}/.well-known/nodeinfo/2.0`);
      const info = await response.json();
      if (!response.ok || info.software?.name?.toLowerCase() !== 'gancio') throw new Error('Gancio NodeInfo not available');
      result.confirmedGancio = true;
      result.name = info.metadata?.nodeName || candidate.name;
      result.timezone = info.metadata?.nodeTimezone || candidate.timezone;
      result.version = info.software.version;
    })(),
    (async () => {
      const response = await get(`${candidate.url}/api/events?max=1&page=0`, { Origin: origin });
      if (!response.ok) throw new Error(`API HTTP ${response.status}`);
      const data = await response.json();
      const events = Array.isArray(data) ? data : data.events;
      if (!Array.isArray(events)) throw new Error('API did not return an event list');
      result.apiUrl = response.url;
      const cors = response.headers.get('access-control-allow-origin');
      result.access = cors === '*' || cors === origin ? 'available' : 'cors-blocked';
      result.checkMessage = result.access === 'available' ? 'Public API and cross-origin response checked.' : 'Public API responded, but did not allow the test origin.';
    })(),
  ]);
  if (checks[1].status === 'rejected') result.checkMessage = checks[1].reason.message;
  try { new Intl.DateTimeFormat('en', { timeZone: result.timezone || 'invalid' }); }
  catch { result.timezone = 'UTC'; result.timezoneUnconfirmed = true; }
  result.name ||= new URL(candidate.url).hostname;
  result.region ||= '';
  return result;
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const candidate = queue.shift();
    results.push(await inspect(candidate));
    if (++completed % 25 === 0) console.log(`Checked ${completed}/${candidates.size}`);
  }
}));
// Collapse aliases only when the API actually redirects to an already listed host.
const byUrl = new Map(results.map(result => [result.url, result]));
for (const result of results) {
  if (!result.apiUrl) continue;
  const canonical = byUrl.get(new URL(result.apiUrl).origin);
  if (!canonical || canonical === result) continue;
  canonical.aliases = [...new Set([...(canonical.aliases || []), result.url])];
  canonical.discoveredAt = [...new Set([...canonical.discoveredAt, ...result.discoveredAt])];
  canonical.official ||= result.official;
  canonical.region ||= result.region;
  result.aliasOf = canonical.url;
}
const fallbackCities = { 'gancio.cisti.org': 'Torino', 'lapunta.org': 'Firenze', 'puntello.org': 'Milano', 'lasitua.org': 'Brescia', 'balotta.org': 'Bologna', 'gancio.daghe.org': 'Trento', 'www.attoppa.it': 'Catania', 'camifa.net': 'Cosenza', 'jamme.la': 'Napoli', 'rebaltela.org': 'Verona', 'roma.convoca.la': 'Roma', 'scruscio.org': 'Palermo', 'gancio.invegendo.org': 'Genova', 'botep.org': 'Bergamo', 'meh.convoca.la': 'Bari', 'lucitr.one': "L'Aquila" };
const sources = results.filter(result => !result.aliasOf).map(result => {
  const host = new URL(result.url).hostname;
  return { id: host === 'gancio.cisti.org' ? 'gancio-torino' : host === 'demo.gancio.org' ? 'gancio-demo' : `gancio:${host}`, name: host === 'gancio.cisti.org' ? 'Gancio · Torino' : result.name, url: result.url, kind: 'gancio', city: fallbackCities[host] || '', timezone: result.timezone, enabled: result.access === 'available' && (result.official || result.confirmedGancio) && !result.timezoneUnconfirmed && !/^(demo|test)[.-]/.test(host), region: result.region, discoveredAt: result.discoveredAt, aliases: result.aliases || [], checkedAt, access: result.access, checkMessage: result.checkMessage, confirmedGancio: result.confirmedGancio, timezoneUnconfirmed: !!result.timezoneUnconfirmed };
}).sort((a,b) => a.id === 'gancio-torino' ? -1 : b.id === 'gancio-torino' ? 1 : a.name.localeCompare(b.name));
await mkdir('src/data', { recursive: true });
await writeFile('src/data/gancio-sources.json', JSON.stringify({ checkedAt, discovery, sources }, null, 2) + '\n');
const counts = sources.reduce((out, source) => { out[source.access] = (out[source.access] || 0) + 1; return out; }, {});
console.log(JSON.stringify({ sources: sources.length, enabled: sources.filter(s => s.enabled).length, aliases: results.filter(r => r.aliasOf).length, ...counts }));
