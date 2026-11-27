import {
  Bell, Boxes, ClipboardList, FileBarChart, Layers, LayoutDashboard, Map,
  Network, PlugZap, Radio, Settings, Thermometer, UserRoundCheck, Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationDestination {
  id: string;
  label: string;
  to: `/${string}`;
  icon: LucideIcon;
  end?: boolean;
  capability?: string;
}

export const navigation = {
  dashboard: { id: 'dashboard', label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  twin: { id: 'twin', label: 'Digital Twin', to: '/twin', icon: Map },
  alerts: { id: 'alerts', label: 'Alerts & Incidents', to: '/alerts', icon: Bell },
  personnel: { id: 'personnel', label: 'Personnel', to: '/personnel', icon: Users },
  assets: { id: 'assets', label: 'Assets', to: '/assets', icon: Boxes },
  environment: { id: 'environment', label: 'Environmental', to: '/environment', icon: Thermometer },
  devices: { id: 'devices', label: 'Devices & Mesh', to: '/devices', icon: Network },
  gateways: { id: 'gateways', label: 'Gateways & Commissioning', to: '/gateways', icon: Radio, capability: 'manage_devices' },
  sites: { id: 'sites', label: 'Sites & Zones', to: '/sites-zones', icon: Layers },
  reports: { id: 'reports', label: 'Reports', to: '/reports', icon: FileBarChart },
  integrations: { id: 'integrations', label: 'Integrations', to: '/integrations', icon: PlugZap },
  audit: { id: 'audit', label: 'Audit Trail', to: '/audit', icon: ClipboardList, capability: 'view_audit' },
  access: { id: 'access', label: 'Users & Access', to: '/access', icon: UserRoundCheck, capability: 'manage_users' },
  settings: { id: 'settings', label: 'Settings', to: '/settings', icon: Settings, capability: 'manage_settings' },
} as const satisfies Record<string, NavigationDestination>;

interface NavigationGroup {
  label: string;
  items: readonly NavigationDestination[];
}

// The group and item order reflects operator priority. Alerts are rendered in the utility header.
export const navigationGroups: readonly NavigationGroup[] = [
  { label: 'Operations', items: [navigation.dashboard, navigation.twin, navigation.personnel, navigation.assets, navigation.environment] },
  { label: 'Infrastructure', items: [navigation.devices, navigation.gateways, navigation.sites, navigation.integrations] },
  { label: 'Records', items: [navigation.reports, navigation.audit] },
  { label: 'Administration', items: [navigation.access, navigation.settings] },
];
