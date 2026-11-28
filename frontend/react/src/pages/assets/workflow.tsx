import { useEffect, useRef, type FormEvent } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { FormField, Input, Select } from '../../platform/form';
import { LocationLabel } from '../../platform/ui';
import { ApiError } from '../../services/api';
import type { AssetFields, AssetItem } from '../../types';
import { EvidenceTime } from '../personnel/workflow';

export const statusOptions = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'];
export const statusLabel = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
export const emptyAsset: AssetFields = { name: '', identifier: '', asset_type: '', operational_status: 'ACTIVE' };
export const assetQueryKey = (id: string, site?: number) => ['entity', 'assets', id, site] as const;
export const assetHref = (id: number) => `/assets/${id}`;
export const scopeLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);

export type AssetOrigin = { key: string; site: number; filters: string };
type AssetView = { id?: number; search: string; scroll: number; tableScroll: number };
const viewKey = (site: number, key: string) => ['assets-return', site, key];

export function saveAssetView(client: QueryClient, origin: AssetOrigin, view: AssetView) {
  client.setQueryData(viewKey(origin.site, origin.key), view);
}

export function getAssetView(client: QueryClient, site: number, key: string) {
  return client.getQueryData<AssetView>(viewKey(site, key));
}

export function useAssetSiteChange(client: QueryClient, site?: number, onChange?: () => void) {
  const lastSite = useRef(site);
  useEffect(() => {
    if (site === lastSite.current) return;
    if (lastSite.current) client.removeQueries({ queryKey: ['assets-return', lastSite.current] });
    lastSite.current = site;
    onChange?.();
  }, [client, site, onChange]);
}

export function AssetEvidence({ asset, timezone, detail = false }: { asset: AssetItem; timezone?: string; detail?: boolean }) {
  if (!asset.node_id || !asset.current_zone || !asset.location_evidence || asset.location_evidence === 'UNKNOWN'
      || typeof asset.location_observed_at !== 'number' || !Number.isFinite(asset.location_observed_at) || asset.location_observed_at <= 0) {
    return <div className="grid gap-1 text-sm text-[var(--muted)]">
      <span>{asset.node_id && detail ? 'Awaiting a location observation since assignment' : 'Location unknown'}</span>
      {asset.node_id && detail && <small>Location requires a known capture time within this tracker’s assignment.</small>}
    </div>;
  }
  return <div className="asset-evidence grid gap-1 text-sm">
    <LocationLabel evidence={asset.location_evidence} zone={asset.current_zone} />
    <EvidenceTime value={asset.location_observed_at} zone={timezone} />
    {detail && <small className="text-[var(--muted)]">Reported by {asset.node_id}</small>}
  </div>;
}

const labels = { name: 'Asset name', identifier: 'Asset ID', asset_type: 'Classification', operational_status: 'Operational status' };

export function AssetForm({ value, onChange, onSubmit, onClose, pending, error, edit = false, blocked = false }: {
  value: AssetFields; onChange: (value: AssetFields) => void; onSubmit: (value: AssetFields) => void;
  onClose: () => void; pending: boolean; error?: Error | null; edit?: boolean; blocked?: boolean;
}) {
  const summary = useRef<HTMLDivElement>(null);
  const errors = error instanceof ApiError && error.details && typeof error.details === 'object'
    ? error.details as Record<string, string | string[]> : {};
  const message = (key: keyof AssetFields) => Array.isArray(errors[key]) ? errors[key][0] : errors[key];
  const invalid = (Object.keys(labels) as (keyof AssetFields)[]).filter(key => message(key));
  const change = (key: keyof AssetFields, val: string) => onChange({ ...value, [key]: val });
  const statusValues = Array.from(new Set([...statusOptions, value.operational_status])).filter(Boolean);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending && !blocked) onSubmit({
      name: value.name.trim(), identifier: value.identifier.trim(), asset_type: value.asset_type.trim(),
      operational_status: value.operational_status,
    });
  }
  return <form onSubmit={submit}>
    {error && <div ref={summary} tabIndex={-1} role="alert" className="mb-4 rounded-md border border-[var(--border)] p-3 text-sm">
      <p>{invalid.length ? 'Check the highlighted fields.' : scopeLost(error) ? 'Your account cannot save this asset at this site.'
        : error instanceof ApiError && error.kind === 'validation' ? error.message : 'The service could not confirm the save. Check the registry before retrying.'}</p>
      {invalid.length > 0 && <ul className="list-disc pl-5">{invalid.map(key => <li key={key}><a href={`#asset-form-${key}`}
        onClick={event => { event.preventDefault(); document.getElementById(`asset-form-${key}`)?.focus(); }}>{labels[key]}: {message(key)}</a></li>)}</ul>}
    </div>}
    <fieldset disabled={pending || blocked} className="m-0 min-w-0 border-0 p-0">
      <FormField label={labels.name} name="asset-form-name" required error={message('name')}>
        <Input value={value.name} maxLength={120} pattern=".*\S.*" placeholder="e.g. Ventilation fan 02" onChange={event => change('name', event.target.value)} />
      </FormField>
      {!edit && <FormField label={labels.identifier} name="asset-form-identifier" required error={message('identifier')}
        helperText="Unique within the organisation. The tracker has a separate hardware ID.">
        <Input value={value.identifier} maxLength={32} pattern=".*\S.*" placeholder="e.g. FAN-002" onChange={event => change('identifier', event.target.value)} />
      </FormField>}
      <FormField label={labels.asset_type} name="asset-form-asset_type" error={message('asset_type')}>
        <Input value={value.asset_type} maxLength={80} placeholder="e.g. Ventilation equipment" onChange={event => change('asset_type', event.target.value)} />
      </FormField>
      <FormField label={labels.operational_status} name="asset-form-operational_status" required error={message('operational_status')}>
        <Select value={value.operational_status} onChange={event => change('operational_status', event.target.value)}
          options={statusValues.map(status => ({ value: status, label: statusLabel(status) }))} />
      </FormField>
    </fieldset>
    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
      <button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancel</button>
      <button className="button primary" disabled={pending || blocked}>{pending ? 'Saving…' : edit ? 'Save changes' : 'Register asset'}</button>
    </div>
  </form>;
}
