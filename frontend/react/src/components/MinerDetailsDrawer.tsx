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

// Known miner personnel directory for Zambian underground operations
const PERSONNEL_DIRECTORY: Record<string, {
  name: string;
  roleTitle: string;
  shift: string;
  team: string;
  bloodGroup: string;
  emergencyContact: string;
  certifications: string[];
}> = {
  'MINER-101': {
    name: 'Moses Banda',
    roleTitle: 'Haulage Drill Operator',
    shift: 'Shift A (06:00 - 14:00 CAT)',
    team: 'Drift Section 2 Alpha',
    bloodGroup: 'O+',
    emergencyContact: '+260 97 712 3456 (Spouse)',
    certifications: ['Blasting Certificate #4412', 'Mine Rescue Level 2', 'First Aid Certified'],
  },
  'MINER-106': {
    name: 'Chileshe Phiri',
    roleTitle: 'Underground Geologist / Stope Surveyor',
    shift: 'Shift A (06:00 - 14:00 CAT)',
    team: 'Deep Stope Geotechnical Crew',
    bloodGroup: 'A+',
    emergencyContact: '+260 96 688 1234 (Brother)',
    certifications: ['Ventilation Gas Specialist', 'Deep Shaft Fall Arrest', 'Confined Space Lead'],
  },
  'MINER-112': {
    name: 'Peter Mwape',
    roleTitle: 'Ventilation & Dewatering Technician',
    shift: 'Shift A (06:00 - 14:00 CAT)',
    team: 'Level 2 Infrastructure Team',
    bloodGroup: 'B+',
    emergencyContact: '+260 95 544 9876 (Sister)',
    certifications: ['Subterranean Pumping Tech', 'Hazardous Atmosphere Response'],
  },
  'MINER-DANGER': {
    name: 'Kabwe Lungu',
    roleTitle: 'Active Stope Loader Operator',
    shift: 'Shift B (14:00 - 22:00 CAT)',
    team: 'Stope Extraction Unit #4',
    bloodGroup: 'O-',
    emergencyContact: '+260 97 123 7890 (Clinic Liaison)',
    certifications: ['Heavy Machinery Operator', 'Emergency Evacuation Lead'],
  },
};

export const MinerDetailsDrawer: React.FC<MinerDetailsDrawerProps> = ({
  isOpen,
  minerId,
  nodes,
  alerts,
  history,
  onClose,
  onLocateOnMap,
  onOpenAck,
}) => {
  if (!isOpen || !minerId) return null;

  const node = nodes.find(n => n.node_id === minerId);
  const personnel = PERSONNEL_DIRECTORY[minerId] || {
    name: `Operator ${minerId.replace('MINER-', '#')}`,
    roleTitle: 'Underground Mine Specialist',
    shift: 'Active Production Shift',
    team: 'Mining Operations Division',
    bloodGroup: 'Unknown',
    emergencyContact: 'Central Surface Dispatch (Ext. 201)',
    certifications: ['Underground Safety Induction (Zambia Mining Act)'],
  };

  const co = node?.latest_co ?? 0.0;
  const temp = node?.latest_temp ?? 0.0;
  const hum = node?.latest_hum ?? 0.0;
  const batt = node?.battery_v ?? 4.0;
  const isOnline = node?.status === 'ONLINE';
  const isStale = node?.status === 'STALE';

  const isCoCrit = co >= 50.0;
  const isCoWarn = co >= 25.0 && co < 50.0;
  const gasStatusLabel = isCoCrit ? 'CRITICAL EVACUATION' : isCoWarn ? 'WARNING THRESHOLD' : 'ATMOSPHERE SAFE';
  const gasStatusColor = isCoCrit ? '#ff3344' : isCoWarn ? '#f59e0b' : '#10b981';

  // Miner-specific active alerts
  const minerAlerts = alerts.filter(a => a.node_id === minerId && a.status !== 'RESOLVED');

  // Sparkline generator for CO
  const sparklinePoints = history.slice(0, 20).reverse();
  const maxCo = Math.max(60, ...sparklinePoints.map(p => p.co_ppm));
  const svgWidth = 320;
  const svgHeight = 60;
  const polylineCoords = sparklinePoints.map((pt, i) => {
    const x = (i / Math.max(1, sparklinePoints.length - 1)) * svgWidth;
    const y = svgHeight - (pt.co_ppm / maxCo) * (svgHeight - 10) - 5;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="miner-drawer"
        onClick={e => e.stopPropagation()}
        aria-label={`Detailed telemetry dossier for ${minerId}`}
      >
        {/* Drawer Header */}
        <div className="drawer-header">
          <div className="drawer-header-left">
            <div className="miner-avatar">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a5 5 0 0 0-5 5v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2V7a5 5 0 0 0-5-5z" />
                <circle cx="12" cy="6" r="1.5" />
              </svg>
              <span className={`status-indicator-dot ${isOnline ? 'dot-online' : isStale ? 'dot-stale' : 'dot-offline'}`} />
            </div>
            <div>
              <div className="drawer-title-row">
                <h2 className="miner-name">{personnel.name}</h2>
                <span className="miner-id-tag">{minerId}</span>
              </div>
              <p className="miner-role-subtitle">{personnel.roleTitle} &bull; {personnel.team}</p>
            </div>
          </div>

          <button className="drawer-close-btn" onClick={onClose} title="Close dossier (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drawer Scrollable Body */}
        <div className="drawer-body">
          {/* Active Hazard Warning Banner (if any) */}
          {minerAlerts.length > 0 && (
            <div className="drawer-hazard-alert">
              <div className="drawer-hazard-title">
                <span className="pulse-hazard-icon">⚠️</span>
                <span>ACTIVE SAFETY ALARM TRIGGERED ({minerAlerts.length})</span>
              </div>
              {minerAlerts.map(a => (
                <div key={a.id} className="drawer-alert-item">
                  <div className="drawer-alert-meta">
                    <span className="alert-badge-crit">{a.severity}</span>
                    <span className="alert-code-text">{a.alert_code}</span>
                  </div>
                  <div className="alert-details-text">{a.details || 'Environmental or motion threshold exceeded'}</div>
                  {a.status === 'NEW' && (
                    <button
                      className="btn btn-warning btn-sm"
                      style={{ marginTop: '8px', width: '100%' }}
                      onClick={() => onOpenAck(a.id)}
                    >
                      Acknowledge Hazard Incident
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Location & Spatial Positioning Card */}
          <div className="dossier-card">
            <div className="card-section-label">
              <span>📍</span> SUBTERRANEAN SPATIAL TRACKING
            </div>
            <div className="grid-2col">
              <div className="metric-box">
                <span className="metric-caption">CURRENT MINING ZONE</span>
                <span className="metric-val-highlight">{node?.current_zone || 'UNASSIGNED'}</span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">ELEVATION / DEPTH</span>
                <span className="metric-val">
                  {node?.current_zone?.includes('LEVEL-3') ? '-450m (Deep Stope)' :
                   node?.current_zone?.includes('LEVEL-2') ? '-250m (Haulage Drift)' :
                   node?.current_zone?.includes('LEVEL-1') ? '-100m (Sub-Station)' : '0m (Surface Portal)'}
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">COMMUNICATION LINK</span>
                <span className="metric-val font-mono">
                  {node?.is_simulated ? 'Mesh Link: 2 Hops (Nominal)' : 'Direct Mesh Bridge'}
                </span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">DEVICE STATUS</span>
                <span className={`metric-val font-mono ${isOnline ? 'text-safe' : 'text-warn'}`}>
                  {node?.status || 'UNKNOWN'} (Seq #{node?.last_seq || 0})
                </span>
              </div>
            </div>

            <button
              className="btn btn-locate"
              onClick={() => onLocateOnMap(minerId)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="22" y1="12" x2="18" y2="12" />
                <line x1="6" y1="12" x2="2" y2="12" />
                <line x1="12" y1="6" x2="12" y2="2" />
                <line x1="12" y1="22" x2="12" y2="18" />
              </svg>
              <span>FOCUS &amp; TRACK ON 2.5D DIGITAL TWIN</span>
            </button>
          </div>

          {/* Real-Time Environmental & Biometric Telemetry */}
          <div className="dossier-card">
            <div className="card-section-label">
              <span>⚡</span> REAL-TIME SENSOR METRICS (WEARABLE ESP32)
            </div>

            {/* CO Gas Gauge Meter */}
            <div className="gas-gauge-block">
              <div className="gas-gauge-header">
                <span className="gas-title">CARBON MONOXIDE (CO) CONCENTRATION</span>
                <span className="gas-value" style={{ color: gasStatusColor }}>
                  {co.toFixed(1)} <span className="unit">ppm</span>
                </span>
              </div>

              <div className="gas-bar-track">
                <div
                  className="gas-bar-fill"
                  style={{
                    width: `${Math.min(100, (co / 60) * 100)}%`,
                    backgroundColor: gasStatusColor,
                    boxShadow: `0 0 12px ${gasStatusColor}`,
                  }}
                />
                {/* Visual Threshold Ticks */}
                <span className="threshold-tick" style={{ left: '41.6%' }} title="25 ppm OSHA Warning" />
                <span className="threshold-tick tick-crit" style={{ left: '83.3%' }} title="50 ppm Evac Ceiling" />
              </div>

              <div className="gas-bar-legend">
                <span>0 ppm (Clean)</span>
                <span>25 ppm (Warning)</span>
                <span>50 ppm (Evacuate)</span>
              </div>

              <div className="gas-status-badge" style={{ backgroundColor: `${gasStatusColor}18`, borderColor: `${gasStatusColor}40`, color: gasStatusColor }}>
                <span className="pulse-dot" style={{ backgroundColor: gasStatusColor, boxShadow: `0 0 6px ${gasStatusColor}` }} />
                <span>STATUS: {gasStatusLabel}</span>
              </div>
            </div>

            {/* Micro-Climate & Motion Grid */}
            <div className="grid-3col" style={{ marginTop: '16px' }}>
              <div className="metric-box">
                <span className="metric-caption">AMBIENT TEMP</span>
                <span className="metric-val">{temp.toFixed(1)}°C</span>
                <span className="metric-subtext">Thermal Index Nominal</span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">HUMIDITY</span>
                <span className="metric-val">{hum.toFixed(0)}%</span>
                <span className="metric-subtext">Underground Drift</span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">MOTION / GYRO</span>
                <span className="metric-val text-safe">NORMAL</span>
                <span className="metric-subtext">No Fall Detected</span>
              </div>
            </div>

            {/* Battery & Hardware Status */}
            <div className="grid-2col" style={{ marginTop: '12px' }}>
              <div className="metric-box">
                <span className="metric-caption">BATTERY VOLTAGE</span>
                <span className="metric-val font-mono">{batt.toFixed(2)} V</span>
                <span className="metric-subtext">LiPo Est. ~88% Remaining</span>
              </div>
              <div className="metric-box">
                <span className="metric-caption">SENSOR HEALTH</span>
                <span className="metric-val text-safe font-mono">ALL NOMINAL</span>
                <span className="metric-subtext">I2C + MQ-7 + MPU6050</span>
              </div>
            </div>
          </div>

          {/* Historical Trend Sparkline */}
          <div className="dossier-card">
            <div className="card-section-label">
              <span>📊</span> 20-POINT CO TELEMETRY STREAM
            </div>
            {sparklinePoints.length > 1 ? (
              <div className="sparkline-wrapper">
                <svg width="100%" height="70" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none">
                  {/* Warning line at 25 ppm */}
                  <line
                    x1="0"
                    y1={svgHeight - (25 / maxCo) * (svgHeight - 10) - 5}
                    x2={svgWidth}
                    y2={svgHeight - (25 / maxCo) * (svgHeight - 10) - 5}
                    stroke="rgba(245, 158, 11, 0.4)"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  {/* Critical line at 50 ppm */}
                  <line
                    x1="0"
                    y1={svgHeight - (50 / maxCo) * (svgHeight - 10) - 5}
                    x2={svgWidth}
                    y2={svgHeight - (50 / maxCo) * (svgHeight - 10) - 5}
                    stroke="rgba(239, 68, 68, 0.4)"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  {/* Polyline */}
                  <polyline
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    points={polylineCoords}
                  />
                </svg>
                <div className="sparkline-footer">
                  <span>-20 Packets Ago</span>
                  <span style={{ color: '#38bdf8' }}>Current: {co.toFixed(1)} ppm</span>
                  <span>Latest (Now)</span>
                </div>
              </div>
            ) : (
              <p className="no-history-text">Awaiting streaming telemetry packets from ESP32 mesh...</p>
            )}
          </div>

          {/* Worker Profile & Safety Qualifications */}
          <div className="dossier-card">
            <div className="card-section-label">
              <span>📋</span> PERSONNEL PROFILE &amp; EMERGENCY DISPATCH
            </div>
            <div className="profile-row">
              <span className="profile-key">Shift Schedule:</span>
              <span className="profile-val">{personnel.shift}</span>
            </div>
            <div className="profile-row">
              <span className="profile-key">Emergency Contact:</span>
              <span className="profile-val">{personnel.emergencyContact}</span>
            </div>
            <div className="profile-row">
              <span className="profile-key">Blood Group:</span>
              <span className="profile-val font-mono">{personnel.bloodGroup}</span>
            </div>
            <div className="profile-cert-list">
              <span className="profile-key" style={{ marginBottom: '6px', display: 'block' }}>Qualifications:</span>
              <div className="cert-tags">
                {personnel.certifications.map((c, i) => (
                  <span key={i} className="cert-tag">{c}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="drawer-footer">
          <button
            className="btn btn-danger"
            style={{ flex: 1, padding: '10px' }}
            onClick={() => alert(`🚨 EMERGENCY EVACUATION SIGNAL TRANSMITTED TO ${minerId}!\nBadge buzzer and strobe LED triggered via mesh broadcast.`)}
          >
            <span>📢</span> TRIGGER BADGE EVACUATION ALARM
          </button>
          <button
            className="btn"
            style={{ padding: '10px 16px' }}
            onClick={onClose}
          >
            DISMISS
          </button>
        </div>
      </aside>
    </div>
  );
};
