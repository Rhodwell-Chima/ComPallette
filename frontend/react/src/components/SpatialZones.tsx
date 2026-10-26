import React from 'react';
import { NodeItem } from '../types';

interface SpatialZonesProps {
  nodes: NodeItem[];
  onSelectMiner: (nodeId: string) => void;
}

export const SpatialZones: React.FC<SpatialZonesProps> = ({ nodes, onSelectMiner }) => {
  const zonesMap: Record<string, NodeItem[]> = {};
  nodes.forEach(n => {
    const zone = n.current_zone || 'UNASSIGNED / TRANSIT';
    if (!zonesMap[zone]) zonesMap[zone] = [];
    zonesMap[zone].push(n);
  });

  if (nodes.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '30px' }}>
        Scanning underground mesh for active personnel...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {Object.entries(zonesMap).map(([zone, minerList]) => (
        <div key={zone} style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px 16px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            paddingBottom: '6px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13px', color: '#38bdf8' }}>
              ⛏️ {zone}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
              {minerList.length} Personnel Assigned
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '12px',
          }}>
            {minerList.map(m => {
              const co = m.latest_co || 0.0;
              const isCrit = co >= 50.0;
              const isWarn = co >= 25.0 && co < 50.0;
              const gasColor = isCrit ? 'var(--color-crit)' : isWarn ? 'var(--color-warn)' : 'var(--color-safe)';
              const gasPct = Math.min(100, (co / 60.0) * 100);

              return (
                <div
                  key={m.node_id}
                  onClick={() => onSelectMiner(m.node_id)}
                  style={{
                    backgroundColor: isCrit ? 'var(--color-crit-bg)' : isWarn ? 'var(--color-warn-bg)' : 'rgba(11, 15, 23, 0.7)',
                    border: `1px solid ${isCrit ? 'var(--color-crit)' : isWarn ? 'var(--color-warn)' : 'var(--border-subtle)'}`,
                    borderRadius: '4px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '13px', color: '#fff' }}>
                      {m.node_id}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontFamily: 'var(--font-mono)',
                      background: m.status === 'ONLINE' ? 'var(--color-safe-bg)' : m.status === 'STALE' ? 'var(--color-warn-bg)' : 'rgba(100, 116, 139, 0.2)',
                      color: m.status === 'ONLINE' ? 'var(--color-safe)' : m.status === 'STALE' ? 'var(--color-warn)' : 'var(--text-dim)',
                    }}>
                      {m.status}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>CO Gas</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: gasColor }}>
                        {co.toFixed(1)} ppm
                      </div>
                      <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', overflow: 'hidden', marginTop: '2px' }}>
                        <div style={{ height: '100%', width: `${gasPct}%`, backgroundColor: gasColor, borderRadius: '3px', transition: 'width 0.3s ease' }}></div>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Climate</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {m.latest_temp.toFixed(1)}°C &bull; {m.latest_hum.toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    <span>Batt: {m.battery_v.toFixed(2)}V</span>
                    <span>Role: {m.role}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
