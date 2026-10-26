import React from 'react';
import { NodeItem } from '../types';

interface PersonnelMatrixProps {
  nodes: NodeItem[];
  onSelectMiner: (nodeId: string) => void;
}

export const PersonnelMatrix: React.FC<PersonnelMatrixProps> = ({ nodes, onSelectMiner }) => {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
        <thead>
          <tr style={{ backgroundColor: 'rgba(11, 15, 23, 0.6)', borderBottom: '1px solid var(--border-subtle)' }}>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Device / Personnel</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Role</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Current Zone</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>CO Level (ppm)</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Climate</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Battery</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Status</th>
            <th style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map(m => {
            const co = m.latest_co || 0.0;
            const gasColor = co >= 50 ? 'var(--color-crit)' : co >= 25 ? 'var(--color-warn)' : 'var(--color-safe)';

            return (
              <tr key={m.node_id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', fontFamily: 'var(--font-mono)' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700, color: '#fff' }}>{m.node_id}</td>
                <td style={{ padding: '9px 12px', color: 'var(--text-dim)' }}>{m.role}</td>
                <td style={{ padding: '9px 12px', color: '#38bdf8' }}>{m.current_zone || 'UNASSIGNED'}</td>
                <td style={{ padding: '9px 12px', color: gasColor, fontWeight: 700 }}>{co.toFixed(1)} ppm</td>
                <td style={{ padding: '9px 12px' }}>{m.latest_temp.toFixed(1)}°C / {m.latest_hum.toFixed(0)}%</td>
                <td style={{ padding: '9px 12px' }}>{m.battery_v.toFixed(2)} V</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    background: m.status === 'ONLINE' ? 'var(--color-safe-bg)' : m.status === 'STALE' ? 'var(--color-warn-bg)' : 'rgba(100, 116, 139, 0.2)',
                    color: m.status === 'ONLINE' ? 'var(--color-safe)' : m.status === 'STALE' ? 'var(--color-warn)' : 'var(--text-dim)',
                  }}>
                    {m.status}
                  </span>
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <button className="btn" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={() => onSelectMiner(m.node_id)}>
                    Inspect
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
