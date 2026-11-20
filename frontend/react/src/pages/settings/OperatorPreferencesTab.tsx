import { useState, useEffect } from 'react';
import {
  Bell,
  Check,
  Eye,
  Gauge,
  Moon,
  RefreshCw,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { FormField, Select } from '../../platform/form';
import { LoadingButton } from '../../platform/loading';
import { playSyntheticAlertSound } from './audio';

export interface WorkstationPrefs {
  themeMode: 'light' | 'dark' | 'high-contrast';
  density: 'compact' | 'comfortable';
  reducedMotion: boolean;
  alertChimeEnabled: boolean;
  alertVolume: number;
  alertRepeatInterval: number;
  telemetryRefreshRate: number;
}

const STORAGE_KEY = 'compallette_workstation_prefs';

function loadStoredPrefs(currentTheme: 'light' | 'dark'): WorkstationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        themeMode: parsed.themeMode ?? currentTheme,
        density: parsed.density ?? 'comfortable',
        reducedMotion: parsed.reducedMotion ?? false,
        alertChimeEnabled: parsed.alertChimeEnabled ?? true,
        alertVolume: parsed.alertVolume ?? 0.7,
        alertRepeatInterval: parsed.alertRepeatInterval ?? 30,
        telemetryRefreshRate: parsed.telemetryRefreshRate ?? 15,
      };
    }
  } catch {
    // fallback below
  }
  return {
    themeMode: currentTheme,
    density: 'comfortable',
    reducedMotion: false,
    alertChimeEnabled: true,
    alertVolume: 0.7,
    alertRepeatInterval: 30,
    telemetryRefreshRate: 15,
  };
}

export function OperatorPreferencesTab({
  onDirtyChange,
}: {
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { theme, toggleTheme } = usePlatform();
  const [initialPrefs, setInitialPrefs] = useState<WorkstationPrefs>(() => loadStoredPrefs(theme));
  const [prefs, setPrefs] = useState<WorkstationPrefs>(initialPrefs);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Check dirty state
  const isDirty = JSON.stringify(prefs) !== JSON.stringify(initialPrefs);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleSave = () => {
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      // Sync theme with PlatformContext if user changed it in tab
      if (prefs.themeMode !== 'high-contrast' && prefs.themeMode !== theme) {
        toggleTheme();
      }
      setInitialPrefs(prefs);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestAudio = () => {
    playSyntheticAlertSound(prefs.alertVolume);
  };

  return (
    <div className="settings-tab-content">
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Workstation Preferences</h2>
          <p className="settings-section-desc">
            Local control-room terminal display settings, emergency audio chimes, and live polling cadence.
          </p>
        </div>
        {isDirty && <span className="status-pill warning">Unsaved Changes</span>}
      </div>

      <div className="settings-cards-grid">
        {/* Visual & Ergonomics Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Eye size={18} className="card-icon" />
            <div>
              <h3>Display & Ergonomics</h3>
              <p>Tailor the cockpit interface for high-ambient daylight or darkened subterranean control rooms.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Color Theme</strong>
                <span>Controls surface luminosity and data contrast across all pages.</span>
              </label>
              <div className="segmented" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={prefs.themeMode === 'light' ? 'active' : ''}
                  onClick={() => setPrefs(p => ({ ...p, themeMode: 'light' }))}
                >
                  <Sun size={14} /> Light
                </button>
                <button
                  type="button"
                  className={prefs.themeMode === 'dark' ? 'active' : ''}
                  onClick={() => setPrefs(p => ({ ...p, themeMode: 'dark' }))}
                >
                  <Moon size={14} /> Dark
                </button>
                <button
                  type="button"
                  className={prefs.themeMode === 'high-contrast' ? 'active' : ''}
                  onClick={() => setPrefs(p => ({ ...p, themeMode: 'high-contrast' }))}
                >
                  High Contrast
                </button>
              </div>
            </div>

            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Information Density</strong>
                <span>Compact mode compresses table row heights and increases data density for multi-monitor setups.</span>
              </label>
              <div className="segmented" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={prefs.density === 'comfortable' ? 'active' : ''}
                  onClick={() => setPrefs(p => ({ ...p, density: 'comfortable' }))}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  className={prefs.density === 'compact' ? 'active' : ''}
                  onClick={() => setPrefs(p => ({ ...p, density: 'compact' }))}
                >
                  Compact
                </button>
              </div>
            </div>

            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Reduced Motion</strong>
                <span>Disables smooth 3D camera sweeps and fluid graph animations for legacy terminal hardware.</span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={prefs.reducedMotion}
                  onChange={(e) => setPrefs(p => ({ ...p, reducedMotion: e.target.checked }))}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </section>

        {/* Audio & Alarm Acoustics Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Volume2 size={18} className="card-icon" />
            <div>
              <h3>Acoustic Alarms & Chimes</h3>
              <p>Audible alerts generated locally via the Web Audio API for unacknowledged critical emergencies.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Emergency Alert Chime</strong>
                <span>Plays a high-priority synthetic safety buzzer when critical gas or SOS events occur.</span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={prefs.alertChimeEnabled}
                  onChange={(e) => setPrefs(p => ({ ...p, alertChimeEnabled: e.target.checked }))}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Buzzer Volume ({Math.round(prefs.alertVolume * 100)}%)</strong>
                <span>Terminal speaker output level for synthesized audio events.</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '220px' }}>
                <VolumeX size={15} className="muted" />
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={prefs.alertVolume}
                  onChange={(e) => setPrefs(p => ({ ...p, alertVolume: Number(e.target.value) }))}
                  disabled={!prefs.alertChimeEnabled}
                  style={{ flex: 1 }}
                />
                <Volume2 size={15} className="muted" />
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleTestAudio}
                  disabled={!prefs.alertChimeEnabled}
                  style={{ padding: '5px 9px', fontSize: '0.74rem' }}
                >
                  Test Sound
                </button>
              </div>
            </div>

            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Alarm Repeat Cadence</strong>
                <span>Repeats the acoustic chime until an on-duty operator acknowledges or assigns the incident.</span>
              </label>
              <FormField size="sm">
                <Select
                  value={prefs.alertRepeatInterval}
                  onChange={(e) => setPrefs(p => ({ ...p, alertRepeatInterval: Number(e.target.value) }))}
                  disabled={!prefs.alertChimeEnabled}
                  options={[
                    { value: 15, label: 'Every 15 seconds' },
                    { value: 30, label: 'Every 30 seconds (Standard)' },
                    { value: 60, label: 'Every 60 seconds' },
                    { value: 120, label: 'Every 2 minutes' },
                  ]}
                />
              </FormField>
            </div>
          </div>
        </section>

        {/* Polling & Telemetry Cadence */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Gauge size={18} className="card-icon" />
            <div>
              <h3>Telemetry Polling Cadence</h3>
              <p>Configure background synchronization frequency between control-room browsers and gateway nodes.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-field-row">
              <label className="field-meta">
                <strong>Live Refresh Interval</strong>
                <span>Frequency of background React Query polling for dashboard metrics, twin locations, and readings.</span>
              </label>
              <FormField size="sm">
                <Select
                  value={prefs.telemetryRefreshRate}
                  onChange={(e) => setPrefs(p => ({ ...p, telemetryRefreshRate: Number(e.target.value) }))}
                  options={[
                    { value: 5, label: '5 seconds (High Frequency / Incident Mode)' },
                    { value: 10, label: '10 seconds (Active Shift Monitoring)' },
                    { value: 15, label: '15 seconds (Standard Operational Default)' },
                    { value: 30, label: '30 seconds (Network Conserving)' },
                    { value: 0, label: 'Manual Refresh Only' },
                  ]}
                />
              </FormField>
            </div>
          </div>
        </section>
      </div>

      {/* Save Action Footer */}
      <div className="settings-action-bar">
        {saveSuccess && (
          <span className="save-feedback-message">
            <Check size={14} /> Workstation preferences saved successfully.
          </span>
        )}
        <LoadingButton
          className="button primary"
          onClick={handleSave}
          isLoading={isSaving}
          disabled={!isDirty}
        >
          Save Preferences
        </LoadingButton>
      </div>
    </div>
  );
}
