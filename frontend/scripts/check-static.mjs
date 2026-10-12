// Verify a real static build, independently of FastAPI and its package directory.
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/', import.meta.url);
const read = path => readFile(new URL(path, root));
const html = (await read('index.html')).toString();
assert.ok(!html.includes('/static/spa/'));
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)) await access(new URL(`.${match[1]}`, root));
assert.match(html, /og:image/);
await access(new URL('social-preview.png', root));
await access(new URL('_headers', root));
assert.match((await read('_headers')).toString(), /frame-ancestors 'self' https:\/\/misaa.dev/);
for (const weight of [400, 500, 900]) assert.ok((await read(`static/fonts/hanken-grotesk-${weight}.ttf`)).length > 1000);
const manifest = JSON.parse(await read('demo/v1/manifest.json'));
const hash = createHash('sha256');
for (const day of manifest.dates) {
  const bytes = await read(`demo/v1/${manifest.revision}/${day}.json`);
  hash.update(bytes);
  const data = JSON.parse(bytes);
  assert.equal(data.report.day, day);
  assert.deepEqual(data.series.map(s => s.area), ['DK1', 'DK2']);
  assert.ok(!/archive_path|run_id|"error"|postgresql:\/\//.test(bytes.toString()));
  assert.ok(data.report.regions.every(region => region.last_ingested_at === null));
  for (const series of data.series) {
    assert.ok([276, 288, 300].includes(series.observations.length));
    assert.ok(series.observations.every((o, i) => !i || Date.parse(o.timestamp) - Date.parse(series.observations[i-1].timestamp) === 300000));
  }
}
assert.equal(hash.digest('hex').slice(0, 16), manifest.revision);
const chunks = (await readdir(new URL('assets/', root))).filter(file => file.endsWith('.js'));
assert.ok(chunks.length >= 2, 'main and interactive chart chunks are packaged');
console.log(`Static artifact checks passed: ${manifest.dates.length} historical date(s), ${chunks.length} JS chunks, CSS, fonts, social preview, headers and content revision.`);
