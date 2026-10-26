import { SystemSummary, NodeItem, AlertItem, TelemetryItem, AuditItem } from '../types';

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
