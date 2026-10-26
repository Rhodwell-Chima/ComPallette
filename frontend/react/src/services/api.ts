import { SystemSummary, NodeItem, AlertItem, TelemetryItem, AuditItem, ProvisioningRequest } from '../types';

const API_BASE = '';

export async function fetchSummary(): Promise<SystemSummary> {
  const resp = await fetch(`${API_BASE}/api/v1/system/summary`);
  if (!resp.ok) throw new Error('Failed to fetch summary');
  return resp.json();
}

export async function fetchNodes(): Promise<NodeItem[]> {
  const resp = await fetch(`${API_BASE}/api/v1/nodes`);
  if (!resp.ok) throw new Error('Failed to fetch nodes');
  const data = await resp.json();
  return data.nodes || [];
}

export async function fetchAlerts(statusFilter?: string, limit: number = 20): Promise<AlertItem[]> {
  let url = `${API_BASE}/api/v1/alerts?limit=${limit}`;
  if (statusFilter) url += `&status=${statusFilter}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to fetch alerts');
  const data = await resp.json();
  return data.alerts || [];
}

export async function fetchNodeHistory(nodeId: string, limit: number = 30): Promise<TelemetryItem[]> {
  const resp = await fetch(`${API_BASE}/api/v1/nodes/${nodeId}/history?limit=${limit}`);
  if (!resp.ok) throw new Error('Failed to fetch node history');
  const data = await resp.json();
  return data.history || [];
}

export async function fetchAudit(limit: number = 20): Promise<AuditItem[]> {
  const resp = await fetch(`${API_BASE}/api/v1/audit?limit=${limit}`);
  if (!resp.ok) throw new Error('Failed to fetch audit log');
  const data = await resp.json();
  return data.audit_log || [];
}

export async function acknowledgeAlert(alertId: number, officerName: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/v1/alerts/${alertId}/ack/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officer_name: officerName })
  });
  if (!resp.ok) throw new Error('Failed to acknowledge alert');
}

export async function resolveAlert(alertId: number, officerName: string, notes: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/v1/alerts/${alertId}/resolve/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ officer_name: officerName, notes })
  });
  if (!resp.ok) throw new Error('Failed to resolve alert');
}

export async function fetchPendingProvisioning(): Promise<ProvisioningRequest[]> {
  const resp = await fetch(`${API_BASE}/api/v1/provision/pending`);
  if (!resp.ok) throw new Error('Failed to fetch pending provisioning requests');
  const data = await resp.json();
  return data.pending_nodes || [];
}

export async function assignNodeProvisioning(
  chipId: string,
  deviceId: string,
  role: string,
  zoneId: string,
  officerName: string = 'Safety_Officer'
): Promise<any> {
  const resp = await fetch(`${API_BASE}/api/v1/provision/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chip_id: chipId,
      device_id: deviceId,
      role,
      zone_id: zoneId,
      officer_name: officerName,
    }),
  });
  if (!resp.ok) throw new Error('Failed to assign node identity');
  return resp.json();
}
