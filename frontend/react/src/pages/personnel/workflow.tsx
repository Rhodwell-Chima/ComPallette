import { useEffect, useId, useRef, type FormEvent } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../services/api';
import { LocationLabel, NodeStatusPill } from '../../platform/ui';
import type { PersonnelFields, PersonnelItem, PersonnelOptions } from '../../types';

export const rosterKey = (site: number) => ['personnel', site] as const;
const returnKey = (site: number, key: string) => ['personnel-return', site, key];

export type RosterReturn = { site: number; key: string; filters: string };
type RosterView = { search: string; scroll: number; tableScroll: number; person: number };

export function rememberRoster(client: QueryClient, origin: RosterReturn, view: RosterView) {
  client.setQueryData(returnKey(origin.site, origin.key), view);
}

export function recallRoster(client: QueryClient, site: number, key: string) {
  return client.getQueryData<RosterView>(returnKey(site, key));
}

export function useClearRosterOnSiteChange(client: QueryClient, site?: number) {
  const previous = useRef(site);
  useEffect(() => {
    if (previous.current != null && previous.current !== site) {
      client.removeQueries({ queryKey: ['personnel-return', previous.current] });
    }
    previous.current = site;
  }, [client, site]);
}

export function permissionLost(error: unknown) {
  return error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
}

const fieldLabels = {
  display_name: 'Full name', identifier: 'Personnel ID', operational_role: 'Operational role',
  team: 'Team / crew', employment_status: 'Employment status',
};

export const newPerson: PersonnelFields = {
  display_name: '', identifier: '', operational_role: null, team: '', employment_status: 'ACTIVE',
};

const employmentDefaults = [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }];
export const readableStatus = (value?: string) => value === 'ACTIVE' ? 'Active' : value === 'INACTIVE' ? 'Inactive' : value || 'Unavailable';

export function personRole(person: PersonnelItem) {
  return person.operational_role_label || (person.operational_role
    ? person.operational_role.replace(/_/g, ' ').toLowerCase().replace(/^./, first => first.toUpperCase())
    : 'Unassigned');
}

export function EvidenceTime({ value, zone }: { value?: string | number | null; zone?: string }) {
  if (value == null || value === 0) return <span>Time unavailable</span>;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.getTime() <= 0) return <span>Time unavailable</span>;
  const minutes = Math.floor((Date.now() - time.getTime()) / 60_000);
  const age = minutes < 0 ? '' : minutes < 1 ? 'Less than a minute ago' : minutes < 60 ? `${minutes} min ago` :
    minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
  const format = (timeZone?: string) => new Intl.DateTimeFormat(undefined, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(time);
  let absolute: string;
  try { absolute = format(zone); } catch { absolute = format(); }
  return <time dateTime={time.toISOString()} title={absolute} aria-label={age ? `${age}, ${absolute}` : absolute}>{age || absolute}<span className="personnel-absolute">{age ? absolute : ''}</span></time>;
}

export function PersonEvidence({ person, timezone }: { person: PersonnelItem; timezone?: string }) {
  const hasZone = person.node_id && person.current_zone && person.location_evidence && person.location_evidence !== 'UNKNOWN';
  return hasZone ? <span className="personnel-evidence">
    <LocationLabel evidence={person.location_evidence} zone={person.current_zone ?? undefined} />
    <EvidenceTime value={person.location_observed_at} zone={timezone} />
  </span> : <span className="personnel-muted">{person.node_id ? 'No usable location observation' : 'Location unknown'}</span>;
}

export function WearableState({ person }: { person: PersonnelItem }) {
  return <span className="personnel-muted">{!person.node_id ? '—' : person.node_status
    ? <NodeStatusPill status={person.node_status} /> : 'Device state unavailable'}</span>;
}

export function fieldErrors(error: unknown) {
  const fields: Partial<Record<keyof PersonnelFields, string>> = {};
  if (!(error instanceof ApiError) || error.kind !== 'validation' || !error.details || typeof error.details !== 'object') return fields;
  const details = error.details as Record<string, unknown>;
  for (const field of Object.keys(fieldLabels) as (keyof PersonnelFields)[]) {
    const value = details[field];
    if (typeof value === 'string') fields[field] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') fields[field] = value[0];
  }
  return fields;
}

export function failureMessage(error: unknown, action: string) {
  if (permissionLost(error)) return `Your account cannot ${action} at this site.`;
  if (!(error instanceof ApiError) || ['server', 'unavailable'].includes(error.kind)) {
    return `The service could not confirm the request to ${action}. Check the record before sending a new request.`;
  }
  return error.message;
}

export function PersonForm({ value, options, register = false, error, pending, blocked, onChange, onSubmit, onClose }: {
  value: PersonnelFields; options: PersonnelOptions; register?: boolean; error?: Error | null; pending: boolean;
  blocked?: boolean; onChange: (value: PersonnelFields) => void; onSubmit: (value: PersonnelFields) => void; onClose: () => void;
}) {
  const prefix = useId();
  const summary = useRef<HTMLDivElement>(null);
  const fields = fieldErrors(error);
  const messages = Object.entries(fields) as [keyof PersonnelFields, string][];
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  const change = (field: keyof PersonnelFields, next: string | null) => onChange({ ...value, [field]: next });
  const id = (field: keyof PersonnelFields) => `${prefix}-${field}`;
  const attrs = (field: keyof PersonnelFields, help?: string) => ({
    id: id(field), 'aria-invalid': Boolean(fields[field]) || undefined,
    'aria-describedby': [help, fields[field] && `${id(field)}-error`].filter(Boolean).join(' ') || undefined,
  });
  const field = (key: keyof PersonnelFields, control: React.ReactNode, help?: string) => (
    <div className="personnel-field">
      <label htmlFor={id(key)}>{fieldLabels[key]}</label>{control}
      {help && <small id={`${id(key)}-help`}>{help}</small>}
      {fields[key] && <small className="personnel-field-error" id={`${id(key)}-error`}>{fields[key]}</small>}
    </div>
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending && !blocked) onSubmit({
      ...value, identifier: value.identifier.trim(), display_name: value.display_name.trim(), team: value.team.trim(),
    });
  }
  const statuses = options.employment_statuses ?? employmentDefaults;
  return <form className="personnel-form" onSubmit={submit}>
    {error && <div ref={summary} tabIndex={-1} role="alert" className="personnel-form-error">
      {messages.length ? <><strong>Check the highlighted fields.</strong><ul>{messages.map(([key, message]) =>
        <li key={key}><a href={`#${id(key)}`} onClick={event => { event.preventDefault(); document.getElementById(id(key))?.focus(); }}>{fieldLabels[key]}: {message}</a></li>
      )}</ul></> : failureMessage(error, register ? 'register this person' : 'save these edits')}
    </div>}
    <fieldset disabled={pending || blocked}>
      {field('display_name', <input {...attrs('display_name')} required maxLength={120} placeholder="Mwamba Phiri"
        value={value.display_name} onChange={e => change('display_name', e.target.value)} />)}
      {register && field('identifier', <input {...attrs('identifier', `${id('identifier')}-help`)} required maxLength={32}
        placeholder="PER-0082" value={value.identifier} onChange={e => change('identifier', e.target.value)} />, 'Use an ID unique across this organisation. Leading zeros are kept.')}
      {field('operational_role', <select {...attrs('operational_role')} value={value.operational_role ?? ''} onChange={e => change('operational_role', e.target.value || null)}>
        <option value="">Unassigned</option>
        {options.operational_roles?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>)}
      {field('team', <input {...attrs('team')} maxLength={80} placeholder="Ventilation crew"
        value={value.team} onChange={e => change('team', e.target.value)} />)}
      {field('employment_status', <select {...attrs('employment_status')} value={value.employment_status} onChange={e => change('employment_status', e.target.value)}>
        {!statuses.some(option => option.value === value.employment_status) && <option value={value.employment_status}>{value.employment_status}</option>}
        {statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>)}
    </fieldset>
    <div className="personnel-actions personnel-form-actions">
      <button type="button" className="button secondary" onClick={onClose} disabled={pending}>Cancel</button>
      <button type="submit" className="button primary" disabled={pending || blocked}>{pending ? 'Saving…' : register ? 'Register person' : 'Save changes'}</button>
    </div>
  </form>;
}
