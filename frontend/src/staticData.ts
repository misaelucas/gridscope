import type { DailyReport, DailySeries, DemoManifest } from './types';

export const isStaticMode = () => import.meta.env.VITE_DATA_MODE === 'static';
export class UnavailableDate extends Error {
  constructor(public manifest: DemoManifest) { super('This date is not included in the historical demo. Choose an available observation date.'); }
}
async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal });
  if (!response.ok) throw new Error('Historical demo data could not be loaded. Please retry.');
  try { return await response.json() as T; }
  catch { throw new Error('Historical demo data is missing or invalid. Please retry.'); }
}
export async function loadManifest(signal: AbortSignal): Promise<DemoManifest> {
  const value = await json<DemoManifest>('demo/v1/manifest.json', signal);
  if (value.schema_version !== 1 || !/^[a-f0-9]{16}$/.test(value.revision)
      || !Array.isArray(value.dates) || !value.dates.length
      || value.dates.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day))
      || new Set(value.dates).size !== value.dates.length
      || value.dates.join() !== [...value.dates].sort().join()
      || !Number.isFinite(Date.parse(value.exported_at))
      || value.timezone !== 'Europe/Copenhagen' || value.source !== 'Energinet / CO2Emis'
      || value.unit !== 'g CO2/kWh' || !Array.isArray(value.limitations)) {
    throw new Error('Historical demo manifest is invalid.');
  }
  return value;
}
export async function loadStaticDay(day: string, signal: AbortSignal) {
  const manifest = await loadManifest(signal);
  const selected = day || manifest.dates.at(-1)!;
  if (!manifest.dates.includes(selected)) throw new UnavailableDate(manifest);
  const data = await json<{ report: DailyReport; series: DailySeries[] }>(
    `demo/v1/${manifest.revision}/${selected}.json`, signal);
  if (data.report?.day !== selected || data.series?.length !== 2
      || data.series[0].area !== 'DK1' || data.series[1].area !== 'DK2'
      || data.series.some(series => series.day !== selected)) {
    throw new Error('Historical demo returned an invalid day or region.');
  }
  return { ...data, manifest };
}
