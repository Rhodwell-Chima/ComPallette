import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { EmergencyBanner } from './components/EmergencyBanner';
import { KpiMetrics } from './components/KpiMetrics';
import { DigitalMineTwin } from './components/DigitalMineTwin';
import { SpatialZones } from './components/SpatialZones';
import { PersonnelMatrix } from './components/PersonnelMatrix';
import { TelemetryChart } from './components/TelemetryChart';
import { AuditFeed } from './components/AuditFeed';
import { MinerDetailsDrawer } from './components/MinerDetailsDrawer';
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
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [history, setHistory] = useState<TelemetryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'model' | 'table' | 'zones'>('model');
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

  // Handle miner selection from any component
  const handleSelectMiner = (nodeId: string) => {
    setSelectedMinerId(nodeId);
  };

  const handleOpenDrawer = (nodeId: string) => {
    setSelectedMinerId(nodeId);
    setIsDrawerOpen(true);
  };

  const handleLocateOnMap = (minerId: string) => {
    setSelectedMinerId(minerId);
    setActiveTab('model');
    setIsDrawerOpen(false);
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
    <div className="scada-app-layout">
      {/* SCADA Global Header */}
      <Header
        isGatewayOnline={isGatewayOnline}
        audioArmed={audioArmed}
        onToggleAudio={() => setAudioArmed(prev => !prev)}
        onRefresh={loadData}
      />

      {/* Emergency Alarm Banner */}
      <EmergencyBanner
        alerts={alerts}
        audioArmed={audioArmed}
        onOpenAck={id => setAckModalId(id)}
        onOpenResolve={id => setResModalId(id)}
      />

      {/* Main SCADA Command Body */}
      <main className="scada-main-container">
        {/* KPI Telemetry Header Grid */}
        <KpiMetrics summary={summary} />

        {/* Core Tactical Workspaces Grid */}
        <div className="scada-cockpit-grid">
          {/* Left / Center Major Panel: Tracking & Simulation */}
          <section className="scada-panel scada-tracking-panel">
            {/* Tabbed Navigation Bar */}
            <div className="scada-panel-header">
              <div className="panel-title-group">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="22" />
                </svg>
                <span className="panel-title-text">SUBTERRANEAN PERSONNEL TRACKING</span>
              </div>

              {/* View Selector Tabs */}
              <div className="scada-tab-group">
                <button
                  className={`scada-tab-btn ${activeTab === 'model' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('model')}
                >
                  <span className="tab-indicator" />
                  <span>2.5D DIGITAL TWIN</span>
                </button>
                <button
                  className={`scada-tab-btn ${activeTab === 'table' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('table')}
                >
                  <span className="tab-indicator" />
                  <span>PERSONNEL ROSTER</span>
                </button>
                <button
                  className={`scada-tab-btn ${activeTab === 'zones' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('zones')}
                >
                  <span className="tab-indicator" />
                  <span>ZONE CLUSTERS</span>
                </button>
              </div>
            </div>

            {/* Tab Body View */}
            <div className="scada-panel-content">
              {activeTab === 'model' && (
                <DigitalMineTwin
                  nodes={nodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
              {activeTab === 'table' && (
                <PersonnelMatrix
                  nodes={nodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
              {activeTab === 'zones' && (
                <SpatialZones
                  nodes={nodes}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
            </div>
          </section>

          {/* Right Panel: Selected Miner Telemetry & Live Incident Ledger */}
          <section className="scada-panel scada-sidebar-panel">
            <div className="scada-panel-header">
              <div className="panel-title-group">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span className="panel-title-text">TELEMETRY &amp; AUDIT FEED</span>
              </div>

              {/* Miner Selector Dropdown with Quick Inspect Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  className="scada-select"
                  value={selectedMinerId}
                  onChange={e => handleSelectMiner(e.target.value)}
                >
                  {nodes.filter(n => n.role === 'WEARABLE').map(m => (
                    <option key={m.node_id} value={m.node_id}>
                      {m.node_id} ({m.current_zone || 'TRANSIT'})
                    </option>
                  ))}
                </select>

                <button
                  className="scada-quick-btn"
                  onClick={() => setIsDrawerOpen(true)}
                  title="Open miner dossier"
                >
                  DOSSIER ↗
                </button>
              </div>
            </div>

            <div className="scada-panel-content">
              <TelemetryChart minerId={selectedMinerId} history={history} />
              <AuditFeed logs={auditLogs} />
            </div>
          </section>
        </div>
      </main>

      {/* Individual Miner Detailed Inspector Drawer */}
      <MinerDetailsDrawer
        isOpen={isDrawerOpen}
        minerId={selectedMinerId}
        nodes={nodes}
        alerts={alerts}
        history={history}
        onClose={() => setIsDrawerOpen(false)}
        onLocateOnMap={handleLocateOnMap}
        onOpenAck={id => setAckModalId(id)}
      />

      {/* Incident Workflow Modals */}
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
