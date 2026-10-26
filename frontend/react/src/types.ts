export type NodeRole = 'WEARABLE' | 'ANCHOR' | 'GATEWAY';
export type NodeStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

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
}

export interface AuditItem {
  id: number;
  timestamp: number;
  actor: string;
  action: string;
  details: string;
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
