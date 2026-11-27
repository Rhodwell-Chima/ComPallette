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

const now = 1794902400000;
const navigationTest = import.meta.env.MODE === 'navigation-test';
const testCase = navigationTest ? new URLSearchParams(location.search).get('fixture') : null;
const username = testCase === 'long-account' ? 'TEST-OPERATOR-WITH-AN-UNUSUALLY-LONG-LOCAL-NAME-FOR-REFLOW' : testCase === 'missing-account' ? undefined : 'TEST-OPERATOR';
const sites = [1, 2].map(id => ({ id, organisation: 1, organisation_name: 'TEST ORGANISATION', name: `TEST SITE ${id}`, code: `TEST-${id}`, industry: 'Mining test fixture', timezone: 'Africa/Lusaka', active: true }));
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
const response = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin); const path = url.pathname;
  if (scenario === 'offline' && !path.includes('/auth/') && !path.includes('/bootstrap')) throw new TypeError('Simulated disconnected backend');
  if (path === '/api/v1/auth/csrf') return response({});
  if (path === '/api/v1/auth/session') { if (init?.method === 'DELETE') signedIn = false; if (init?.method === 'POST') signedIn = true; return response({ authenticated: signedIn, username, is_staff: true, capabilities, sites }); }
  if (path === '/api/v1/platform/bootstrap') return response({ contract_version: 2, build_revision: 'ISOLATED FIXTURE', sites, organisations: [], capabilities, site_capabilities: { 1: capabilities, 2: navigationTest ? ['view'] : capabilities } });
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
  if (path === '/api/v1/environment/overview') return response({ channels, readings: [] });
  if (path === '/api/v1/environment/readings') {
    if (scenario === 'readings-error') return response({ error: 'Synthetic reading failure' }, 500);
    const readings = scenario === 'empty' ? [] : [8, 11, 7].map((value, id) => ({ id, value, unit: 'ppm', received_at: now - id * 60000, node_id: 'TEST-NODE-1', zone: 'TEST-ZONE' }));
    return response({ readings, total: readings.length, page: 1, page_size: 25, total_pages: 1 });
  }
  if (path === '/api/v1/dashboard') return response({ metrics: { active_alerts: 2, critical_alerts: 2, online_personnel: 0, tracked_assets: 0, online_devices: 1, stale_or_offline_devices: 1 }, alerts, activity: [], environment: channels, charts: { primary_timeline: [0, 60000, 600000].map((offset, i) => ({ timestamp: now + offset, gas_ppm: [8, 11, 7][i], dust_ugm3: [15, 25, 20][i], active_alerts: [1, 2, 2][i] })), severity_breakdown: [], zone_occupancy: [] } });
  if (path === '/api/v1/digital-twin') return response({
    site: sites[0],
    layout: { site: 1, version: 1, geometry: { features: [{ id: 'test-zone', label: 'TEST-ZONE', points: [[0, 0], [40, 0], [40, 20], [0, 20]] }] } },
    zones: [], entities: [], topology: [],
  });
  const entityMatch = path.match(/^\/api\/v1\/entities\/(personnel|assets|devices)\/([^/]+)$/);
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
