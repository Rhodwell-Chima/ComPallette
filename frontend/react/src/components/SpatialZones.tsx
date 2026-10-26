import React from 'react';
import { NodeItem } from '../types';

interface SpatialZonesProps {
  nodes: NodeItem[];
  onSelectMiner: (nodeId: string) => void;
  onOpenDrawer?: (nodeId: string) => void;
}

export const SpatialZones: React.FC<SpatialZonesProps> = ({ nodes, onSelectMiner, onOpenDrawer }) => {
  const zonesMap: Record<string, NodeItem[]> = {};
  nodes.forEach(n => {
    const zone = n.current_zone || 'UNASSIGNED / TRANSIT';
    if (!zonesMap[zone]) zonesMap[zone] = [];
    zonesMap[zone].push(n);
  });

  if (nodes.length === 0) {
    return (
      <div className="empty-zone-banner">
        Scanning underground wireless mesh for active personnel beacons...
      </div>
    );
  }

  return (
    <div className="spatial-zones-list">
      {Object.entries(zonesMap).map(([zone, minerList]) => {
        const hasCrit = minerList.some(m => m.latest_co >= 50.0);
        const hasWarn = minerList.some(m => m.latest_co >= 25.0 && m.latest_co < 50.0);

        return (
          <div
            key={zone}
            className={`zone-cluster-card ${hasCrit ? 'cluster-crit' : hasWarn ? 'cluster-warn' : ''}`}
          >
            <div className="zone-cluster-header">
              <div className="zone-cluster-title">
                <span className="zone-icon-cube">⬢</span>
                <span className="font-mono">{zone}</span>
                {hasCrit && <span className="zone-badge-crit">EVACUATION ALARM</span>}
              </div>
              <span className="zone-count-pill font-mono">
                {minerList.length} Active Personnel
              </span>
            </div>

            <div className="zone-miners-grid">
              {minerList.map(m => {
                const co = m.latest_co || 0.0;
                const isCrit = co >= 50.0;
                const isWarn = co >= 25.0 && co < 50.0;
                const gasColor = isCrit ? '#ff3344' : isWarn ? '#f59e0b' : '#10b981';
                const gasPct = Math.min(100, (co / 60.0) * 100);

                return (
                  <div
                    key={m.node_id}
                    className={`zone-miner-card ${isCrit ? 'card-crit' : isWarn ? 'card-warn' : ''}`}
                    onClick={() => {
                      onSelectMiner(m.node_id);
                      if (onOpenDrawer) onOpenDrawer(m.node_id);
                    }}
                  >
                    <div className="zone-miner-top">
                      <span className="miner-tag-bold font-mono">{m.node_id}</span>
                      <span className={`status-chip ${m.status === 'ONLINE' ? 'chip-online' : 'chip-offline'}`}>
                        {m.status}
                      </span>
                    </div>

                    <div className="zone-metrics-row">
                      <div className="zone-metric-col">
                        <span className="zone-label-sub">CO GAS</span>
                        <span className="zone-val-strong font-mono" style={{ color: gasColor }}>
                          {co.toFixed(1)} ppm
                        </span>
                        <div className="mini-progress-track">
                          <div
                            className="mini-progress-fill"
                            style={{ width: `${gasPct}%`, backgroundColor: gasColor }}
                          />
                        </div>
                      </div>
                      <div className="zone-metric-col">
                        <span className="zone-label-sub">CLIMATE</span>
                        <span className="zone-val-strong font-mono">
                          {m.latest_temp.toFixed(1)}°C &bull; {m.latest_hum.toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    <div className="zone-miner-bottom">
                      <span>Batt: {m.battery_v.toFixed(2)}V</span>
                      <span className="inspect-link">Click for Dossier →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
