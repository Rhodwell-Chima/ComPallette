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
    <section className="kpi-grid">
      {/* 1. Personnel Deployment */}
      <div className="scada-kpi-card border-accent-safe">
        <div className="kpi-header">
          <span className="kpi-label">PERSONNEL UNDERGROUND</span>
          <span className="kpi-tag-safe">ACTIVE</span>
        </div>
        <div className="kpi-value-row">
          <span className="kpi-number font-mono">{onlineMiners}</span>
          <span className="kpi-fraction font-mono">/ {totalNodes} TAGS</span>
        </div>
        <div className="kpi-footer-metric">
          <div className="mini-meter-track">
            <div
              className="mini-meter-fill fill-safe"
              style={{ width: `${totalNodes > 0 ? (onlineMiners / totalNodes) * 100 : 0}%` }}
            />
          </div>
          <span className="kpi-subtext">Active Mesh Wearable Nodes</span>
        </div>
      </div>

      {/* 2. Critical Evacuations */}
      <div className={`scada-kpi-card ${critEmergencies > 0 ? 'border-accent-crit card-flash-crit' : 'border-accent-neutral'}`}>
        <div className="kpi-header">
          <span className="kpi-label">CRITICAL EMERGENCIES</span>
          {critEmergencies > 0 ? (
            <span className="kpi-tag-crit">ALARM</span>
          ) : (
            <span className="kpi-tag-dim">CLEAR</span>
          )}
        </div>
        <div className="kpi-value-row">
          <span className={`kpi-number font-mono ${critEmergencies > 0 ? 'text-crit' : ''}`}>
            {critEmergencies}
          </span>
          <span className="kpi-unit">INCIDENTS</span>
        </div>
        <div className="kpi-footer-metric">
          <span className="kpi-subtext">CO &ge; 50 ppm &bull; Man-Down Inactivity</span>
        </div>
      </div>

      {/* 3. Hazardous Gas Atmosphere */}
      <div className={`scada-kpi-card ${gasHazards > 0 ? 'border-accent-warn' : 'border-accent-neutral'}`}>
        <div className="kpi-header">
          <span className="kpi-label">GAS HAZARD EXPOSURE</span>
          {gasHazards > 0 ? (
            <span className="kpi-tag-warn">WARNING</span>
          ) : (
            <span className="kpi-tag-dim">NOMINAL</span>
          )}
        </div>
        <div className="kpi-value-row">
          <span className={`kpi-number font-mono ${gasHazards > 0 ? 'text-warn' : ''}`}>
            {gasHazards}
          </span>
          <span className="kpi-unit">MINERS</span>
        </div>
        <div className="kpi-footer-metric">
          <span className="kpi-subtext">&gt; 25.0 ppm CO OSHA Warning Floor</span>
        </div>
      </div>

      {/* 4. Mesh Link Health */}
      <div className={`scada-kpi-card ${staleNodes > 0 ? 'border-accent-warn' : 'border-accent-safe'}`}>
        <div className="kpi-header">
          <span className="kpi-label">SILENT / STALE NODES</span>
          {staleNodes > 0 ? (
            <span className="kpi-tag-warn">DEGRADED</span>
          ) : (
            <span className="kpi-tag-safe">HEALTHY</span>
          )}
        </div>
        <div className="kpi-value-row">
          <span className={`kpi-number font-mono ${staleNodes > 0 ? 'text-warn' : ''}`}>
            {staleNodes}
          </span>
          <span className="kpi-unit">DROPPED</span>
        </div>
        <div className="kpi-footer-metric">
          <span className="kpi-subtext">Mesh Watchdog Threshold: 20s / 45s</span>
        </div>
      </div>

      {/* 5. Incident Queue */}
      <div className="scada-kpi-card border-accent-info">
        <div className="kpi-header">
          <span className="kpi-label">SAFETY INCIDENT QUEUE</span>
          <span className="kpi-tag-info font-mono">{inProgressAlerts} IN PROGRESS</span>
        </div>
        <div className="kpi-value-row">
          <span className="kpi-number font-mono">{unackAlerts}</span>
          <span className="kpi-unit">UNACKED</span>
        </div>
        <div className="kpi-footer-metric">
          <span className="kpi-subtext">Mandatory Operator Sign-Off</span>
        </div>
      </div>
    </section>
  );
};
