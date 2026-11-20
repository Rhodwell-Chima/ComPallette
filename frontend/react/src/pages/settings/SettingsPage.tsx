import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  Clock,
  Radio,
  Server,
  ShieldAlert,
  Sliders,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { EmptyState, StatusPill } from '../../platform/ui';
import { OperatorPreferencesTab } from './OperatorPreferencesTab';
import { SiteProfileTab } from './SiteProfileTab';

export type SettingsTabId =
  | 'preferences'
  | 'site'
  | 'safety'
  | 'network'
  | 'integrations';

interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  shortDesc: string;
  icon: LucideIcon;
}

const SETTINGS_TABS: SettingsTabDef[] = [
  {
    id: 'preferences',
    label: 'Operator Preferences',
    shortDesc: 'Display, acoustics & polling',
    icon: Sliders,
  },
  {
    id: 'site',
    label: 'Site Profile',
    shortDesc: 'Taxonomy, timezone & shifts',
    icon: Building2,
  },
  {
    id: 'safety',
    label: 'Safety Thresholds',
    shortDesc: 'Remote changes unavailable',
    icon: ShieldAlert,
  },
  {
    id: 'network',
    label: 'Network & Gateway',
    shortDesc: 'Registration & diagnostics',
    icon: Radio,
  },
  {
    id: 'integrations',
    label: 'System & Compliance',
    shortDesc: 'Integration status & audit',
    icon: Server,
  },
];

export function SettingsPage() {
  const { selectedSiteId } = usePlatform();
  return <SettingsContent key={selectedSiteId ?? 'none'} />;
}

function SettingsContent() {
  const { selectedSite, can } = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active Tab from URL with fallback
  const activeTabId = useMemo<SettingsTabId>(() => {
    const raw = searchParams.get('tab') as SettingsTabId;
    if (raw && SETTINGS_TABS.some((t) => t.id === raw)) {
      return raw;
    }
    return 'preferences';
  }, [searchParams]);

  const setActiveTab = (tabId: SettingsTabId) => {
    setSearchParams({ tab: tabId }, { replace: true });
  };

  // Track dirty status per tab to display unsaved pill
  const [dirtyMap, setDirtyMap] = useState<Record<SettingsTabId, boolean>>({
    preferences: false,
    site: false,
    safety: false,
    network: false,
    integrations: false,
  });

  const handleDirtyChange = (tabId: SettingsTabId, isDirty: boolean) => {
    setDirtyMap((prev) => (prev[tabId] === isDirty ? prev : { ...prev, [tabId]: isDirty }));
  };

  const hasAnyDirty = Object.values(dirtyMap).some(Boolean);

  return (
    <div className="settings-workspace">
      <header className="settings-page-header">
        <div className="settings-title-group">
          <div className="settings-title-row">
            <Sliders size={22} className="settings-title-icon" aria-hidden="true" />
            <h1>Settings &amp; Controls</h1>
          </div>
          <p className="settings-page-lead">
            Manage workstation preferences and site settings. Gateway commands and audit records are available through their dedicated workflows.
          </p>
        </div>
        <div className="settings-header-actions">
          {selectedSite ? (
            <>
              <StatusPill value={selectedSite.code} tone="neutral" />
              <StatusPill
                value={selectedSite.active ? 'ACTIVE' : 'STANDBY'}
                tone={selectedSite.active ? 'success' : 'warning'}
              />
            </>
          ) : (
            <StatusPill value="NO SITE SELECTED" tone="critical" />
          )}
        </div>
      </header>

      <div className="settings-layout">
        {/* Navigation Sidebar / Horizontal bar on mobile */}
        <aside className="settings-nav-sidebar" aria-label="Settings Categories">
          <nav className="settings-nav-list" role="tablist">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTabId === tab.id;
              const isTabDirty = dirtyMap[tab.id];

              return (
                <button
                  key={tab.id}
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${tab.id}`}
                  className={`settings-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <div className="nav-item-icon">
                    <Icon size={18} />
                  </div>
                  <div className="nav-item-meta">
                    <span className="nav-item-label">{tab.label}</span>
                    <span className="nav-item-desc">{tab.shortDesc}</span>
                  </div>
                  {isTabDirty && (
                    <span
                      className="nav-item-dirty-badge"
                      title="Unsaved modifications pending"
                      aria-label="Unsaved modifications pending"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Quick info footer */}
          <div className="settings-nav-footer">
            <div className="system-pill-summary">
              <span className="system-indicator online" />
              <div className="system-details">
                <span className="system-title">Operational Cockpit</span>
                <span className="system-sub">
                  {can('manage_settings') ? 'Full Governance' : 'Operator View'}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* Tab Content Panel */}
        <main
          className="settings-content-viewport"
          role="tabpanel"
          id={`settings-panel-${activeTabId}`}
          aria-labelledby={`settings-tab-${activeTabId}`}
        >
          {activeTabId === 'preferences' && (
            <OperatorPreferencesTab
              onDirtyChange={(d) => handleDirtyChange('preferences', d)}
            />
          )}

          {activeTabId === 'site' && (
            selectedSite ? (
              <SiteProfileTab
                onDirtyChange={(d) => handleDirtyChange('site', d)}
              />
            ) : (
              <EmptyState
                title="No Site Selected"
                detail="Select a permitted industrial site from the navigation header to configure site identity, shifts, and industry presets."
              />
            )
          )}

          {activeTabId === 'safety' && (
            <EmptyState title="Remote threshold changes are unavailable" detail="This release preserves device safety thresholds. The browser cannot read or change the active firmware thresholds." />
          )}

          {activeTabId === 'network' && (
            <section className="settings-tab-content"><h2>Network and gateways</h2><p>Register gateways, review discovered hardware, and track provisioning and diagnostics in the gateway workspace. Radio and buffer settings cannot be changed here.</p><Link className="button primary" to="/gateways">Open gateways</Link></section>
          )}

          {activeTabId === 'integrations' && (
            <section className="settings-tab-content"><h2>Integrations and audit</h2><p>Review backend-reported integration status and recorded operator actions. Webhook configuration and remote retention changes are unavailable in this release.</p><Link className="button" to="/integrations">View integrations</Link> <Link className="button" to="/audit">View audit records</Link></section>
          )}
        </main>
      </div>
    </div>
  );
}
