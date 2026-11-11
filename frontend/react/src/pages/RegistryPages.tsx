import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Users } from 'lucide-react';
import { platformApi } from '../services/api';
import { AssetItem, PersonnelItem } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, PageHeader, StatusPill } from '../platform/ui';
import { FormField, Input, Select, SearchInput } from '../platform/form';
import { DataTable, ColumnDef, SortState } from '../platform/table';

export function PersonnelPage() {
  const { selectedSiteId, can } = usePlatform();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [sortState, setSortState] = useState<SortState>({ field: 'display_name', direction: 'asc' });
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [form, setForm] = useState({ identifier: '', display_name: '', team: '', employment_status: 'ACTIVE' });

  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ['personnel', selectedSiteId, search],
    queryFn: () => platformApi.personnel(selectedSiteId, search),
    enabled: Boolean(selectedSiteId),
  });

  const create = useMutation({
    mutationFn: () => platformApi.createPersonnel({ ...form, site: selectedSiteId }),
    onSuccess: () => {
      setForm({ identifier: '', display_name: '', team: '', employment_status: 'ACTIVE' });
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['personnel'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const columns: ColumnDef<PersonnelItem>[] = useMemo(() => [
    {
      key: 'display_name',
      header: 'Person',
      sortable: true,
      render: (person) => (
        <div>
          <strong style={{ display: 'block', color: 'var(--color-text, #f8fafc)' }}>{person.display_name}</strong>
          <small style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.75rem' }}>{person.identifier}</small>
        </div>
      ),
    },
    {
      key: 'team',
      header: 'Team',
      sortable: true,
      render: (person) => <span>{person.team || '—'}</span>,
    },
    {
      key: 'node_id',
      header: 'Assigned Device',
      render: (person) => <span>{person.node_id || 'Not assigned'}</span>,
    },
    {
      key: 'location_evidence',
      header: 'Location Evidence',
      render: (person) => <LocationLabel evidence={person.location_evidence} zone={person.current_zone} />,
    },
    {
      key: 'node_status',
      header: 'Device State',
      render: (person) => <NodeStatusPill status={person.node_status} />,
    },
  ], []);

  const sortedData = useMemo(() => {
    if (!records.data?.personnel) return [];
    const list = [...records.data.personnel];
    if (!sortState.direction) return list;
    return list.sort((a, b) => {
      const field = sortState.field as keyof PersonnelItem;
      const valA = String(a[field] ?? '');
      const valB = String(b[field] ?? '');
      return sortState.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [records.data?.personnel, sortState]);

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to view its personnel registry." />;
  if (records.isLoading) return <LoadingState label="Loading personnel registry…" />;
  if (records.isError || !records.data) return <ErrorState message="Personnel records could not be loaded." retry={() => void records.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Personnel"
        description="A site-scoped people registry that keeps reported location evidence separate from identity and assignment."
        actions={
          can('manage_assets') ? (
            <button className="button primary" onClick={() => setShowForm((value) => !value)}>
              <Plus size={16} /> Register person
            </button>
          ) : undefined
        }
      />

      {showForm && (
        <form className="inline-form panel" onSubmit={submit} style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Register Personnel</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <FormField label="Identifier" required>
              <Input
                required
                value={form.identifier}
                placeholder="e.g. PER-0082"
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              />
            </FormField>

            <FormField label="Display Name" required>
              <Input
                required
                value={form.display_name}
                placeholder="e.g. John Doe"
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </FormField>

            <FormField label="Team">
              <Input
                value={form.team}
                placeholder="e.g. Ventilation Crew"
                onChange={(e) => setForm({ ...form, team: e.target.value })}
              />
            </FormField>

            <FormField label="Status">
              <Select
                value={form.employment_status}
                options={[
                  { value: 'ACTIVE', label: 'ACTIVE' },
                  { value: 'INACTIVE', label: 'INACTIVE' },
                ]}
                onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
              />
            </FormField>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="button primary" disabled={create.isPending}>
              {create.isPending ? 'Saving...' : 'Save person'}
            </button>
            <button type="button" className="button ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
          {create.error && (
            <p className="form-error" style={{ color: 'var(--color-error, #ef4444)', marginTop: '0.5rem', fontSize: '0.84rem' }}>
              The person could not be registered. Check the identifier and site permissions.
            </p>
          )}
        </form>
      )}

      <section className="panel registry-panel" style={{ padding: '1.25rem' }}>
        <DataTable
          columns={columns}
          data={sortedData}
          keyExtractor={(p) => p.id}
          sortState={sortState}
          onSortChange={setSortState}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderToolbar={() => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', maxWidth: '380px' }}>
              <SearchInput
                placeholder="Search by name, ID, or team..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
              />
            </div>
          )}
          renderBulkActions={(ids) => (
            <button
              type="button"
              className="button ghost"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => alert(`Exporting ${ids.length} selected records`)}
            >
              Export Selected ({ids.length})
            </button>
          )}
          emptyMessage="No personnel records found in this site."
        />
      </section>
    </>
  );
}

export function AssetsPage() {
  const { selectedSiteId, can } = usePlatform();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [sortState, setSortState] = useState<SortState>({ field: 'name', direction: 'asc' });
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [form, setForm] = useState({ identifier: '', name: '', asset_type: '', operational_status: 'ACTIVE' });

  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ['assets', selectedSiteId, search],
    queryFn: () => platformApi.assets(selectedSiteId, search),
    enabled: Boolean(selectedSiteId),
  });

  const create = useMutation({
    mutationFn: () => platformApi.createAsset({ ...form, site: selectedSiteId }),
    onSuccess: () => {
      setForm({ identifier: '', name: '', asset_type: '', operational_status: 'ACTIVE' });
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const columns: ColumnDef<AssetItem>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Asset',
      sortable: true,
      render: (asset) => (
        <div>
          <strong style={{ display: 'block', color: 'var(--color-text, #f8fafc)' }}>{asset.name}</strong>
          <small style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.75rem' }}>{asset.identifier}</small>
        </div>
      ),
    },
    {
      key: 'asset_type',
      header: 'Classification',
      sortable: true,
      render: (asset) => <span>{asset.asset_type || '—'}</span>,
    },
    {
      key: 'operational_status',
      header: 'Operational Status',
      sortable: true,
      render: (asset) => <StatusPill value={asset.operational_status} />,
    },
    {
      key: 'node_id',
      header: 'Assigned Device',
      render: (asset) => <span>{asset.node_id || 'Not assigned'}</span>,
    },
    {
      key: 'location_evidence',
      header: 'Location Evidence',
      render: (asset) => <LocationLabel evidence={asset.location_evidence} zone={asset.current_zone} />,
    },
  ], []);

  const sortedData = useMemo(() => {
    if (!records.data?.assets) return [];
    const list = [...records.data.assets];
    if (!sortState.direction) return list;
    return list.sort((a, b) => {
      const field = sortState.field as keyof AssetItem;
      const valA = String(a[field] ?? '');
      const valB = String(b[field] ?? '');
      return sortState.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [records.data?.assets, sortState]);

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to view its asset registry." />;
  if (records.isLoading) return <LoadingState label="Loading asset registry…" />;
  if (records.isError || !records.data) return <ErrorState message="Asset records could not be loaded." retry={() => void records.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS"
        title="Assets"
        description="Track equipment identities and their last reported zone without claiming more precision than backend evidence supports."
        actions={
          can('manage_assets') ? (
            <button className="button primary" onClick={() => setShowForm((value) => !value)}>
              <Plus size={16} /> Register asset
            </button>
          ) : undefined
        }
      />

      {showForm && (
        <form className="inline-form panel" onSubmit={submit} style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Register Asset</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <FormField label="Identifier" required>
              <Input
                required
                value={form.identifier}
                placeholder="e.g. VEH-HAUL-04"
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              />
            </FormField>

            <FormField label="Name" required>
              <Input
                required
                value={form.name}
                placeholder="e.g. Haul Truck 04"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>

            <FormField label="Classification">
              <Input
                value={form.asset_type}
                placeholder="e.g. Heavy Equipment"
                onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
              />
            </FormField>

            <FormField label="Status">
              <Select
                value={form.operational_status}
                options={[
                  { value: 'ACTIVE', label: 'ACTIVE' },
                  { value: 'MAINTENANCE', label: 'MAINTENANCE' },
                  { value: 'INACTIVE', label: 'INACTIVE' },
                ]}
                onChange={(e) => setForm({ ...form, operational_status: e.target.value })}
              />
            </FormField>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="button primary" disabled={create.isPending}>
              {create.isPending ? 'Saving...' : 'Save asset'}
            </button>
            <button type="button" className="button ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
          {create.error && (
            <p className="form-error" style={{ color: 'var(--color-error, #ef4444)', marginTop: '0.5rem', fontSize: '0.84rem' }}>
              The asset could not be registered. Check the identifier and site permissions.
            </p>
          )}
        </form>
      )}

      <section className="panel registry-panel" style={{ padding: '1.25rem' }}>
        <DataTable
          columns={columns}
          data={sortedData}
          keyExtractor={(a) => a.id}
          sortState={sortState}
          onSortChange={setSortState}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          renderToolbar={() => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', maxWidth: '380px' }}>
              <SearchInput
                placeholder="Search by asset name, ID, or type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
              />
            </div>
          )}
          renderBulkActions={(ids) => (
            <button
              type="button"
              className="button ghost"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              onClick={() => alert(`Exporting ${ids.length} selected assets`)}
            >
              Export Selected ({ids.length})
            </button>
          )}
          emptyMessage="No assets found in this site."
        />
      </section>
    </>
  );
}

