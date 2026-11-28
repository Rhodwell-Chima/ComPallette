import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormField, Input, Select, Textarea } from '../../platform/form';
import { Modal } from '../../platform/Modal';
import { ApiError, platformApi } from '../../services/api';
import type { AssetDetail, AssetFields, AssetImpact, Site } from '../../types';
import { AssetForm, scopeLost } from './workflow';

export type AssetAction = 'edit' | 'assign' | 'release' | 'custody' | 'return' | 'transfer' | 'archive';
export const actionLabels: Record<AssetAction, string> = {
  edit: 'Edit asset', assign: 'Assign tracker', release: 'Release tracker', custody: 'Issue custody',
  return: 'Return custody', transfer: 'Transfer site', archive: 'Archive asset',
};
const confirmations: Record<Exclude<AssetAction, 'edit'>, string> = {
  assign: 'Confirm assignment', release: 'Confirm release', custody: 'Confirm custody', return: 'Confirm return',
  transfer: 'Confirm transfer', archive: 'Confirm archive',
};

type AssetOperation = Record<string, unknown> & {
  action: AssetAction; expected_version: number; expected_site: number; operation_id: string;
};

export function AssetActionDialog({ action, snapshot, latest, site, onClose, onReview, onSaved, onReconcile }: {
  action: AssetAction; snapshot: AssetDetail; latest?: AssetDetail; site: Site;
  onClose: () => void; onReview: (asset: AssetDetail) => void;
  onSaved: (action: AssetAction, destination?: number) => void; onReconcile: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const id = String(snapshot.id);
  const [target, setTarget] = useState('');
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [confirmedPreview, setConfirmedPreview] = useState<{ destination?: number; impact: AssetImpact }>();
  const [previewRequested, setPreviewRequested] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState<AssetOperation>();
  const [reconciling, setReconciling] = useState(false);
  const [draft, setDraft] = useState<AssetFields>(() => ({
    name: snapshot.name, identifier: snapshot.identifier, asset_type: snapshot.asset_type, operational_status: snapshot.operational_status,
  }));
  const tracker = snapshot.current_assignments?.[0];
  const custodian = snapshot.current_custody?.[0];
  const requiresImpact = action === 'transfer' || action === 'archive';
  const requiredReason = requiresImpact || action === 'release' || action === 'return';
  const destination = action === 'transfer' ? Number(target) : undefined;
  const preview = useQuery({
    queryKey: ['asset-impact', site.id, id, destination, snapshot.version],
    queryFn: ({ signal }) => platformApi.assetImpact(id, destination, signal),
    enabled: requiresImpact && (action === 'archive' || Boolean(destination) && previewRequested) && !conflict,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const eligible = useQuery({
    queryKey: ['eligible-devices', site.id, search],
    queryFn: ({ signal }) => platformApi.eligibleDevices(site.id, search, signal),
    enabled: action === 'assign',
  });
  const people = useQuery({
    queryKey: ['eligible-custodians', site.id, search],
    queryFn: ({ signal }) => platformApi.eligibleCustodians(site.id, search, signal),
    enabled: action === 'custody',
  });
  const chosenTracker = eligible.data?.nodes.find(node => node.node_id === target);
  const chosenPerson = people.data?.personnel.find(person => String(person.id) === target);
  const chosenDestination = snapshot.transfer_destinations?.find(item => item.id === destination);
  // Keep the exact version and relationships explicitly shown before submission.
  const impact = action === 'archive' && !conflict ? preview.data
    : previewRequested && confirmedPreview?.destination === destination ? confirmedPreview?.impact : undefined;
  const changedPreview = Boolean(impact && latest?.version !== undefined && impact.version !== latest.version);
  const validTarget = action === 'assign' ? Boolean(chosenTracker) && !eligible.isError && !eligible.isFetching
    : action === 'custody' ? Boolean(chosenPerson) && !people.isError && !people.isFetching
    : action === 'release' ? Boolean(tracker) : action === 'return' ? Boolean(custodian)
    : action === 'transfer' ? Boolean(chosenDestination) : true;
  const mutation = useMutation({
    mutationFn: (input: AssetOperation) => platformApi.entityAction('assets', id, input),
    onSuccess: (_, input) => onSaved(input.action, input.destination_site as number | undefined),
    onError: async (error, input) => {
      const serverRejected = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
      setUncertain(serverRejected ? undefined : input);
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setConfirmedPreview(undefined);
        setTarget('');
        void client.invalidateQueries({ queryKey: ['asset-impact', site.id, id], refetchType: 'none' });
        void client.invalidateQueries({ queryKey: ['eligible-devices', site.id] });
        void client.invalidateQueries({ queryKey: ['eligible-custodians', site.id] });
      }
      setReconciling(true);
      await onReconcile();
      setReconciling(false);
    },
  });
  const pending = mutation.isPending || reconciling;
  const forbidden = scopeLost(mutation.error);
  const disabled = pending || Boolean(uncertain) || conflict || forbidden;
  const confirmationDisabled = disabled || !validTarget || (requiredReason && !reason.trim())
    || (requiresImpact && (!impact || changedPreview || preview.isFetching || preview.isError));

  async function reviewDestination() {
    setPreviewRequested(true);
    setConfirmedPreview(undefined);
    const result = await preview.refetch();
    if (result.isSuccess) setConfirmedPreview({ destination, impact: result.data });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (uncertain) {
      mutation.mutate(uncertain);
      return;
    }
    if (confirmationDisabled) return;
    const input: AssetOperation = {
      action, operation_id: crypto.randomUUID(), expected_version: impact?.version ?? snapshot.version,
      expected_site: site.id, reason: reason.trim(),
    };
    if (action === 'assign') input.node_id = target;
    if (action === 'custody') input.personnel_id = Number(target);
    if (action === 'release') input.relationship_id = tracker?.id;
    if (action === 'return') input.relationship_id = custodian?.id;
    if (action === 'transfer') input.destination_site = destination;
    if (requiresImpact && impact) input.confirmed_relationships = { assignment_ids: impact.assignment_ids, custody_ids: impact.custody_ids };
    mutation.mutate(input);
  }

  function saveEdit(fields: AssetFields) {
    const editable = ['name', 'asset_type', 'operational_status'] as const;
    const changes = Object.fromEntries(editable.filter(key => fields[key] !== snapshot[key]).map(key => [key, fields[key]]));
    if (!Object.keys(changes).length) { onClose(); return; }
    mutation.mutate({ action, changes, expected_version: snapshot.version, expected_site: site.id, operation_id: crypto.randomUUID() });
  }

  const identity = <><strong>{snapshot.name}</strong> ({snapshot.identifier})</>;
  const title = actionLabels[action];
  return <Modal isOpen className="asset-modal" title={title} subtitle={`${snapshot.name} · ${snapshot.identifier} · ${site.name}`}
    onClose={() => { if (!pending) onClose(); }}>
    {conflict && <div role="alert" className="mb-4 rounded-md border border-[var(--border)] p-3 text-sm">
      <p>{mutation.error?.message ?? 'The record changed.'} Review the current record before confirming another change.</p>
      <button className="button secondary mt-2" type="button" disabled={!latest || latest.archived || pending}
        onClick={() => { if (latest) onReview(latest); }}>Review current record</button>
    </div>}
    {uncertain && <div role="status" className="mb-4 rounded-md border border-[var(--border)] p-3 text-sm">
      <p>The service could not confirm the outcome. The record has been refreshed. Retrying uses the original operation.</p>
      <button className="button secondary mt-2" type="button" disabled={pending} onClick={() => mutation.mutate(uncertain)}>Retry same operation</button>
    </div>}
    {action === 'edit' ? <AssetForm value={draft} onChange={setDraft} onSubmit={saveEdit} edit
      pending={pending} blocked={disabled} error={conflict || uncertain ? undefined : mutation.error} onClose={onClose} />
      : <form onSubmit={submit}>
        <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
          {(action === 'assign' || action === 'custody') && <>
            <FormField label={action === 'assign' ? 'Find by tracker ID' : 'Find by name or personnel ID'}>
              <Input type="search" value={search} onChange={event => { setSearch(event.target.value); setTarget(''); }} />
            </FormField>
            {action === 'assign' ? <>
              <FormField label="Eligible tracker" required>
                <Select value={target} onChange={event => setTarget(event.target.value)} options={[
                  { value: '', label: 'Select a tracker' }, ...(eligible.data?.nodes ?? []).map(node => ({ value: node.node_id, label: node.node_id })),
                ]} />
              </FormField>
              <LookupStatus pending={eligible.isPending} error={eligible.isError} empty={!eligible.data?.nodes.length} noun="trackers" retry={() => void eligible.refetch()} />
              {chosenTracker && <p className="mb-4">Assign tracker <strong>{chosenTracker.node_id}</strong> to {identity}?</p>}
            </> : <>
              <FormField label="Responsible person" required>
                <Select value={target} onChange={event => setTarget(event.target.value)} options={[
                  { value: '', label: 'Select a person' }, ...(people.data?.personnel ?? []).map(person => ({ value: String(person.id), label: `${person.display_name} · ${person.identifier}` })),
                ]} />
              </FormField>
              <LookupStatus pending={people.isPending} error={people.isError} empty={!people.data?.personnel.length} noun="custodians" retry={() => void people.refetch()} />
              {chosenPerson && <p className="mb-4">Issue custody of {identity} to <strong>{chosenPerson.display_name}</strong> ({chosenPerson.identifier})?</p>}
            </>}
          </>}
          {action === 'release' && <p className="mb-4">Release tracker <strong>{tracker?.node_id}</strong> from {identity}? Custody remains in place.</p>}
          {action === 'return' && <p className="mb-4">Return custody of {identity} from <strong>{custodian?.person_name ?? 'the current custodian'}</strong>?
            The tracker remains assigned if one is attached.</p>}
          {action === 'transfer' && <>
            <FormField label="Destination site" required>
              <Select value={target} onChange={event => {
                setTarget(event.target.value); setConfirmedPreview(undefined); setPreviewRequested(false);
              }} options={[{ value: '', label: 'Select a site' }, ...(snapshot.transfer_destinations ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />
            </FormField>
            {!snapshot.transfer_destinations?.length && <p className="mb-4 text-sm">No permitted destination sites are available.</p>}
            <button className="button secondary mb-3" type="button" disabled={!chosenDestination || preview.isFetching}
              onClick={() => void reviewDestination()}>{preview.isFetching ? 'Loading preview…' : 'Preview affected relationships'}</button>
          </>}
          {requiresImpact && (action === 'archive' || previewRequested) && <>
            {preview.isError && <p role="alert" className="mb-3">The impact could not be loaded. {action === 'archive'
              && <button type="button" className="button secondary" onClick={() => void preview.refetch()}>Retry</button>}</p>}
            {action === 'archive' && preview.isPending && <p role="status">Loading archive impact…</p>}
            {changedPreview && <p role="alert" className="mb-3">The asset changed. Review its updated relationships before confirming.
              <button type="button" className="button secondary ml-2" onClick={() => { if (latest) onReview(latest); }}>Review current record</button></p>}
            {impact && <div className="asset-impact mb-4 grid gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
              <strong>{chosenDestination ? `${site.name} → ${chosenDestination.name}` : `Archive ${snapshot.identifier}`}</strong>
              {impact.trackers.map(row => <p key={row.id}>Release tracker <strong>{row.node_id}</strong></p>)}
              {impact.custodians.map(row => <p key={row.id}>End custody held by <strong>{row.person_name ?? 'the current custodian'}{row.person_identifier ? ` · ${row.person_identifier}` : ''}</strong></p>)}
              {!impact.assignment_ids.length && !impact.custody_ids.length && <p>There are no open tracker or custody relationships to close.</p>}
              <p className="text-[var(--muted)]">{chosenDestination ? 'This changes the registered site. Physical arrival needs separate location evidence.' : 'The asset record and its history remain available for review.'}</p>
            </div>}
          </>}
          <FormField label={requiredReason ? 'Reason' : 'Reason (optional)'} required={requiredReason}>
            <Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} />
          </FormField>
        </fieldset>
        {mutation.error && !conflict && !uncertain && <p role="alert" className="mb-3">{mutation.error.message}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={confirmationDisabled}>{pending ? 'Saving…' : confirmations[action]}</button>
        </div>
      </form>}
  </Modal>;
}

function LookupStatus({ pending, error, empty, noun, retry }: { pending: boolean; error: boolean; empty: boolean; noun: string; retry: () => void }) {
  if (pending) return <p role="status" className="mb-3 text-sm">Checking eligible {noun}…</p>;
  if (error) return <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
    Eligible {noun} could not be loaded. <button type="button" className="button secondary" onClick={retry}>Retry</button>
  </div>;
  return empty ? <p className="mb-3 text-sm">No eligible {noun} match this lookup.</p> : null;
}
