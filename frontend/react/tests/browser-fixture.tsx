// Development-only fixture. Every API request is intercepted; none reaches a backend.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthGate } from '../src/components/AuthGate';
import { PlatformProvider } from '../src/platform/PlatformContext';
import { AlertSessionProvider } from '../src/platform/AlertSessionContext';
import { App } from '../src/App';
import '../src/index.css';
import { twinFixture } from './twin/fixture';
import { personnelResponse, personnelScenario } from './personnel/fixture';

const now = 1794902400000;
const navigationTest = import.meta.env.MODE === 'navigation-test';
const testCase = navigationTest ? new URLSearchParams(location.search).get('fixture') : null;
const username = testCase === 'long-account' ? 'TEST-OPERATOR-WITH-AN-UNUSUALLY-LONG-LOCAL-NAME-FOR-REFLOW' : testCase === 'missing-account' ? undefined : 'TEST-OPERATOR';
const sites = [1, 2].map(id => ({ id, organisation: 1, organisation_name: 'TEST ORGANISATION', name: personnelScenario && id === 1 ? 'Mining Pilot Site' : `TEST SITE ${id}`, code: `TEST-${id}`, industry: 'Mining test fixture', timezone: 'Africa/Lusaka', active: true }));
const permittedSites = testCase === 'dashboard-no-site' ? [] : sites;
const capabilities = ['view', 'operate_alerts', 'manage_users', 'manage_sites', 'manage_settings', 'view_audit', 'manage_personnel', 'manage_assets', 'manage_devices'];
const alerts = Array.from({ length: testCase === 'long-account' ? 100 : 2 }, (_, index) => {
  const id = index + 1;
  return { id, node_id: `TEST-NODE-${id}`, zone: 'TEST-ZONE', severity: 'CRITICAL', alert_code: `TEST-ALARM-${id}`, status: 'NEW', created_at: now, trigger_value: 55, details: 'Synthetic fixture: verify alert handling without contacting operational services.', investigation_notes: '', resolution_notes: '', resolved_by: '', acknowledged_by: '' };
});
const channels = [{ key: 'test-co', display_name: 'Test CO', unit: 'ppm', latest_value: 8, latest_at: now, node_id: 'TEST-NODE-1', zone: 'TEST-ZONE', sensor_ok: true }];
let scenario = testCase === 'offline' ? 'offline' : 'healthy';
let signedIn = true;
let healthRequests = 0;
let newAlertRequests = 0;
let dashboardRequests = 0;
let bootstrapRequests = 0;
let twinRequests = 0;
const olderIncident = { ...alerts[0], id: 77, alert_code: 'TEST-OLDER-CRITICAL', status: 'ACKNOWLEDGED', created_at: now - 7_200_000 };
const response = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin); const path = url.pathname;
  if (scenario === 'offline' && !path.includes('/auth/') && !path.includes('/bootstrap')) throw new TypeError('Simulated disconnected backend');
  if (path === '/api/v1/auth/csrf') return response({});
  if (path === '/api/v1/auth/session') { if (init?.method === 'DELETE') signedIn = false; if (init?.method === 'POST') signedIn = true; return response({ authenticated: signedIn, username, is_staff: true, capabilities, sites: permittedSites }); }
  if (path === '/api/v1/platform/bootstrap') {
    if (testCase === 'dashboard-bootstrap-failure' && bootstrapRequests++ > 0) return response({ error: 'Synthetic bootstrap failure' }, 503);
    return response({ contract_version: 2, build_revision: 'ISOLATED FIXTURE', sites: permittedSites, organisations: [], capabilities, site_capabilities: { 1: personnelScenario === 'personnel-readonly' ? ['view'] : capabilities, 2: navigationTest ? ['view'] : capabilities } });
  }
  if (path === '/health/') {
    if (testCase === 'stale' && healthRequests++ > 0) throw new TypeError('Simulated health refresh failure');
    return response({ status: 'healthy', build_revision: 'ISOLATED FIXTURE' });
  }
  if (path === '/api/v1/alerts') {
    const status = url.searchParams.get('status');
    if (testCase === 'stale' && status === 'NEW' && newAlertRequests++ > 0) throw new TypeError('Simulated alert refresh failure');
    const records = alerts.filter(alert => !status || alert.status === status);
    return response({ alerts: records, count: records.length });
  }
  const mutation = path.match(/^\/api\/v1\/alerts\/(\d+)\/(ack|assign|resolve)$/);
  if (mutation) {
    if (scenario === 'rejected') return response({ error: 'Synthetic validation rejection' }, 400);
    const alert = alerts.find(a => a.id === Number(mutation[1]))!;
    const notes = init?.body ? JSON.parse(String(init.body)).notes : '';
    if (mutation[2] === 'resolve' && !notes?.trim()) return response({ error: 'Resolution notes are required.' }, 400);
    if (mutation[2] === 'ack') { alert.status = 'ACKNOWLEDGED'; alert.acknowledged_by = 'TEST-OPERATOR'; }
    if (mutation[2] === 'assign') { alert.status = 'INVESTIGATING'; alert.investigation_notes = notes; }
    if (mutation[2] === 'resolve') { alert.status = 'RESOLVED'; alert.resolution_notes = notes.trim(); alert.resolved_by = 'TEST-OPERATOR'; }
    if (scenario === 'lost-response') throw new TypeError('Simulated lost mutation response');
    return response({ status: 'ok' });
  }
  if (path === '/api/v1/alerts/77' && testCase === 'dashboard-overload') {
    return url.searchParams.get('site_id') === '1' ? response(olderIncident) : response({ error: 'Not found' }, 404);
  }
  if (path === '/api/v1/environment/overview') return response({ channels, readings: [] });
  if (path === '/api/v1/environment/readings') {
    if (scenario === 'readings-error') return response({ error: 'Synthetic reading failure' }, 500);
    const readings = scenario === 'empty' ? [] : [8, 11, 7].map((value, id) => ({ id, value, unit: 'ppm', received_at: now - id * 60000, node_id: 'TEST-NODE-1', zone: 'TEST-ZONE' }));
    return response({ readings, total: readings.length, page: 1, page_size: 25, total_pages: 1 });
  }
  if (path === '/api/v1/dashboard') {
    const attempt = ++dashboardRequests;
    document.documentElement.dataset.fixtureDashboardRequests = String(attempt);
    if (testCase === 'dashboard-delay') await new Promise(resolve => window.setTimeout(resolve, 700));
    if (testCase === 'dashboard-flaky' && [2, 3].includes(attempt)) return response({ error: 'Synthetic snapshot failure' }, 503);
    if (testCase === 'dashboard-unavailable') return response({ error: 'Synthetic initial failure' }, 503);
    const site = sites.find(candidate => String(candidate.id) === url.searchParams.get('site_id'));
    if (!site) return response({ error: 'Site not found' }, 404);
    const snapshotAt = Date.now() - (testCase === 'dashboard-stale-generated' ? 3_600_000 : 0);
    const hour = 3_600_000;
    const siteOne = site.id === 1;
    const preview = testCase === 'dashboard-overload' && siteOne ? [olderIncident, ...alerts, ...Array.from({ length: 5 }, (_, index) =>
      ({ ...alerts[0], id: 80 + index, alert_code: `TEST-WARNING-${index + 1}`, severity: 'WARNING' })),
    ] : siteOne ? alerts : [];
    const body = {
      site: testCase === 'dashboard-mismatched-site' ? sites[1] : site,
      snapshot_at: snapshotAt,
      history_window: { start_at: snapshotAt - 12 * hour, end_at: snapshotAt, bucket_ms: hour },
      metrics: { active_alerts: testCase === 'dashboard-overload' ? 10 : preview.length, critical_alerts: preview.filter(alert => alert.severity === 'CRITICAL').length,
        online_personnel: 0, tracked_assets: siteOne ? 3 : 0, online_devices: siteOne ? 7 : 2, stale_or_offline_devices: siteOne ? 1 : 0 },
      alerts: preview,
      activity: siteOne ? [
        { id: 1, actor: 'TEST-OPERATOR', action: 'ALERT_ASSIGNED', details: 'Test incident review', timestamp: snapshotAt - 6_000 },
        { id: 2, actor: 'TEST-OPERATOR', action: 'GATEWAY_REGISTERED', details: 'Test gateway entry', timestamp: snapshotAt - 3_000 },
      ] : [],
      environment: siteOne ? [
        { id: 1, measurement_key: 'co_ppm', unit: 'ppm', value: 0, received_at: snapshotAt - 60_000, node_id: 'TEST-NODE-1', zone: 'NORTH ACCESS' },
        { id: 2, measurement_key: 'dust_ugm3', unit: 'µg/m³', value: 21.4, received_at: snapshotAt - 120_000, node_id: 'TEST-NODE-2', zone: 'SERVICE BAY' },
      ] : [],
      charts: {
        primary_timeline: Array.from({ length: 12 }, (_, index) => ({
          timestamp: snapshotAt - (11 - index) * hour,
          gas_ppm: [1, 0, 3, 4, null, 7, 5, 7, 3, 5, 4, 1][index],
          dust_ugm3: [15, 25, 24, 20, 22, 23, 30, 22, 18, 20, 22, 21.4][index],
          active_alerts: index < 4 ? 0 : 2,
        })),
        zone_occupancy: siteOne ? [{ zone: 'North access', personnel_count: 4, asset_count: 2 }, { zone: 'Service bay', personnel_count: 0, asset_count: 1 }] : [],
      },
    };
    return response(testCase === 'dashboard-partial'
      ? { site, snapshot_at: snapshotAt, metrics: { online_devices: 0 }, alerts: [] }
      : body);
  }
  if (path === '/api/v1/digital-twin') {
    const site = sites.find(candidate => String(candidate.id) === url.searchParams.get('site_id'));
    if (!site) return response({ error: 'Site not found' }, 404);
    const attempt = ++twinRequests;
    document.documentElement.dataset.fixtureTwinRequests = String(attempt);
    if (testCase === 'twin-race' && site.id === 1) {
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      document.documentElement.dataset.fixtureTwinSiteOneCompleted = 'true';
    }
    if (testCase === 'twin-unavailable' || (testCase === 'twin-refresh' && attempt === 2)) {
      return response({ error: 'Synthetic Digital Twin failure' }, 503);
    }
    return response(twinFixture(site, testCase));
  }
  const entityMatch = path.match(/^\/api\/v1\/entities\/(personnel|assets|devices)\/([^/]+)$/);
  const personnelFixture = await personnelResponse(url, init, capabilities);
  if (personnelFixture) return personnelFixture;
  if (entityMatch) return response({ id: entityMatch[2], site: 1, organisation: 1, identifier: 'TEST-001', display_name: 'Isolated test person', version: 1, archived: false, location_evidence: 'UNKNOWN', current_assignments: [], current_custody: [], assignment_history: [], custody_history: [], location_observations: [], device_alerts: [], measurements: [], audit: [] });
  if (path === '/api/v1/devices/eligible') return response({ nodes: [{ node_id: 'TEST-DEVICE-1' }] });
  if (path === '/api/v1/gateways') return response({ gateways: [], discoveries: [], commands: [], devices: [] });
  if (path === '/api/v1/personnel') return response({ personnel: [], count: 0 });
  if (path === '/api/v1/assets') return response({ assets: [], count: 0 });
  if (path === '/api/v1/users') return response({ users: [], total: 0, total_pages: 1, page: 1, page_size: 25 });
  if (path.endsWith('/structures')) return response({ structures: [] });
  if (path.endsWith('/zones')) return response({ zones: [] });
  if (path.endsWith('/layout')) return response({ site: 1, geometry: {}, version: 1 });
  if (path === '/api/v1/audit') return response({ audit_log: [] });
  if (path === '/api/v1/nodes') return response({ nodes: [], count: 0 });
  if (path === '/api/v1/reports/summary') return response({ site: sites[0], summary: { alerts_total: alerts.length } });
  if (path === '/api/v1/integrations') return response({ integrations: [], message: 'No integrations in the isolated fixture.' });
  if (path === '/api/v1/search') {
    if (testCase === 'expired') return response({ error: 'Synthetic expired session' }, 401);
    if (testCase === 'slow-search') await new Promise(resolve => window.setTimeout(resolve, 300));
    const term = url.searchParams.get('q')?.toLowerCase() ?? '';
    const label = 'Isolated test person';
    return response({ results: label.toLowerCase().includes(term) ? [{ kind: 'personnel', id: 1, label, route: '/personnel/1' }] : [] });
  }
  // Fail closed: the fixture never delegates to the original fetch.
  return response({ error: `No isolated fixture for ${path}` }, 400);
};
function FixtureRoutes({ selected }: { selected: string }) {
  const client = useQueryClient();
  const previous = useRef(selected);
  useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    void client.invalidateQueries();
  }, [client, selected]);
  return <PlatformProvider><AlertSessionProvider><App /></AlertSessionProvider></PlatformProvider>;
}

function Fixture() {
  const [selected, setSelected] = useState('healthy');
  const routes = <AuthGate><FixtureRoutes selected={selected} /></AuthGate>;
  if (navigationTest) return <BrowserRouter>{routes}</BrowserRouter>;
  return <><aside style={{ padding: 10, background: '#fff1c2', color: '#302400' }}><strong>ISOLATED TEST DATA — no backend requests</strong><label style={{ display: 'block' }}>Test scenario <select value={selected} onChange={event => { scenario = event.target.value; setSelected(scenario); }}>
    {['healthy', 'rejected', 'lost-response', 'readings-error', 'empty', 'offline'].map(value => <option key={value}>{value}</option>)}
  </select></label></aside><MemoryRouter initialEntries={[new URLSearchParams(location.search).get('page') || '/alerts']}>{routes}</MemoryRouter></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
