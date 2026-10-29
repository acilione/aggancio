import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : process.env.COMMONS_BROWSER ? { executablePath: process.env.COMMONS_BROWSER } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Europe/Rome' });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-10-29T12:00:00+01:00'));
const errors = []; page.on('pageerror', error => errors.push(error.message));
const row = (id, title, city = 'Milano', latitude = null, longitude = null, start = '2026-10-29T18:00:00Z') => ({ id, title, start_datetime: Date.parse(start)/1000, tags: ['music'], place: { city, country: 'IT', address: city, latitude, longitude } });
const shared = { ...row(200, 'Shared precise venue'), ap_id: 'https://calendar.example/shared' };
const milano = [...Array.from({ length: 35 }, (_, i) => row(i + 1, `Milano city-only ${i + 1}`)), shared, row(201, 'Milano exact venue', 'Milano', 45.49, 9.22), row(300, 'Torino tomorrow', 'Torino', 45.07, 7.68, '2026-10-30T18:00:00Z')];
const copies = [{ ...shared, place: { ...shared.place, latitude: 45.48, longitude: 9.21 } }, row(500, 'Unplaced gathering', 'Undisclosed village')];
await context.route('**/api/events?*', route => {
  const host = new URL(route.request().url()).hostname;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(host === 'puntello.org' ? milano : host === 'all.askapunk.net' ? copies : []), headers: { 'Access-Control-Allow-Origin': '*' } });
});
const count = expected => page.waitForFunction(expected => Number(document.querySelector('.result-count')?.textContent) === expected, expected);
const mapCount = expected => page.waitForFunction(expected => !document.querySelector('.map-topline')?.textContent.includes('Updating') && [...document.querySelectorAll('.commons-pin,.commons-cluster')].reduce((sum, marker) => sum + Number(marker.dataset.eventCount), 0) === expected, expected);
try {
  await page.goto(process.env.COMMONS_URL || 'http://localhost:5173');
  await page.waitForFunction(() => document.querySelector('.coverage-line button') && !document.querySelector('.coverage-line button').disabled, null, { timeout: 60000 });
  await page.getByLabel('City', { exact: true }).selectOption('Milano');
  await page.locator('[data-day="2026-10-29"]').click(); await count(37);
  assert.equal(await page.locator('.event-card').count(), 30, 'List pagination does not restrict map input');
  await page.getByRole('button', { name: 'Map and list view', exact: true }).click();
  await mapCount(37);
  assert.match(await page.locator('.map-footer').innerText(), /2 venue locations[\s\S]*35 city estimates[\s\S]*0 unplaced/);
  for (let i = 0; i < 8 && !await page.locator('.cluster-events').isVisible(); i++) {
    await page.locator('.commons-cluster.approximate-location').first().click();
    await page.waitForTimeout(350);
  }
  await page.locator('.cluster-events').waitFor();
  const titles = new Set(await page.locator('.cluster-event').allTextContents());
  await page.getByRole('button', { name: 'Next events', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.cluster-events .source-actions:last-child')?.textContent.includes('21–35'));
  for (const title of await page.locator('.cluster-event').allTextContents()) titles.add(title);
  assert.equal(titles.size, 35, 'All estimated/co-located events remain selectable');
  assert.equal(await page.locator('.estimate-label').count(), 15);
  await page.locator('.cluster-event').first().click();
  await page.getByRole('heading', { name: 'Event details', exact: true }).waitFor();
  assert.ok((await page.locator('dialog').innerText()).includes('city centre is shown as an estimate'));
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Switching filters resets the old cluster panel and refits without a manual Fit click.
  await page.getByLabel('City', { exact: true }).selectOption('Torino'); await count(0); await mapCount(0);
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('.map-wrapper').dataset.latitude) - 45.07) < .05 && Math.abs(Number(document.querySelector('.map-wrapper').dataset.longitude) - 7.68) < .05);
  assert.equal(await page.locator('.cluster-events').count(), 0);
  await page.locator('[data-day="2026-10-30"]').click(); await count(1); await mapCount(1);
  assert.ok(await page.locator('.commons-pin[title="Torino tomorrow"]').isVisible());
  // Background refresh respects an intentional pan.
  const canvas = await page.locator('.map-canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width/2, canvas.y + canvas.height/2);
  await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width/2 + 85, canvas.y + canvas.height/2 + 25, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const before = await page.locator('.commons-pin').boundingBox();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.coverage-line button').disabled); await mapCount(1);
  const after = await page.locator('.commons-pin').boundingBox();
  assert.ok(Math.abs(after.x - before.x) < 3 && Math.abs(after.y - before.y) < 3, 'Refresh preserves a user-panned viewport');
  await page.getByLabel('City', { exact: true }).selectOption('');
  await page.locator('[data-day="2026-10-29"]').click(); await count(38); await mapCount(37);
  assert.ok((await page.locator('.map-footer').innerText()).includes('1 unplaced'));
  await page.locator('.unplaced-events summary').click();
  await page.locator('.unplaced-events').getByRole('button', { name: 'Unplaced gathering', exact: true }).click();
  await page.getByRole('heading', { name: 'Event details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  // Strict radius still excludes estimates from both list and map.
  await page.getByLabel('City', { exact: true }).selectOption('Milano');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Distance"]').disabled);
  await page.getByLabel('Distance', { exact: true }).selectOption('25'); await count(37); await mapCount(37);
  await page.getByLabel('Only events with venue coordinates').check(); await count(2); await mapCount(2);
  await page.getByLabel('Only events with venue coordinates').uncheck(); await count(37); await mapCount(37);
  await page.setViewportSize({ width: 390, height: 1000 });
  await mapCount(37);
  await page.locator('.commons-cluster.approximate-location').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.expanded-event').length === 20);
  const expanded = await page.locator('.expanded-event').evaluateAll(markers => markers.map(marker => { const box = marker.getBoundingClientRect(); return [box.x, box.y]; }));
  assert.equal(new Set(expanded.map(point => point.join(','))).size, 20, 'Shared locations fan out into distinct mobile markers');
  const mapBox = await page.locator('.map-wrapper').boundingBox();
  const panelBox = await page.locator('.cluster-events').boundingBox();
  assert.ok(panelBox.y >= mapBox.y && panelBox.y + panelBox.height <= mapBox.y + mapBox.height, 'Event chooser stays inside the map');
  assert.ok(expanded.every(([, y]) => y + 44 <= panelBox.y), 'All expanded marker targets stay above the event chooser');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/map-coverage-mobile.png', fullPage: true });
  await page.getByLabel('Country', { exact: true }).selectOption('JP'); await count(0); await mapCount(0);
  await page.waitForFunction(() => { const map = document.querySelector('.map-wrapper').dataset; return Number(map.latitude) > 25 && Number(map.latitude) < 45 && Number(map.longitude) > 125 && Number(map.longitude) < 150 && Number(map.zoom) >= 3; });
  await page.getByLabel('Country', { exact: true }).selectOption('');
  await page.getByLabel('Search city', { exact: true }).fill('Berlin');
  await page.locator('.city-suggestions button').filter({ hasText: 'Germany' }).first().click(); await count(0); await mapCount(0);
  await page.waitForFunction(() => { const map = document.querySelector('.map-wrapper').dataset; return Math.abs(Number(map.latitude) - 52.52) < .05 && Math.abs(Number(map.longitude) - 13.4) < .05 && Number(map.zoom) === 12; });
  assert.deepEqual(errors, []);
  console.log('PASS: Milano/today map-list parity beyond list pagination; estimates, precise duplicates, cluster pages, unplaced events, filter refitting, refresh/pan preservation, strict radius and mobile layout.');
} finally { await browser.close(); }
