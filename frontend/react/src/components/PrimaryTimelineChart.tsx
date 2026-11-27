import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartTimeSeriesPoint } from '../types';

const metrics = [
  { key: 'gas_ppm', label: 'CO (ppm)', color: 'var(--primary-strong)' },
  { key: 'dust_ugm3', label: 'Dust (µg/m³)', color: 'var(--warning)' },
  { key: 'active_alerts', label: 'Unresolved incidents', color: 'var(--danger)' },
  { key: 'all', label: 'All' },
] as const;

type MetricKey = typeof metrics[number]['key'];
type Sample = { timestamp: number; value: number };

function groupSamples(points: ChartTimeSeriesPoint[], key: Exclude<MetricKey, 'all'>, bucketMs?: number) {
  const segments: Sample[][] = [];
  let segment: Sample[] = [];
  for (const point of points) {
    const value = point[key];
    const last = segment[segment.length - 1];
    if ((value === null || !Number.isFinite(value) || (last && bucketMs && point.timestamp - last.timestamp > bucketMs)) && segment.length) {
      segments.push(segment);
      segment = [];
    }
    if (value !== null && Number.isFinite(value)) segment.push({ timestamp: point.timestamp, value });
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export function PrimaryTimelineChart({ points, initialMetric = 'all', timeZone, window: historyWindow }: {
  points: ChartTimeSeriesPoint[];
  initialMetric?: MetricKey;
  timeZone?: string;
  window?: { start_at: number; end_at: number; bucket_ms: number };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<MetricKey>(initialMetric);
  const [showTable, setShowTable] = useState(false);
  const ordered = useMemo(() => points.filter(point => Number.isFinite(point.timestamp) && point.timestamp > 0 && point.timestamp <= 8.64e15)
    .sort((a, b) => a.timestamp - b.timestamp), [points]);
  const hasPoints = ordered.length > 0;
  useEffect(() => {
    if (!hasPoints || !containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasPoints]);

  const time = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }), [timeZone]);
  const fullTime = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }), [timeZone]);
  if (!hasPoints) return <p className="dashboard-empty">No historical readings in this range.</p>;

  const left = Math.min(65, width * 0.22);
  const right = width - 40;
  const first = historyWindow?.start_at ?? ordered[0].timestamp;
  const last = historyWindow?.end_at ?? ordered[ordered.length - 1].timestamp;
  const x = (timestamp: number) => last === first ? (left + right) / 2 : left + (timestamp - first) / (last - first) * (right - left);
  const chartMetrics = metrics.filter(metric => metric.key !== 'all');
  const shownMetrics = chartMetrics.filter(metric => active === 'all' || metric.key === active);

  return <div className="dashboard-timeline timeline-charts" ref={containerRef}>
    <div className="dashboard-chart-options flex flex-wrap" role="group" aria-label="Historical series">
      {metrics.map(metric => <button type="button" className="dashboard-control" key={metric.key}
        aria-pressed={active === metric.key} onClick={() => setActive(metric.key)}>{metric.label}</button>)}
    </div>
    {shownMetrics.map(metric => {
      const segments = groupSamples(ordered, metric.key, historyWindow?.bucket_ms);
      const values = segments.flat();
      if (!values.length) return <figure className="timeline-chart" key={metric.key}><figcaption>{metric.label}</figcaption><p className="dashboard-empty">No measurements available.</p></figure>;
      const min = Math.min(0, ...values.map(sample => sample.value));
      const max = Math.max(1, ...values.map(sample => sample.value));
      const y = (value: number) => 124 - (value - min) / (max - min) * 106;
      const midpoint = (min + max) / 2;
      const ticks = [...new Set([min, metric.key === 'active_alerts' ? Math.round(midpoint) : midpoint, max])];
      return <figure className="timeline-chart" key={metric.key}>
        <figcaption>{metric.label}</figcaption>
        <svg viewBox={`0 0 ${width} 154`} role="img" aria-label={`${metric.label}. ${values.length} available buckets. Values are available in the chart table.`}>
          {ticks.map(value => <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--border)" />
            <text x={left - 7} y={y(value) + 4} textAnchor="end" fontSize="11" fill="var(--dashboard-muted, var(--muted))">{Number(value.toPrecision(4))}</text>
          </g>)}
          {segments.filter(segment => segment.length > 1).map(segment => <polyline
            key={segment[0].timestamp} fill="none" stroke={metric.color} strokeWidth="2"
            points={segment.map(point => `${x(point.timestamp)},${y(point.value)}`).join(' ')} />)}
          {values.map((point, index) => <circle key={`${point.timestamp}:${index}`} cx={x(point.timestamp)} cy={y(point.value)} r="3" fill={metric.color}>
            <title>{fullTime.format(point.timestamp)} · {point.value} · {metric.label}</title>
          </circle>)}
          <text x={left} y="145" fontSize="11" fill="var(--dashboard-muted, var(--muted))">{time.format(first)}</text>
          {last !== first && <text x={right} y="145" textAnchor="end" fontSize="11" fill="var(--dashboard-muted, var(--muted))">{time.format(last)}</text>}
        </svg>
      </figure>;
    })}
    <details onToggle={event => setShowTable(event.currentTarget.open)}>
      <summary className="dashboard-control" tabIndex={0}>View chart data</summary>
      {showTable && <div className="dashboard-table-wrap table-scroll"><table>
        <caption>Hourly values in native units</caption><thead><tr><th scope="col">Bucket end</th>{shownMetrics.map(metric => <th scope="col" key={metric.key}>{metric.label}</th>)}</tr></thead>
        <tbody>{ordered.map((point, index) => <tr key={`${point.timestamp}:${index}`}><th scope="row">{fullTime.format(point.timestamp)}</th>
          {shownMetrics.map(metric => <td key={metric.key}>{Number.isFinite(point[metric.key]) ? point[metric.key] : 'Unavailable'}</td>)}
        </tr>)}</tbody>
      </table></div>}
    </details>
  </div>;
}
