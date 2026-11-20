import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, platformApi } from '../services/api';
import { usePlatform } from '../platform/PlatformContext';
import { Modal } from '../platform/Modal';
import { ErrorState, LoadingState, PageHeader, LocationLabel } from '../platform/ui';

type Kind = 'personnel' | 'assets' | 'devices';
type Impact = { assignment_ids: number[]; custody_ids: number[] };
type HistoryItem = { id: number; node_id?: string; personnel_id?: number; asset_id?: number; started_at: string; ended_at?: string };

export function EntityDetailPage({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const { selectedSiteId } = usePlatform();
  return <EntityDetailContent key={`${kind}:${id}:${selectedSiteId}`} kind={kind} id={id} />;
}

function EntityDetailContent({ kind, id }: { kind: Kind; id: string }) {
  const { selectedSiteId, sites, setSelectedSiteId, can } = usePlatform();
  const client = useQueryClient();
  const record = useQuery({ queryKey: ['entity', kind, id, selectedSiteId], queryFn: () => platformApi.entity(kind, id) });
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState<Impact>();
  const [feedback, setFeedback] = useState('');
  const [uncertainInput, setUncertainInput] = useState<Record<string, unknown>>();
  const options = useQuery({ queryKey: ['eligible-devices', selectedSiteId, search], queryFn: () => platformApi.eligibleDevices(selectedSiteId!, search), enabled: action === 'assign' && !!selectedSiteId });
  const people = useQuery({ queryKey: ['personnel', selectedSiteId, search], queryFn: () => platformApi.personnel(selectedSiteId, search), enabled: action === 'custody' && !!selectedSiteId });
  const accounts = useQuery({ queryKey: ['link-accounts', selectedSiteId, search], queryFn: () => platformApi.users({ site_id: selectedSiteId, search }), enabled: action === 'link_user' && can('manage_users') });
  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => platformApi.entityAction(kind, id, input),
    onSuccess: async () => {
      setAction(''); setUncertainInput(undefined); setFeedback('Change saved.');
      await Promise.all(['entity', 'personnel', 'assets', 'devices', 'dashboard', 'digital-twin', 'twin', 'audit', 'eligible-devices'].map(key => client.invalidateQueries({ queryKey: [key] })));
    },
    onError: async (error: Error, input) => {
      const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
      setUncertainInput(rejected ? undefined : input);
      setFeedback(rejected ? `Change rejected: ${error.message}` : 'Outcome could not be confirmed. Refreshing the record. A retry will use the same operation ID.');
      await record.refetch();
    },
  });
  const data = record.data;
  if (record.isLoading) return <LoadingState label="Loading linked record…" />;
  if (record.isError || !data) return <ErrorState message="Record could not be loaded or is outside your access." retry={() => void record.refetch()} />;
  if (data.site !== selectedSiteId) return <section className="panel"><h1>Record belongs to another site</h1><button className="button primary" onClick={() => setSelectedSiteId(data.site)}>Switch to {sites.find(s => s.id === data.site)?.name ?? 'record site'}</button></section>;
  const assignments: HistoryItem[] = data.current_assignments ?? [];
  const custody: HistoryItem[] = data.current_custody ?? [];
  const permitted = can(kind === 'devices' ? 'manage_devices' : 'manage_assets') && !data.archived;
  const open = (next: string) => { setAction(next); setTarget(''); setSearch(''); setReason(''); setImpact(undefined); setFeedback(''); setUncertainInput(undefined); mutation.reset(); };
  const submit = () => {
    if (mutation.isPending || record.isFetching) return;
    if (uncertainInput) { mutation.mutate(uncertainInput); return; }
    const input: Record<string, unknown> = { action, operation_id: crypto.randomUUID(), expected_version: data.version, reason };
    if (action === 'assign') input.node_id = target;
    if (action === 'custody') input.personnel_id = Number(target);
    if (action === 'link_user') input.user_id = target ? Number(target) : null;
    if (action === 'release') input.relationship_id = assignments[0]?.id;
    if (action === 'return') input.relationship_id = custody[0]?.id;
    if (action === 'transfer') { input.destination_site = Number(target); input.confirmed_relationships = impact; }
    if (action === 'archive') input.confirmed_relationships = { assignment_ids: assignments.map(x => x.id), custody_ids: custody.map(x => x.id) };
    if (action === 'edit') input.changes = kind === 'personnel' ? { display_name: target } : { name: target };
    mutation.mutate(input);
  };
  return <>
    <PageHeader eyebrow={kind.toUpperCase()} title={data.display_name ?? data.name ?? data.node_id} description={`Identifier: ${data.identifier ?? data.node_id} · Version ${data.version}${data.archived ? ' · Archived' : ''}`} />
    <p><Link to={`/${kind}`}>Back to {kind}</Link></p>
    {feedback && <p role="status">{feedback}</p>}
    <section className="panel" style={{ padding: '1rem' }}>
      <h2>Current relationships</h2>
      <LocationLabel evidence={data.location_evidence ?? 'UNKNOWN'} zone={data.current_zone} />
      <p>Zone membership only. A configured zone or custody assignment does not establish observed presence.</p>
      {assignments.length ? assignments.map(item => <p key={item.id}>Device <Link to={`/devices/${encodeURIComponent(item.node_id ?? '')}`}>{item.node_id}</Link>{item.personnel_id && <> · <Link to={`/personnel/${item.personnel_id}`}>Personnel #{item.personnel_id}</Link></>}{item.asset_id && <> · <Link to={`/assets/${item.asset_id}`}>Asset #{item.asset_id}</Link></>}</p>) : <p>No active device assignment.</p>}
      {custody.map(item => <p key={item.id}>Custodian: <Link to={`/personnel/${item.personnel_id}`}>Personnel #{item.personnel_id}</Link> · <Link to={`/assets/${item.asset_id}`}>Asset #{item.asset_id}</Link></p>)}
      {kind === 'personnel' && <p>Operator account ID: {data.user_id ?? 'None'}</p>}
      {permitted && <div className="entity-actions">
        {kind === 'personnel' && can('manage_users') && <button className="button" onClick={() => open('link_user')}>Link operator account</button>}
        {kind !== 'devices' && <button className="button" onClick={() => open('edit')}>Edit name</button>}
        {kind !== 'devices' && !assignments.length && <button className="button primary" onClick={() => open('assign')}>Assign device</button>}
        {!!assignments.length && <button className="button" onClick={() => open('release')}>Return device</button>}
        {kind === 'assets' && <button className="button" onClick={() => open(custody.length ? 'return' : 'custody')}>{custody.length ? 'Return custody' : 'Issue custody'}</button>}
        <button className="button" onClick={() => open('transfer')}>Transfer site</button>
        <button className="button" onClick={() => open('archive')}>Archive</button>
      </div>}
    </section>
    <Modal isOpen={!!action} onClose={() => !mutation.isPending && setAction('')} title={`${action === 'assign' ? 'Assign device' : action} · ${data.display_name ?? data.name ?? id}`}>
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <fieldset disabled={mutation.isPending || !!uncertainInput} style={{ border: 0, padding: 0 }}>
          {['assign', 'custody', 'link_user'].includes(action) && <label>Search <input value={search} onChange={e => setSearch(e.target.value)} /></label>}
          {action === 'assign' && <label>Eligible device <select required value={target} onChange={e => setTarget(e.target.value)}><option value="">Select a device</option>{options.data?.nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}</select>{options.isError && <p role="alert">Devices could not be loaded.</p>}</label>}
          {action === 'custody' && <label>Responsible person <select required value={target} onChange={e => setTarget(e.target.value)}><option value="">Select a person</option>{people.data?.personnel.map(p => <option key={p.id} value={p.id}>{p.display_name} · {p.identifier}</option>)}</select>{people.isError && <p role="alert">Personnel could not be loaded.</p>}</label>}
          {action === 'link_user' && <label>Operator account <select value={target} onChange={e => setTarget(e.target.value)}><option value="">No linked account</option>{accounts.data?.users.map(account => <option key={account.id} value={account.id}>{account.username}</option>)}</select><p>Select an explicit account; names are never matched automatically.</p>{accounts.isError && <p role="alert">Accounts could not be loaded.</p>}</label>}
          {action === 'edit' && <label>Name <input required value={target} onChange={e => setTarget(e.target.value)} /></label>}
          {action === 'transfer' && <><label>Destination <select required value={target} onChange={e => { setTarget(e.target.value); setImpact(undefined); }}><option value="">Select a site</option>{sites.filter(s => s.id !== selectedSiteId && s.organisation === data.organisation).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button type="button" className="button" disabled={!target} onClick={() => void platformApi.transferPreview(kind, id, Number(target)).then(setImpact).catch(e => setFeedback(e.message))}>Preview affected relationships</button>{impact && <p>Will close assignments: {impact.assignment_ids.join(', ') || 'none'}; custody: {impact.custody_ids.join(', ') || 'none'}.</p>}</>}
          {action === 'archive' && <p>This archives the record and closes its {assignments.length} device assignments and {custody.length} custody relationships. History is preserved.</p>}
          <label>Reason <textarea value={reason} required={['release', 'return', 'transfer', 'archive'].includes(action)} onChange={e => setReason(e.target.value)} /></label>
        </fieldset>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
        <div className="entity-actions"><button type="button" className="button" disabled={mutation.isPending} onClick={() => setAction('')}>Cancel</button><button className="button primary" disabled={mutation.isPending || record.isFetching || (action === 'transfer' && !impact)}>{mutation.isPending ? 'Saving…' : uncertainInput ? 'Retry same operation' : 'Confirm'}</button></div>
      </form>
    </Modal>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>History</h2>
      <h3>Device assignments</h3>{data.assignment_history?.map((item: HistoryItem) => <p key={item.id}>{item.node_id} · {new Date(item.started_at).toLocaleString()} → {item.ended_at ? new Date(item.ended_at).toLocaleString() : 'Current'}</p>)}
      <h3>Asset custody</h3>{data.custody_history?.map((item: HistoryItem) => <p key={item.id}>Asset #{item.asset_id} · Personnel #{item.personnel_id} · {new Date(item.started_at).toLocaleString()} → {item.ended_at ? new Date(item.ended_at).toLocaleString() : 'Current'}</p>)}
      <h3>Device incidents</h3><p>Device history does not establish who carried it when a delayed event was captured.</p>{data.device_alerts?.map((item: any) => <p key={item.id}><Link to={`/alerts?alert=${item.id}`}>#{item.id} · {item.alert_code} · {item.status}</Link></p>)}
      <h3>Recent device measurements</h3>{data.measurements?.length ? data.measurements.map((item: any) => <p key={item.id}>{item.node_id} · {item.measurement_key}: {item.value} {item.unit} · received {new Date(item.received_at).toLocaleString()}</p>) : <p>No recorded measurements for this device in this site.</p>}
      <h3>Audit history</h3>{data.audit?.map((item: any) => <p key={item.id}>{item.action} · {item.actor} · {new Date(item.timestamp).toLocaleString()}</p>)}
      <h3>Location evidence</h3>{data.location_observations?.map((item: any) => <p key={item.id}>{item.reported_zone} · {item.source} · {item.quality} · received {new Date(item.received_at).toLocaleString()}{item.captured_at ? '' : ' · capture time unknown'}</p>)}
    </section>
  </>;
}
