import type { DailyReport, DailySeries, IngestionRun } from '../types';

export function report(day = '2026-10-10', empty = false): DailyReport {
  return { day, timezone: 'Europe/Copenhagen', source: 'Energinet / CO2Emis', unit: 'g CO2/kWh',
    regions: (['DK1', 'DK2'] as const).map(area => ({ area, observed_intervals: empty ? 0 : 1,
      expected_intervals: 288, missing_intervals: empty ? 288 : 287, completeness_percent: empty ? 0 : 0.35,
      average_g_per_kwh: empty ? null : 0, minimum_g_per_kwh: empty ? null : 0,
      peak_g_per_kwh: empty ? null : 0, latest_observation: empty ? null : `${day}T00:00:00Z`,
      last_ingested_at: empty ? null : `${day}T01:00:00Z`,
    })),
  };
}
export function series(area: 'DK1' | 'DK2', day = '2026-10-10', values: (number | null)[] = [0, null, 20]): DailySeries {
  return { day, area, observations: values.map((intensity, i) => ({
    timestamp: new Date(Date.parse(`${day}T00:00:00Z`) + i * 300_000).toISOString(), intensity,
  })) };
}
export const runs: IngestionRun[] = [{ id: 'run', report_day: '2026-10-10', started_at: '2026-10-11T00:00:00Z',
  finished_at: null, status: 'running', received: 0, error: null, archive_path: '/test' }];
export function response(url: string, empty = false) {
  const parsed = new URL(url, 'http://test');
  const day = parsed.searchParams.get('day')!;
  const body = parsed.pathname === '/api/reports' ? report(day, empty) : parsed.pathname === '/api/series'
    ? series(parsed.searchParams.get('area') as 'DK1' | 'DK2', day, empty ? [null, null, null] : undefined)
    : empty ? [] : runs;
  return { ok: true, json: async () => body } as Response;
}
