import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, MoreHorizontal, Radio } from 'lucide-react';
import { Modal } from '../../platform/Modal';
import { usePlatform } from '../../platform/PlatformContext';
import { ErrorState, LoadingState } from '../../platform/ui';
import { ApiError, platformApi } from '../../services/api';
import type { PersonDetail, PersonnelFields, PersonnelRoster } from '../../types';
import {
  EvidenceTime, PersonEvidence, PersonForm, WearableState, failureMessage, newPerson, permissionLost,
  personRole, readableStatus, rosterKey, useClearRosterOnSiteChange, type RosterReturn,
} from './workflow';
import './personnel.css';

type Action = 'assign' | 'edit' | 'release' | 'transfer' | 'archive' | 'link_user';
type Impact = { assignment_ids: number[]; custody_ids: number[] };
const actionLabel: Record<Action, string> = {
  assign: 'Assign wearable', edit: 'Edit person', release: 'Return wearable',
  transfer: 'Transfer site', archive: 'Archive person', link_user: 'Link operator account',
};
const draftFrom = (person: PersonDetail): PersonnelFields => ({
  ...newPerson, identifier: person.identifier, display_name: person.display_name, operational_role: person.operational_role ?? null,
  team: person.team ?? '', employment_status: person.employment_status || 'ACTIVE',
});

export function PersonDetailsPage() {
  const { id = '' } = useParams();
  const { selectedSiteId } = usePlatform();
  const client = useQueryClient();
  useClearRosterOnSiteChange(client, selectedSiteId);
  useEffect(() => {
    const previousTitle = document.title;
    return () => { document.title = previousTitle; };
  }, []);
  return <PersonRecord key={`${selectedSiteId}:${id}`} id={id} site={selectedSiteId} />;
}

function PersonRecord({ id, site }: { id: string; site?: number }) {
  const { selectedSite, sites, can, scopeUnverified, setSelectedSiteId } = usePlatform();
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const wearableTitle = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const queryKey = ['entity', 'personnel', id, site];
  const record = useQuery({
    queryKey, queryFn: ({ signal }) => platformApi.personnelDetail(id, signal),
    enabled: site != null && /^\d+$/.test(id),
  });
  const denied = permissionLost(record.error);
  const person = !denied && record.data?.site != null && record.data.site === site && String(record.data.id) === id ? record.data : undefined;
  const cached = site != null && !denied && !record.data
    ? client.getQueryData<PersonnelRoster>(rosterKey(site))?.personnel.find(row => String(row.id) === id && row.site === site) : undefined;
  const identity = person ?? cached;
  const routeState = (location.state as { personnelReturn?: RosterReturn } | null)?.personnelReturn;
  const origin = routeState != null && routeState.site === site ? routeState : undefined;
  const roster = origin ? { to: `/personnel${origin.filters}`, state: { personnelReturn: origin } } : { to: '/personnel' };
  const mayManage = Boolean(person && !person.archived && !scopeUnverified && can('manage_assets') && person.capabilities?.includes('manage_assets'));
  const assignment = person?.current_assignments?.[0];
  const node = person?.node_id || assignment?.node_id;
  const mayAssign = mayManage && !node;

  const [action, setAction] = useState<Action>();
  const [baseline, setBaseline] = useState<PersonDetail>();
  const [draft, setDraft] = useState(newPerson);
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const [impact, setImpact] = useState<Impact>();
  const [impactError, setImpactError] = useState('');
  const [uncertain, setUncertain] = useState<Record<string, unknown>>();
  const [conflict, setConflict] = useState(false);

  const eligibleKey = ['eligible-devices', site, search];
  const eligible = useQuery({ queryKey: eligibleKey, queryFn: () => platformApi.eligibleDevices(site!, search), enabled: action === 'assign' && mayAssign });
  const accounts = useQuery({
    queryKey: ['link-accounts', site, search], queryFn: () => platformApi.users({ site_id: site, search }),
    enabled: action === 'link_user' && mayManage && can('manage_users'),
  });
  const choices = eligible.data?.nodes.filter(device => device.role === 'WEARABLE' && device.site === site && device.commissioned === true && !device.archived) ?? [];
  const selectedDevice = choices.find(device => device.node_id === target);

  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => platformApi.entityAction('personnel', id, input),
    onSuccess: async (_, input) => {
      setAction(undefined);
      setUncertain(undefined);
      setStatus(input.action === 'assign' ? `Wearable ${input.node_id} assigned.` : input.action === 'release' ? 'Wearable returned.' : 'Changes saved.');
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ['personnel', site] }),
        client.invalidateQueries({ queryKey: ['eligible-devices', site] }),
        ...['devices', 'dashboard', 'twin', 'audit', 'entity'].map(key => client.invalidateQueries({ queryKey: key === 'entity' ? [key, 'devices'] : [key] })),
      ]);
      if (input.action === 'assign' || input.action === 'release') wearableTitle.current?.focus({ preventScroll: true });
    },
    onError: async (error, input) => {
      if (error instanceof ApiError && error.kind === 'conflict') {
        setConflict(true);
        if (input.action === 'assign') {
          setTarget('');
          await client.invalidateQueries({ queryKey: ['eligible-devices', site] });
        }
      } else if (!(error instanceof ApiError) || ['server', 'unavailable'].includes(error.kind)) {
        setUncertain(input);
      }
      if (error instanceof ApiError && error.kind === 'validation') return;
      await record.refetch();
    },
  });

  function open(next: Action, source: PersonDetail) {
    setBaseline(source); setDraft(draftFrom(source));
    setTarget(next === 'link_user' && source.user_id ? String(source.user_id) : '');
    setSearch(''); setReason(''); setStatus(''); setImpact(undefined); setImpactError('');
    setUncertain(undefined); setConflict(false); mutation.reset(); setAction(next);
  }

  useEffect(() => {
    document.title = `${identity?.display_name ?? 'Person record'} · ComPallette`;
    if (!identity || focused.current) return;
    const frame = requestAnimationFrame(() => {
      if (title.current) { title.current.focus({ preventScroll: true }); focused.current = true; }
    });
    return () => cancelAnimationFrame(frame);
  }, [identity]);

  useEffect(() => {
    if (requested.current || !person || params.get('action') !== 'assign') return;
    requested.current = true;
    if (mayAssign) open('assign', person);
    else setStatus(node ? 'This person already has a wearable.' : 'Wearable assignment is unavailable for this record.');
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true, state: location.state });
  }, [person, mayAssign, params, node, setParams, location.state]);

  const close = () => { if (!mutation.isPending) setAction(undefined); };
  function submit(event?: FormEvent, fields?: PersonnelFields) {
    event?.preventDefault();
    if (!mayManage || !action || !person || !baseline || mutation.isPending || conflict) return;
    if (uncertain) { mutation.mutate(uncertain); return; }
    if (action === 'assign' && (!mayAssign || !selectedDevice || eligible.isError)) return;
    const input: Record<string, unknown> = { action, expected_site: site, expected_version: baseline.version, operation_id: crypto.randomUUID(), reason: reason.trim() };
    if (action === 'edit' && fields) {
      const initial = draftFrom(baseline);
      const editable = ['display_name', 'operational_role', 'team', 'employment_status'] as const;
      input.changes = Object.fromEntries(editable.filter(key => initial[key] !== fields[key]).map(key => [key, fields[key]]));
      if (!Object.keys(input.changes as object).length) { close(); return; }
    }
    if (action === 'assign') input.node_id = target;
    if (action === 'release') input.relationship_id = assignment?.id;
    if (action === 'link_user') input.user_id = target ? Number(target) : null;
    if (action === 'transfer') {
      if (!impact) return;
      input.destination_site = Number(target); input.confirmed_relationships = impact;
    }
    if (action === 'archive') input.confirmed_relationships = {
      assignment_ids: person.current_assignments?.map(row => row.id) ?? [],
      custody_ids: person.current_custody?.map(row => row.id) ?? [],
    };
    mutation.mutate(input);
  }
  const timezone = selectedSite?.timezone;
  const nextSite = !denied && record.data && record.data.site !== site ? sites.find(row => row.id === record.data?.site) : undefined;

  return <div className="personnel-page personnel-detail">
    <nav className="personnel-breadcrumb" aria-label="Breadcrumb"><Link {...roster}>Personnel</Link>
      <ChevronRight size={15} aria-hidden /> <span aria-current="page">{identity?.display_name ?? 'Person record'}</span>
    </nav>
    <header className="personnel-heading">
      <div><h1 ref={title} tabIndex={-1}>{identity?.display_name ?? 'Person record'}</h1>
        {identity && <p><strong>{identity.identifier}</strong>{person && <> · {personRole(person)} · {person.team || 'Crew unassigned'} · {readableStatus(person.employment_status)}</>}</p>}
        {person?.archived && <p className="personnel-muted">Archived record</p>}
      </div>
      {mayManage && person && <div className="personnel-actions">
        {mayAssign && <button type="button" className="button primary" onClick={() => open('assign', person)}><Radio size={16} /> Assign wearable</button>}
        <button type="button" className="button secondary" onClick={() => open('edit', person)}>Edit person</button>
        <details className="personnel-more"><summary className="button secondary" aria-label="More personnel actions"><MoreHorizontal size={19} /></summary>
          <div className="personnel-columns panel">
            {assignment && <button type="button" className="button ghost" onClick={() => open('release', person)}>Return wearable</button>}
            {can('manage_users') && person.capabilities?.includes('manage_users') && <button type="button" className="button ghost" onClick={() => open('link_user', person)}>Link operator account</button>}
            {sites.some(row => row.id !== site && row.organisation === person.organisation) && <button type="button" className="button ghost" onClick={() => open('transfer', person)}>Transfer site</button>}
            <button type="button" className="button ghost" onClick={() => open('archive', person)}>Archive person</button>
          </div>
        </details>
      </div>}
    </header>
    {status && <div className="panel personnel-notice" role="status">{status}</div>}
    {!person ? nextSite ? <div className="panel personnel-notice">This record belongs to another permitted site.
      <button type="button" className="button secondary" onClick={() => setSelectedSiteId(nextSite.id)}>Switch to {nextSite.name}</button></div>
      : record.isPending && site != null && /^\d+$/.test(id) ? <div className="personnel-overview" aria-busy="true">
        {['Work assignment', 'Wearable', 'Latest location'].map((label, index) => <section key={label} className={`panel personnel-section${index === 0 ? ' personnel-work' : ''}`}><h2>{label}</h2><LoadingState label="Loading record…" /></section>)}
      </div> : <ErrorState message={denied ? 'This person is unavailable or outside your site access.' : site == null ? 'Select a site to open a person record.' : 'The person record could not be loaded.'}
        retry={site != null && !denied ? () => void record.refetch() : undefined} /> : <>
      {record.isError && <div className="panel personnel-notice" role="status">The record could not refresh. Showing the last received details.
        <button type="button" className="button secondary" onClick={() => void record.refetch()}>Retry</button></div>}
      <div className="personnel-overview">
        <section className="panel personnel-section personnel-work">
          <h2>Work assignment</h2>
          <dl><div><dt>Personnel ID</dt><dd>{person.identifier}</dd></div>
            <div><dt>Operational role</dt><dd>{personRole(person)}</dd></div>
            <div><dt>Team / crew</dt><dd>{person.team || 'Unassigned'}</dd></div>
            <div><dt>Employment status</dt><dd>{readableStatus(person.employment_status)}</dd></div>
            <div><dt>Site</dt><dd>{selectedSite?.name ?? 'Selected site'}</dd></div>
            <div><dt>Operator account</dt><dd>{person.user_id ? 'Linked' : 'No account linked'}</dd></div></dl>
        </section>
        <section className="panel personnel-section" aria-labelledby="wearable-heading">
          <h2 id="wearable-heading" ref={wearableTitle} tabIndex={-1}>Wearable</h2>
          {node ? <><p className="personnel-device"><strong>{node}</strong> <WearableState person={{ ...person, node_id: node }} /></p>
            {assignment && <p className="personnel-muted">Assigned <EvidenceTime value={assignment.started_at} zone={timezone} /></p>}
            <Link className="personnel-name" to={`/devices/${encodeURIComponent(node)}`}>Open wearable diagnostics <ArrowRight size={14} /></Link>
          </> : <><p><strong>No wearable assigned</strong></p>{mayAssign ? <button type="button" className="button secondary"
            onClick={() => open('assign', person)}>Choose eligible wearable</button> : <p className="personnel-muted">A permitted supervisor can issue a wearable.</p>}</>}
        </section>
        <section className="panel personnel-section">
          <h2>Latest location</h2><p><PersonEvidence person={person} timezone={timezone} /></p>
          <p className="personnel-muted">{node ? person.location_observed_at && person.current_zone ?
            `Report received from wearable ${node} during this assignment. Capture time may differ.` : 'Location is unknown. Issuing a wearable does not establish a location.' :
            'A wearable observation is needed to report a zone.'}</p>
        </section>
      </div>
      <PersonHistory person={person} timezone={timezone} showAudit={Boolean(can('view_audit') && person.capabilities?.includes('view_audit'))} />
    </>}
    {person && action && <Modal isOpen={mayManage} title={actionLabel[action]} subtitle={`${person.display_name} · ${person.identifier}`} className="personnel-dialog" onClose={close}>
      {conflict && <div className="personnel-form-error" role="alert"><p>{mutation.error?.message || 'The record changed.'} Review the latest record before continuing.</p>
        <button className="button secondary" type="button" disabled={record.isFetching || (action === 'assign' && !mayAssign)}
          onClick={() => open(action, person)}>{action === 'edit' ? 'Reload edit form' : 'Review latest options'}</button></div>}
      {uncertain && <div className="personnel-form-error" role="status">
        The outcome could not be confirmed. The record has been refreshed. Retrying uses the same operation.
        <button type="button" className="button secondary" disabled={mutation.isPending || record.isFetching} onClick={() => submit()}>Retry same operation</button>
      </div>}
      {action === 'edit' ? <PersonForm value={draft} options={person} error={!uncertain && !conflict ? mutation.error : undefined}
        pending={mutation.isPending} blocked={Boolean(uncertain || conflict)} onChange={setDraft} onSubmit={fields => submit(undefined, fields)} onClose={close} /> :
        <form className="personnel-form" onSubmit={submit}>
          <fieldset disabled={mutation.isPending || Boolean(uncertain || conflict)}>
            {(action === 'assign' || action === 'link_user') && <label className="personnel-field">{action === 'assign' ? 'Find by device ID' : 'Find an account'}
              <input type="search" value={search} onChange={e => { setSearch(e.target.value); setTarget(''); }} /></label>}
            {action === 'assign' && (mayAssign ? <>
              <label className="personnel-field">Eligible wearable
                <select required value={target} onChange={e => setTarget(e.target.value)}><option value="">Select a wearable</option>
                  {choices.map(device => <option key={device.node_id} value={device.node_id}>{device.node_id}</option>)}</select></label>
              {eligible.isPending ? <p role="status">Loading eligible wearables…</p> : eligible.isError ? <p role="alert">Eligible wearables could not be loaded.
                <button type="button" className="button secondary" onClick={() => void eligible.refetch()}>Retry wearable lookup</button></p>
                : !choices.length && <p>No eligible wearables match this search at this site.</p>}
              {selectedDevice && <p className="personnel-confirm">Assign wearable <strong>{selectedDevice.node_id}</strong> to <strong>{person.display_name} ({person.identifier})</strong>?</p>}
            </> : <p>This person now has a wearable. Review the updated record.</p>)}
            {action === 'link_user' && <label className="personnel-field">Operator account<select value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">No linked account</option>{accounts.data?.users.map(row => <option key={row.id} value={row.id}>{row.username}</option>)}</select>
              {accounts.isError && <span role="alert">Accounts could not be loaded.</span>}</label>}
            {action === 'release' && <p>Return wearable <strong>{node}</strong> from {person.display_name}?</p>}
            {action === 'archive' && <p>Archive this record and close its current assignments and custody relationships? History is retained.</p>}
            {action === 'transfer' && <>
              <label className="personnel-field">Destination site<select value={target} required onChange={e => { setTarget(e.target.value); setImpact(undefined); }}>
                <option value="">Select a site</option>{sites.filter(row => row.id !== site && row.organisation === person.organisation).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select></label>
              <button type="button" className="button secondary" disabled={!target} onClick={() => {
                setImpactError(''); void platformApi.transferPreview('personnel', id, Number(target)).then(setImpact).catch(error => setImpactError(error.message));
              }}>Preview transfer</button>
              {impact && <p>The transfer closes {impact.assignment_ids.length} wearable assignments and {impact.custody_ids.length} custody relationships.</p>}
              {impactError && <p role="alert">{impactError}</p>}
            </>}
            <label className="personnel-field">Reason {['release', 'archive', 'transfer'].includes(action) ? '(required)' : '(optional)'}
              <textarea value={reason} onChange={e => setReason(e.target.value)} required={['release', 'archive', 'transfer'].includes(action)} />
            </label>
          </fieldset>
          {mutation.error && !uncertain && !conflict && <p className="personnel-form-error" role="alert">{failureMessage(mutation.error, actionLabel[action].toLowerCase())}</p>}
          <div className="personnel-actions personnel-form-actions">
            <button type="button" className="button secondary" onClick={close} disabled={mutation.isPending}>Cancel</button>
            <button type="submit" className="button primary" disabled={mutation.isPending || Boolean(conflict || uncertain)
              || (action === 'assign' && (!mayAssign || !selectedDevice || eligible.isError || eligible.isFetching))
              || (action === 'transfer' && !impact) || (action === 'release' && !assignment)}>
              {mutation.isPending ? 'Saving…' : action === 'assign' ? 'Confirm assignment' : 'Confirm'}
            </button>
          </div>
        </form>}
    </Modal>}
  </div>;
}

function PersonHistory({ person, timezone, showAudit }: { person: PersonDetail; timezone?: string; showAudit: boolean }) {
  const assignments = person.assignment_history;
  const observations = person.location_observations;
  return <section className="panel personnel-section personnel-history">
    <h2>Recent history</h2>
    <div className="personnel-history-grid">
      <div><h3>Wearable assignments</h3>{assignments?.length ? <ul>{assignments.slice(0, 10).map(item => <li key={item.id}>
        <strong>{item.node_id}</strong> · {item.ended_at ? 'Completed' : 'Current'}
        <small>Started <EvidenceTime value={item.started_at} zone={timezone} />{item.ended_at && <> · Ended <EvidenceTime value={item.ended_at} zone={timezone} /></>}</small>
        {(item.reason || item.end_reason) && <small>{item.reason}{item.end_reason && ` · ${item.end_reason}`}</small>}
      </li>)}</ul> : <p className="personnel-muted">{assignments ? 'No wearable assignments recorded.' : 'Assignment history unavailable.'}</p>}</div>
      <div><h3>Device location observations</h3>
        <p className="personnel-muted">These are records from the assigned device and may include reports from before this assignment.</p>
        {observations?.length ? <ul>{observations.slice(0, 10).map(item => <li key={item.id}>
          <strong>{item.reported_zone && item.reported_zone !== 'UNASSIGNED' ? item.reported_zone : 'Zone unavailable'}</strong> · {item.node_id}
          <small>{item.simulated ? 'Simulated · ' : ''}{item.quality?.replace(/_/g, ' ').toLowerCase() || 'Evidence unavailable'}</small>
          <small>{item.captured_at ? 'Observed ' : 'Received '}<EvidenceTime value={item.captured_at || item.received_at} zone={timezone} /></small>
        </li>)}</ul> : <p className="personnel-muted">{observations ? 'No device location observations available.' : 'Device observations unavailable.'}</p>}</div>
    </div>
    {(person.custody_history?.length || person.device_alerts?.length || person.measurements?.length) ? <details>
      <summary>Custody and device records</summary><p className="personnel-muted">Device readings and alerts describe the hardware.</p>
      {person.custody_history?.slice(0, 10).map(item => <p key={`custody-${item.id}`}><Link to={`/assets/${item.asset_id}`}>Asset #{item.asset_id}</Link> · {item.ended_at ? 'Returned' : 'Current custody'}</p>)}
      {person.device_alerts?.slice(0, 10).map(item => <p key={`alert-${item.id}`}><Link to={`/alerts?alert=${item.id}`}>{item.alert_code}</Link> · {item.status}</p>)}
      {person.measurements?.slice(0, 10).map(item => <p key={`reading-${item.id}`}>{item.measurement_key}: {item.value} {item.unit} · <EvidenceTime value={item.received_at} zone={timezone} /></p>)}
    </details> : null}
    {showAudit && <details><summary>Administrative audit</summary>{person.audit?.length ? <ul>{person.audit.slice(0, 10).map((item, index) =>
      <li key={index}>{item.action} · {item.actor} · <EvidenceTime value={item.timestamp} zone={timezone} /></li>)}</ul> :
      <p className="personnel-muted">No administrative actions in the available audit history.</p>}</details>}
  </section>;
}
