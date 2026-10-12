import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { loadReport } from './api';
import { previousDanishDay } from './time';
import { DatePicker, IngestionHistory, Methodology, ReportSection, SummaryCards } from './components/Report';
import type { ReportData } from './types';
import type { DemoManifest } from './types';
import { isStaticMode, UnavailableDate } from './staticData';
import { copenhagenTimestamp } from './time';

const CarbonChart = lazy(() => import('./components/CarbonChart').then(module => ({ default: module.CarbonChart })));

export default function App() {
  const [day, setDay] = useState(() => isStaticMode() ? '' : previousDanishDay());
  const [manifest, setManifest] = useState<DemoManifest | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unavailable'>('idle');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selectedDay = useRef(day);

  const invalidate = useCallback(() => {
    requestId.current++;
    controller.current?.abort();
    setData(null); setError(''); setStatus('idle');
  }, []);
  const load = useCallback(async (date: string) => {
    invalidate();
    const id = requestId.current;
    const current = new AbortController();
    controller.current = current;
    setStatus('loading');
    try {
      const result = await loadReport(date, current.signal);
      if (id !== requestId.current || date !== selectedDay.current) return;
      if (result.manifest) {
        setManifest(result.manifest);
        if (!date) { selectedDay.current = result.report.day; setDay(result.report.day); }
      }
      setData(result); setStatus('ready');
    } catch (failure) {
      if (id !== requestId.current || date !== selectedDay.current) return;
      if (failure instanceof Error && failure.name === 'AbortError') { setStatus('idle'); return; }
      if (failure instanceof UnavailableDate) {
        setManifest(failure.manifest); setError(failure.message); setStatus('unavailable'); return;
      }
      current.abort(); setData(null);
      setError(failure instanceof Error ? failure.message : 'Unable to load report. Please retry.');
      setStatus('error');
    }
  }, [invalidate]);
  useEffect(() => {
    void load(selectedDay.current);
    return () => { requestId.current++; controller.current?.abort(); };
  }, [load]);
  const changeDay = (date: string) => { selectedDay.current = date; setDay(date); invalidate(); };

  return <main className="report-page">
    <header><p className="eyebrow">GridScope / Denmark</p><h1>Electricity &amp; carbon intensity.</h1>
      <p className="description">Five-minute electricity consumption carbon intensity for DK1 and DK2, from Energinet’s public data.</p>
      {isStaticMode() && <aside className="detail demo-notice" aria-label="Historical demo information">
        <p className="eyebrow">Historical demo · Energinet CO2Emis</p>
        <p>Historical observations, not a live feed. Carbon intensity in g CO₂/kWh is not total CO₂ emissions.</p>
        {manifest && <><p>Available observation dates: {manifest.dates.join(', ')}.</p>
          <p>Dataset exported: {copenhagenTimestamp(manifest.exported_at)} (Europe/Copenhagen). Export time does not indicate source freshness.</p></>}
        <p>Source: <a href="https://www.energidataservice.dk/tso-electricity/co2emis">Energinet CO2Emis</a>.</p>
      </aside>}
      <DatePicker day={day} onChange={changeDay} onSubmit={() => void load(day)} />
      {isStaticMode() && !manifest && status !== 'loading' && <button onClick={() => void load('')}>Retry demo data</button>}
      {error && <p id="error" role={status === 'unavailable' ? 'status' : 'alert'}>{error}</p>}
      <div className="min-h-6" aria-live="polite">
        {status === 'loading' && <p role="status" className="detail">Loading report for {day}…</p>}
        {status === 'idle' && <p className="detail">Choose a Danish local day and load its report.</p>}
      </div>
    </header>
    <div aria-busy={status === 'loading'}>
      {data && <><SummaryCards regions={data.report.regions} />
        <ReportSection number="01" title="Daily comparison" wide
          detail="g CO₂/kWh · Danish local time. Missing intervals break the line. Hover, touch or use arrow keys to inspect readings.">
          <Suspense fallback={<p role="status" className="detail">Loading chart…</p>}>
            <CarbonChart points={data.points} />
          </Suspense>
        </ReportSection>
        {!isStaticMode() && <ReportSection number="02" title="Ingestion history" detail="Recent imports across all days, their status and record counts.">
          <IngestionHistory runs={data.runs} />
        </ReportSection>}</>}
    </div>
    <Methodology />
  </main>;
}
