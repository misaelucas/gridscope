// Optional real-browser check. Requires an available Playwright installation/browser.
// All API responses are synthetic; this never imports Energinet observations.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRID_BROWSER_EXECUTABLE || undefined });
  try {
    const artifacts = path.resolve(__dirname, '../browser-artifacts');
    await mkdir(artifacts, { recursive: true });
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const day = url.searchParams.get('day');
        const area = url.searchParams.get('area');
        const start = Date.parse('2026-10-24T22:00:00Z');
        let body;
        if (url.pathname === '/api/reports') body = { day, timezone: 'Europe/Copenhagen', unit: 'g CO2/kWh', source: 'Energinet / CO2Emis',
          regions: ['DK1', 'DK2'].map(area => ({ area, average_g_per_kwh: 40, peak_g_per_kwh: 120, minimum_g_per_kwh: 0,
            observed_intervals: 298, expected_intervals: 300, missing_intervals: 2, completeness_percent: 99.33,
            latest_observation: '2026-10-25T22:55:00Z', last_ingested_at: '2026-10-26T06:00:00Z' })) };
        else if (url.pathname === '/api/series') {
          const observations = Array.from({ length: 300 }, (_, i) => ({ timestamp: new Date(start + i * 300000).toISOString(),
            intensity: i === 31 || (i === 30 && area === 'DK2') ? null : i === 30 ? 0 : i === 42 ? (area === 'DK1' ? 12.345 : 67.89) :
              40 + (area === 'DK1' ? 25 : 10) * Math.sin(i / 24) }));
          body = { day, area, observations: area === 'DK2' ? observations.reverse() : observations };
        } else body = [{ id: 'synthetic', report_day: '2026-10-25', received: 598, status: 'success', finished_at: '2026-10-26T06:00:00Z' }];
        await route.fulfill({ json: body });
      });
      await page.goto(process.env.GRID_BROWSER_URL || 'http://127.0.0.1:8000');
      await page.getByLabel('Danish local day').fill('2026-10-25');
      await page.getByRole('button', { name: 'Load report' }).click();
      await page.locator('.recharts-line-curve').first().waitFor();
      const svg = page.locator('.carbon-chart svg.recharts-surface');
      await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      const grid = page.locator('.recharts-cartesian-grid-horizontal line').first();
      const left = Number(await grid.getAttribute('x1'));
      const right = Number(await grid.getAttribute('x2'));
      const point = index => ({ x: box.x + left + (right - left) * index / 299, y: box.y + 80 });
      const inspect = async index => {
        const position = point(index);
        if (mobile) await page.touchscreen.tap(position.x, position.y);
        else await page.mouse.move(position.x, position.y);
      };
      await inspect(30);
      try {
        await page.getByRole('tooltip').filter({ hasText: '2026-10-25 02:30:00 UTC+02:00' }).waitFor();
      } catch (error) {
        console.error({ mobile, box, left, right, position: point(30), tooltip: await page.locator('.chart-tooltip').allTextContents() });
        await page.screenshot({ path: path.join(artifacts, 'interaction-failure.png'), fullPage: true });
        throw error;
      }
      assert.match(await page.getByRole('tooltip').innerText(), /0 g CO₂\/kWh/);
      assert.match(await page.getByRole('tooltip').innerText(), /No data g CO₂\/kWh/);
      await inspect(42);
      await page.getByRole('tooltip').filter({ hasText: '2026-10-25 02:30:00 UTC+01:00' }).waitFor();
      const tooltip = await page.getByRole('tooltip').innerText();
      assert.match(tooltip, /12\.345 g CO₂\/kWh/);
      assert.match(tooltip, /67\.89 g CO₂\/kWh/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      const chart = await page.locator('.carbon-chart').boundingBox();
      const section = await page.getByRole('region', { name: 'Daily comparison' }).boundingBox();
      assert.ok(Math.abs(chart.width - section.width) < 2, 'comparison chart spans the full section');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Hanken Grotesk')), true);
      for (const weight of [400, 500, 900]) assert.equal((await page.request.get(new URL(`/static/fonts/hanken-grotesk-${weight}.ttf`, page.url()).href)).status(), 200);
      assert.deepEqual(errors, []);
      await page.evaluate(() => { window.scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: path.join(artifacts, mobile ? 'mobile.png' : 'desktop.png'), fullPage: true });
      console.log(`${mobile ? 'Mobile tap' : 'Desktop hover'}: repeated DST times, both readings, zero/null, full width, fonts and no overflow verified.`);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
