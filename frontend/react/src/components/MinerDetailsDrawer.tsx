import React from 'react';
import { NodeItem, AlertItem, TelemetryItem } from '../types';

interface MinerDetailsDrawerProps {
  isOpen: boolean;
  minerId: string | null;
  nodes: NodeItem[];
  alerts: AlertItem[];
  history: TelemetryItem[];
  onClose: () => void;
  onLocateOnMap: (minerId: string) => void;
  onOpenAck: (alertId: number) => void;
}

const NAMES: Record<string, { name: string; role: string; shift: string; team: string; blood: string; contact: string; certs: string[] }> = {
  'MINER-101': { name: 'Moses Banda', role: 'Drill Operator', shift: 'A · 06:00–14:00', team: 'Drift 2 Alpha', blood: 'O+', contact: '+260 97 712 3456', certs: ['Blasting #4412', 'Mine Rescue L2', 'First Aid'] },
  'MINER-106': { name: 'Chileshe Phiri', role: 'Geologist / Surveyor', shift: 'A · 06:00–14:00', team: 'Deep Stope Crew', blood: 'A+', contact: '+260 96 688 1234', certs: ['Gas Specialist', 'Fall Arrest', 'Confined Space'] },
  'MINER-112': { name: 'Peter Mwape', role: 'Ventilation Tech', shift: 'A · 06:00–14:00', team: 'L2 Infrastructure', blood: 'B+', contact: '+260 95 544 9876', certs: ['Pumping Tech', 'Hazmat Response'] },
  'MINER-DANGER': { name: 'Kabwe Lungu', role: 'Loader Operator', shift: 'B · 14:00–22:00', team: 'Stope Unit #4', blood: 'O-', contact: '+260 97 123 7890', certs: ['Heavy Machinery', 'Evac Lead'] },
};

function depthFromZone(zone?: string): string {
  if (!zone) return '0m';
  if (zone.includes('LEVEL-3')) return '-450m';
  if (zone.includes('LEVEL-2')) return '-250m';
  if (zone.includes('LEVEL-1')) return '-100m';
  return '0m';
}

export const MinerDetailsDrawer: React.FC<MinerDetailsDrawerProps> = ({ isOpen, minerId, nodes, alerts, history, onClose, onLocateOnMap, onOpenAck }) => {
  if (!isOpen || !minerId) return null;

  const node = nodes.find(n => n.node_id === minerId);
  const p = NAMES[minerId] || { name: `Operator ${minerId.replace('MINER-', '#')}`, role: 'Mine Worker', shift: 'Active', team: 'Operations', blood: '—', contact: 'Surface dispatch', certs: ['Safety Induction'] };

  const co = node?.latest_co ?? 0;
  const temp = node?.latest_temp ?? 0;
  const hum = node?.latest_hum ?? 0;
  const batt = node?.battery_v ?? 0;
  const isCrit = co >= 50;
  const isWarn = co >= 25 && co < 50;
  const coColor = isCrit ? 'var(--color-crit)' : isWarn ? 'var(--color-warn)' : 'var(--color-safe)';

  const minerAlerts = alerts.filter(a => a.node_id === minerId && a.status !== 'RESOLVED');

  // Sparkline data
  const pts = history.slice(0, 20).reverse();
  const maxCo = Math.max(60, ...pts.map(p => p.co_ppm));
  const svgW = 400;
  const svgH = 56;
  const coords = pts.map((pt, i) => {
    const x = pts.length > 1 ? (i / (pts.length - 1)) * svgW : svgW / 2;
    const y = svgH - (pt.co_ppm / maxCo) * (svgH - 8) - 4;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-head">
          <div>
            <div className="drawer-title">
              <h2>{p.name}</h2>
              <span className="mono text-accent">{minerId}</span>
            </div>
            <p className="drawer-subtitle">{p.role} · {p.team}</p>
          </div>
          <button className="btn btn-ghost drawer-close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Active alerts */}
          {minerAlerts.length > 0 && (
            <div className="drawer-alert-block">
              <p className="drawer-alert-heading">{minerAlerts.length} active alert{minerAlerts.length > 1 ? 's' : ''}</p>
              {minerAlerts.map(a => (
                <div key={a.id} className="drawer-alert-row">
                  <span className={`severity-badge severity-${a.severity.toLowerCase()}`}>{a.severity}</span>
                  <span className="mono">{a.alert_code}</span>
                  <span className="text-dim">{a.details || 'Threshold exceeded'}</span>
                  {a.status === 'NEW' && (
                    <button className="btn btn-sm" onClick={() => onOpenAck(a.id)}>Acknowledge</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Location */}
          <section className="drawer-section">
            <h3 className="section-title">Location</h3>
            <div className="detail-grid cols-2">
              <div className="detail-cell">
                <span className="detail-label">Zone</span>
                <span className="detail-value mono">{node?.current_zone || 'Unassigned'}</span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Depth</span>
                <span className="detail-value mono">{depthFromZone(node?.current_zone)}</span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Status</span>
                <span className={`detail-value mono ${node?.status === 'ONLINE' ? 'text-safe' : 'text-warn'}`}>
                  {node?.status || 'Unknown'}
                </span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Last sequence</span>
                <span className="detail-value mono">#{node?.last_seq || 0}</span>
              </div>
            </div>
            <button className="btn btn-primary btn-block" onClick={() => onLocateOnMap(minerId)}>
              Show on map
            </button>
          </section>

          {/* Gas & Environment */}
          <section className="drawer-section">
            <h3 className="section-title">Environment</h3>
            {/* CO gauge */}
            <div className="gauge-row">
              <div className="gauge-info">
                <span className="gauge-label">CO concentration</span>
                <span className="gauge-value mono" style={{ color: coColor }}>{co.toFixed(1)} ppm</span>
              </div>
              <div className="gauge-track">
                <div className="gauge-fill" style={{ width: `${Math.min(100, (co / 60) * 100)}%`, backgroundColor: coColor }} />
                <span className="gauge-tick" style={{ left: '41.7%' }} />
                <span className="gauge-tick tick-red" style={{ left: '83.3%' }} />
              </div>
              <div className="gauge-legend">
                <span>0</span><span>25 (warn)</span><span>50 (evac)</span>
              </div>
            </div>

            <div className="detail-grid cols-3">
              <div className="detail-cell">
                <span className="detail-label">Temperature</span>
                <span className="detail-value mono">{temp.toFixed(1)}°C</span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Humidity</span>
                <span className="detail-value mono">{hum.toFixed(0)}%</span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Motion</span>
                <span className="detail-value text-safe">Normal</span>
              </div>
            </div>

            <div className="detail-grid cols-2" style={{ marginTop: '8px' }}>
              <div className="detail-cell">
                <span className="detail-label">Battery</span>
                <span className="detail-value mono">{batt.toFixed(2)} V</span>
              </div>
              <div className="detail-cell">
                <span className="detail-label">Sensors</span>
                <span className="detail-value text-safe">OK</span>
              </div>
            </div>
          </section>

          {/* CO trend */}
          <section className="drawer-section">
            <h3 className="section-title">CO trend (last 20 readings)</h3>
            {pts.length > 1 ? (
              <div className="sparkline-box">
                <svg width="100%" height="60" viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none">
                  <line x1="0" y1={svgH - (25/maxCo)*(svgH-8)-4} x2={svgW} y2={svgH - (25/maxCo)*(svgH-8)-4} stroke="rgba(234,179,8,0.3)" strokeDasharray="4 4" strokeWidth="1" />
                  <line x1="0" y1={svgH - (50/maxCo)*(svgH-8)-4} x2={svgW} y2={svgH - (50/maxCo)*(svgH-8)-4} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" strokeWidth="1" />
                  <polyline fill="none" stroke="#22d3ee" strokeWidth="1.5" points={coords} />
                </svg>
                <div className="sparkline-labels">
                  <span>Oldest</span>
                  <span className="mono" style={{ color: coColor }}>{co.toFixed(1)} ppm</span>
                  <span>Now</span>
                </div>
              </div>
            ) : (
              <p className="text-dim" style={{ padding: '12px 0', textAlign: 'center', fontSize: '12px' }}>
                Waiting for telemetry data…
              </p>
            )}
          </section>

          {/* Personnel info */}
          <section className="drawer-section">
            <h3 className="section-title">Personnel</h3>
            <div className="info-rows">
              <div className="info-row"><span className="info-key">Shift</span><span>{p.shift}</span></div>
              <div className="info-row"><span className="info-key">Emergency contact</span><span>{p.contact}</span></div>
              <div className="info-row"><span className="info-key">Blood group</span><span className="mono">{p.blood}</span></div>
            </div>
            <div className="cert-list">
              {p.certs.map((c, i) => <span key={i} className="cert-pill">{c}</span>)}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="drawer-foot">
          <button className="btn btn-danger" style={{ flex: 1 }}
            onClick={() => alert(`Evacuation signal sent to ${minerId}`)}
          >
            Send evacuation alert
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </aside>
    </div>
  );
};
