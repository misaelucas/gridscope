import type { ChartPoint, DailyReport, DailySeries, IngestionRun, ReportData } from './types';

export function mergeSeries(dk1: DailySeries, dk2: DailySeries): ChartPoint[] {
  const points = new Map<number, ChartPoint>();
  for (const series of [dk1, dk2]) {
    for (const observation of series.observations) {
      const instant = Date.parse(observation.timestamp);
      if (!Number.isFinite(instant)) throw new Error('Invalid observation timestamp');
      const point = points.get(instant) ?? { instant, DK1: null, DK2: null };
      point[series.area] = observation.intensity;
      points.set(instant, point);
    }
  }
  return [...points.values()].sort((a, b) => a.instant - b.instant);
}

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status}). Check the database and API logs.`);
  return response.json() as Promise<T>;
}
export async function loadReport(day: string, signal: AbortSignal): Promise<ReportData> {
  const query = encodeURIComponent(day);
  const [report, dk1, dk2, runs] = await Promise.all([
    get<DailyReport>(`/api/reports?day=${query}`, signal),
    get<DailySeries>(`/api/series?day=${query}&area=DK1`, signal),
    get<DailySeries>(`/api/series?day=${query}&area=DK2`, signal),
    get<IngestionRun[]>('/api/runs', signal),
  ]);
  if ([report.day, dk1.day, dk2.day].some(value => value !== day) || dk1.area !== 'DK1' || dk2.area !== 'DK2') {
    throw new Error('API returned a different reporting day or region. Please retry.');
  }
  // These endpoints read independently; this request group is not a database snapshot.
  return { report, points: mergeSeries(dk1, dk2), runs };
}
