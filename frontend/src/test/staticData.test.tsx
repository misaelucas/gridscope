import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { loadReport } from '../api';
import { loadManifest } from '../staticData';
import type { DailySeries } from '../types';

const manifest = { schema_version: 1, revision: '0123456789abcdef', dates: ['2026-10-25'],
  timezone: 'Europe/Copenhagen', source: 'Energinet / CO2Emis', unit: 'g CO2/kWh',
  source_url: 'https://www.energidataservice.dk/tso-electricity/co2emis',
  exported_at: '2026-10-26T07:00:00Z', limitations: ['Historical observations, not a live feed.'] };
const series = (area: 'DK1' | 'DK2'): DailySeries => ({ day: '2026-10-25', area,
  observations: Array.from({ length: 300 }, (_, i) => ({
    timestamp: new Date(Date.parse('2026-10-24T22:00:00Z') + i * 300000).toISOString(),
    intensity: i === 1 ? null : 0,
  })) });
const report = { day: '2026-10-25', timezone: 'Europe/Copenhagen', source: manifest.source, unit: manifest.unit,
  regions: ['DK1', 'DK2'].map(area => ({ area, average_g_per_kwh: 0, peak_g_per_kwh: 0,
    minimum_g_per_kwh: 0, observed_intervals: 299, expected_intervals: 300, missing_intervals: 1,
    completeness_percent: 99.67, latest_observation: '2026-10-25T22:55:00Z', last_ingested_at: null })) };
function setup(missing = '') {
  vi.stubEnv('VITE_DATA_MODE', 'static');
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('manifest.json') ? manifest : { report, series: [series('DK1'), series('DK2')] }),
  { status: url.includes(missing) && missing ? 404 : 200 }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('static mode loads only manifest and versioned JSON; retains DST slots, zero/null and UTC order', async () => {
  const fetcher = setup();
  const data = await loadReport('', new AbortController().signal);
  expect(data.points).toHaveLength(300);
  expect(data.points[0].DK1).toBe(0);
  expect(data.points[1].DK2).toBeNull();
  expect(data.points.every((p, i) => !i || p.instant > data.points[i-1].instant)).toBe(true);
  expect(data.runs).toEqual([]);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    '/demo/v1/manifest.json', '/demo/v1/0123456789abcdef/2026-10-25.json']);
});
it('renders source, historical freshness disclaimer, export time and available dates without operational history', async () => {
  setup(); render(<App />);
  expect(await screen.findByText(/Available observation dates: 2026-10-25/)).toBeVisible();
  expect(screen.getByText('Historical demo · Energinet CO2Emis')).toBeVisible();
  expect(screen.getByText(/Dataset exported: 2026-10-26 08:00:00 UTC\+01:00/)).toBeVisible();
  expect(screen.getByText(/Export time does not indicate source freshness/)).toBeVisible();
  expect(screen.getByText(/not total CO₂ emissions/)).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Energinet CO2Emis' })[0]).toHaveAttribute('href', manifest.source_url);
  expect(screen.queryByText('Ingestion history')).not.toBeInTheDocument();
  expect(screen.queryByText(/Last ingested:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Danish local day')).toHaveValue('2026-10-25');
});
it('unavailable selection clears old data and shows an empty state without requesting absent day JSON', async () => {
  const fetcher = setup(); render(<App />);
  await screen.findByRole('region', { name: 'DK1' });
  fireEvent.change(screen.getByLabelText('Danish local day'), { target: { value: '2026-10-24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  expect(await screen.findByText(/This date is not included/)).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('region', { name: 'DK1' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(call => call[0].includes('2026-10-24'))).toBe(false);
});
it.each(['manifest.json', '2026-10-25.json'])('missing %s shows useful errors and can recover', async missing => {
  setup(missing); render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Historical demo data could not be loaded');
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Retry demo data' }));
  expect(await screen.findByRole('region', { name: 'DK1' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('rejects HTML SPA fallback and malformed manifests without backend fallback', async () => {
  const fetcher = setup();
  fetcher.mockResolvedValueOnce(new Response('<html>Not JSON</html>'));
  await expect(loadManifest(new AbortController().signal)).rejects.toThrow('missing or invalid');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...manifest, revision: '../api/runs' })));
  await expect(loadManifest(new AbortController().signal)).rejects.toThrow('manifest is invalid');
  expect(fetcher.mock.calls.every(call => !call[0].includes('/api/'))).toBe(true);
});
it('keeps API mode on the existing four read-only endpoints', async () => {
  const fetcher = setup(); vi.stubEnv('VITE_DATA_MODE', 'api');
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.startsWith('/api/reports') ? report : url.startsWith('/api/series') ? series(url.includes('DK2') ? 'DK2' : 'DK1') : [])));
  await loadReport('2026-10-25', new AbortController().signal);
  expect(fetcher.mock.calls).toHaveLength(4);
  expect(fetcher.mock.calls.every(call => call[0].startsWith('/api/'))).toBe(true);
});
it('static request identity prevents an older day-file response from replacing a new selection', async () => {
  const fetcher = setup();
  let finishOld!: (response: Response) => void;
  let dayRequests = 0;
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    if (++dayRequests === 1) return new Promise<Response>(resolve => { finishOld = resolve; });
    return new Response(JSON.stringify({ report, series: [series('DK1'), series('DK2')] }));
  });
  render(<App />);
  await waitFor(() => expect(dayRequests).toBe(1));
  fireEvent.change(screen.getByLabelText('Danish local day'), { target: { value: '2026-10-25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  expect(await screen.findByRole('region', { name: 'DK1' })).toHaveTextContent('0.0 g CO₂/kWh');
  await act(async () => finishOld(new Response(JSON.stringify({
    report: { ...report, regions: report.regions.map(region => ({ ...region, average_g_per_kwh: 99 })) },
    series: [series('DK1'), series('DK2')],
  }))));
  expect(screen.getByRole('region', { name: 'DK1' })).toHaveTextContent('0.0 g CO₂/kWh');
});
