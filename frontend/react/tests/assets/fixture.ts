import type { AssetDetail, AssetRelationship } from '../../src/types';

const key = 'isolated-fixture.assets';
const requested = new URLSearchParams(location.search).get('fixture');
export const assetScenario = requested?.startsWith('assets-') ? requested : sessionStorage.getItem(`${key}.scenario`);
if (assetScenario) sessionStorage.setItem(`${key}.scenario`, assetScenario);

const person = { id: 82, display_name: 'Mwamba Phiri', identifier: 'PER-0082' };
const base = (id: number, name: string, asset_type = 'Pump', site = 1): AssetDetail => ({
  id, name, identifier: `P-${String(id).padStart(3, '0')}`, site, organisation: 1, asset_type, operational_status: 'ACTIVE',
  assigned_node: null, version: 1, archived: false, current_assignments: [], current_custody: [],
  custody_history: [], assignment_history: [], location_evidence: 'UNKNOWN',
});
const historyRow = (id: number): AssetRelationship => ({
  id, started_at: new Date(Date.now() - 3_600_000).toISOString(), ended_at: null,
});
const named = () => ({ personnel_id: person.id, person_name: person.display_name, person_identifier: person.identifier });

export async function assetResponse(url: URL, init: RequestInit | undefined, capabilities: string[]) {
  if (!assetScenario) return undefined;
  const path = url.pathname;
  const endpoint = path.match(/^\/api\/v1\/entities\/assets\/(\d+)$/);
  const personEndpoint = path === '/api/v1/entities/personnel/82';
  const assetsRoute = path === '/api/v1/assets';
  const eligible = path === '/api/v1/devices/eligible' || path === '/api/v1/assets/eligible-custodians';
  if (!endpoint && !personEndpoint && !assetsRoute && !eligible) return undefined;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const readOnly = assetScenario === 'assets-readonly';
  const method = init?.method ?? 'GET';
  const query = url.searchParams;
  const site = Number(query.get('site_id'));
  const saved = localStorage.getItem(key);
  const priorTracker = { ...historyRow(2), node_id: 'TAG-014', started_at: new Date(Date.now() - 14_400_000).toISOString() };
  const priorCustody = { ...historyRow(1), ...named() };
  const catalog: AssetDetail[] = saved ? JSON.parse(saved) : [
    ...Array.from({ length: assetScenario === 'assets-clamp' ? 50 : 57 }, (_, i) => base(i + 10, `Service pump ${String(i + 1).padStart(2, '0')}`)),
    base(70, 'Ventilation drill', 'Drill'),
    base(71, 'North site drill', 'Drill', 2),
    ...(readOnly ? [{ ...base(1, 'Dewatering pump 04 with a long equipment label'), identifier: 'PUMP-004',
      node_id: 'TAG-014', node_status: 'OFFLINE' as const, assigned_node: 'TAG-014',
      custody_history: [priorCustody], current_custody: [priorCustody],
      custodian: { id: person.id, name: person.display_name, identifier: person.identifier, started_at: priorCustody.started_at },
      tracker_started_at: priorTracker.started_at, current_assignments: [priorTracker], assignment_history: [priorTracker],
      current_zone: 'Level 2 Haulage West Ventilation and Return Passage', location_evidence: 'LAST_KNOWN' as const,
      location_observed_at: Date.now() - 7_200_000 }] : []),
  ];
  const store = () => localStorage.setItem(key, JSON.stringify(catalog));
  const term = (query.get('q') ?? '').toLowerCase();
  const before = document.documentElement.dataset;
  if (assetScenario === 'assets-slow' && (method === 'POST' || site === 1)) {
    if (method === 'POST') before.fixtureAssetPending = endpoint ? 'action' : 'registration';
    await new Promise(resolve => setTimeout(resolve, 650));
  }
  if (personEndpoint) return reply({
    ...person, site: 1, organisation: 1, version: 1, team: 'Ventilation crew', employment_status: 'ACTIVE',
    assigned_node: null, capabilities, custody_history: catalog.flatMap(asset => (asset.custody_history ?? []).map(row => ({
      ...row, asset_id: asset.id, asset_name: asset.name, asset_identifier: asset.identifier,
    }))),
  });
  if (eligible) {
    if (readOnly) return reply({ error: 'Access denied.' }, 403);
    if (path.endsWith('eligible-custodians')) return reply({
      personnel: site === 1 && `${person.display_name} ${person.identifier}`.toLowerCase().includes(term) ? [person] : [],
    });
    const taken = new Set(catalog.flatMap(asset => asset.node_id ? [asset.node_id] : []));
    if (sessionStorage.getItem(`${key}.competing`)) taken.add('TAG-014');
    return reply({ nodes: ['TAG-014', 'TAG-017'].filter(node => !taken.has(node) && node.toLowerCase().includes(term))
      .map(node_id => ({ node_id, site, role: 'WEARABLE', commissioned: true, archived: false })) });
  }
  if (assetsRoute && method === 'GET') {
    const siteRows = catalog.filter(row => row.site === site);
    const archive = query.get('archive') ?? 'current';
    const classification = query.get('classification');
    const status = query.get('status');
    const custody = query.get('custody');
    const tracker = query.get('tracker');
    const field = (query.get('sort') ?? 'name') as 'name' | 'asset_type' | 'operational_status';
    const direction = query.get('direction') === 'desc' ? -1 : 1;
    const matches = siteRows.filter(asset => (archive === 'all' || asset.archived === (archive === 'archived'))
      && (!term || [asset.name, asset.identifier, asset.asset_type].some(value => value.toLowerCase().includes(term)))
      && (!classification || asset.asset_type === classification)
      && (!status || asset.operational_status === status)
      && (!custody || Boolean(asset.custodian) === (custody === 'issued'))
      && (!tracker || Boolean(asset.node_id) === (tracker === 'assigned')))
      .sort((left, right) => direction * left[field].localeCompare(right[field]) || left.id - right.id);
    const size = Number(query.get('page_size') ?? 25);
    const page = Math.min(Number(query.get('page') ?? 1), Math.max(1, Math.ceil(matches.length / size)));
    return reply({ assets: matches.slice((page - 1) * size, page * size), count: matches.length, page, page_size: size,
      site_total: siteRows.filter(row => !row.archived).length,
      classifications: Array.from(new Set(siteRows.map(row => row.asset_type).filter(Boolean))),
      statuses: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'],
    });
  }
  const asset = endpoint ? catalog.find(row => row.id === Number(endpoint[1])) : undefined;
  const impact = () => ({
    assignment_ids: asset?.current_assignments?.map(row => row.id) ?? [],
    custody_ids: asset?.current_custody?.map(row => row.id) ?? [],
  });
  if (method === 'GET') {
    if (!asset) return reply({ error: 'Asset not found.' }, 404);
    if (query.has('preview_destination') || query.has('preview_archive')) return reply({
      ...impact(), version: asset.version, trackers: asset.current_assignments ?? [], custodians: asset.current_custody ?? [],
    });
    return reply({ ...asset, capabilities: readOnly ? ['view'] : capabilities,
      transfer_destinations: readOnly ? [] : [{ id: asset.site === 1 ? 2 : 1, name: asset.site === 1 ? 'North Site' : 'Mining Pilot Site' }] });
  }
  before.fixtureAssetWrites = String(Number(before.fixtureAssetWrites ?? 0) + 1);
  if (readOnly) return reply({ error: 'Access denied.' }, 403);
  const body = JSON.parse(String(init?.body));
  if (assetsRoute) {
    if (catalog.some(row => row.identifier === body.identifier)) return reply({ identifier: ['This asset ID is already used in this organisation.'] }, 400);
    const created = { ...base(100 + catalog.length, body.name, body.asset_type, body.site), identifier: body.identifier, operational_status: body.operational_status };
    catalog.push(created);
    store();
    return reply(created, 201);
  }
  if (!asset) return reply({ error: 'Not found' }, 404);
  const opKey = `${key}.operation.${body.operation_id}`;
  const prior = sessionStorage.getItem(opKey);
  if (prior) return reply(JSON.parse(prior));
  if (body.expected_version !== asset.version || body.expected_site !== asset.site || asset.archived) return reply({ error: 'The record changed.' }, 409);
  if (before.fixtureAssetConflict === body.action) {
    delete before.fixtureAssetConflict;
    if (body.action === 'assign') sessionStorage.setItem(`${key}.competing`, 'true');
    if (body.action === 'transfer') {
      issue(asset);
      asset.version++;
      store();
    }
    return reply({ error: 'A competing change was saved.' }, 409);
  }
  if (body.action === 'transfer' || body.action === 'archive') {
    if (JSON.stringify(impact()) !== JSON.stringify(body.confirmed_relationships)) return reply({ error: 'The preview changed.' }, 409);
    closeTracker(asset);
    closeCustody(asset);
    if (body.action === 'archive') asset.archived = true;
    else {
      asset.transfer_history = [{ id: asset.version, source_name: 'Mining Pilot Site', destination_name: 'North Site',
        created_at: new Date().toISOString(), reason: body.reason }];
      asset.site = body.destination_site;
    }
  }
  if (body.action === 'edit') Object.assign(asset, body.changes);
  if (body.action === 'custody') issue(asset);
  if (body.action === 'return') closeCustody(asset);
  if (body.action === 'release') closeTracker(asset);
  if (body.action === 'assign') {
    const row = { ...historyRow(asset.version), node_id: body.node_id, started_at: new Date().toISOString() };
    asset.node_id = body.node_id;
    asset.assigned_node = body.node_id;
    asset.node_status = 'OFFLINE';
    asset.tracker_started_at = row.started_at;
    asset.current_assignments = [row];
    asset.assignment_history = [row, ...asset.assignment_history ?? []];
    asset.location_observations = [{ id: 1, node_id: body.node_id, source: 'DIRECT_ANCHOR', quality: 'CONFIRMED',
      reported_zone: 'Level 2 Haulage', captured_at: null, received_at: new Date(Date.now() - 3_600_000).toISOString() }];
  }
  asset.version++;
  store();
  const result = { status: 'ok', action: body.action, version: asset.version, id: asset.id };
  sessionStorage.setItem(opKey, JSON.stringify(result));
  if (before.fixtureAssetLost === body.action) {
    delete before.fixtureAssetLost;
    throw new TypeError('Synthetic lost response');
  }
  return reply(result);
}

function issue(asset: AssetDetail) {
  const row = { ...historyRow(asset.version), ...named() };
  asset.current_custody = [row];
  asset.custody_history = [row, ...asset.custody_history ?? []];
  asset.custodian = { id: person.id, name: person.display_name, identifier: person.identifier, started_at: row.started_at };
}

function closeTracker(asset: AssetDetail) {
  const id = asset.current_assignments?.[0]?.id;
  const row = asset.assignment_history?.find(item => item.id === id);
  if (row) row.ended_at = new Date().toISOString();
  asset.current_assignments = [];
  asset.node_id = null;
  asset.assigned_node = null;
  asset.location_observations = [];
}

function closeCustody(asset: AssetDetail) {
  const id = asset.current_custody?.[0]?.id;
  const row = asset.custody_history?.find(item => item.id === id);
  if (row) row.ended_at = new Date().toISOString();
  asset.current_custody = [];
  asset.custodian = null;
}
