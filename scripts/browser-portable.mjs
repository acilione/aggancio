import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const useWSL = process.argv.includes('--wsl');
const port = useWSL ? 4176 : 4175;
const origin = `http://127.0.0.1:${port}`;
const executable = process.env.COMMONS_EXECUTABLE || path.join(root, 'releases', `Commons-${version}-${process.platform === 'win32' ? 'windows-x64.exe' : 'linux-x64'}`);
const launch = () => {
  const command = useWSL ? 'wsl' : executable;
  const args = useWSL ? ['-d', 'Ubuntu', '--exec', `./releases/Commons-${version}-linux-x64`, '--no-browser', '--port', String(port)] : ['--no-browser', '--port', String(port)];
  const process = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  process.output = ''; process.stdout.on('data', data => process.output += data); process.stderr.on('data', data => process.output += data);
  process.on('error', error => process.output += error.message);
  return process;
};
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(origin + '/_commons/status'); if (response.ok && (await response.json()).app === 'commons-events-portable-v1') return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Launcher did not start');
}
async function stopped(process) {
  if (process.exitCode !== null) { assert.equal(process.exitCode, 0, process.output); return; }
  const [code] = await Promise.race([once(process, 'exit'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Launcher did not exit')), 10000); timer.unref(); })]);
  assert.equal(code, 0, process.output);
}
// Do not attach to or stop a pre-existing instance during this test.
try { await fetch(origin + '/_commons/status'); throw new Error(`Test port already occupied: ${origin}`); }
catch (error) { if (error.message.startsWith('Test port')) throw error; }
let child = launch();
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : process.env.COMMONS_BROWSER ? { executablePath: process.env.COMMONS_BROWSER } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
await context.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'Access-Control-Allow-Origin': '*' } }));
try {
  await ready();
  assert.equal(await (await fetch(origin + '/_commons/status')).json().then(value => value.version), version);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Quit local app', exact: true }).waitFor();
  await page.getByLabel('Search city', { exact: true }).fill('Reggio Calabria');
  await page.locator('.city-suggestions button').filter({ hasText: 'Italy' }).first().click();
  assert.ok(page.workers().some(worker => worker.url().includes('geography.worker')), 'Bundled geography worker runs');
  await page.waitForFunction(() => !document.querySelector('.coverage-line')?.textContent.includes('Updating'));
  // Seed an actual draft and verify browser storage survives stopping/restarting the executable.
  await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('commons-local'); request.onsuccess = () => resolve(request.result); });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ id: 'draft:portable-test', title: 'Portable restart draft', description: '', venue: '', address: 'Reggio Calabria, Italy', city: 'Reggio Calabria', cityBasis: 'provided', countryCode: 'IT', categories: ['Community'], tags: [], occurrences: [{ start: '2035-11-03T17:00:00Z' }], timezone: 'Europe/Rome', sourceId: 'local', sourceName: 'Local draft', sourceUrl: '', local: true, status: 'scheduled', updatedAt: new Date().toISOString(), cachedAt: new Date().toISOString() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); database.close();
  });
  const second = launch(); await stopped(second);
  assert.equal((await fetch(origin + '/')).status, 200, 'Second launch retains the original server');
  const client = await (await fetch(origin + '/_commons/client.js')).text();
  const token = client.match(/const token = "([a-f0-9]+)"/)[1];
  assert.equal((await fetch(origin + '/_commons/quit', { method: 'POST' })).status, 403);
  assert.equal((await fetch(origin + '/_commons/quit', { method: 'POST', headers: { Origin: 'https://example.com', 'X-Commons-Token': token } })).status, 403);
  await page.getByRole('button', { name: 'Quit local app', exact: true }).click();
  await page.getByRole('heading', { name: 'Commons is closed' }).waitFor();
  await stopped(child);
  child = launch(); await ready();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Portable restart draft', exact: true }).waitFor({ timeout: 30000 });
  const currentClient = await (await fetch(origin + '/_commons/client.js')).text();
  assert.notEqual(currentClient.match(/const token = "([a-f0-9]+)"/)[1], token, 'Shutdown token changes on restart');
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', `portable-${useWSL ? 'linux' : process.platform}.png`) });
  await page.getByRole('button', { name: 'Quit local app', exact: true }).click();
  await page.getByRole('heading', { name: 'Commons is closed' }).waitFor();
  await stopped(child);
  assert.deepEqual(errors, []);
  console.log(`PASS: ${useWSL ? 'Linux (WSL)' : process.platform} executable, bundled frontend/worker, duplicate launch, guarded shutdown, restart and persistent drafts.`);
} finally {
  if (child.exitCode === null) {
    try {
      const script = await (await fetch(origin + '/_commons/client.js')).text();
      const token = script.match(/const token = "([a-f0-9]+)"/)[1];
      await fetch(origin + '/_commons/quit', { method: 'POST', headers: { 'X-Commons-Token': token } });
      await stopped(child);
    } catch { child.kill(); }
  }
  await browser.close();
}
