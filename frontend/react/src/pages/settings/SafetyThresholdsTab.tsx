import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Check,
  Cpu,
  Flame,
  Lock,
  Radio,
  Server,
  ShieldAlert,
  Sliders,
  UserCheck,
} from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { FormField, Input, Select } from '../../platform/form';
import { LoadingButton } from '../../platform/loading';

export interface SafetyThresholdsData {
  coWarningPpm: number;
  coCriticalPpm: number;
  dustWarningUgm3: number;
  dustCriticalUgm3: number;
  fallImpactG: number;
  immobilityTimeoutSec: number;
  sosLatchMode: 'SINGLE_PRESS' | 'HOLD_3_SECONDS';
  batteryLowVoltage: number;
  batteryBrownoutVoltage: number;
  alarmEscalationSec: number;
  requireInvestigationNotes: boolean;
}

const DEFAULT_SAFETY_THRESHOLDS: SafetyThresholdsData = {
  coWarningPpm: 25.0,
  coCriticalPpm: 50.0,
  dustWarningUgm3: 15.0,
  dustCriticalUgm3: 35.0,
  fallImpactG: 2.8,
  immobilityTimeoutSec: 60,
  sosLatchMode: 'HOLD_3_SECONDS',
  batteryLowVoltage: 3.35,
  batteryBrownoutVoltage: 3.00,
  alarmEscalationSec: 120,
  requireInvestigationNotes: true,
};

const STORAGE_KEY = 'compallette_safety_thresholds';

function loadThresholds(): SafetyThresholdsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SAFETY_THRESHOLDS, ...JSON.parse(raw) };
  } catch {
    // fallback
  }
  return DEFAULT_SAFETY_THRESHOLDS;
}

export function SafetyThresholdsTab({
  onDirtyChange,
}: {
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { can } = usePlatform();
  const hasSettingsPermission = can('manage_settings');

  const [initialData, setInitialData] = useState<SafetyThresholdsData>(loadThresholds);
  const [data, setData] = useState<SafetyThresholdsData>(initialData);
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
          <h2 className="settings-section-title">Safety &amp; Atmospheric Thresholds</h2>
          <p className="settings-section-desc">
            Toxic gas exposure limits, MPU6050 fall detection sensitivity, SOS latches, and automated escalation timers.
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
        {/* Atmospheric Gas Limits Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Flame size={18} className="card-icon" />
            <div>
              <h3>Atmospheric Gas Limits (Carbon Monoxide - CO)</h3>
              <p>Governs real-time sensor threshold triggers on miner wearable nodes and supervisory safety boards.</p>
            </div>
          </div>

          <div className="card-body">
            {/* Autonomous vs Cloud Badges */}
            <div className="settings-notice-banner info">
              <Cpu size={16} className="notice-icon" />
              <div>
                <strong>Autonomous ESP32 Firmware Execution</strong>
                <p>
                  These threshold values are broadcast to wearable ESP32 nodes over the sub-GHz mesh. The node executes local
                  piezo buzzer alarms and haptic vibration even if severed from gateway connectivity.
                </p>
              </div>
            </div>

            <div className="settings-slider-card">
              <div className="slider-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="severity-dot warning" />
                  <strong>Warning Threshold (CO ppm)</strong>
                </div>
                <span className="slider-value-badge">{data.coWarningPpm.toFixed(1)} ppm</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                step="0.5"
                value={data.coWarningPpm}
                onChange={(e) => setData(d => ({ ...d, coWarningPpm: Number(e.target.value) }))}
                disabled={!hasSettingsPermission}
                className="range-slider"
              />
              <span className="slider-hint">
                OSHA 8-hour Time Weighted Average (TWA) Permissible Exposure Limit: <strong>25.0 ppm</strong>
              </span>
            </div>

            <div className="settings-slider-card" style={{ marginTop: '14px' }}>
              <div className="slider-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="severity-dot critical" />
                  <strong>Critical / Evacuation Threshold (CO ppm)</strong>
                </div>
                <span className="slider-value-badge critical">{data.coCriticalPpm.toFixed(1)} ppm</span>
              </div>
              <input
                type="range"
                min="30"
                max="100"
                step="1.0"
                value={data.coCriticalPpm}
                onChange={(e) => setData(d => ({ ...d, coCriticalPpm: Number(e.target.value) }))}
                disabled={!hasSettingsPermission}
                className="range-slider critical"
              />
              <span className="slider-hint">
                MSHA Mine Safety Emergency Ceiling: <strong>50.0 ppm</strong> (Mandatory immediate stope evacuation)
              </span>
            </div>
          </div>
        </section>

        {/* Physical Safety & Biometrics Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Activity size={18} className="card-icon" />
            <div>
              <h3>Motion, Fall Detection &amp; SOS Latch</h3>
              <p>Calibrates on-body accelerometer algorithms and emergency distress latching mechanisms.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <div className="settings-slider-card">
                <div className="slider-header">
                  <strong>Impact Force Threshold (g-force)</strong>
                  <span className="slider-value-badge">{data.fallImpactG.toFixed(1)} g</span>
                </div>
                <input
                  type="range"
                  min="1.5"
                  max="5.0"
                  step="0.1"
                  value={data.fallImpactG}
                  onChange={(e) => setData(d => ({ ...d, fallImpactG: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  className="range-slider"
                />
                <span className="slider-hint">MPU6050 fall spike detection. Default: 2.8g (trips on abrupt drop impact)</span>
              </div>

              <div className="settings-slider-card">
                <div className="slider-header">
                  <strong>Stationary Immobility Timeout</strong>
                  <span className="slider-value-badge">{data.immobilityTimeoutSec}s</span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="180"
                  step="5"
                  value={data.immobilityTimeoutSec}
                  onChange={(e) => setData(d => ({ ...d, immobilityTimeoutSec: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  className="range-slider"
                />
                <span className="slider-hint">Man-down trigger: raises alert when no movement is detected post-fall.</span>
              </div>
            </div>

            <div className="settings-field-row" style={{ marginTop: '16px' }}>
              <label className="field-meta">
                <strong>SOS Panic Button Trigger Mode</strong>
                <span>Hardware tactile button trigger requirement on wearable miner badge nodes.</span>
              </label>
              <div className="segmented" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={data.sosLatchMode === 'SINGLE_PRESS' ? 'active' : ''}
                  onClick={() => setData(d => ({ ...d, sosLatchMode: 'SINGLE_PRESS' }))}
                  disabled={!hasSettingsPermission}
                >
                  Immediate Single-Press
                </button>
                <button
                  type="button"
                  className={data.sosLatchMode === 'HOLD_3_SECONDS' ? 'active' : ''}
                  onClick={() => setData(d => ({ ...d, sosLatchMode: 'HOLD_3_SECONDS' }))}
                  disabled={!hasSettingsPermission}
                >
                  Hold 3 Seconds (Anti-False-Positive)
                </button>
              </div>
            </div>

            <div className="settings-grid-2" style={{ marginTop: '14px' }}>
              <FormField label="Low Battery Warning Voltage" helperText="Triggers recharge reminder on supervisor HUD">
                <Select
                  value={data.batteryLowVoltage}
                  onChange={(e) => setData(d => ({ ...d, batteryLowVoltage: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 3.45, label: '3.45V (~25% remaining)' },
                    { value: 3.35, label: '3.35V (~15% remaining - Standard)' },
                    { value: 3.25, label: '3.25V (~8% remaining)' },
                  ]}
                />
              </FormField>

              <FormField label="Node Brownout Voltage" helperText="ESP32 deep sleep threshold to protect LiPo cells">
                <Select
                  value={data.batteryBrownoutVoltage}
                  onChange={(e) => setData(d => ({ ...d, batteryBrownoutVoltage: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 3.10, label: '3.10V (Conservative cutoff)' },
                    { value: 3.00, label: '3.00V (Standard LiPo safety cutoff)' },
                    { value: 2.90, label: '2.90V (Emergency minimum)' },
                  ]}
                />
              </FormField>
            </div>
          </div>
        </section>

        {/* Incident Escalation Rules Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <ShieldAlert size={18} className="card-icon" />
            <div>
              <h3>Incident Escalation &amp; Resolution Policy</h3>
              <p>Audit standards for dispatching supervisors and closing unresolved underground emergency alarms.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Unacknowledged Alarm Escalation Timer</strong>
                <span>Auto-dispatches sirens and secondary safety supervisor notifications if an alert goes unhandled.</span>
              </label>
              <FormField size="sm">
                <Select
                  value={data.alarmEscalationSec}
                  onChange={(e) => setData(d => ({ ...d, alarmEscalationSec: Number(e.target.value) }))}
                  disabled={!hasSettingsPermission}
                  options={[
                    { value: 60, label: '60 seconds (Urgent High-Risk Corridor)' },
                    { value: 120, label: '120 seconds (Standard Supervisory SLA)' },
                    { value: 300, label: '300 seconds (5 minutes)' },
                  ]}
                />
              </FormField>
            </div>

            <div className="settings-field-row" style={{ marginTop: '12px' }}>
              <label className="field-meta">
                <strong>Mandatory Investigation Notes</strong>
                <span>Enforces that operators must provide a documented resolution rationale before closing an alarm.</span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={data.requireInvestigationNotes}
                  onChange={(e) => setData(d => ({ ...d, requireInvestigationNotes: e.target.checked }))}
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
            <Check size={14} /> Safety thresholds and escalation rules updated.
          </span>
        )}
        <LoadingButton
          className="button primary"
          onClick={handleSave}
          isLoading={isSaving}
          disabled={!isDirty || !hasSettingsPermission}
        >
          Save Safety Thresholds
        </LoadingButton>
      </div>
    </div>
  );
}
