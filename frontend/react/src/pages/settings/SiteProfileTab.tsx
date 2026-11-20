import { useState, useEffect } from 'react';
import {
  Building2,
  Calendar,
  Check,
  Clock,
  Compass,
  Globe,
  Layers,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../../platform/PlatformContext';
import { platformApi } from '../../services/api';
import { FormField, Input, Select } from '../../platform/form';
import { LoadingButton } from '../../platform/loading';
import { StatusPill } from '../../platform/ui';

const INDUSTRY_PRESETS: Record<string, { label: string; terms: string[] }> = {
  'Deep Underground Hard-Rock Mine': {
    label: 'Deep Underground Hard-Rock Mine',
    terms: ['Extraction Stopes', 'Decline Ramps', 'Headframe Hoists', 'Ventilation Shafts', 'Horizons'],
  },
  'Open-Pit Extraction & Processing': {
    label: 'Open-Pit Extraction & Processing',
    terms: ['Pit Benches', 'Haul Roads', 'Crusher Station', 'Tailings Facility', 'Stockpiles'],
  },
  'Confined Space Tunnels & Subterranean Rail': {
    label: 'Confined Space Tunnels & Subterranean Rail',
    terms: ['Bore Portals', 'Cross-Passages', 'Vent Plenums', 'Track Sections', 'Evacuation Chambers'],
  },
  'Industrial Smelter & Chemical Refining': {
    label: 'Industrial Smelter & Chemical Refining',
    terms: ['Furnace Hall', 'Electrolysis Bay', 'Converter Floor', 'Acid Plant', 'Gas Scrubbers'],
  },
};

const COMMON_TIMEZONES = [
  { value: 'Africa/Lusaka', label: 'Africa/Lusaka (CAT, UTC+2 - Zambia Central)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST, UTC+2)' },
  { value: 'UTC', label: 'UTC (Universal Coordinated Time)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST, UTC+8 - Pilbara Mining)' },
  { value: 'America/Denver', label: 'America/Denver (MST, UTC-7)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST, UTC-5)' },
  { value: 'America/Santiago', label: 'America/Santiago (CLT, UTC-4 - Atacama Mining)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
];

export function SiteProfileTab({
  onDirtyChange,
}: {
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const { selectedSite, can } = usePlatform();
  const queryClient = useQueryClient();
  const hasSitePermission = can('manage_sites');

  // Form State
  const [siteName, setSiteName] = useState(selectedSite?.name ?? '');
  const [industry, setIndustry] = useState(selectedSite?.industry ?? 'Deep Underground Hard-Rock Mine');
  const [timezone, setTimezone] = useState(selectedSite?.timezone ?? 'Africa/Lusaka');
  const [operationalStatus, setOperationalStatus] = useState<'ACTIVE' | 'STANDBY' | 'MAINTENANCE'>(
    selectedSite?.active ? 'ACTIVE' : 'STANDBY'
  );
  const [units, setUnits] = useState<'METRIC' | 'IMPERIAL'>('METRIC');

  // Shift Schedule state
  const [shiftDay, setShiftDay] = useState('06:00 - 14:00');
  const [shiftAfternoon, setShiftAfternoon] = useState('14:00 - 22:00');
  const [shiftNight, setShiftNight] = useState('22:00 - 06:00');

  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync with selected site changes
  useEffect(() => {
    if (selectedSite) {
      setSiteName(selectedSite.name);
      setIndustry(selectedSite.industry || 'Deep Underground Hard-Rock Mine');
      setTimezone(selectedSite.timezone || 'Africa/Lusaka');
      setOperationalStatus(selectedSite.active ? 'ACTIVE' : 'STANDBY');
    }
  }, [selectedSite]);

  // Check dirty state against selectedSite
  const isDirty = Boolean(
    selectedSite &&
      (siteName !== selectedSite.name ||
        industry !== selectedSite.industry ||
        timezone !== selectedSite.timezone ||
        (operationalStatus === 'ACTIVE') !== selectedSite.active)
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!selectedSite) throw new Error('No site selected');
      return platformApi.updateSite(selectedSite.id, {
        name: siteName,
        industry,
        timezone,
        active: operationalStatus === 'ACTIVE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-bootstrap'] });
      void queryClient.invalidateQueries({ queryKey: ['sites'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const selectedPreset = INDUSTRY_PRESETS[industry] || INDUSTRY_PRESETS['Deep Underground Hard-Rock Mine'];

  return (
    <div className="settings-tab-content">
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">Site Profile &amp; Localization</h2>
          <p className="settings-section-desc">
            Primary site identity, industry geometry presets, operating shifts, and localization parameters.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!hasSitePermission && (
            <span className="status-pill warning" style={{ display: 'inline-flex', gap: '4px' }}>
              <Lock size={12} /> Read-Only Mode
            </span>
          )}
          {isDirty && <span className="status-pill warning">Unsaved Changes</span>}
        </div>
      </div>

      <div className="settings-cards-grid">
        {/* Site Identity Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Building2 size={18} className="card-icon" />
            <div>
              <h3>Site Identity &amp; State</h3>
              <p>Top-level enterprise ownership and persistent facility identification.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <FormField label="Parent Organization" helperText="Governed by parent enterprise tenancy">
                <Input value={selectedSite?.organisation_name ?? 'Mining Enterprise Tenancy'} disabled readOnly />
              </FormField>

              <FormField label="Site Code (Immutable Identifier)" helperText="Unique hardware telemetry routing prefix">
                <Input value={selectedSite?.code ?? 'SITE-01'} disabled readOnly style={{ fontFamily: 'monospace' }} />
              </FormField>

              <FormField label="Display Name" required helperText="Human-readable site title displayed on consoles">
                <Input
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  disabled={!hasSitePermission}
                  placeholder="e.g. Copperbelt Horizon Alpha"
                />
              </FormField>

              <FormField label="Operational State" helperText="Determines whether alerts actively dispatch to telemetry queues">
                <Select
                  value={operationalStatus}
                  onChange={(e) => setOperationalStatus(e.target.value as any)}
                  disabled={!hasSitePermission}
                  options={[
                    { value: 'ACTIVE', label: 'Active (Full Real-Time Telemetry & Dispatch)' },
                    { value: 'STANDBY', label: 'Standby (Passive Logging / Non-Production)' },
                    { value: 'MAINTENANCE', label: 'Maintenance (Alarms Suppressed for Testing)' },
                  ]}
                />
              </FormField>
            </div>
          </div>
        </section>

        {/* Industry Taxonomy & Spatial Presets */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Layers size={18} className="card-icon" />
            <div>
              <h3>Industry Preset &amp; Spatial Taxonomy</h3>
              <p>Maps spatial terminology, coordinate geometries, and entity models to your industry sector.</p>
            </div>
          </div>

          <div className="card-body">
            <FormField label="Operating Environment Preset">
              <Select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={!hasSitePermission}
                options={Object.keys(INDUSTRY_PRESETS).map((key) => ({
                  value: key,
                  label: INDUSTRY_PRESETS[key].label,
                }))}
              />
            </FormField>

            <div className="settings-field-row" style={{ marginTop: '12px', alignItems: 'flex-start' }}>
              <label className="field-meta">
                <strong>Active Taxonomy Vocabulary</strong>
                <span>Spatial labels automatically assigned to Digital Twin chambers and registry tags.</span>
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '340px' }}>
                {selectedPreset.terms.map((term) => (
                  <span key={term} className="status-pill info">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Localization & Shift Roster Card */}
        <section className="settings-panel-card">
          <div className="card-header">
            <Globe size={18} className="card-icon" />
            <div>
              <h3>Localization &amp; Shift Schedule</h3>
              <p>Timezone alignment and automated shift window segmentation for safety reports.</p>
            </div>
          </div>

          <div className="card-body">
            <div className="settings-grid-2">
              <FormField label="Site Timezone (IANA)" helperText="All timestamps, logs, and audit entries are anchored to this clock">
                <Select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!hasSitePermission}
                  options={COMMON_TIMEZONES}
                />
              </FormField>

              <FormField label="Units of Measurement" helperText="Gas concentrations, temperature, distance, and pressure">
                <div className="segmented" style={{ margin: 0, height: '40px' }}>
                  <button
                    type="button"
                    className={units === 'METRIC' ? 'active' : ''}
                    onClick={() => setUnits('METRIC')}
                  >
                    Metric (°C, m, ppm, μg/m³)
                  </button>
                  <button
                    type="button"
                    className={units === 'IMPERIAL' ? 'active' : ''}
                    onClick={() => setUnits('IMPERIAL')}
                  >
                    Imperial (°F, ft, ppm, μg/m³)
                  </button>
                </div>
              </FormField>
            </div>

            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
              <label className="field-meta" style={{ marginBottom: '10px' }}>
                <strong>Operational Shift Windows</strong>
                <span>Used to segment incident statistics, personnel accountability, and change-of-shift reports.</span>
              </label>
              <div className="settings-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <FormField label="Shift 1 (Day Shift)" size="sm">
                  <Input value={shiftDay} onChange={(e) => setShiftDay(e.target.value)} disabled={!hasSitePermission} />
                </FormField>
                <FormField label="Shift 2 (Afternoon Shift)" size="sm">
                  <Input value={shiftAfternoon} onChange={(e) => setShiftAfternoon(e.target.value)} disabled={!hasSitePermission} />
                </FormField>
                <FormField label="Shift 3 (Night Shift)" size="sm">
                  <Input value={shiftNight} onChange={(e) => setShiftNight(e.target.value)} disabled={!hasSitePermission} />
                </FormField>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Save Action Footer */}
      <div className="settings-action-bar">
        {saveSuccess && (
          <span className="save-feedback-message">
            <Check size={14} /> Site configuration persisted to backend database.
          </span>
        )}
        {updateMutation.isError && (
          <span className="save-error-message">
            Failed to save site settings. Verify network connection and administrator permissions.
          </span>
        )}
        <LoadingButton
          className="button primary"
          onClick={() => updateMutation.mutate()}
          isLoading={updateMutation.isPending}
          disabled={!isDirty || !hasSitePermission}
        >
          Save Site Profile
        </LoadingButton>
      </div>
    </div>
  );
}
