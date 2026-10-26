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
    const zone = n.current_zone || 'Transit / Unassigned';
    if (!zonesMap[zone]) zonesMap[zone] = [];
    zonesMap[zone].push(n);
  });

  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-3)' }}>
        No active personnel nodes connected to mesh.
      </div>
    );
  }

  return (
    <div className="zone-list">
      {Object.entries(zonesMap).map(([zone, minerList]) => {
        const hasCrit = minerList.some(m => m.latest_co >= 50.0);
        const hasWarn = minerList.some(m => m.latest_co >= 25.0 && m.latest_co < 50.0);

        return (
          <div
            key={zone}
            className={`zone-group ${hasCrit ? 'has-crit' : ''}`}
          >
            <div className="zone-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="zone-name mono">{zone}</span>
                {hasCrit && (
                  <span className="severity-badge severity-critical">Evacuation</span>
                )}
                {!hasCrit && hasWarn && (
                  <span className="severity-badge severity-warning">Warning</span>
                )}
              </div>
              <span className="zone-count mono">
                {minerList.length} {minerList.length === 1 ? 'Person' : 'Personnel'}
              </span>
            </div>

            <div className="zone-miners">
              {minerList.map(m => {
                const co = m.latest_co || 0.0;
                const isCrit = co >= 50.0;
                const isWarn = co >= 25.0 && co < 50.0;
                const gasColor = isCrit ? 'var(--crit)' : isWarn ? 'var(--warn)' : 'var(--safe)';
                const gasPct = Math.min(100, (co / 60.0) * 100);

                return (
                  <div
                    key={m.node_id}
                    className="zone-miner"
                    onClick={() => {
                      onSelectMiner(m.node_id);
                      if (onOpenDrawer) onOpenDrawer(m.node_id);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-1)' }}>
                        {m.node_id}
                      </span>
                      <span className={`cell-status ${m.status === 'ONLINE' ? 'st-online' : 'st-offline'}`} style={{ fontSize: '9px' }}>
                        {m.status}
                      </span>
                    </div>

                    <div style={{ marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px' }}>
                        <span style={{ color: 'var(--text-3)' }}>CO Gas</span>
                        <span className="mono" style={{ color: gasColor, fontWeight: 600 }}>
                          {co.toFixed(1)} ppm
                        </span>
                      </div>
                      <div className="progress-sm">
                        <div
                          className="progress-fill"
                          style={{ width: `${gasPct}%`, backgroundColor: gasColor }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: 'var(--text-3)' }}>
                      <span className="mono">{m.latest_temp.toFixed(1)}°C &bull; {m.battery_v.toFixed(2)}V</span>
                      <span style={{ color: 'var(--brand-light)', fontWeight: 500 }}>Details →</span>
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
