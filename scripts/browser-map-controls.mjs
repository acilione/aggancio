import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : process.env.COMMONS_BROWSER ? { executablePath: process.env.COMMONS_BROWSER } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const events = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, title: `Shared venue event ${i + 1}`, start_datetime: Date.parse('2030-11-03T17:00Z') / 1000, tags: ['music'], place: { address: 'Reggio Calabria, Italy', latitude: 38.11, longitude: 15.65 } }));
await context.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).hostname === 'puntello.org' ? events : []), headers: { 'Access-Control-Allow-Origin': '*' } }));
try {
  await page.goto(process.env.COMMONS_URL || 'http://localhost:5173');
  await page.waitForFunction(() => Number(document.querySelector('.result-count')?.textContent) === 3, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.coverage-line button').disabled);
  await page.getByRole('button', { name: 'Map and list view', exact: true }).click();
  await page.locator('.commons-cluster').click();
  await page.waitForFunction(() => document.querySelectorAll('.expanded-event').length === 3);
  assert.equal(await page.locator('.cluster-event').count(), 3, 'One click reveals every shared-venue event');
  assert.equal(await page.locator('.commons-cluster').count(), 0, 'Selected terminal count becomes individual markers');
  const pins = await page.locator('.expanded-event svg').evaluateAll(icons => icons.map(icon => { const box = icon.getBoundingClientRect(); return { width: box.width, height: box.height, transform: getComputedStyle(icon).transform }; }));
  assert.ok(pins.every(pin => pin.width === 28 && pin.height === 36 && pin.transform === 'none'), 'Pins retain their undistorted SVG proportions');
  await page.locator('.expanded-event').first().click();
  await page.getByRole('heading', { name: 'Event details', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Close cluster events' }).click();
  // At maximum zoom, identical coordinates still need a selection mechanism.
  while (Number(await page.locator('.map-wrapper').getAttribute('data-zoom')) < 19) {
    const zoom = Number(await page.locator('.map-wrapper').getAttribute('data-zoom'));
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForFunction(zoom => Number(document.querySelector('.map-wrapper').dataset.zoom) > zoom, zoom);
  }
  await page.waitForFunction(() => document.querySelectorAll('.expanded-event').length === 3);
  await page.getByRole('button', { name: 'Close cluster events' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.cluster-events').count(), 0, 'Closing a group at max zoom does not reopen it');
  await page.locator('.commons-cluster').click();
  await page.waitForFunction(() => document.querySelectorAll('.expanded-event').length === 3);
  await mkdir('test-results', { recursive: true });
  await page.locator('.map-wrapper').screenshot({ path: 'test-results/map-controls.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: one-click shared-venue expansion, selectable SVG pins, maximum-zoom expansion, close/reopen behavior.');
} finally { await browser.close(); }
