import React from 'react';
import { SystemSummary } from '../types';

interface KpiMetricsProps {
  summary: SystemSummary | null;
}

export const KpiMetrics: React.FC<KpiMetricsProps> = ({ summary }) => {
  const onlineMiners = summary?.online_miners ?? 0;
  const totalNodes = summary?.total_nodes_tracked ?? 0;
  const critEmergencies = summary?.critical_emergencies ?? 0;
  const gasHazards = (summary?.miners_in_gas_warning ?? 0) + (summary?.miners_in_gas_critical ?? 0);
  const staleNodes = (summary?.stale_nodes ?? 0) + (summary?.offline_nodes ?? 0);
  const unackAlerts = summary?.active_unacknowledged_alerts ?? 0;
  const inProgressAlerts = summary?.acknowledged_in_progress ?? 0;

  return (
    <section style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '16px',
    }}>
      <div className="kpi-card" style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '4px solid var(--color-safe)',
        borderRadius: '6px',
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Active Miners Underground
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span>{onlineMiners}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>/ {totalNodes} Total Nodes</span>
        </div>
      </div>

      <div className="kpi-card" style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '4px solid var(--color-crit)',
        borderRadius: '6px',
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Critical Emergencies
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: critEmergencies > 0 ? '#ef4444' : '#fff' }}>
          {critEmergencies}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          Man-Down &bull; Critical Gas Ceiling
        </div>
      </div>

      <div className="kpi-card" style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '4px solid var(--color-warn)',
        borderRadius: '6px',
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Gas Exposure Warnings
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: gasHazards > 0 ? '#fbbf24' : '#fff' }}>
          {gasHazards}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          &gt; 25.0 ppm CO OSHA Limit
        </div>
      </div>

      <div className="kpi-card" style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '4px solid var(--color-warn)',
        borderRadius: '6px',
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Silent / Stale Miners
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: staleNodes > 0 ? '#fcd34d' : '#fff' }}>
          {staleNodes}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          No check-in &gt; 20 seconds
        </div>
      </div>

      <div className="kpi-card" style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderLeft: '4px solid var(--color-info)',
        borderRadius: '6px',
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Unresolved Incidents
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 700, color: '#fff' }}>
          {unackAlerts}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          {inProgressAlerts} In Progress
        </div>
      </div>
    </section>
  );
};
