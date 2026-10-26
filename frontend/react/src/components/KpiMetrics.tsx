import React from 'react';
import { SystemSummary } from '../types';

interface KpiMetricsProps {
  summary: SystemSummary | null;
}

interface KpiCardData {
  label: string;
  value: number;
  detail: string;
  accent: 'safe' | 'warn' | 'crit' | 'neutral';
}

export const KpiMetrics: React.FC<KpiMetricsProps> = ({ summary }) => {
  const s = summary;

  const cards: KpiCardData[] = [
    {
      label: 'Active miners',
      value: s?.online_miners ?? 0,
      detail: `${s?.total_nodes_tracked ?? 0} total nodes`,
      accent: 'safe',
    },
    {
      label: 'Critical alerts',
      value: s?.critical_emergencies ?? 0,
      detail: 'CO ≥ 50 ppm or man-down',
      accent: (s?.critical_emergencies ?? 0) > 0 ? 'crit' : 'neutral',
    },
    {
      label: 'Gas warnings',
      value: (s?.miners_in_gas_warning ?? 0) + (s?.miners_in_gas_critical ?? 0),
      detail: 'CO above 25 ppm',
      accent: ((s?.miners_in_gas_warning ?? 0) + (s?.miners_in_gas_critical ?? 0)) > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Stale nodes',
      value: (s?.stale_nodes ?? 0) + (s?.offline_nodes ?? 0),
      detail: 'No heartbeat > 20s',
      accent: ((s?.stale_nodes ?? 0) + (s?.offline_nodes ?? 0)) > 0 ? 'warn' : 'neutral',
    },
    {
      label: 'Open incidents',
      value: s?.active_unacknowledged_alerts ?? 0,
      detail: `${s?.acknowledged_in_progress ?? 0} in progress`,
      accent: 'neutral',
    },
  ];

  return (
    <section className="kpi-strip">
      {cards.map(c => (
        <div key={c.label} className={`kpi-card accent-${c.accent}`}>
          <span className="kpi-label">{c.label}</span>
          <span className={`kpi-value mono ${c.accent !== 'neutral' && c.value > 0 ? `text-${c.accent}` : ''}`}>
            {c.value}
          </span>
          <span className="kpi-detail">{c.detail}</span>
        </div>
      ))}
    </section>
  );
};
