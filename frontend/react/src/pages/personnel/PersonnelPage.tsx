import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Plus, Search, X } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { Modal } from '../../platform/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../platform/ui';
import { Pagination } from '../../platform/pagination';
import { platformApi } from '../../services/api';
import type { PersonnelFields, PersonnelItem } from '../../types';
import {
  PersonEvidence, PersonForm, WearableState, newPerson, permissionLost, personRole, readableStatus,
  recallRoster, rememberRoster, rosterKey, useClearRosterOnSiteChange, type RosterReturn,
} from './workflow';
import './personnel.css';

const PAGE_SIZE = 20;
const preferencesKey = 'compallette.personnel.table';
const columns = [
  ['person', 'Person'], ['role', 'Role'], ['team', 'Team / crew'], ['wearable', 'Wearable'],
  ['location', 'Location evidence'], ['state', 'Device state'], ['employment', 'Employment status'],
] as const;
type Column = typeof columns[number][0];
type Preferences = { density: 'compact' | 'comfortable'; columns: Column[] };
const defaults: Preferences = { density: 'compact', columns: ['person', 'role', 'team', 'wearable', 'location', 'state'] };
const sortable = new Set<Column>(['person', 'role', 'team', 'wearable', 'employment']);
const normalized = (text?: string | null) => (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? 'null') as Partial<Preferences> | null;
    if (saved && Array.isArray(saved.columns)) return {
      density: saved.density === 'comfortable' ? 'comfortable' : 'compact',
      columns: columns.filter(([key]) => key === 'person' || saved.columns!.includes(key)).map(([key]) => key),
    };
  } catch { /* Preferences are optional. */ }
  return defaults;
}

function sortValue(person: PersonnelItem, field: Column) {
  if (field === 'role') return personRole(person);
  if (field === 'team') return person.team;
  if (field === 'wearable') return person.node_id ?? '';
  if (field === 'employment') return person.employment_status;
  return person.display_name;
}

export function PersonnelPage() {
  const { selectedSite, selectedSiteId, can, scopeUnverified } = usePlatform();
  const client = useQueryClient();
  useClearRosterOnSiteChange(client, selectedSiteId);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Personnel · ComPallette';
    return () => { document.title = previousTitle; };
  }, []);
  if (!selectedSite || selectedSiteId == null) return <EmptyState title="No site selected" detail="Select a permitted site to view its personnel roster." />;
  return <PersonnelRoster key={selectedSiteId} site={selectedSiteId} siteName={selectedSite.name} timezone={selectedSite.timezone}
    canRegister={can('manage_assets') && !scopeUnverified} />;
}

function PersonnelRoster({ site, siteName, timezone, canRegister }: { site: number; siteName: string; timezone: string; canRegister: boolean }) {
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const returned = (location.state as { personnelReturn?: RosterReturn } | null)?.personnelReturn;
  const [restore] = useState(() => recallRoster(client, site, returned?.site === site ? returned.key : location.key));
  const [search, setSearch] = useState(restore?.search ?? '');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [dialog, setDialog] = useState(false);
  const [draft, setDraft] = useState(newPerson);
  const [registered, setRegistered] = useState<PersonnelItem>();
  const [returnNotice, setReturnNotice] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const registrationStatus = useRef<HTMLDivElement>(null);
  const tableFrame = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const records = useQuery({ queryKey: rosterKey(site), queryFn: ({ signal }) => platformApi.personnel(site, undefined, signal) });
  const denied = permissionLost(records.error);
  const data = denied ? undefined : records.data;
  const registration = useMutation({
    mutationFn: (fields: PersonnelFields) => platformApi.createPersonnel({ ...fields, site }),
    onSuccess: (person) => {
      void client.invalidateQueries({ queryKey: rosterKey(site) });
      void client.invalidateQueries({ queryKey: ['dashboard', site] });
      if (person.site !== site) return;
      setDialog(false);
      setRegistered(person);
      requestAnimationFrame(() => registrationStatus.current?.focus());
    },
  });

  const role = params.get('role') ?? '';
  const wearable = params.get('wearable') ?? '';
  const requestedSort = params.get('sort') as Column;
  const sort = sortable.has(requestedSort) ? requestedSort : 'person';
  const direction = params.get('dir') === 'desc' ? 'desc' : 'asc';
  const query = normalized(search);
  const total = useMemo(() => data?.personnel.filter(person => !person.archived) ?? [], [data?.personnel]);
  const filtered = useMemo(() => total.filter(person =>
    (!query || [person.display_name, person.identifier, person.team, personRole(person)].some(value => normalized(value).includes(query)))
    && (!role || (role === 'unassigned' ? !person.operational_role : person.operational_role === role))
    && (!wearable || (wearable === 'assigned' ? Boolean(person.node_id) : !person.node_id)))
    .sort((a, b) => (direction === 'asc' ? 1 : -1)
      * (sortValue(a, sort).localeCompare(sortValue(b, sort), undefined, { numeric: true, sensitivity: 'base' }) || a.id - b.id)),
  [total, query, role, wearable, sort, direction]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number(params.get('page'));
  const page = Math.min(totalPages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeColumns = columns.filter(([key]) => preferences.columns.includes(key));
  const rowsReady = Boolean(data && !records.isFetching);

  useEffect(() => {
    if (!restore || restored.current || !rowsReady) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      window.scrollTo(0, restore.scroll);
      if (tableFrame.current) tableFrame.current.scrollTop = restore.tableScroll;
      const link = document.getElementById(`person-link-${restore.person}`);
      if (link) link.focus({ preventScroll: true });
      else {
        setReturnNotice('This person is outside the current roster view. Your filters are still applied.');
        resultHeading.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [restore, rowsReady]);

  function setFilters(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next, { replace: true, state: location.state });
    setReturnNotice('');
  }

  function updatePreferences(next: Preferences) {
    setPreferences(next);
    try { localStorage.setItem(preferencesKey, JSON.stringify(next)); } catch { /* The table still works in this session. */ }
  }

  function personLink(person: PersonnelItem, assign = false) {
    const context: RosterReturn = { site, key: location.key, filters: location.search };
    return {
      to: `/personnel/${person.id}${assign ? '?action=assign' : ''}`,
      state: { personnelReturn: context },
      onClick: () => rememberRoster(client, context, {
        person: person.id, search, scroll: window.scrollY, tableScroll: tableFrame.current?.scrollTop ?? 0,
      }),
    };
  }

  function renderCell(column: Column, person: PersonnelItem) {
    switch (column) {
      case 'person': return <>
        <Link id={`person-link-${person.id}`} className="personnel-name" {...personLink(person)}>{person.display_name}</Link>
        <small>{person.identifier}</small>
        <div className="personnel-mobile-summary"><span>{personRole(person)}</span>
          <span>{person.node_id || 'No wearable assigned'}</span><PersonEvidence person={person} timezone={timezone} /></div>
      </>;
      case 'role': return personRole(person);
      case 'team': return person.team || 'Unassigned';
      case 'wearable': return person.node_id || <span className="personnel-muted">No wearable assigned</span>;
      case 'location': return <PersonEvidence person={person} timezone={timezone} />;
      case 'state': return <WearableState person={person} />;
      case 'employment': return readableStatus(person.employment_status);
    }
  }

  return <div className="personnel-page">
    <header className="personnel-heading">
      <div><h1>Personnel</h1><p>{siteName}</p></div>
      {canRegister && <button type="button" className="button primary" onClick={() => {
        setDraft(newPerson); setRegistered(undefined); registration.reset(); setDialog(true);
      }}><Plus size={17} /> Register person</button>}
    </header>
    <Modal isOpen={dialog && canRegister} title="Register person" subtitle={siteName} className="personnel-dialog"
      onClose={() => { if (!registration.isPending) setDialog(false); }}>
      <PersonForm register value={draft} options={data ?? {}} pending={registration.isPending}
        error={registration.error} onChange={setDraft} onSubmit={fields => registration.mutate(fields)} onClose={() => setDialog(false)} />
    </Modal>
    {registered && <div className="panel personnel-notice" ref={registrationStatus} tabIndex={-1}>
      <strong role="status">{registered.display_name} registered</strong>
      <div className="personnel-actions">
        <Link className="button secondary" {...personLink(registered)}>View person</Link>
        {canRegister && <Link className="button primary" {...personLink(registered, true)}>Assign wearable</Link>}
      </div>
    </div>}
    <section className="panel personnel-roster" aria-labelledby="personnel-results">
      <div className="personnel-toolbar">
        <div className="personnel-search">
          <label className="sr-only" htmlFor="personnel-search">Search personnel</label><Search size={16} aria-hidden />
          <input id="personnel-search" type="search" placeholder="Search name, ID, crew, or role" value={search}
            onChange={event => { setSearch(event.target.value); if (params.has('page')) setFilters({ page: '' }); }} />
          {search && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => {
            setSearch(''); setFilters({ page: '' }); document.getElementById('personnel-search')?.focus();
          }}><X size={16} /></button>}
        </div>
        <label className="personnel-filter">Role<select value={role} onChange={e => setFilters({ role: e.target.value, page: '' })}>
          <option value="">All roles</option><option value="unassigned">Unassigned</option>
          {data?.operational_roles?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label className="personnel-filter">Wearable<select value={wearable} onChange={e => setFilters({ wearable: e.target.value, page: '' })}>
          <option value="">All assignments</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>
        </select></label>
        {(search || role || wearable) && <button type="button" className="button ghost" onClick={() => {
          setSearch(''); setFilters({ role: '', wearable: '', page: '' });
        }}>Clear filters</button>}
        <div className="personnel-table-settings">
          <button type="button" className="button secondary" aria-label="Toggle roster density" onClick={() => updatePreferences({
            ...preferences, density: preferences.density === 'compact' ? 'comfortable' : 'compact',
          })}>{preferences.density === 'compact' ? 'Compact' : 'Comfortable'}</button>
          <details><summary className="button secondary"><Columns3 size={16} /> Columns</summary>
            <div className="personnel-columns panel">{columns.filter(([key]) => key !== 'person').map(([key, label]) => <label key={key}>
              <input type="checkbox" checked={preferences.columns.includes(key)} onChange={e => updatePreferences({
                ...preferences, columns: e.target.checked ? [...preferences.columns, key] : preferences.columns.filter(value => value !== key),
              })} /> {label}
            </label>)}</div>
          </details>
        </div>
      </div>
      <div className="personnel-results">
        <h2 id="personnel-results" tabIndex={-1} ref={resultHeading}>Roster</h2>
        {data && <span>{filtered.length} {filtered.length === 1 ? 'result' : 'results'} · {total.length} on this site’s roster</span>}
      </div>
      {returnNotice && <p className="personnel-inline-status" role="status">{returnNotice}</p>}
      {records.isError && data && <div className="personnel-notice" role="status">The roster could not refresh. Showing the last received records.
        <button type="button" className="button secondary" onClick={() => void records.refetch()}>Retry</button></div>}
      {!data ? records.isPending ? <LoadingState label="Loading personnel…" /> :
        <ErrorState message={denied ? 'This roster is unavailable or outside your site access.' : 'Personnel records could not be loaded for this site.'}
          retry={denied ? undefined : () => void records.refetch()} />
        : rows.length ? <>
          <div className="personnel-table-frame" ref={tableFrame}>
            <table className="personnel-table" data-density={preferences.density} aria-labelledby="personnel-results">
              <thead><tr>{activeColumns.map(([key, label]) => <th key={key} scope="col" data-column={key}
                aria-sort={sort === key ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
                {sortable.has(key) ? <button className="personnel-sort" type="button" onClick={() => setFilters({
                  sort: key, dir: sort === key && direction === 'asc' ? 'desc' : '', page: '',
                })}>{label}{sort !== key ? <ArrowUpDown size={13} aria-hidden /> : direction === 'asc' ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />}</button> : label}
              </th>)}</tr></thead>
              <tbody>{rows.map(person => <tr key={person.id}>{activeColumns.map(([key]) =>
                <td key={key} data-column={key}>{renderCell(key, person)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {totalPages > 1 && <nav className="personnel-pagination" aria-label="Roster pages">
            <Pagination variant="compact" currentPage={page} totalPages={totalPages} enableKeyboardNavigation={false}
              onPageChange={next => { setFilters({ page: next > 1 ? String(next) : '' }); if (tableFrame.current) tableFrame.current.scrollTop = 0; }} />
          </nav>}
        </> : total.length ? <EmptyState title="No matching personnel" detail="Try another search or clear the filters."
          action={<button type="button" className="button secondary" onClick={() => { setSearch(''); setFilters({ role: '', wearable: '', page: '' }); }}>Clear roster filters</button>} /> :
          <EmptyState title={data.personnel.length ? 'No people on the current roster' : 'No personnel registered at this site'}
            detail={data.personnel.length ? 'This site has archived records.' : 'Registered people will appear here.'} />}
    </section>
  </div>;
}
