import React, { useState } from 'react';
import { NodeItem } from '../types';

interface PersonnelMatrixProps {
  nodes: NodeItem[];
  selectedMinerId: string;
  onSelectMiner: (nodeId: string) => void;
  onOpenDrawer: (nodeId: string) => void;
}

const MINER_NAMES: Record<string, string> = {
  'MINER-101': 'Moses Banda',
  'MINER-106': 'Chileshe Phiri',
  'MINER-112': 'Peter Mwape',
  'MINER-DANGER': 'Kabwe Lungu',
};

export const PersonnelMatrix: React.FC<PersonnelMatrixProps> = ({
  nodes,
  selectedMinerId,
  onSelectMiner,
  onOpenDrawer,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CRIT' | 'WARN' | 'ONLINE'>('ALL');

  const wearableMiners = nodes.filter(n => n.role === 'WEARABLE');

  const filteredMiners = wearableMiners.filter(m => {
    const name = MINER_NAMES[m.node_id] || '';
    const matchesSearch =
      m.node_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.current_zone || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'CRIT') return m.latest_co >= 50.0;
    if (statusFilter === 'WARN') return m.latest_co >= 25.0 && m.latest_co < 50.0;
    if (statusFilter === 'ONLINE') return m.status === 'ONLINE';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Search & Filter Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div className="search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search badge, name, or zone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '14px' }}
            >
              ×
            </button>
          )}
        </div>

        <div className="filter-pills">
          <button
            className={`filter-pill ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            All ({wearableMiners.length})
          </button>
          <button
            className={`filter-pill ${statusFilter === 'WARN' ? 'active' : ''}`}
            onClick={() => setStatusFilter('WARN')}
          >
            Warning ({wearableMiners.filter(m => m.latest_co >= 25 && m.latest_co < 50).length})
          </button>
          <button
            className={`filter-pill ${statusFilter === 'CRIT' ? 'active' : ''}`}
            onClick={() => setStatusFilter('CRIT')}
          >
            Evacuation ({wearableMiners.filter(m => m.latest_co >= 50).length})
          </button>
        </div>
      </div>

      {/* Roster Table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Personnel</th>
              <th>Assignment</th>
              <th>Underground Zone</th>
              <th>CO Concentration</th>
              <th>Climate</th>
              <th>Battery</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMiners.map(m => {
              const co = m.latest_co || 0.0;
              const isCrit = co >= 50.0;
              const isWarn = co >= 25.0 && co < 50.0;
              const isSelected = m.node_id === selectedMinerId;
              const name = MINER_NAMES[m.node_id] || `Miner ${m.node_id.replace('MINER-', '#')}`;

              return (
                <tr
                  key={m.node_id}
                  className={`${isSelected ? 'row-selected' : ''} ${isCrit ? 'row-crit' : ''}`}
                  onClick={() => {
                    onSelectMiner(m.node_id);
                    onOpenDrawer(m.node_id);
                  }}
                >
                  {/* Name and ID */}
                  <td>
                    <div>
                      <div className="cell-name">{name}</div>
                      <div className="cell-id mono">{m.node_id}</div>
                    </div>
                  </td>

                  {/* Role */}
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--text-2)' }}>{m.role}</span>
                  </td>

                  {/* Zone */}
                  <td>
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--brand-text)' }}>
                      {m.current_zone || 'Unassigned'}
                    </span>
                  </td>

                  {/* CO Reading & Progress */}
                  <td style={{ minWidth: '130px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <span className={`mono ${isCrit ? 'text-crit' : isWarn ? 'text-warn' : 'text-safe'}`} style={{ fontWeight: 600 }}>
                        {co.toFixed(1)} ppm
                      </span>
                      <span style={{ fontSize: '9px', fontWeight: 600, color: isCrit ? 'var(--crit)' : isWarn ? 'var(--warn)' : 'var(--safe)' }}>
                        {isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'SAFE'}
                      </span>
                    </div>
                    <div className="progress-sm">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${Math.min(100, (co / 60) * 100)}%`,
                          backgroundColor: isCrit ? 'var(--crit)' : isWarn ? 'var(--warn)' : 'var(--safe)',
                        }}
                      />
                    </div>
                  </td>

                  {/* Climate */}
                  <td>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text-2)' }}>
                      {m.latest_temp.toFixed(1)}°C &bull; {m.latest_hum.toFixed(0)}% RH
                    </span>
                  </td>

                  {/* Battery */}
                  <td>
                    <span className="mono" style={{ fontSize: '11px' }}>
                      {m.battery_v.toFixed(2)} V
                    </span>
                  </td>

                  {/* Status */}
                  <td>
                    <span className={`cell-status ${m.status === 'ONLINE' ? 'st-online' : m.status === 'STALE' ? 'st-stale' : 'st-offline'}`}>
                      {m.status}
                    </span>
                  </td>

                  {/* Action */}
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMiner(m.node_id);
                        onOpenDrawer(m.node_id);
                      }}
                    >
                      Details →
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredMiners.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-3)' }}>
                  No personnel matching current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
