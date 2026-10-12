import { cp, mkdir, rm } from 'node:fs/promises';

// Keep hashed assets in the Python package; generated files are never committed.
const target = new URL('../../src/grid_report/static/spa/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('../dist/', import.meta.url), target, { recursive: true });
