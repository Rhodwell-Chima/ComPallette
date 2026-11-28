import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformContext';
import { ErrorState, NodeStatusPill } from '../../platform/ui';
import { platformApi } from '../../services/api';
import type { AssetDetail, AssetRegistry, AssetRelationship } from '../../types';
import { EvidenceTime } from '../personnel/workflow';
import { AssetActionDialog, actionLabels, type AssetAction } from './AssetActionDialog';
import { AssetEvidence, assetHref, assetQueryKey, scopeLost, statusLabel, useAssetSiteChange, type AssetOrigin } from './workflow';

export function AssetDetailsPage() {
  const { id = '' } = useParams();
  const { selectedSiteId } = usePlatform();
  const client = useQueryClient();
  useAssetSiteChange(client, selectedSiteId);
  useEffect(() => {
    const title = document.title;
    return () => { document.title = title; };
  }, []);
  return <AssetRecord key={`${selectedSiteId}:${id}`} id={id} />;
}

function AssetRecord({ id }: { id: string }) {
  const { selectedSite, sites, can, scopeUnverified, setSelectedSiteId } = usePlatform();
  const site = selectedSite?.id;
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const title = useRef<HTMLHeadingElement>(null);
  const custodyHeading = useRef<HTMLHeadingElement>(null);
  const trackingHeading = useRef<HTMLHeadingElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const handoff = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [moved, setMoved] = useState<number>();
  const [dialog, setDialog] = useState<{ action: AssetAction; snapshot: AssetDetail; revision: number }>();
  const record = useQuery({
    queryKey: assetQueryKey(id, site), queryFn: ({ signal }) => platformApi.assetDetail(id, signal),
    enabled: site != null && /^\d+$/.test(id),
  });
  const denied = scopeLost(record.error);
  const returned = !denied && String(record.data?.id) === id ? record.data : undefined;
  const asset = returned?.site === site ? returned : undefined;
  const cached = !denied && !returned && site != null
    ? client.getQueriesData<AssetRegistry>({ queryKey: ['assets', site] }).flatMap(([, data]) => data?.assets ?? [])
      .find(row => String(row.id) === id && row.site === site) : undefined;
  const destinationSite = sites.find(entry => entry.id === (moved ?? returned?.site) && entry.id !== site);
  const identity = asset ?? cached;
  const mayManage = Boolean(asset && !asset.archived && !scopeUnverified && can('manage_assets')
    && asset.capabilities?.includes('manage_assets'));
  const custody = asset?.current_custody?.[0];
  const assignment = asset?.current_assignments?.[0];
  const origin = (location.state as { assetOrigin?: AssetOrigin } | null)?.assetOrigin;
  const back = origin?.site === site ? { to: `/assets${origin?.filters ?? ''}`, state: { assetOrigin: origin } } : { to: '/assets' };

  useEffect(() => {
    document.title = identity ? `${identity.name} · ComPallette` : 'Asset details · ComPallette';
    if (!identity || focused.current) return;
    const frame = requestAnimationFrame(() => {
      if (title.current) { title.current.focus({ preventScroll: true }); focused.current = true; }
    });
    return () => cancelAnimationFrame(frame);
  }, [identity]);

  useEffect(() => {
    const action = params.get('action');
    if (!asset || handoff.current || !action) return;
    handoff.current = true;
    if (mayManage && ((action === 'assign' && !assignment && !asset.node_id) || (action === 'custody' && !custody))) {
      setDialog({ action, snapshot: asset, revision: 0 });
    }
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true, state: location.state });
  }, [asset, assignment, custody, location.state, mayManage, params, setParams]);

  function open(action: AssetAction) {
    if (!asset || !mayManage) return;
    setFeedback('');
    setDialog({ action, snapshot: asset, revision: 0 });
  }

  function saved(action: AssetAction, destination?: number) {
    const messages: Record<AssetAction, string> = {
      edit: 'Asset details saved.', assign: 'Tracker assigned.', release: 'Tracker released.',
      custody: 'Custody issued.', return: 'Custody returned.', archive: 'Asset archived.',
      transfer: 'Asset transferred.',
    };
    setFeedback(messages[action]);
    setDialog(undefined);
    if (action === 'transfer') setMoved(destination);
    for (const key of [['assets', site], ['entity', 'assets', id], ['entity', 'personnel'], ['entity', 'devices'],
      ['personnel', site], ['devices'], ['eligible-devices', site], ['eligible-custodians', site],
      ['dashboard'], ['twin'], ['digital-twin'], ['audit']]) {
      void client.invalidateQueries({ queryKey: key });
    }
    void client.invalidateQueries({ queryKey: ['asset-impact', site, id], refetchType: 'none' });
    if (destination) {
      void client.invalidateQueries({ queryKey: ['assets', destination] });
      void client.invalidateQueries({ queryKey: ['eligible-devices', destination] });
    }
    requestAnimationFrame(() => {
      const next = action === 'assign' || action === 'release' ? trackingHeading.current
        : action === 'custody' || action === 'return' ? custodyHeading.current : noticeRef.current;
      next?.focus({ preventScroll: true });
    });
  }

  const dialogContent = dialog && !denied && selectedSite && can('manage_assets') && <AssetActionDialog
    key={dialog.revision} action={dialog.action} snapshot={dialog.snapshot} latest={asset} site={selectedSite}
    onClose={() => {
      setDialog(undefined);
      if (dialog.action === 'archive' || dialog.action === 'transfer') {
        requestAnimationFrame(() => moreTrigger.current?.focus({ preventScroll: true }));
      }
    }}
    onReview={snapshot => setDialog({ action: dialog.action, snapshot, revision: dialog.revision + 1 })}
    onSaved={saved} onReconcile={() => record.refetch()} />;

  return <div className="asset-page asset-detail grid min-w-0 gap-4">
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
      <Link className="asset-link font-semibold" {...back}>Assets</Link>
      {identity && <><ChevronRight aria-hidden="true" size={15} /><span aria-current="page">{identity.name}</span></>}
    </nav>
    {destinationSite && !asset && <div ref={noticeRef} tabIndex={-1} className="panel grid justify-items-start gap-3 p-4">
      <h1 className="asset-title">{moved ? 'Asset transferred' : 'Asset registered at another site'}</h1>
      <p>{moved ? `The asset is now registered at ${destinationSite.name}. Physical arrival requires location evidence.`
        : `This record is available at ${destinationSite.name}.`}</p>
      <Link className="button primary" to={assetHref(Number(id))} state={null}
        onClick={event => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setSelectedSiteId(destinationSite.id);
        }}>Open asset at {destinationSite.name}</Link>
    </div>}
    {moved && asset && <div ref={noticeRef} tabIndex={-1} className="panel p-4">
      <span role="status">Asset transferred to {destinationSite?.name ?? 'the destination site'}.</span>
      {destinationSite && <Link className="button secondary ml-3" to={assetHref(asset.id)} state={null}
        onClick={event => {
          if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) setSelectedSiteId(destinationSite.id);
        }}>Open asset at {destinationSite.name}</Link>}
    </div>}
    {!destinationSite && (!selectedSite || !/^\d+$/.test(id) || (!asset && !cached && !record.isPending)) && <ErrorState
      message={!selectedSite ? 'Select a site to inspect assets.' : denied || !/^\d+$/.test(id) ? 'Asset could not be found at a site you can access.' : 'Asset details could not be loaded.'}
      retry={selectedSite && /^\d+$/.test(id) ? () => void record.refetch() : undefined} />}
    {!moved && (identity || record.isPending && selectedSite && /^\d+$/.test(id)) && <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 ref={title} tabIndex={-1} className="asset-title">{identity?.name ?? 'Asset details'}</h1>
          {identity && <p className="mt-1 text-sm text-[var(--muted)]">
            <strong>{identity.identifier}</strong> · {identity.asset_type || 'Unclassified'} · {statusLabel(identity.operational_status)} · {selectedSite?.name}
            {asset?.archived && <strong className="ml-2 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[var(--text)]">Archived</strong>}
          </p>}
        </div>
        {mayManage && <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="button secondary" onClick={() => open('edit')}>Edit asset</button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger ref={moreTrigger} className="button secondary" aria-label="More asset actions"><MoreHorizontal size={19} /></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="nav-floating nav-account-menu" align="end" sideOffset={6}>
                <DropdownMenu.Item className="nav-menu-item" onSelect={() => open('transfer')}>Transfer site</DropdownMenu.Item>
                <DropdownMenu.Item className="nav-menu-item" onSelect={() => open('archive')}>Archive asset</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>}
      </header>
      {feedback && <div ref={noticeRef} tabIndex={-1} role="status" className="panel p-3 text-sm">{feedback}</div>}
      {record.isError && !denied && identity && <ErrorState message={asset ? 'Showing the previous asset details. Refresh failed.' : 'Could not load asset details.'}
        retry={() => void record.refetch()} />}
      {!asset && record.isPending && <div role="status" className="grid gap-3 md:grid-cols-3">
        {['Custody', 'Tracking device', 'Last reported location'].map(label => <section key={label} className="panel min-h-32 p-4">
          <h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
        </section>)}
      </div>}
      {asset && <div className="asset-overview grid gap-3 lg:grid-cols-3">
        <section className="panel flex min-w-0 flex-col items-start gap-2 p-4">
          <h2 ref={custodyHeading} tabIndex={-1} className="font-semibold">Custody</h2>
          {asset.custodian ? <>
            <Link className="asset-link font-bold" to={`/personnel/${asset.custodian.id}`}>{asset.custodian.name}</Link>
            <small className="text-[var(--muted)]">{asset.custodian.identifier}</small>
            <p className="text-sm text-[var(--muted)]">Issued <EvidenceTime value={asset.custodian.started_at} zone={selectedSite?.timezone} /></p>
          </> : <p className="text-sm text-[var(--muted)]">{custody ? 'Custodian details unavailable' : 'No custodian'}</p>}
          {mayManage && <button className="button secondary mt-auto" type="button" onClick={() => open(custody ? 'return' : 'custody')}>
            {custody ? 'Return custody' : 'Issue custody'}</button>}
        </section>
        <section className="panel flex min-w-0 flex-col items-start gap-2 p-4">
          <h2 ref={trackingHeading} tabIndex={-1} className="font-semibold">Tracking device</h2>
          {asset.node_id ? <>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="asset-link font-bold" to={`/devices/${encodeURIComponent(asset.node_id)}`}>{asset.node_id}</Link>
              {asset.node_status ? <NodeStatusPill status={asset.node_status} /> : <small className="text-[var(--muted)]">Connectivity unavailable</small>}
            </div>
            <p className="text-sm text-[var(--muted)]">Assigned <EvidenceTime value={asset.tracker_started_at ?? assignment?.started_at} zone={selectedSite?.timezone} /></p>
          </> : <p className="text-sm text-[var(--muted)]">No tracker assigned</p>}
          {mayManage && (assignment || !asset.node_id) && <button type="button" className="button secondary mt-auto"
            onClick={() => open(assignment ? 'release' : 'assign')}>{assignment ? 'Release tracker' : 'Assign tracker'}</button>}
        </section>
        <section className="panel grid min-w-0 content-start gap-2 p-4">
          <h2 className="font-semibold">Last reported location</h2>
          <AssetEvidence asset={asset} detail timezone={selectedSite?.timezone} />
        </section>
        <AssetHistory asset={asset} timezone={selectedSite?.timezone} audit={can('view_audit') && Boolean(asset.capabilities?.includes('view_audit'))} />
      </div>}
    </>}
    {dialogContent}
  </div>;
}

function AssetHistory({ asset, timezone, audit }: { asset: AssetDetail; timezone?: string; audit: boolean }) {
  const observations = asset.location_observations ?? [];
  const transfers = asset.transfer_history ?? [];
  return <section className="panel min-w-0 p-4 lg:col-span-3">
    <h2 className="font-semibold">Recent history</h2>
    <div className="mt-3 grid gap-4 md:grid-cols-2">
      <RelationshipHistory label="Custody history" rows={asset.custody_history ?? []} timezone={timezone}
        identity={row => row.person_name ? <>{row.person_name}{row.person_identifier ? ` · ${row.person_identifier}` : ''}</> : 'Custodian details unavailable'} />
      <RelationshipHistory label="Tracker assignment history" rows={asset.assignment_history ?? []} timezone={timezone}
        identity={row => row.node_id} />
    </div>
    {transfers.length > 0 && <details className="asset-history">
      <summary>Site-transfer history</summary>
      <ul>{transfers.slice(0, 10).map(row => <li key={row.id}>
        <strong>{row.source_name} → {row.destination_name}</strong>
        <div><EvidenceTime value={row.created_at} zone={timezone} />{row.actor_name && <> · {row.actor_name}</>}</div>
        <p>{row.reason}</p>
      </li>)}</ul>
    </details>}
    <details className="asset-history">
      <summary>Tracker observations, readings, and incidents</summary>
      <p className="my-2 text-sm text-[var(--muted)]">These tracker records may include reports from earlier assignments.</p>
      {observations.length > 0 ? <ul>{observations.slice(0, 10).map(row => <li key={row.id}>
        <strong>{row.reported_zone && row.reported_zone !== 'UNASSIGNED' ? row.reported_zone : 'Zone unavailable'} · {row.node_id}</strong>
        <p>{statusLabel(row.quality)}{row.simulated && ' · Simulated'}</p>
        <div>{row.captured_at ? <>Captured <EvidenceTime value={row.captured_at} zone={timezone} /></> : 'Capture time unknown'}</div>
        <div>Received <EvidenceTime value={row.received_at} zone={timezone} /></div>
      </li>)}</ul> : <p className="text-sm text-[var(--muted)]">No tracker location observations are available.</p>}
      {asset.measurements?.slice(0, 10).map(item => <p key={item.id} className="mt-2 text-sm">
        {item.node_id} · {item.measurement_key} {item.value} {item.unit} · Received <EvidenceTime value={item.received_at} zone={timezone} /></p>)}
      {asset.device_alerts?.slice(0, 10).map(item => <p key={item.id} className="mt-2 text-sm">
        <Link className="asset-link" to={`/alerts?alert=${item.id}`}>{item.alert_code}</Link> · {item.status}</p>)}
    </details>
    {audit && <details className="asset-history">
      <summary>Administrative audit</summary>
      {asset.audit?.length ? <ul>{asset.audit.slice(0, 10).map(item => <li key={item.id}>
        <strong>{statusLabel(item.action)}</strong> · {item.actor} · <EvidenceTime value={item.timestamp} zone={timezone} />
      </li>)}</ul> : <p className="my-2 text-sm text-[var(--muted)]">No audit entries are available.</p>}
    </details>}
  </section>;
}

function RelationshipHistory({ label, rows, identity, timezone }: {
  label: string; rows: AssetRelationship[]; identity: (row: AssetRelationship) => ReactNode; timezone?: string;
}) {
  return <section className="min-w-0">
    <h3 className="text-sm font-semibold">{label}</h3>
    {rows.length ? <ul className="asset-history-list">{rows.slice(0, 10).map(row => <li key={row.id}>
      <strong>{identity(row)}</strong> · {row.ended_at ? 'Ended' : 'Current'}
      <div>Started <EvidenceTime value={row.started_at} zone={timezone} />{row.started_actor && <> · {row.started_actor}</>}</div>
      {row.reason && <p>{row.reason}</p>}
      {row.ended_at && <div>Ended <EvidenceTime value={row.ended_at} zone={timezone} />{row.ended_actor && <> · {row.ended_actor}</>}</div>}
      {row.end_reason && <p>{row.end_reason}</p>}
    </li>)}</ul> : <p className="mt-2 text-sm text-[var(--muted)]">No records yet.</p>}
  </section>;
}
