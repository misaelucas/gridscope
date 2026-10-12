import type { ReactNode } from 'react';
import { copenhagenTimestamp } from '../time';
import type { IngestionRun, RegionReport } from '../types';
import { isStaticMode } from '../staticData';

const reading = (value: number | null) => value === null ? 'No data' : value.toFixed(1);
export function DatePicker({ day, onChange, onSubmit }: {
  day: string; onChange: (day: string) => void; onSubmit: () => void;
}) {
  return <form onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <label>Danish local day <input type="date" value={day} required onChange={event => onChange(event.target.value)} /></label>
    <button type="submit">Load report</button>
  </form>;
}
export function SummaryCards({ regions }: { regions: RegionReport[] }) {
  return <div id="cards">{regions.map(region => <section className="region" key={region.area} aria-label={region.area}>
    <h2>{region.area}</h2>
    <div className="value">{reading(region.average_g_per_kwh)} g CO₂/kWh</div>
    <p>Peak: {reading(region.peak_g_per_kwh)} · Minimum: {reading(region.minimum_g_per_kwh)}</p>
    <p className={region.missing_intervals ? 'warning' : ''}>
      {region.completeness_percent}% complete · {region.missing_intervals}/{region.expected_intervals} intervals missing
    </p>
    <small>Latest observation: {region.latest_observation ? copenhagenTimestamp(region.latest_observation) : 'never'}</small><br />
    {!isStaticMode() && <small>Last ingested: {region.last_ingested_at ? copenhagenTimestamp(region.last_ingested_at) : 'never'}</small>}
  </section>)}</div>;
}
export function ReportSection({ number, title, detail, wide, children }: {
  number: string; title: string; detail: string; wide?: boolean; children: ReactNode;
}) {
  return <section className={`report-section${wide ? ' comparison-section' : ''}`} aria-label={title}>
    <div className="section-heading"><p className="section-number">[{number}]</p><h2>{title}</h2><p className="detail">{detail}</p></div>
    {children}
  </section>;
}
export function IngestionHistory({ runs }: { runs: IngestionRun[] }) {
  return <div className="section-content table-scroll">
    {runs.length ? <table><thead><tr><th>Day</th><th>Status</th><th>Records</th><th>Finished (Copenhagen)</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id}><td>{run.report_day}</td><td>{run.status}</td><td>{run.received ?? '—'}</td>
        <td>{run.finished_at ? copenhagenTimestamp(run.finished_at) : '—'}</td></tr>)}</tbody></table>
      : <p className="detail">No ingestion runs yet.</p>}
  </div>;
}
export function Methodology() {
  return <footer><p className="detail">Source: <a href="https://www.energidataservice.dk/tso-electricity/co2emis">Energinet CO2Emis</a>.
    {' '}Preliminary estimates; upstream errors may remain uncorrected. Daily averages use available readings and are not consumption-weighted emissions totals.</p>
    <p className="detail">Stored historical observations · g CO₂/kWh · {isStaticMode()
      ? 'Versioned historical export. Missing values remain gaps. Exported API responses were checked for report/series agreement, not a shared database snapshot.'
      : 'Reports, series and run history are read independently, without a shared database snapshot.'}</p>
  </footer>;
}
