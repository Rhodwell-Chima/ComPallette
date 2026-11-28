import type { PersonDetail, PersonnelOptions } from '../../src/types';

const key = 'isolated-fixture.personnel';
const options: PersonnelOptions = {
  operational_roles: [
    { value: 'UNDERGROUND_MINER', label: 'Underground miner' },
    { value: 'SHIFT_SUPERVISOR', label: 'Shift supervisor' },
    { value: 'MAINTENANCE_TECHNICIAN', label: 'Maintenance technician' },
    { value: 'EQUIPMENT_OPERATOR', label: 'Equipment operator' },
    { value: 'SAFETY_OFFICER', label: 'Safety officer' },
  ],
  employment_statuses: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }],
};
const initial = (id: number, label: string): PersonDetail => ({
  id, site: 1, organisation: 1, identifier: `PER-${String(id).padStart(4, '0')}`, display_name: label,
  operational_role: null, team: 'Ventilation crew', employment_status: 'ACTIVE', assigned_node: null, version: 1,
  location_evidence: 'UNKNOWN', current_assignments: [], current_custody: [], assignment_history: [], location_observations: [], audit: [],
});
const savedScenario = new URLSearchParams(location.search).get('fixture');
export const personnelScenario = savedScenario?.startsWith('personnel-') ? savedScenario : sessionStorage.getItem(`${key}.scenario`);
if (personnelScenario) sessionStorage.setItem(`${key}.scenario`, personnelScenario);

export async function personnelResponse(url: URL, init: RequestInit | undefined, capabilities: string[]) {
  if (!personnelScenario) return undefined;
  const path = url.pathname;
  const method = init?.method ?? 'GET';
  const endpoint = path.match(/^\/api\/v1\/(?:entities\/)?personnel\/(\d+)$/);
  if (path !== '/api/v1/personnel' && path !== '/api/v1/devices/eligible' && !endpoint) return undefined;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const readOnly = personnelScenario === 'personnel-readonly';
  const site = Number(url.searchParams.get('site_id') ?? url.searchParams.get('site'));
  const raw = localStorage.getItem(key);
  const people: PersonDetail[] = raw ? JSON.parse(raw) : [
    { ...initial(1, 'Amina Mulenga'), operational_role: 'SHIFT_SUPERVISOR', operational_role_label: 'Shift supervisor',
      assigned_node: 'BADGE-001', node_id: 'BADGE-001', node_status: 'ONLINE', current_zone: 'NORTH ACCESS',
      location_evidence: 'LAST_KNOWN', location_observed_at: Date.now() - 7_200_000 },
    ...Array.from({ length: 26 }, (_, index) => ({
      ...initial(index + 2, `Ventilation crew member ${String(index + 1).padStart(2, '0')}`),
      operational_role: 'UNDERGROUND_MINER', operational_role_label: 'Underground miner',
    })),
  ];
  function save() { localStorage.setItem(key, JSON.stringify(people)); }
  if (personnelScenario === 'personnel-slow') {
    if (method === 'POST') document.documentElement.dataset.pendingPersonnelWrite = endpoint ? 'entity' : 'registration';
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  if (path === '/api/v1/devices/eligible') {
    if (readOnly || site !== 1) return reply({ detail: 'Denied' }, 403);
    const used = people.some(person => person.node_id === 'BADGE-014') ||
      sessionStorage.getItem(`${key}.conflict`) === 'true';
    const term = (url.searchParams.get('q') ?? '').trim().toUpperCase();
    return reply({ nodes: (used ? ['BADGE-017'] : ['BADGE-014', 'BADGE-017']).filter(id => id.includes(term))
      .map(node_id => ({ node_id, site, commissioned: true, archived: false, role: 'WEARABLE' })) });
  }
  if (method === 'GET' && !endpoint) {
    const roster = people.filter(person => person.site === site);
    return reply({ personnel: roster, count: roster.length, site_total: roster.length, ...options });
  }
  const person = endpoint ? people.find(row => row.id === Number(endpoint[1])) : undefined;
  if (method === 'GET') return person ? reply({ ...person, ...options, capabilities: readOnly ? ['view'] : capabilities }) : reply({ detail: 'Not found' }, 404);
  document.documentElement.dataset.personnelWrites = String(Number(document.documentElement.dataset.personnelWrites ?? 0) + 1);
  if (readOnly) return reply({ detail: 'Denied' }, 403);
  const payload = JSON.parse(String(init?.body));
  if (!endpoint) {
    if (payload.site !== 1) return reply({ detail: 'Denied' }, 403);
    if (people.some(row => row.identifier === payload.identifier)) return reply({ identifier: ['This personnel ID is already used in this organisation.'] }, 400);
    const created = { ...initial(Math.max(...people.map(row => row.id)) + 1, payload.display_name), ...payload,
      operational_role_label: options.operational_roles?.find(option => option.value === payload.operational_role)?.label };
    people.unshift(created);
    save();
    return reply(created, 201);
  }
  if (!person) return reply({ detail: 'Not found' }, 404);
  if (personnelScenario === 'personnel-conflict' && payload.action === 'edit' && !sessionStorage.getItem(`${key}.stale`)) {
    sessionStorage.setItem(`${key}.stale`, 'true');
    person.version++;
    save();
  }
  if (payload.expected_site !== person.site || payload.expected_version !== person.version) return reply({ detail: 'The record changed. Refresh before retrying.' }, 409);
  if (payload.action === 'edit') {
    Object.assign(person, payload.changes);
    person.operational_role_label = options.operational_roles?.find(option => option.value === person.operational_role)?.label;
  }
  if (payload.action === 'assign') {
    if (personnelScenario === 'personnel-conflict' && payload.node_id === 'BADGE-014') {
      sessionStorage.setItem(`${key}.conflict`, 'true');
      return reply({ detail: 'A competing relationship change was saved. Refresh before retrying.' }, 409);
    }
    const assignment = { id: 4, node_id: payload.node_id, started_at: new Date().toISOString(), ended_at: null };
    person.assigned_node = payload.node_id;
    person.node_id = payload.node_id;
    person.node_status = 'ONLINE';
    person.current_assignments = [assignment];
    person.assignment_history = [assignment];
    person.location_observations = [{
      id: 6, node_id: payload.node_id, reported_zone: 'OLDER ZONE', source: 'RADIO', quality: 'CONFIRMED',
      captured_at: null, received_at: new Date(Date.now() - 4_000_000).toISOString(),
    }];
  }
  person.version++;
  save();
  return reply({ id: person.id, version: person.version, status: 'ok', action: payload.action });
}
