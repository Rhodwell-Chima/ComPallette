import { describe, expect, it } from 'vitest';
import { countValue, latestStreams, monitoringTimeZone, recentActivity, snapshotState } from '../src/pages/dashboard/dashboardModel';
import type { AuditItem, MeasurementReading } from '../src/types';

describe('dashboard snapshot semantics', () => {
  it('distinguishes a measured zero from missing and invalid counts', () => {
    expect(countValue(0)).toBe(0);
    for (const value of [undefined, null, NaN, Infinity, -1, 1.5, '0']) {
      expect(countValue(value)).toBeUndefined();
    }
  });

  it('keeps stale transport data distinct from initial failure and offline', () => {
    const state = { now: 50_000, online: true, failed: false, fetching: false };
    expect(snapshotState(state)).toBe('loading');
    expect(snapshotState({ ...state, failed: true })).toBe('unavailable');
    expect(snapshotState({ ...state, receivedAt: 45_000 })).toBe('current');
    expect(snapshotState({ ...state, receivedAt: 45_000, fetching: true })).toBe('refreshing');
    expect(snapshotState({ ...state, receivedAt: 20_000 })).toBe('stale');
    expect(snapshotState({ ...state, receivedAt: 45_000, failed: true })).toBe('stale');
    expect(snapshotState({ ...state, receivedAt: 45_000, generatedAt: 10_000 })).toBe('stale');
    expect(snapshotState({ ...state, receivedAt: 45_000, online: false })).toBe('offline');
  });

  it('keeps the newest device sample and preserves zero and source identity', () => {
    const sample = { id: 1, node: 'A', node_id: 'A', capability: null, measurement_key: 'co_ppm', value: 0,
      unit: 'ppm', source_seq: 1, received_at: 20_000, zone: '' } satisfies MeasurementReading;
    const old = { ...sample, id: 2, value: 99, received_at: 10_000 };
    const other = { ...old, id: 3, node: 'B', node_id: 'B' };
    expect(latestStreams([sample, other, old])).toEqual([sample, other]);
  });

  it('sorts and deduplicates the retained activity before filtering', () => {
    const first = { id: 1, actor: 'tester', action: 'ALERT_ASSIGNED', details: '', timestamp: 1000 } satisfies AuditItem;
    const second = { ...first, id: 2, action: 'GATEWAY_REGISTERED', timestamp: 2000 };
    expect(recentActivity([first, second, first], 'all')).toEqual([second, first]);
    expect(recentActivity([first, second], 'devices')).toEqual([second]);
    expect(monitoringTimeZone('Africa/Lusaka')).toBe('Africa/Lusaka');
    expect(monitoringTimeZone('Unknown/Zone')).toBe('UTC');
  });
});
