export type NodeRole = 'WEARABLE' | 'ANCHOR' | 'GATEWAY';
export type NodeStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED';
export type LocationEvidence = 'CURRENT' | 'CONFIRMED' | 'TRANSITIONING' | 'AMBIGUOUS' | 'LAST_KNOWN' | 'ESTIMATED' | 'UNKNOWN';

export interface Organisation {
  id: number;
  name: string;
  slug: string;
  active: boolean;
}

export interface Site {
  id: number;
  organisation: number;
  organisation_name: string;
  name: string;
  code: string;
  industry: string;
  timezone: string;
  active: boolean;
}

export interface Structure {
  id: number;
  site: number;
  name: string;
  structure_type: string;
  description: string;
}

export interface Level {
  id: number;
  structure: number;
  name: string;
  sort_order: number;
  description: string;
}

export interface Zone {
  id: number;
  site: number;
  level: number | null;
  level_name?: string;
  code: string;
  name: string;
  zone_type: string;
  description: string;
  is_restricted: boolean;
  is_hazardous: boolean;
  geometry: Record<string, unknown>;
  active: boolean;
}

export interface FacilityLayout {
  site: number;
  version: number;
  geometry: Record<string, unknown>;
  updated_at: string;
}

export interface NodeItem {
  node_id: string;
  role: NodeRole;
  current_zone: string;
  last_seen_ts: number;
  last_seq: number;
  battery_v: number;
  free_heap: number;
  status: NodeStatus;
  is_simulated: boolean;
  sensor_ok: boolean;
  latest_co: number;
  latest_temp: number;
  latest_hum: number;
  organisation?: number | null;
  site?: number | null;
  site_name?: string;
  zone_ref?: number | null;
  zone_name?: string;
  location_evidence?: LocationEvidence;
  location_observed_at?: number;
  assigned_person?: string;
  assigned_asset?: string;
}

export interface TelemetryItem {
  id: number;
  node_id: string;
  seq: number;
  zone: string;
  co_ppm: number;
  temp_c: number;
  humidity_pct: number;
  fall_detected: boolean;
  battery_v: number;
  is_simulated: boolean;
  sensor_ok: boolean;
  uptime_ms: number;
  received_at: number;
}

export interface AlertItem {
  id: number;
  node_id: string;
  zone: string;
  severity: AlertSeverity;
  alert_code: string;
  details: string;
  trigger_value: number;
  status: AlertStatus;
  seq: number;
  created_at: number;
  acknowledged_at?: number | null;
  acknowledged_by?: string;
  resolved_at?: number | null;
  resolved_by?: string;
  resolution_notes?: string;
  assigned_to?: number | null;
  assigned_to_username?: string;
  assigned_at?: number | null;
  investigation_notes?: string;
}

export interface AuditItem {
  id: number;
  timestamp: number;
  actor: string;
  action: string;
  details: string;
  site?: number | null;
}

export interface SystemSummary {
  total_nodes_tracked: number;
  online_miners: number;
  stale_nodes: number;
  offline_nodes: number;
  active_unacknowledged_alerts: number;
  critical_emergencies: number;
  acknowledged_in_progress: number;
  miners_in_gas_warning: number;
  miners_in_gas_critical: number;
  last_packet_received_ms: number;
}

export interface ProvisioningRequest {
  chip_id: string;
  chip_mac: string;
  mesh_node_id: number;
  fw_version: string;
  battery_v: number;
  mq_healthy: boolean;
  mpu_healthy: boolean;
  status: 'PENDING' | 'ASSIGNED' | 'CONFIRMED';
  assigned_id: string;
  assigned_role: string;
  assigned_zone: string;
  created_at: string;
}

export interface PersonnelItem {
  id: number;
  organisation: number;
  site: number | null;
  identifier: string;
  display_name: string;
  team: string;
  employment_status: string;
  assigned_node: string | null;
  node_id?: string;
  current_zone?: string;
  location_evidence?: LocationEvidence;
  location_observed_at?: number;
  node_status?: NodeStatus;
}

export interface AssetItem {
  id: number;
  organisation: number;
  site: number | null;
  identifier: string;
  name: string;
  asset_type: string;
  operational_status: string;
  assigned_node: string | null;
  node_id?: string;
  current_zone?: string;
  location_evidence?: LocationEvidence;
  location_observed_at?: number;
  node_status?: NodeStatus;
}

export interface DeviceCapability {
  id: number;
  node: string;
  measurement_key: string;
  display_name: string;
  unit: string;
  warning_threshold: number | null;
  critical_threshold: number | null;
  active: boolean;
}

export interface MeasurementReading {
  id: number;
  node: string;
  node_id: string;
  capability: number | null;
  measurement_key: string;
  value: number;
  unit: string;
  source_seq: number;
  received_at: number;
  zone: string;
}

export interface DashboardData {
  site: Site | null;
  metrics: {
    online_personnel: number;
    tracked_assets: number;
    active_alerts: number;
    critical_alerts: number;
    online_devices: number;
    stale_or_offline_devices: number;
  };
  alerts: AlertItem[];
  environment: MeasurementReading[];
  activity: AuditItem[];
}

export interface EnvironmentChannel {
  key: string;
  display_name: string;
  unit: string;
  latest_value: number;
  latest_at: number;
  node_id: string;
  zone: string;
  sensor_ok: boolean;
}

export interface TwinEntity {
  id: string;
  kind: 'personnel' | 'asset' | 'device';
  label: string;
  node_id: string;
  zone_id: number | null;
  zone_code: string;
  status: NodeStatus;
  evidence: LocationEvidence;
  observed_at: number;
  role: NodeRole;
}

export interface TwinData {
  site: Site | null;
  layout: FacilityLayout | null;
  zones: Zone[];
  entities: TwinEntity[];
  topology: unknown[];
  topology_status?: string;
}

export interface SearchResult {
  kind: 'device' | 'personnel' | 'asset' | 'zone';
  id: string | number;
  label: string;
  route: string;
}

export interface SiteMembership {
  id: number;
  user: number;
  username: string;
  organisation: number;
  organisation_name: string;
  site: number | null;
  site_name?: string;
  role: string;
  active: boolean;
}


// =========================================================================
// OPERATIONAL ADMIN DASHBOARD & USER MANAGEMENT EXTENSIONS
// =========================================================================

export interface MetricTrend {
  value: number;
  previous_value: number;
  delta_percent: number; // e.g. +4.2 or -1.5
  direction: 'up' | 'down' | 'flat';
  sparkline: number[]; // mini series data
}

export interface ChartTimeSeriesPoint {
  timestamp: number;
  label: string;
  environmental_index: number;
  gas_ppm: number;
  dust_ugm3: number;
  active_alerts: number;
}

export interface ChartSeverityBreakdown {
  label: string;
  count: number;
  color: string;
}

export interface ChartZoneOccupancy {
  zone: string;
  personnel_count: number;
  asset_count: number;
}

export interface SystemNotification {
  id: string;
  severity: 'WARNING' | 'CRITICAL' | 'INFO';
  title: string;
  message: string;
  timestamp: number;
  action_required: boolean;
  action_label?: string;
  action_route?: string;
  snoozed_until?: number | null;
}

export interface EnhancedDashboardData extends DashboardData {
  trends?: {
    active_alerts: MetricTrend;
    critical_alerts: MetricTrend;
    online_personnel: MetricTrend;
    tracked_assets: MetricTrend;
    online_devices: MetricTrend;
    telemetry_rate: MetricTrend;
  };
  charts?: {
    primary_timeline: ChartTimeSeriesPoint[];
    severity_breakdown: ChartSeverityBreakdown[];
    zone_occupancy: ChartZoneOccupancy[];
  };
  system_notifications?: SystemNotification[];
}

export type UserStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'INVITED';

export interface AdminUserItem {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  status: UserStatus;
  last_active: number | null;
  site_id: number | null;
  site_name?: string;
  organisation_name: string;
  assigned_node_id?: string | null;
  assigned_personnel_id?: string | null;
  capabilities: string[];
}

export interface AdminUserListResponse {
  users: AdminUserItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
