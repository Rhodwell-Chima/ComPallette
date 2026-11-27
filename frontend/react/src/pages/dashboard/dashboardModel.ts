import type { AlertItem, AuditItem, MeasurementReading } from '../../types';
import { POLL_OPERATIONAL_MS } from '../../platform/queryKeys';

export function numberValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function countValue(value: unknown): number | undefined {
  return numberValue(value) && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function validTimestamp(value: unknown): value is number {
  return numberValue(value) && value > 0 && value <= 8.64e15;
}

export function monitoringTimeZone(value?: string) {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

export function snapshotState({ receivedAt, generatedAt, online, failed, fetching, now }: {
  receivedAt?: number;
  generatedAt?: number;
  online: boolean;
  failed: boolean;
  fetching: boolean;
  now: number;
}) {
  if (!online) return 'offline';
  if (!receivedAt) return failed ? 'unavailable' : 'loading';
  const tolerance = 2 * POLL_OPERATIONAL_MS;
  if (failed || now - receivedAt >= tolerance ||
    (validTimestamp(generatedAt) && Math.abs(now - generatedAt) >= tolerance)) return 'stale';
  return fetching ? 'refreshing' : 'current';
}

const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
export function prioritizeIncidents(alerts?: AlertItem[]) {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter(alert => alert.status !== 'RESOLVED').sort((a, b) =>
    (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) ||
    b.created_at - a.created_at || b.id - a.id,
  );
}

export function latestStreams(readings?: MeasurementReading[]) {
  if (!Array.isArray(readings)) return [];
  const latest = new Map<string, MeasurementReading>();
  for (const reading of readings) {
    if (!reading.node_id || !reading.measurement_key) continue;
    const key = JSON.stringify([reading.node_id, reading.measurement_key]);
    const previous = latest.get(key);
    if (!previous || (validTimestamp(reading.received_at) &&
      (!validTimestamp(previous.received_at) || reading.received_at > previous.received_at))) {
      latest.set(key, reading);
    }
  }
  return [...latest.values()].sort((a, b) =>
    (validTimestamp(b.received_at) ? b.received_at : 0) - (validTimestamp(a.received_at) ? a.received_at : 0) || a.id - b.id,
  );
}

const measurementLabels: Record<string, string> = { co_ppm: 'Carbon monoxide', dust_ugm3: 'Dust', temperature_c: 'Temperature', humidity_pct: 'Humidity' };
export function measurementLabel(key: string) {
  return measurementLabels[key] ?? key.replace(/_/g, ' ');
}

export type ActivityFilter = 'all' | 'alerts' | 'users' | 'devices';
export function recentActivity(items: AuditItem[], filter: ActivityFilter) {
  const unique = new Map(items.filter(entry => validTimestamp(entry.timestamp)).map(entry => [entry.id, entry]));
  return [...unique.values()].filter(entry => {
    if (filter === 'all') return true;
    if (filter === 'alerts') return entry.action.includes('ALERT');
    if (filter === 'users') return /USER|ACCESS/.test(entry.action);
    return /NODE|PROVISION|GATEWAY|DEVICE/.test(entry.action);
  }).sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
}
