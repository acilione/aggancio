import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: process.env.COMMONS_BROWSER ||
  (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) });
const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const rows = ['Milano', 'Amsterdam', 'Torino'].map((city, i) => ({
  id: i + 1, title: 'Concert in ' + city, start_datetime: Date.parse('2030-11-03T18:00:00Z') / 1000,
  place: { city, address: city + (i === 1 ? ', Netherlands' : ', Italy'), country: i === 1 ? 'NL' : 'IT' },
}));
const answer = (route, data) => route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
let offline = false;
let scans = 0;
await context.route('**/api/events?*', route => answer(route, new URL(route.request().url()).host === 'puntello.org' ? rows : []));
await context.route('https://framagit.org/api/**', route => {
  scans++;
  return offline ? route.abort() : answer(route, [
    { name: 'New calendar', url: 'https://new.example/', timezone: 'Europe/Rome' },
    { name: 'Same calendar', url: 'https://NEW.example/events', timezone: 'Europe/Rome' },
    { url: 'https://puntello.org', name: 'Known calendar' },
  ]);
});
await context.route('https://raw.githubusercontent.com/**', route => route.abort());
const count = value => page.waitForFunction(n => document.querySelector('.result-count')?.textContent === String(n), value);
const button = name => page.getByRole('button', { name, exact: true });
const openSources = () => page.locator('.main-footer').getByRole('button', { name: 'Sources & privacy' }).click();
async function addCity(name, country) {
  await page.getByLabel('Find a preferred city').fill(name);
  await page.locator('dialog .city-suggestions button').filter({ hasText: country }).first().click();
}
try {
  await page.goto(process.env.COMMONS_URL || 'http://localhost:5173');
  await count(3);
  await button('City preferences').click();
  await addCity('Milano', 'Italy');
  await addCity('Amsterdam', 'Netherlands');
  await button('Save city preferences').click();
  await count(2);
  await page.getByLabel('Select a specific day').fill('2030-11-03');
  assert.match(await page.locator('[data-day="2030-11-03"] .day-count').innerText(), /^2/);
  await page.getByLabel('City', { exact: true }).selectOption('');
  await count(3);
  await page.reload();
  await count(2);
  assert.deepEqual((await page.locator('.event-card h3').allTextContents()).sort(), ['Concert in Amsterdam', 'Concert in Milano']);
  assert.equal(scans, 0);
  await openSources();
  const scan = button('Rescan Gancio directories');
  await scan.click();
  await page.getByRole('status').filter({ hasText: '1 new · 1 already listed' }).waitFor();
  assert.match(await page.locator('dialog').innerText(), /Could not check Aggancio catalogue/);
  const newlyAdded = page.getByRole('switch', { name: 'Enable New calendar' });
  assert.equal(await newlyAdded.getAttribute('aria-checked'), 'false');
  await scan.click();
  await page.getByRole('status').filter({ hasText: '0 new · 2 already listed' }).waitFor();
  offline = true;
  await scan.click();
  await page.getByRole('alert').filter({ hasText: 'directories could not be read' }).waitFor();
  await button('Close dialog').click();
  await page.reload();
  await count(2);
  await openSources();
  await page.getByLabel('Search sources', { exact: true }).fill('new.example');
  assert.equal(await newlyAdded.count(), 1);
  await button('Close dialog').click();
  await button('City preferences').click();
  await button('Remove Milano').click();
  await button('Remove Amsterdam').click();
  await button('Save city preferences').click();
  await count(3);
  await page.reload(); await count(3);
  assert.deepEqual(errors, []);
  console.log('PASS: preferred city union, counts, temporary override, reload and clearing; partial, repeated and offline scans, source deduplication and persistence.');
} finally { await browser.close(); }
