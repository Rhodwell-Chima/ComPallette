import { Link } from 'react-router-dom';
import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Plus, Users, UserPlus, PackagePlus } from 'lucide-react';
import { platformApi } from '../services/api';
import { AssetItem, PersonnelItem } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, PageHeader, StatusPill } from '../platform/ui';
import { FormField, Input, Select, SearchInput } from '../platform/form';
import { DataTable, ColumnDef, SortState } from '../platform/table';
import { Modal } from '../platform/Modal';

export function PersonnelPage() {
  const { selectedSiteId, can } = usePlatform();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
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
      setShowModal(false);
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
          <strong style={{ display: 'block', color: 'var(--text)' }}><Link to={`/personnel/${person.id}`}>{person.display_name}</Link></strong>
          <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{person.identifier}</small>
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
            <button className="button primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Register person
            </button>
          ) : undefined
        }
      />

      {/* Pop-up Modal for Personnel Registration */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Register Personnel"
        subtitle="Create an operational personnel identity mapped to site tracking credentials."
        maxWidth="500px"
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <FormField label="Personnel Identifier" required helperText="Unique organizational badge or payroll ID">
            <Input
              required
              value={form.identifier}
              placeholder="e.g. PER-0082"
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
            />
          </FormField>

          <FormField label="Display Name" required helperText="Full operational name displayed in Twin and tables">
            <Input
              required
              value={form.display_name}
              placeholder="e.g. John Doe"
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </FormField>

          <FormField label="Team / Crew" helperText="Operational department or assignment">
            <Input
              value={form.team}
              placeholder="e.g. Ventilation Crew Shift-1"
              onChange={(e) => setForm({ ...form, team: e.target.value })}
            />
          </FormField>

          <FormField label="Employment Status" required>
            <Select
              value={form.employment_status}
              options={[
                { value: 'ACTIVE', label: 'ACTIVE' },
                { value: 'INACTIVE', label: 'INACTIVE' },
              ]}
              onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
            />
          </FormField>

          {create.error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger, #ef4444)',
                borderRadius: '7px',
                padding: '0.65rem 0.85rem',
                color: 'var(--danger, #ef4444)',
                fontSize: '0.82rem',
                marginTop: '0.25rem',
              }}
            >
              The person could not be registered. Ensure the identifier is unique and permissions are valid.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button type="button" className="button ghost" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={create.isPending}>
              <UserPlus size={16} />
              {create.isPending ? 'Saving...' : 'Register Person'}
            </button>
          </div>
        </form>
      </Modal>

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
  const [showModal, setShowModal] = useState(false);
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
      setShowModal(false);
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
          <strong style={{ display: 'block', color: 'var(--text)' }}><Link to={`/assets/${asset.id}`}>{asset.name}</Link></strong>
          <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{asset.identifier}</small>
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
            <button className="button primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Register asset
            </button>
          ) : undefined
        }
      />

      {/* Pop-up Modal for Asset Registration */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Register Asset"
        subtitle="Register mobile machinery, fixed infrastructure, or industrial tools for tracking."
        maxWidth="500px"
      >
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <FormField label="Asset Identifier" required helperText="Unique equipment serial or asset number">
            <Input
              required
              value={form.identifier}
              placeholder="e.g. VEH-HAUL-04"
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
            />
          </FormField>

          <FormField label="Asset Name" required helperText="Operational label visible across maps and telemetry">
            <Input
              required
              value={form.name}
              placeholder="e.g. Haul Truck 04 (Cat 793F)"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>

          <FormField label="Classification" helperText="Equipment category (e.g. Hauler, Drill, Ventilation)">
            <Input
              value={form.asset_type}
              placeholder="e.g. Heavy Haulage"
              onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
            />
          </FormField>

          <FormField label="Operational Status" required>
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

          {create.error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger, #ef4444)',
                borderRadius: '7px',
                padding: '0.65rem 0.85rem',
                color: 'var(--danger, #ef4444)',
                fontSize: '0.82rem',
                marginTop: '0.25rem',
              }}
            >
              The asset could not be registered. Ensure the identifier is unique and permissions are valid.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button type="button" className="button ghost" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={create.isPending}>
              <PackagePlus size={16} />
              {create.isPending ? 'Saving...' : 'Register Asset'}
            </button>
          </div>
        </form>
      </Modal>

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
