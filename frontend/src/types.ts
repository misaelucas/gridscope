export type Area = 'DK1' | 'DK2';
export interface RegionReport {
  area: Area;
  observed_intervals: number;
  expected_intervals: number;
  missing_intervals: number;
  completeness_percent: number;
  average_g_per_kwh: number | null;
  peak_g_per_kwh: number | null;
  minimum_g_per_kwh: number | null;
  latest_observation: string | null;
  last_ingested_at: string | null;
}
export interface DailyReport {
  day: string;
  timezone: 'Europe/Copenhagen';
  source: string;
  unit: string;
  regions: RegionReport[];
}
export interface DailySeries {
  day: string;
  area: Area;
  observations: { timestamp: string; intensity: number | null }[];
}
export interface IngestionRun {
  id: string;
  report_day: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  received: number | null;
  error: string | null;
  archive_path: string;
}
export interface ChartPoint {
  instant: number;
  DK1: number | null;
  DK2: number | null;
}
export interface ReportData {
  report: DailyReport;
  points: ChartPoint[];
  runs: IngestionRun[];
  manifest?: DemoManifest;
}
export interface DemoManifest {
  schema_version: 1;
  revision: string;
  dates: string[];
  source: string;
  source_url: string;
  unit: string;
  timezone: 'Europe/Copenhagen';
  exported_at: string;
  limitations: string[];
}
