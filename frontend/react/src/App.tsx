import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { EmergencyBanner } from './components/EmergencyBanner';
import { KpiMetrics } from './components/KpiMetrics';
import { DigitalMineTwin } from './components/DigitalMineTwin';
import { SpatialZones } from './components/SpatialZones';
import { PersonnelMatrix } from './components/PersonnelMatrix';
import { TelemetryChart } from './components/TelemetryChart';
import { AuditFeed } from './components/AuditFeed';
import { AckModal, ResolveModal } from './components/Modals';
import {
  fetchSummary,
  fetchNodes,
  fetchAlerts,
  fetchNodeHistory,
  fetchAudit,
  acknowledgeAlert,
  resolveAlert,
} from './services/api';
import { SystemSummary, NodeItem, AlertItem, TelemetryItem, AuditItem } from './types';

export const App: React.FC = () => {
  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [selectedMinerId, setSelectedMinerId] = useState<string>('MINER-106');
  const [history, setHistory] = useState<TelemetryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'model' | 'zones' | 'table'>('model');
  const [audioArmed, setAudioArmed] = useState<boolean>(true);
  const [ackModalId, setAckModalId] = useState<number | null>(null);
  const [resModalId, setResModalId] = useState<number | null>(null);

  const isGatewayOnline = Boolean(
    summary?.last_packet_received_ms &&
    (Date.now() - summary.last_packet_received_ms) < 15000
  );

  const loadData = useCallback(async () => {
    try {
      const [sumData, nodesData, alertsData, auditData] = await Promise.all([
        fetchSummary().catch(() => null),
        fetchNodes().catch(() => []),
        fetchAlerts().catch(() => []),
        fetchAudit().catch(() => []),
      ]);

      if (sumData) setSummary(sumData);
      if (nodesData) {
        setNodes(nodesData);
        if (!selectedMinerId && nodesData.length > 0) {
          const firstWearable = nodesData.find(n => n.role === 'WEARABLE');
          if (firstWearable) setSelectedMinerId(firstWearable.node_id);
        }
      }
      if (alertsData) setAlerts(alertsData);
      if (auditData) setAuditLogs(auditData);
    } catch (e) {
      console.error('Error polling data:', e);
    }
  }, [selectedMinerId]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 2000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (selectedMinerId) {
      fetchNodeHistory(selectedMinerId)
        .then(setHistory)
        .catch(() => setHistory([]));
    }
  }, [selectedMinerId]);

  const handleSelectMiner = (nodeId: string) => {
    setSelectedMinerId(nodeId);
  };

  const handleAckSubmit = async (alertId: number, officerName: string) => {
    await acknowledgeAlert(alertId, officerName);
    loadData();
  };

  const handleResolveSubmit = async (alertId: number, officerName: string, notes: string) => {
    await resolveAlert(alertId, officerName, notes);
    loadData();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        isGatewayOnline={isGatewayOnline}
        audioArmed={audioArmed}
        onToggleAudio={() => setAudioArmed(prev => !prev)}
        onRefresh={loadData}
      />

      <EmergencyBanner
        alerts={alerts}
        audioArmed={audioArmed}
        onOpenAck={id => setAckModalId(id)}
        onOpenResolve={id => setResModalId(id)}
      />

      <main style={{ flex: 1, padding: '20px 24px', maxWidth: '1700px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <KpiMetrics summary={summary} />

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          {/* Left Panel: Simulation / Spatial Tracking */}
          <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(22, 31, 51, 0.6)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🗺️</span> Subterranean Personnel Tracking
              </div>

              <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-base)', padding: '3px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                <button
                  className="tab-btn"
                  style={{
                    backgroundColor: activeTab === 'model' ? 'var(--bg-card)' : 'transparent',
                    color: activeTab === 'model' ? '#38bdf8' : 'var(--text-muted)',
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveTab('model')}
                >
                  DIGITAL MINE TWIN
                </button>
                <button
                  className="tab-btn"
                  style={{
                    backgroundColor: activeTab === 'zones' ? 'var(--bg-card)' : 'transparent',
                    color: activeTab === 'zones' ? '#38bdf8' : 'var(--text-muted)',
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveTab('zones')}
                >
                  ZONES (CARDS)
                </button>
                <button
                  className="tab-btn"
                  style={{
                    backgroundColor: activeTab === 'table' ? 'var(--bg-card)' : 'transparent',
                    color: activeTab === 'table' ? '#38bdf8' : 'var(--text-muted)',
                    border: 'none',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveTab('table')}
                >
                  PERSONNEL MATRIX
                </button>
              </div>
            </div>

            <div style={{ padding: '16px', flex: 1 }}>
              {activeTab === 'model' && (
                <DigitalMineTwin
                  nodes={nodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                />
              )}
              {activeTab === 'zones' && (
                <SpatialZones
                  nodes={nodes}
                  onSelectMiner={handleSelectMiner}
                />
              )}
              {activeTab === 'table' && (
                <PersonnelMatrix
                  nodes={nodes}
                  onSelectMiner={handleSelectMiner}
                />
              )}
            </div>
          </section>

          {/* Right Panel: Telemetry Chart & Audit Ledger */}
          <section style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(22, 31, 51, 0.6)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📈</span> Telemetry Trend &amp; Audit Log
              </div>
              <div>
                <select
                  className="form-input"
                  style={{ padding: '3px 8px', fontSize: '11px', width: 'auto' }}
                  value={selectedMinerId}
                  onChange={e => setSelectedMinerId(e.target.value)}
                >
                  {nodes.filter(n => n.role === 'WEARABLE').map(m => (
                    <option key={m.node_id} value={m.node_id}>
                      {m.node_id} ({m.current_zone})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ padding: '16px', flex: 1 }}>
              <TelemetryChart minerId={selectedMinerId} history={history} />
              <AuditFeed logs={auditLogs} />
            </div>
          </section>
        </div>
      </main>

      <AckModal
        isOpen={ackModalId !== null}
        alertId={ackModalId}
        onClose={() => setAckModalId(null)}
        onSubmit={handleAckSubmit}
      />

      <ResolveModal
        isOpen={resModalId !== null}
        alertId={resModalId}
        onClose={() => setResModalId(null)}
        onSubmit={handleResolveSubmit}
      />
    </div>
  );
};
