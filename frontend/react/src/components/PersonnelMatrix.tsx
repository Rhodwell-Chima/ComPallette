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
    <div className="personnel-matrix-container">
      {/* Search & Filter Control Bar */}
      <div className="matrix-toolbar">
        <div className="matrix-search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="matrix-search-input"
            placeholder="Filter by badge, name, or underground zone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="matrix-search-clear" onClick={() => setSearchTerm('')}>×</button>
          )}
        </div>

        <div className="matrix-filter-pills">
          <button
            className={`filter-pill ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            All Miners ({wearableMiners.length})
          </button>
          <button
            className={`filter-pill pill-warn ${statusFilter === 'WARN' ? 'active' : ''}`}
            onClick={() => setStatusFilter('WARN')}
          >
            Gas Warning ({wearableMiners.filter(m => m.latest_co >= 25 && m.latest_co < 50).length})
          </button>
          <button
            className={`filter-pill pill-crit ${statusFilter === 'CRIT' ? 'active' : ''}`}
            onClick={() => setStatusFilter('CRIT')}
          >
            Evacuation Alert ({wearableMiners.filter(m => m.latest_co >= 50).length})
          </button>
        </div>
      </div>

      {/* Industrial Roster Table */}
      <div className="table-responsive">
        <table className="scada-table">
          <thead>
            <tr>
              <th>Personnel / Badge</th>
              <th>Assignment</th>
              <th>Subterranean Zone</th>
              <th>CO Concentration</th>
              <th>Climate</th>
              <th>Battery (LiPo)</th>
              <th>Link Status</th>
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
                  className={`scada-row ${isSelected ? 'row-selected' : ''} ${isCrit ? 'row-crit' : isWarn ? 'row-warn' : ''}`}
                  onClick={() => {
                    onSelectMiner(m.node_id);
                    onOpenDrawer(m.node_id);
                  }}
                >
                  {/* Badge & Personnel Name */}
                  <td>
                    <div className="miner-cell">
                      <div className="miner-cell-avatar">
                        <span className={`status-micro-dot ${m.status === 'ONLINE' ? 'dot-online' : 'dot-offline'}`} />
                      </div>
                      <div>
                        <div className="miner-cell-name">{name}</div>
                        <div className="miner-cell-id font-mono">{m.node_id}</div>
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td>
                    <span className="badge-role">{m.role}</span>
                  </td>

                  {/* Current Zone */}
                  <td>
                    <span className="zone-tag">
                      {m.current_zone || 'UNASSIGNED'}
                    </span>
                  </td>

                  {/* CO Concentration with Visual Bar */}
                  <td>
                    <div className="co-cell">
                      <div className="co-readout">
                        <span className={`font-mono font-bold ${isCrit ? 'text-crit' : isWarn ? 'text-warn' : 'text-safe'}`}>
                          {co.toFixed(1)} ppm
                        </span>
                        <span className="co-label-micro">
                          {isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'SAFE'}
                        </span>
                      </div>
                      <div className="mini-progress-track">
                        <div
                          className="mini-progress-fill"
                          style={{
                            width: `${Math.min(100, (co / 60) * 100)}%`,
                            backgroundColor: isCrit ? '#ff3344' : isWarn ? '#f59e0b' : '#10b981',
                          }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Micro-Climate */}
                  <td>
                    <span className="font-mono climate-text">
                      {m.latest_temp.toFixed(1)}°C &bull; {m.latest_hum.toFixed(0)}% RH
                    </span>
                  </td>

                  {/* Battery */}
                  <td>
                    <div className="battery-cell font-mono">
                      <span className="battery-icon">🔋</span>
                      <span>{m.battery_v.toFixed(2)} V</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td>
                    <span className={`status-chip ${m.status === 'ONLINE' ? 'chip-online' : m.status === 'STALE' ? 'chip-stale' : 'chip-offline'}`}>
                      {m.status}
                    </span>
                  </td>

                  {/* Action */}
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-inspect"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMiner(m.node_id);
                        onOpenDrawer(m.node_id);
                      }}
                    >
                      <span>INSPECT DOSSIER</span>
                      <span>→</span>
                    </button>
                  </td>
                </tr>
              );
            })}

            {filteredMiners.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-table-cell">
                  No active miner tags matching current search or status filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
