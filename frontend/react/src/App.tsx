import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { EmergencyBanner } from './components/EmergencyBanner';
import { KpiMetrics } from './components/KpiMetrics';
import { DigitalMineTwin } from './components/DigitalMineTwin';
import { MineSpatial3D } from './components/MineSpatial3D';
import { SpatialZones } from './components/SpatialZones';
import { PersonnelMatrix } from './components/PersonnelMatrix';
import { TelemetryChart } from './components/TelemetryChart';
import { AuditFeed } from './components/AuditFeed';
import { MinerDetailsDrawer } from './components/MinerDetailsDrawer';
import { AckModal, ResolveModal } from './components/Modals';
import { ProvisioningModal } from './components/ProvisioningModal';
import {
  fetchSummary,
  fetchNodes,
  fetchAlerts,
  fetchNodeHistory,
  fetchAudit,
  fetchPendingProvisioning,
  acknowledgeAlert,
  resolveAlert,
  assignNodeProvisioning,
} from './services/api';
import { SystemSummary, NodeItem, AlertItem, TelemetryItem, AuditItem, ProvisioningRequest } from './types';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('compallette-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [summary, setSummary] = useState<SystemSummary | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [selectedMinerId, setSelectedMinerId] = useState<string>('MINER-106');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [history, setHistory] = useState<TelemetryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'model' | '3d' | 'table' | 'zones'>('model');
  const [audioArmed, setAudioArmed] = useState<boolean>(true);
  const [ackModalId, setAckModalId] = useState<number | null>(null);
  const [resModalId, setResModalId] = useState<number | null>(null);
  const [pendingNodes, setPendingNodes] = useState<ProvisioningRequest[]>([]);
  const [isProvModalOpen, setIsProvModalOpen] = useState(false);
  const [nodeActivityFilter, setNodeActivityFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('compallette-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const isGatewayOnline = Boolean(
    summary?.last_packet_received_ms &&
    (Date.now() - summary.last_packet_received_ms) < 15000
  );

  const loadData = useCallback(async () => {
    try {
      const [sumData, nodesData, alertsData, auditData, provData] = await Promise.all([
        fetchSummary().catch(() => null),
        fetchNodes().catch(() => []),
        fetchAlerts().catch(() => []),
        fetchAudit().catch(() => []),
        fetchPendingProvisioning().catch(() => []),
      ]);

      if (sumData) setSummary(sumData);
      if (provData) setPendingNodes(provData);
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

  const handleOpenDrawer = (nodeId: string) => {
    setSelectedMinerId(nodeId);
    setIsDrawerOpen(true);
  };

  const handleLocateOnMap = (minerId: string) => {
    setSelectedMinerId(minerId);
    if (activeTab !== 'model' && activeTab !== '3d') {
      setActiveTab('3d');
    }
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

  const handleAssignNode = async (
    chipId: string,
    deviceId: string,
    role: string,
    zoneId: string,
    officerName: string
  ) => {
    await assignNodeProvisioning(chipId, deviceId, role, zoneId, officerName);
    loadData();
  };

  const activeCount = nodes.filter(n => n.status === 'ONLINE').length;
  const inactiveCount = nodes.filter(n => n.status !== 'ONLINE').length;

  const displayedNodes = React.useMemo(() => {
    if (nodeActivityFilter === 'ACTIVE') {
      return nodes.filter(n => n.status === 'ONLINE');
    }
    if (nodeActivityFilter === 'INACTIVE') {
      return nodes.filter(n => n.status !== 'ONLINE');
    }
    return nodes;
  }, [nodes, nodeActivityFilter]);

  return (
    <div className="app-layout">
      {/* Global Header */}
      <Header
        isGatewayOnline={isGatewayOnline}
        audioArmed={audioArmed}
        theme={theme}
        pendingProvisioningCount={pendingNodes.length}
        onOpenProvisioning={() => setIsProvModalOpen(true)}
        onToggleTheme={toggleTheme}
        onToggleAudio={() => setAudioArmed(prev => !prev)}
        onRefresh={loadData}
      />

      {/* Emergency Banner */}
      <EmergencyBanner
        alerts={alerts}
        audioArmed={audioArmed}
        onOpenAck={id => setAckModalId(id)}
        onOpenResolve={id => setResModalId(id)}
      />

      {/* Main Content */}
      <main className="main-content">
        {/* KPI Metrics */}
        <KpiMetrics summary={summary} />

        {/* Main Workspace Grid */}
        <div className="main-grid">
          {/* Main Visual/Tracking Panel */}
          <section className="panel">
            <div className="panel-header" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div className="panel-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="22" />
                </svg>
                <span>Personnel Tracking</span>
              </div>

              {/* Status Filter: All / Active / Inactive */}
              <div className="filter-pills" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  className={`filter-pill ${nodeActivityFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setNodeActivityFilter('ALL')}
                  title="Show all registered nodes in system"
                >
                  All ({nodes.length})
                </button>
                <button
                  className={`filter-pill ${nodeActivityFilter === 'ACTIVE' ? 'active' : ''}`}
                  onClick={() => setNodeActivityFilter('ACTIVE')}
                  title="Show only currently active/online nodes"
                >
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--safe)', marginRight: 5 }} />
                  Active ({activeCount})
                </button>
                <button
                  className={`filter-pill ${nodeActivityFilter === 'INACTIVE' ? 'active' : ''}`}
                  onClick={() => setNodeActivityFilter('INACTIVE')}
                  title="Show inactive / offline / stale nodes"
                >
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)', marginRight: 5 }} />
                  Inactive ({inactiveCount})
                </button>
              </div>

              {/* View Selector Tabs */}
              <div className="tab-bar">
                <button
                  className={`tab-btn ${activeTab === 'model' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('model')}
                >
                  2.5D Twin
                </button>
                <button
                  className={`tab-btn ${activeTab === '3d' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('3d')}
                >
                  3D View
                </button>
                <button
                  className={`tab-btn ${activeTab === 'table' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('table')}
                >
                  Roster
                </button>
                <button
                  className={`tab-btn ${activeTab === 'zones' ? 'tab-active' : ''}`}
                  onClick={() => setActiveTab('zones')}
                >
                  Zones
                </button>
              </div>
            </div>

            <div className="panel-body">
              {activeTab === 'model' && (
                <DigitalMineTwin
                  nodes={displayedNodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
              {activeTab === '3d' && (
                <MineSpatial3D
                  nodes={displayedNodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                  theme={theme}
                />
              )}
              {activeTab === 'table' && (
                <PersonnelMatrix
                  nodes={displayedNodes}
                  selectedMinerId={selectedMinerId}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
              {activeTab === 'zones' && (
                <SpatialZones
                  nodes={displayedNodes}
                  onSelectMiner={handleSelectMiner}
                  onOpenDrawer={handleOpenDrawer}
                />
              )}
            </div>
          </section>

          {/* Sidebar Panel: Selected Miner Telemetry & Audit Feed */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span>Telemetry &amp; Audit</span>
              </div>

              {/* Miner Selector & Details Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  className="select"
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
                  className="btn btn-primary btn-sm"
                  onClick={() => setIsDrawerOpen(true)}
                  title="View detailed miner info"
                >
                  Details ↗
                </button>
              </div>
            </div>

            <div className="panel-body">
              <TelemetryChart minerId={selectedMinerId} history={history} />
              <AuditFeed logs={auditLogs} />
            </div>
          </section>
        </div>
      </main>

      {/* Individual Miner Details Drawer */}
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

      {/* Dynamic Node Provisioning Modal (Option 1: OTA Mesh Enrollment) */}
      <ProvisioningModal
        isOpen={isProvModalOpen}
        pendingNodes={pendingNodes}
        onClose={() => setIsProvModalOpen(false)}
        onAssign={handleAssignNode}
      />
    </div>
  );
};
