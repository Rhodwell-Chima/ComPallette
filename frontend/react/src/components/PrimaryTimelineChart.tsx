import { useEffect, useRef, useState } from 'react';
import { ChartTimeSeriesPoint } from '../types';
import { formatTimestamp } from '../platform/ui';

const metrics = [
  { key: 'gas_ppm', label: 'Gas (ppm)', color: 'var(--primary)' },
  { key: 'dust_ugm3', label: 'Dust (µg/m³)', color: 'var(--warning)' },
  { key: 'active_alerts', label: 'Active alarms (count)', color: 'var(--danger)' },
] as const;
type MetricKey = typeof metrics[number]['key'];

export function PrimaryTimelineChart({ points }: { points: ChartTimeSeriesPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [points.length]);
  const left = Math.min(65, width * 0.15);
  const right = width - 40;
  const timeLabel = (timestamp: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp);
  const [active, setActive] = useState<MetricKey | 'all'>('all');
  const ordered = [...points].filter(point => Number.isFinite(point.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length) return <p className="muted">No historical readings in this range.</p>;
  const first = ordered[0].timestamp;
  const last = ordered[ordered.length - 1].timestamp;
  const x = (timestamp: number) => last === first ? (left + right) / 2 : left + (timestamp - first) / (last - first) * (right - left);
  return <div className="timeline-charts" ref={containerRef}>
    <div className="segmented" aria-label="Chart metric">
      <button aria-pressed={active === 'all'} className={active === 'all' ? 'active' : ''} onClick={() => setActive('all')}>All</button>
      {metrics.map(metric => <button key={metric.key} aria-pressed={active === metric.key} className={active === metric.key ? 'active' : ''} onClick={() => setActive(metric.key)}>{metric.label}</button>)}
    </div>
    {metrics.filter(metric => active === 'all' || metric.key === active).map(metric => {
      const values = ordered.filter(point => Number.isFinite(point[metric.key]));
      const min = Math.min(0, ...values.map(point => point[metric.key]));
      const max = Math.max(1, ...values.map(point => point[metric.key]));
      const y = (value: number) => 130 - (value - min) / (max - min) * 110;
      const ticks = metric.key === 'active_alerts' ? Array.from(new Set([min, Math.round((max + min) / 2), max])) : [min, (max + min) / 2, max];
      return <figure className="timeline-chart" key={metric.key}>
        <figcaption>{metric.label}</figcaption>
        <svg viewBox={`0 0 ${width} 165`} role="img" aria-label={`${metric.label}; ${values.length} readings. Exact values in the data table below.`}>
          {ticks.map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--border)" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{Number(value.toFixed(2))}</text></g>)}
          <polyline fill="none" stroke={metric.color} strokeWidth="2" points={values.map(point => `${x(point.timestamp)},${y(point[metric.key])}`).join(' ')} />
          {values.map((point, index) => <circle key={`${point.timestamp}:${index}`} cx={x(point.timestamp)} cy={y(point[metric.key])} r="3" fill={metric.color}><title>{formatTimestamp(point.timestamp)}: {point[metric.key]} {metric.label}</title></circle>)}
          <text x={left} y="155" fontSize="11" fill="var(--muted)">{timeLabel(first)}</text>
          {last !== first && <text x={right} y="155" textAnchor="end" fontSize="11" fill="var(--muted)">{timeLabel(last)}</text>}
        </svg>
      </figure>;
    })}
    <details><summary>View chart data</summary><div className="table-scroll"><table>
      <caption>Original readings in native units</caption><thead><tr><th scope="col">Timestamp</th>{metrics.map(metric => <th scope="col" key={metric.key}>{metric.label}</th>)}</tr></thead>
      <tbody>{ordered.map((point, index) => <tr key={`${point.timestamp}:${index}`}><th scope="row">{formatTimestamp(point.timestamp)}</th>{metrics.map(metric => <td key={metric.key}>{Number.isFinite(point[metric.key]) ? point[metric.key] : 'Unavailable'}</td>)}</tr>)}</tbody>
    </table></div></details>
  </div>;
}
