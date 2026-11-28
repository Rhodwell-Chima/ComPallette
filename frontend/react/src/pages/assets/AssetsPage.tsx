import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { Modal } from '../../platform/Modal';
import { FormField, SearchInput, Select } from '../../platform/form';
import { DataTable, type ColumnDef } from '../../platform/table';
import { Pagination } from '../../platform/pagination';
import { EmptyState, ErrorState } from '../../platform/ui';
import { platformApi } from '../../services/api';
import type { AssetFields, AssetItem, Site } from '../../types';
import {
  AssetEvidence, AssetForm, assetHref, emptyAsset, getAssetView, saveAssetView, scopeLost, statusLabel,
  statusOptions, useAssetSiteChange, type AssetOrigin,
} from './workflow';

const sizes = [25, 50, 100];
const prefs = 'compallette.assets';
const sorts = ['name', 'asset_type', 'operational_status'];
const narrowColumn = 'hidden lg:table-cell';
const filter = (params: URLSearchParams, name: string, options: string[], fallback = '') => {
  const value = params.get(name) ?? '';
  return options.includes(value) ? value : fallback;
};

export function AssetsPage() {
  const { selectedSite, can, scopeUnverified } = usePlatform();
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  useAssetSiteChange(client, selectedSite?.id, () => {
    setParams(params => {
      const next = new URLSearchParams(params);
      next.delete('page');
      return next;
    }, { replace: true, state: null });
  });
  useEffect(() => {
    const previous = document.title;
    document.title = 'Assets · ComPallette';
    return () => { document.title = previous; };
  }, []);
  if (!selectedSite) return <EmptyState title="No site selected" detail="Select a permitted site to view its asset registry." />;
  return <AssetRegistry key={selectedSite.id} site={selectedSite} canRegister={can('manage_assets') && !scopeUnverified} />;
}

function AssetRegistry({ site, canRegister }: { site: Site; canRegister: boolean }) {
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const origin = (location.state as { assetOrigin?: AssetOrigin } | null)?.assetOrigin;
  const [restore] = useState(() => getAssetView(client, site.id, origin?.site === site.id ? origin.key : location.key));
  const [search, setSearch] = useState(restore?.search ?? '');
  const [density, setDensity] = useState<'compact' | 'comfortable'>(() => {
    try { return localStorage.getItem(`${prefs}.density`) === 'comfortable' ? 'comfortable' : 'compact'; }
    catch { return 'compact'; }
  });
  const [register, setRegister] = useState(false);
  const [draft, setDraft] = useState(emptyAsset);
  const [registered, setRegistered] = useState<AssetItem>();
  const [notice, setNotice] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLHeadingElement>(null);
  const success = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const query = {
    q: search.trim(),
    page: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(params.get('page'))) || 1)),
    page_size: sizes.includes(Number(params.get('size'))) ? Number(params.get('size')) : 25,
    sort: filter(params, 'sort', sorts, 'name'),
    direction: filter(params, 'dir', ['asc', 'desc'], 'asc'),
    classification: params.get('classification') ?? '',
    status: params.get('status') ?? '',
    custody: filter(params, 'custody', ['issued', 'unissued']),
    tracker: filter(params, 'tracker', ['assigned', 'unassigned']),
    archive: filter(params, 'archive', ['current', 'archived', 'all'], 'current'),
  };
  const records = useQuery({
    queryKey: ['assets', site.id, query],
    queryFn: ({ signal }) => platformApi.assetRegistry(site.id, query, signal),
    placeholderData: (previous, previousQuery) => {
      const previousInput = previousQuery?.queryKey[2] as typeof query | undefined;
      return previousQuery?.queryKey[1] === site.id && previousInput
        && Object.entries(query).every(([key, value]) => key === 'page' || previousInput[key as keyof typeof query] === value)
        ? previous : undefined;
    },
  });
  const data = scopeLost(records.error) ? undefined : records.data;
  const currentPage = records.isPlaceholderData ? query.page : data?.page ?? query.page;
  const count = data?.count ?? 0;
  const rows = data?.assets.filter(asset => asset.site === site.id) ?? [];
  const frame = () => wrapper.current?.querySelector<HTMLElement>('[data-table-scroll]');
  const isFiltered = Boolean(query.q || query.classification || query.status || query.custody || query.tracker || query.archive !== 'current');
  const create = useMutation({
    mutationFn: (fields: AssetFields) => platformApi.createAsset({ ...fields, site: site.id }),
    onSuccess: asset => {
      void client.invalidateQueries({ queryKey: ['assets', site.id] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      if (asset.site !== site.id) return;
      setRegister(false);
      setRegistered(asset);
      requestAnimationFrame(() => success.current?.focus());
    },
  });

  function updateParams(changes: Record<string, string | number>, start = true) {
    const next = new URLSearchParams(params);
    if (start) next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, String(value));
      else next.delete(key);
    }
    setParams(next, { replace: true, state: location.state });
    setNotice('');
  }

  useEffect(() => {
    if (data?.page == null || currentPage === query.page || records.isFetching) return;
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (currentPage === 1) next.delete('page');
      else next.set('page', String(currentPage));
      return next;
    }, { replace: true, state: location.state });
  }, [currentPage, data?.page, location.state, query.page, records.isFetching, setParams]);

  useEffect(() => {
    if (restored.current || !restore || !data || records.isFetching) return;
    const request = requestAnimationFrame(() => {
      restored.current = true;
      window.scrollTo(0, restore.scroll);
      const table = wrapper.current?.querySelector<HTMLElement>('[data-table-scroll]');
      if (table) table.scrollTop = restore.tableScroll;
      const link = document.getElementById(`asset-link-${restore.id}`);
      if (link) link.focus({ preventScroll: true });
      else if (restore.id) {
        setNotice('This asset is outside the current registry view. Your filters are still applied.');
        results.current?.focus();
      }
    });
    return () => cancelAnimationFrame(request);
  }, [data, records.isFetching, restore]);

  function linkProps(asset: AssetItem, action = '') {
    const assetOrigin: AssetOrigin = { site: site.id, key: location.key, filters: location.search };
    return {
      to: `${assetHref(asset.id)}${action ? `?action=${action}` : ''}`,
      state: { assetOrigin },
      onClick: () => saveAssetView(client, assetOrigin, { id: asset.id, search, scroll: window.scrollY, tableScroll: frame()?.scrollTop ?? 0 }),
    };
  }
  const columns: ColumnDef<AssetItem>[] = [
    { key: 'name', header: 'Asset', required: true, sortable: true, render: asset => <div className="min-w-0 wrap-anywhere">
      <Link className="asset-link font-bold" id={`asset-link-${asset.id}`} {...linkProps(asset)}>{asset.name}</Link>
      <small className="mt-1 block text-[var(--muted)]">{asset.identifier}{asset.archived ? ' · Archived' : ''}</small>
      <div className="mt-1 text-xs text-[var(--muted)] lg:hidden">{statusLabel(asset.operational_status)} · {asset.custodian?.name ?? asset.node_id ?? 'No custodian'}</div>
    </div> },
    { key: 'asset_type', header: 'Classification', sortable: true, className: narrowColumn, render: asset => asset.asset_type || 'Unclassified' },
    { key: 'operational_status', header: 'Operational status', sortable: true, className: narrowColumn, render: asset => statusLabel(asset.operational_status) },
    { key: 'custody', header: 'Custodian', className: narrowColumn, render: asset => asset.custodian ? <>
      {asset.custodian.name}<small className="block text-[var(--muted)]">{asset.custodian.identifier}</small>
    </> : <span className="text-[var(--muted)]">No custodian</span> },
    { key: 'tracker', header: 'Tracker', className: narrowColumn, render: asset => asset.node_id || <span className="text-[var(--muted)]">No tracker assigned</span> },
    { key: 'location', header: 'Last reported location', className: narrowColumn, render: asset => <AssetEvidence asset={asset} timezone={site.timezone} /> },
  ];
  const classifications = Array.from(new Set([...(data?.classifications ?? []), query.classification])).filter(Boolean);
  const statuses = Array.from(new Set([...(data?.statuses ?? statusOptions), query.status])).filter(Boolean);
  const select = (label: string, key: string, value: string, options: { value: string; label: string }[]) =>
    <FormField label={label} size="sm" className="asset-filter">
      <Select value={value} options={options} onChange={event => updateParams({ [key]: event.target.value })} />
    </FormField>;

  return <div className="asset-page grid min-w-0 gap-4">
    <header className="flex flex-wrap items-start justify-between gap-3 pb-1">
      <div><h1 className="asset-title">Assets</h1><p className="mt-1 text-sm text-[var(--muted)]">{site.name}</p></div>
      {canRegister && <button type="button" className="button primary" onClick={() => {
        create.reset(); setDraft(emptyAsset); setRegister(true);
      }}><Plus size={16} /> Register asset</button>}
    </header>
    {registered && <div ref={success} tabIndex={-1} role="status" className="panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <strong>{registered.name} registered</strong>
      <div className="flex flex-wrap gap-2">
        <Link className="button primary" {...linkProps(registered)}>View asset</Link>
        {canRegister && <><Link className="button secondary" {...linkProps(registered, 'assign')}>Assign tracker</Link>
          <Link className="button secondary" {...linkProps(registered, 'custody')}>Issue custody</Link></>}
      </div>
    </div>}
    <section className="panel min-w-0 p-3 sm:p-4" aria-labelledby="asset-results">
      <div className="grid gap-3 border-b border-[var(--border)] pb-3">
        <SearchInput role="searchbox" aria-label="Search assets" placeholder="Search by name, asset ID, or classification" value={search}
          onChange={event => { setSearch(event.target.value); updateParams({}); }}
          onClear={() => { setSearch(''); updateParams({}); }} />
        <div className="grid grid-cols-2 items-end gap-x-2 gap-y-1 sm:grid-cols-3 xl:grid-cols-5">
          {select('Classification', 'classification', query.classification, [{ value: '', label: 'All classifications' }, ...classifications.map(value => ({ value, label: value }))])}
          {select('Operational status', 'status', query.status, [{ value: '', label: 'All statuses' }, ...statuses.map(value => ({ value, label: statusLabel(value) }))])}
          {select('Custody', 'custody', query.custody, [{ value: '', label: 'All custody states' }, { value: 'issued', label: 'Issued' }, { value: 'unissued', label: 'No custodian' }])}
          {select('Tracker', 'tracker', query.tracker, [{ value: '', label: 'All tracker states' }, { value: 'assigned', label: 'Assigned' }, { value: 'unassigned', label: 'Unassigned' }])}
          {select('Record visibility', 'archive', query.archive, [{ value: 'current', label: 'Current assets' }, { value: 'archived', label: 'Archived assets' }, { value: 'all', label: 'All records' }])}
        </div>
      </div>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <h2 ref={results} id="asset-results" tabIndex={-1} className="font-semibold">Asset registry</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          {data?.site_total !== undefined && <span>{data.site_total} current assets at this site</span>}
          {isFiltered && <button type="button" className="button ghost" onClick={() => {
            setSearch(''); updateParams({ classification: '', status: '', custody: '', tracker: '', archive: '' });
          }}>Clear filters</button>}
        </div>
      </div>
      {notice && <p role="status" className="mb-2 text-sm text-[var(--muted)]">{notice}</p>}
      {records.isError && <ErrorState message={data ? 'Showing prior results for these filters. Refresh failed.' : 'Asset records could not be loaded.'}
        retry={() => void records.refetch()} />}
      {(!records.isError || data) && <div ref={wrapper} aria-busy={records.isFetching}>
        <DataTable className="asset-table" data={rows} columns={columns} keyExtractor={asset => asset.id}
          isLoading={records.isPending || records.isPlaceholderData} emptyMessage={isFiltered ? 'No assets match these filters' : 'No assets registered at this site'}
          density={density} columnPreferenceKey={`${prefs}.columns`}
          onDensityChange={value => { setDensity(value); try { localStorage.setItem(`${prefs}.density`, value); } catch { /* Optional preference. */ } }}
          sortState={{ field: query.sort, direction: query.direction === 'desc' ? 'desc' : 'asc' }}
          onSortChange={sort => updateParams({ sort: sort.field, dir: sort.direction ?? '' })} />
      </div>}
      {data && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">Assets per page
          <select className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2" value={query.page_size}
            onChange={event => updateParams({ size: event.target.value })}>
            {sizes.map(size => <option key={size}>{size}</option>)}
          </select>
        </label>
        <Pagination variant="compact" currentPage={currentPage} totalPages={Math.ceil(count / query.page_size)}
          totalItems={count} pageSize={query.page_size} itemLabel="assets" enableKeyboardNavigation={false}
          onPageChange={page => updateParams({ page }, false)} />
      </div>}
    </section>
    <Modal className="asset-modal" isOpen={register && canRegister} onClose={() => { if (!create.isPending) setRegister(false); }}
      title="Register asset" subtitle={site.name}>
      <AssetForm value={draft} onChange={setDraft} onClose={() => setRegister(false)} onSubmit={fields => create.mutate(fields)}
        pending={create.isPending} error={create.error} />
    </Modal>
  </div>;
}
