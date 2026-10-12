import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { clockLabel, copenhagenTimestamp } from '../time';
import type { ChartPoint } from '../types';

export function CarbonTooltip({ active, point }: { active?: boolean; point?: ChartPoint }) {
  if (!active || !point) return null;
  return <div className="chart-tooltip" role="tooltip">
    <p>{copenhagenTimestamp(point.instant)}</p>
    <small>Europe/Copenhagen</small>
    <dl>{(['DK1', 'DK2'] as const).map(area => <div key={area}>
      <dt>{area}</dt><dd>{point[area] === null ? 'No data' : point[area]} g CO₂/kWh</dd>
    </div>)}</dl>
  </div>;
}

export function CarbonChart({ points }: { points: ChartPoint[] }) {
  const hasData = points.some(point => point.DK1 !== null || point.DK2 !== null);
  return <div className="section-content">
    <div className="legend"><span>DK1</span><span className="dk2">DK2</span></div>
    {hasData ? <div className="carbon-chart" aria-label="Five-minute carbon intensity by region">
      <ResponsiveContainer width="100%" height={340} initialDimension={{ width: 800, height: 340 }}>
        <LineChart data={points} accessibilityLayer margin={{ top: 12, right: 20, bottom: 12, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--divider)" />
          <XAxis dataKey="instant" type="number" scale="time" domain={['dataMin', 'dataMax']}
            tickFormatter={clockLabel} minTickGap={65} stroke="var(--text-400)" tickLine={false} axisLine={false} />
          <YAxis domain={[0, 'auto']} stroke="var(--text-400)" tickLine={false} axisLine={false} width={48} />
          <Tooltip filterNull={false} isAnimationActive={false} cursor={{ stroke: 'var(--divider)' }}
            content={({ active, label }) => <CarbonTooltip active={active}
              point={points.find(point => point.instant === Number(label))} />} />
          <Line type="linear" name="DK1" dataKey="DK1" stroke="var(--series-dk1)" strokeWidth={2}
            dot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" name="DK2" dataKey="DK2" stroke="var(--series-dk2)" strokeWidth={2}
            dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="detail" role="status">No observations for this day.</p>}
  </div>;
}
