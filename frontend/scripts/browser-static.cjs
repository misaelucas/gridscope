// Optional Playwright integration against dist only. No backend or network fixtures.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const root = path.resolve(__dirname, '../dist');
  const manifest = JSON.parse(await readFile(path.join(root, 'demo/v1/manifest.json')));
  const day = manifest.dates.at(-1);
  const data = JSON.parse(await readFile(path.join(root, `demo/v1/${manifest.revision}/${day}.json`)));
  const headers = (await readFile(path.join(root, '_headers'), 'utf8')).split('\n');
  const csp = headers.find(line => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://local').pathname;
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep) && filename !== root) { response.writeHead(403).end(); return; }
    let file = filename;
    let bytes;
    try { bytes = await readFile(file); }
    catch { file = path.join(root, 'index.html'); bytes = await readFile(file); }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' }[path.extname(file)];
    response.writeHead(200, { 'Content-Type': mime || 'application/octet-stream', 'Content-Security-Policy': csp });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRID_BROWSER_EXECUTABLE || undefined });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const requests = [], errors = [];
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/portfolio/gridscope`);
      await page.getByRole('region', { name: 'DK1' }).waitFor();
      await page.reload(); await page.getByRole('region', { name: 'DK1' }).waitFor();
      await page.locator('.recharts-line-curve').first().waitFor();
      assert.ok((await page.getByLabel('Historical demo information').innerText()).includes(day));
      assert.equal(await page.getByText('Ingestion history', { exact: true }).count(), 0);
      const svg = page.locator('.carbon-chart svg.recharts-surface'); await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      const grid = page.locator('.recharts-cartesian-grid-horizontal line').first();
      const left = Number(await grid.getAttribute('x1')), right = Number(await grid.getAttribute('x2'));
      const index = 30;
      const x = box.x + left + (right-left)*index/(data.series[0].observations.length-1), y = box.y+80;
      if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.move(x, y);
      await page.getByRole('tooltip').waitFor();
      const tooltip = await page.getByRole('tooltip').innerText();
      for (const series of data.series) assert.ok(tooltip.includes(`${series.observations[index].intensity ?? 'No data'} g CO₂/kWh`));
      assert.match(tooltip, /UTC[+-]\d{2}:\d{2}/);
      assert.ok(!requests.some(url => url.startsWith('/api/')), 'no backend requests');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      for (const weight of [400, 500, 900]) {
        const font = await page.request.get(new URL(`/static/fonts/hanken-grotesk-${weight}.ttf`, page.url()).href);
        assert.match(font.headers()['content-type'], /font/); assert.ok((await font.body()).length > 1000);
      }
      await mkdir(path.resolve(__dirname, '../browser-artifacts'), { recursive: true });
      if (!mobile) {
        await page.mouse.move(0, 0);
        await page.getByRole('region', { name: 'Daily comparison' }).screenshot({ path: path.resolve(__dirname, '../browser-artifacts/static-chart.png') });
      }
      await page.evaluate(() => { scrollTo(0, 0); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.screenshot({ path: path.resolve(__dirname, `../browser-artifacts/static-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
      await page.getByLabel('Danish local day').fill('2000-01-01');
      await page.getByRole('button', { name: 'Load report' }).click();
      await page.getByText(/This date is not included/).waitFor();
      assert.ok(!requests.some(url => url.includes('2000-01-01')));
      await page.getByLabel('Danish local day').fill(day);
      await page.route('**/demo/v1/*/*.json', route => route.fulfill({ status: 404, body: 'Missing' }));
      await page.getByRole('button', { name: 'Load report' }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('region', { name: 'DK1' }).count(), 0);
      await page.unroute('**/demo/v1/*/*.json');
      await page.getByRole('button', { name: 'Load report' }).click();
      await page.getByRole('region', { name: 'DK1' }).waitFor();
      // A deliberate mocked 404 is the only expected browser console error.
      assert.deepEqual(errors.filter(error => !error.includes('404')), []);
      console.log(`Static ${mobile ? 'touch' : 'hover'} passed: genuine historical JSON, refresh/deep link, CSP, assets/fonts, tooltip, unavailable date, missing file/recovery, no API requests.`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
