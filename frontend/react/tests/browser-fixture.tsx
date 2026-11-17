// Development-only fixture. Every API request is intercepted; none reaches a backend.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthGate } from '../src/components/AuthGate';
import { PlatformProvider } from '../src/platform/PlatformContext';
import { AlertSessionProvider } from '../src/platform/AlertSessionContext';
import { App } from '../src/App';
import '../src/index.css';

const now = 1794902400000;
const sites = [1, 2].map(id => ({ id, organisation: 1, organisation_name: 'TEST ORGANISATION', name: `TEST SITE ${id}`, code: `TEST-${id}`, industry: 'Mining test fixture', timezone: 'Africa/Lusaka', active: true }));
const capabilities = ['view', 'operate_alerts', 'manage_users', 'manage_sites', 'manage_settings', 'view_audit', 'manage_personnel', 'manage_assets'];
const alerts = [1, 2].map(id => ({ id, node_id: `TEST-NODE-${id}`, zone: 'TEST-ZONE', severity: 'CRITICAL', alert_code: `TEST-ALARM-${id}`, status: 'NEW', created_at: now, trigger_value: 55, details: 'Synthetic fixture: verify alert handling without contacting operational services.', investigation_notes: '', resolution_notes: '', resolved_by: '', acknowledged_by: '' }));
const channels = [{ key: 'test-co', display_name: 'Test CO', unit: 'ppm', latest_value: 8, latest_at: now, node_id: 'TEST-NODE-1', zone: 'TEST-ZONE', sensor_ok: true }];
let scenario = 'healthy'; let signedIn = true;
const response = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin); const path = url.pathname;
  if (scenario === 'offline' && !path.includes('/auth/') && !path.includes('/bootstrap')) throw new TypeError('Simulated disconnected backend');
  if (path === '/api/v1/auth/csrf') return response({});
  if (path === '/api/v1/auth/session') { if (init?.method === 'DELETE') signedIn = false; if (init?.method === 'POST') signedIn = true; return response({ authenticated: signedIn, username: 'TEST-OPERATOR', is_staff: true, capabilities, sites }); }
  if (path === '/api/v1/platform/bootstrap') return response({ sites, organisations: [], capabilities });
  if (path === '/health/') return response({ status: 'healthy', build_revision: 'ISOLATED FIXTURE' });
  if (path === '/api/v1/alerts') { const status = url.searchParams.get('status'); return response({ alerts: alerts.filter(a => !status || a.status === status), count: alerts.length }); }
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
  if (path === '/api/v1/personnel') return response({ personnel: [], count: 0 });
  if (path === '/api/v1/assets') return response({ assets: [], count: 0 });
  if (path === '/api/v1/users') return response({ users: [], total: 0, total_pages: 1, page: 1, page_size: 25 });
  if (path.endsWith('/structures')) return response({ structures: [] });
  if (path.endsWith('/zones')) return response({ zones: [] });
  if (path.endsWith('/layout')) return response({ site: 1, geometry: {}, version: 1 });
  if (path === '/api/v1/audit') return response({ audit_log: [] });
  // Fail closed: the fixture never delegates to the original fetch.
  return response({ error: `No isolated fixture for ${path}` }, 400);
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function Fixture() {
  const [selected, setSelected] = useState('healthy');
  return <><aside style={{ padding: 10, background: '#fff1c2', color: '#302400' }}><strong>ISOLATED TEST DATA — no backend requests</strong><label style={{ display: 'block' }}>Test scenario <select value={selected} onChange={event => { scenario = event.target.value; setSelected(scenario); void client.invalidateQueries(); }}>
    {['healthy', 'rejected', 'lost-response', 'readings-error', 'empty', 'offline'].map(value => <option key={value}>{value}</option>)}
  </select></label></aside><QueryClientProvider client={client}><MemoryRouter initialEntries={[new URLSearchParams(location.search).get('page') || '/alerts']}><AuthGate><PlatformProvider><AlertSessionProvider><App /></AlertSessionProvider></PlatformProvider></AuthGate></MemoryRouter></QueryClientProvider></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
