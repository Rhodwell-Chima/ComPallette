import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Search, Users } from 'lucide-react';
import { platformApi } from '../services/api';
import { AssetItem, PersonnelItem } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, PageHeader, StatusPill } from '../platform/ui';

function RegistrySearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="registry-search"><Search size={17} /><input value={value} onChange={event => onChange(event.target.value)} placeholder="Search by name, identifier, or classification" /></label>;
}

export function PersonnelPage() {
  const { selectedSiteId, can } = usePlatform();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ identifier: '', display_name: '', team: '', employment_status: 'ACTIVE' });
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ['personnel', selectedSiteId, search], queryFn: () => platformApi.personnel(selectedSiteId, search), enabled: Boolean(selectedSiteId) });
  const create = useMutation({ mutationFn: () => platformApi.createPersonnel({ ...form, site: selectedSiteId }), onSuccess: () => { setForm({ identifier: '', display_name: '', team: '', employment_status: 'ACTIVE' }); setShowForm(false); void queryClient.invalidateQueries({ queryKey: ['personnel'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to view its personnel registry." />;
  if (records.isLoading) return <LoadingState label="Loading personnel registry…" />;
  if (records.isError || !records.data) return <ErrorState message="Personnel records could not be loaded." retry={() => void records.refetch()} />;
  return <>
    <PageHeader eyebrow="OPERATIONS" title="Personnel" description="A site-scoped people registry that keeps reported location evidence separate from identity and assignment." actions={can('manage_assets') ? <button className="button primary" onClick={() => setShowForm(value => !value)}><Plus size={16} /> Register person</button> : undefined} />
    {showForm && <form className="inline-form panel" onSubmit={submit}><h2>Register personnel</h2><label>Identifier<input required value={form.identifier} onChange={event => setForm({ ...form, identifier: event.target.value })} /></label><label>Display name<input required value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} /></label><label>Team<input value={form.team} onChange={event => setForm({ ...form, team: event.target.value })} /></label><label>Status<select value={form.employment_status} onChange={event => setForm({ ...form, employment_status: event.target.value })}><option>ACTIVE</option><option>INACTIVE</option></select></label><div><button className="button primary" disabled={create.isPending}>Save person</button><button type="button" className="button ghost" onClick={() => setShowForm(false)}>Cancel</button></div>{create.error && <p className="form-error">The person could not be registered. Check the identifier and site permissions.</p>}</form>}
    <section className="panel registry-panel"><div className="panel-toolbar"><RegistrySearch value={search} onChange={setSearch} /><span>{records.data.count} people</span></div>{records.data.personnel.length ? <div className="table-scroll"><table><thead><tr><th>Person</th><th>Team</th><th>Assigned device</th><th>Location evidence</th><th>Device state</th></tr></thead><tbody>{records.data.personnel.map(person => <PersonnelRow person={person} key={person.id} />)}</tbody></table></div> : <EmptyState title="No personnel in this site" detail="Register people only when the selected site has a genuine operational need to track them." />}</section>
  </>;
}

function PersonnelRow({ person }: { person: PersonnelItem }) {
  return <tr><td><strong>{person.display_name}</strong><small>{person.identifier}</small></td><td>{person.team || '—'}</td><td>{person.node_id || 'Not assigned'}</td><td><LocationLabel evidence={person.location_evidence} zone={person.current_zone} /></td><td><NodeStatusPill status={person.node_status} /></td></tr>;
}

export function AssetsPage() {
  const { selectedSiteId, can } = usePlatform();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ identifier: '', name: '', asset_type: '', operational_status: 'ACTIVE' });
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ['assets', selectedSiteId, search], queryFn: () => platformApi.assets(selectedSiteId, search), enabled: Boolean(selectedSiteId) });
  const create = useMutation({ mutationFn: () => platformApi.createAsset({ ...form, site: selectedSiteId }), onSuccess: () => { setForm({ identifier: '', name: '', asset_type: '', operational_status: 'ACTIVE' }); setShowForm(false); void queryClient.invalidateQueries({ queryKey: ['assets'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to view its asset registry." />;
  if (records.isLoading) return <LoadingState label="Loading asset registry…" />;
  if (records.isError || !records.data) return <ErrorState message="Asset records could not be loaded." retry={() => void records.refetch()} />;
  return <>
    <PageHeader eyebrow="OPERATIONS" title="Assets" description="Track equipment identities and their last reported zone without claiming more precision than backend evidence supports." actions={can('manage_assets') ? <button className="button primary" onClick={() => setShowForm(value => !value)}><Plus size={16} /> Register asset</button> : undefined} />
    {showForm && <form className="inline-form panel" onSubmit={submit}><h2>Register asset</h2><label>Identifier<input required value={form.identifier} onChange={event => setForm({ ...form, identifier: event.target.value })} /></label><label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Classification<input value={form.asset_type} onChange={event => setForm({ ...form, asset_type: event.target.value })} /></label><label>Status<select value={form.operational_status} onChange={event => setForm({ ...form, operational_status: event.target.value })}><option>ACTIVE</option><option>MAINTENANCE</option><option>INACTIVE</option></select></label><div><button className="button primary" disabled={create.isPending}>Save asset</button><button type="button" className="button ghost" onClick={() => setShowForm(false)}>Cancel</button></div>{create.error && <p className="form-error">The asset could not be registered. Check the identifier and site permissions.</p>}</form>}
    <section className="panel registry-panel"><div className="panel-toolbar"><RegistrySearch value={search} onChange={setSearch} /><span>{records.data.count} assets</span></div>{records.data.assets.length ? <div className="table-scroll"><table><thead><tr><th>Asset</th><th>Classification</th><th>Operational status</th><th>Assigned device</th><th>Location evidence</th></tr></thead><tbody>{records.data.assets.map(asset => <AssetRow asset={asset} key={asset.id} />)}</tbody></table></div> : <EmptyState title="No assets in this site" detail="Add an asset when it is a valuable operational resource, not simply to populate the interface." />}</section>
  </>;
}

function AssetRow({ asset }: { asset: AssetItem }) {
  return <tr><td><strong>{asset.name}</strong><small>{asset.identifier}</small></td><td>{asset.asset_type || '—'}</td><td><StatusPill value={asset.operational_status} /></td><td>{asset.node_id || 'Not assigned'}</td><td><LocationLabel evidence={asset.location_evidence} zone={asset.current_zone} /></td></tr>;
}
