import { useState, useEffect } from 'react';
import {
  Activity,
  Check,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Lock,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Wifi,
  Zap,
} from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { FormField, Input, Select } from '../../platform/form';
import { LoadingButton } from '../../platform/loading';

export interface MeshNetworkData {
  meshPrefix: string;
  meshChannel: number;
  meshPort: number;
  beaconCadenceMs: number;
  telemetryIntervalMs: number;
  staleTimeoutSec: number;
  offlineTimeoutSec: number;
  gatewayTransportMode: 'MQTT_TLS' | 'HTTP_REST_FALLBACK';
  priorityReplayEnabled: boolean;
  maxBufferFrames: number;
}

const DEFAULT_MESH_CONFIG: MeshNetworkData = {
  meshPrefix: 'MineMesh_Zambia',
  meshChannel: 11,
  meshPort: 5555,
  beaconCadenceMs: 500,
  telemetryIntervalMs: 1000,
  staleTimeoutSec: 20,
  offlineTimeoutSec: 45,
  gatewayTransportMode: 'MQTT_TLS',
  priorityReplayEnabled: true,
  maxBufferFrames: 4096,
};

const STORAGE_KEY = 'compallette_mesh_gateway_config';

function loadMeshConfig(): MeshNetworkData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_MESH_CONFIG, ...JSON.parse(raw) };
  } catch {
    // fallback
  }
  return DEFAULT_MESH_CONFIG;
}

export function NetworkGatewayTab({
  onDirtyChange,
}: {
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { can } = usePlatform();
  const hasSettingsPermission = can('manage_settings');

  const [initialData, setInitialData] = useState<MeshNetworkData>(loadMeshConfig);
  const [data, setData] = useState<MeshNetworkData>(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isDirty = JSON.stringify(data) !== JSON.stringify(initialData);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleSave = () => {
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setInitialData(data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-tab-content">
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Mesh Network &amp; Gateway Infrastructure</h2>
          <p className="settings-section-desc">
            Subterranean painlessMesh radio parameters, gateway store-and-forward flash buffer policies, and node heartbeat watchdogs.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!hasSettingsPermission && (
            <span className="status-pill warning" style={{ display: 'inline-flex', gap: '4px' }}>
              <Lock size={12} /> Read-Only Mode
            </span>
          )}
          {isDirty && <span className="status-pill warning">Unsaved Changes</span>}
        </div>
      </div>

      <div className="settings-cards-grid">
        {/* Mesh Radio Parameters Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Radio size={18} className="card-icon" />
            <div>
              <h3>ESP-MESH Sub-GHz / Wi-Fi Topology</h3>
              <p>Radio parameters shared between mobile miner wearables, stationary anchors, and root gateways.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <FormField label="Mesh SSID / Network Prefix" helperText="Cryptographic network domain name for ESP-NOW/painlessMesh">
                <Input
                  value={data.meshPrefix}
                  onChange={(e) => setData(d => ({ ...d, meshPrefix: e.target.value }))}
                  disabled={!hasSettingsPermission}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormField>

              <FormField label="RF Channel (2.4 GHz Band)" helperText="Isolated industrial channel to prevent interference with mine Wi-Fi">
                <Select
                  value={data.meshChannel}
                  onChange={(e) => setData(d => ({ ...d, meshChannel: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 1, label: 'Channel 1 (2.412 GHz)' },
                    { value: 6, label: 'Channel 6 (2.437 GHz)' },
                    { value: 11, label: 'Channel 11 (2.462 GHz - Industrial Default)' },
                    { value: 13, label: 'Channel 13 (2.472 GHz)' },
                  ]}
                />
              </FormField>

              <FormField label="Mesh TCP/UDP Socket Port" helperText="Inter-node mesh framing port">
                <Input
                  type="number"
                  value={data.meshPort}
                  onChange={(e) => setData(d => ({ ...d, meshPort: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  style={{ fontFamily: 'monospace' }}
                />
              </FormField>

              <FormField label="Anchor Beacon Broadcast Cadence" helperText="Distance beacon transmission rate from stationary anchors">
                <Select
                  value={data.beaconCadenceMs}
                  onChange={(e) => setData(d => ({ ...d, beaconCadenceMs: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 250, label: '250 ms (Ultra High Density Spatial Tracking)' },
                    { value: 500, label: '500 ms (Standard Industrial Default)' },
                    { value: 1000, label: '1,000 ms (Low Power Operation)' },
                    { value: 2000, label: '2,000 ms (Long-Range Standby)' },
                  ]}
                />
              </FormField>
            </div>
          </div>
        </section>

        {/* Watchdog Timers Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Clock size={18} className="card-icon" />
            <div>
              <h3>Node Watchdog &amp; Health Timers</h3>
              <p>Configures timeouts before a non-reporting node is flagged as stale or severed from connectivity.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <div className="settings-slider-card">
                <div className="slider-header">
                  <strong>Stale Heartbeat Threshold (T_stale)</strong>
                  <span className="slider-value-badge">{data.staleTimeoutSec}s</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="60"
                  step="5"
                  value={data.staleTimeoutSec}
                  onChange={(e) => setData(d => ({ ...d, staleTimeoutSec: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  className="range-slider"
                />
                <span className="slider-hint">Marks device status as STALE when packets cease (Amber indicator).</span>
              </div>

              <div className="settings-slider-card">
                <div className="slider-header">
                  <strong>Severed Connection Timeout (T_offline)</strong>
                  <span className="slider-value-badge critical">{data.offlineTimeoutSec}s</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="180"
                  step="5"
                  value={data.offlineTimeoutSec}
                  onChange={(e) => setData(d => ({ ...d, offlineTimeoutSec: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  className="range-slider critical"
                />
                <span className="slider-hint">Triggers communication-loss alarm and marks device OFFLINE (Red indicator).</span>
              </div>
            </div>
          </div>
        </section>

        {/* Store-and-Forward / Buffer Policies Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <HardDrive size={18} className="card-icon" />
            <div>
              <h3>Gateway Store-and-Forward Buffer Policies</h3>
              <p>SPI Flash telemetry buffering on root gateways during WAN fiber or cellular backhaul outages.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <FormField label="Gateway Uplink Transport Mode" helperText="Primary telemetry ingress tunnel to Django / Daphne cluster">
                <Select
                  value={data.gatewayTransportMode}
                  onChange={(e) => setData(d => ({ ...d, gatewayTransportMode: e.target.value as any }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 'MQTT_TLS', label: 'MQTT over TLS (Port 8883 - High Throughput)' },
                    { value: 'HTTP_REST_FALLBACK', label: 'HTTP/REST JSON Batch Ingestion (Fallback Mode)' },
                  ]}
                />
              </FormField>

              <FormField label="Maximum Flash Buffer Capacity" helperText="Hardware non-volatile circular buffer space on ESP32 gateway">
                <Select
                  value={data.maxBufferFrames}
                  onChange={(e) => setData(d => ({ ...d, maxBufferFrames: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 2048, label: '2,048 frames (~256 KB Flash)' },
                    { value: 4096, label: '4,096 frames (~512 KB Flash - Standard)' },
                    { value: 8192, label: '8,192 frames (~1 MB Extended Flash)' },
                  ]}
                />
              </FormField>
            </div>

            <div className="settings-field-row" style={{ marginTop: '14px' }}>
              <label className="field-meta">
                <strong>Emergency Priority Burst Replay</strong>
                <span>
                  When connectivity is restored, gateways burst safety alert frames ahead of routine environmental gas logs.
                </span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={data.priorityReplayEnabled}
                  onChange={(e) => setData(d => ({ ...d, priorityReplayEnabled: e.target.checked }))}
                  disabled={!hasSettingsPermission}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </section>
      </div>

      {/* Save Action Footer */}
      <div className="settings-action-bar">
        {saveSuccess && (
          <span className="save-feedback-message">
            <Check size={14} /> Mesh network parameters and gateway watchdog configuration updated.
          </span>
        )}
        <LoadingButton
          className="button primary"
          onClick={handleSave}
          isLoading={isSaving}
          disabled={!isDirty || !hasSettingsPermission}
        >
          Save Network Configuration
        </LoadingButton>
      </div>
    </div>
  );
}
