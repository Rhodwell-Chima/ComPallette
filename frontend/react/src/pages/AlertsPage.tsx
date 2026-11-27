import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ClipboardCheck, ShieldAlert, UserRoundCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { platformApi } from '../services/api';
import { AlertStatus } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { useAlertSession } from '../platform/AlertSessionContext';
import { Modal } from '../platform/Modal';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusPill, formatTimestamp, severityClass } from '../platform/ui';
import { POLL_TRACKING_MS, queryKeys } from '../platform/queryKeys';

const filters: Array<'ALL' | AlertStatus> = ['ALL', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'];

export function AlertsPage() {
  const { selectedSiteId, can } = usePlatform();
  const session = useAlertSession();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'ALL' | AlertStatus>('ALL');
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const requestedParam = params.get('alert');
  const requestedId = requestedParam ? Number(requestedParam) : null;
  const review = params.get('review') === '1';
  const initialRequestedIdRef = useRef<number | null>(review ? null : requestedId);
  const autoOpenedRef = useRef(false);

  const alerts = useQuery({
    queryKey: queryKeys.alerts(selectedSiteId, filter),
    queryFn: () => platformApi.alerts(selectedSiteId, filter === 'ALL' ? undefined : filter),
    enabled: Boolean(selectedSiteId),
    refetchInterval: POLL_TRACKING_MS,
  });

  const listed = alerts.data?.alerts.find(alert => alert.id === requestedId);
  const directReview = review && requestedId !== null && Number.isSafeInteger(requestedId) && requestedId > 0;
  const detail = useQuery({
    queryKey: queryKeys.alertDetail(selectedSiteId, requestedId ?? undefined),
    queryFn: ({ signal }) => platformApi.alertDetail(selectedSiteId!, requestedId!, signal),
    enabled: Boolean(selectedSiteId && directReview && !listed && !alerts.isPending),
    refetchInterval: POLL_TRACKING_MS,
  });
  const selected = directReview ? listed ?? detail.data : listed ?? alerts.data?.alerts[0];
  useEffect(() => {
    if (!alerts.isSuccess || directReview) return;
    if (selected?.id === requestedId || (!selected && !params.has('alert'))) return;
    const next = new URLSearchParams(params);
    if (selected) next.set('alert', String(selected.id)); else next.delete('alert');
    setParams(next, { replace: true });
  }, [alerts.isSuccess, directReview, selected?.id, requestedId, params, setParams]);

  useEffect(() => {
    if (
      !autoOpenedRef.current &&
      initialRequestedIdRef.current &&
      selected?.id === initialRequestedIdRef.current &&
      selected.status !== 'RESOLVED'
    ) {
      autoOpenedRef.current = true;
      setConfirming(true);
    }
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    setConfirming(false);
  }, [selectedSiteId]);

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to review its alerts." />;
  const notices = Object.entries(session.feedback).filter(([key]) => key.startsWith(`${selectedSiteId}:`));
  const feedback = <div aria-label="Alert action feedback">{notices.map(([key, notice]) => <div key={key} className={notice.error ? 'form-error' : 'muted'} role={notice.error ? 'alert' : 'status'}>
    <p>{notice.message}</p>
    {notice.uncertain && <button className="button secondary" disabled={Boolean(session.pending[key])} onClick={() => void session.reconcile(selectedSiteId, Number(key.split(':')[1]))}>Refresh server state</button>}
  </div>)}</div>;
  if (alerts.isLoading) return <>{feedback}<LoadingState label="Loading site alerts…" /></>;
  if (alerts.isError && !alerts.data) return <>{feedback}<ErrorState message="Site alerts could not be loaded." retry={() => void alerts.refetch()} /></>;
  const key = selected ? session.keyFor(selectedSiteId, selected.id) : '';
  const draft = session.drafts[key];
  const notes = draft?.text ?? (selected?.investigation_notes || selected?.resolution_notes || '');
  const pending = session.pending[key];
  const blocked = Boolean(pending || session.feedback[key]?.uncertain || alerts.isError || (directReview && !listed && detail.isError));
  const action = async (kind: 'acknowledge' | 'assign' | 'resolve') => {
    if (!selected || blocked || !can('operate_alerts') || (kind === 'resolve' && !notes.trim())) return;
    const ok = await session.run(selectedSiteId, selected.id, kind, notes);
    if (ok && kind === 'resolve') setConfirming(false);
  };

  return <>
    <PageHeader eyebrow="OPERATIONS" title="Alerts & incidents" description="Review alerts, record investigation notes, and confirm operational actions." />
    {feedback}
    {alerts.isError && <ErrorState message="Refresh failed. Showing previously loaded alerts; refresh before taking action." retry={() => void alerts.refetch()} />}
    <div className="segmented" aria-label="Alert status filter">{filters.map(item => <button aria-pressed={filter === item} className={filter === item ? 'active' : ''} key={item} onClick={() => setFilter(item)}>{item.replace(/_/g, ' ')}</button>)}</div>
    <section className="incident-layout">
      <article className="panel incident-list-panel">{alerts.data?.alerts.length ? <div className="incident-list">{alerts.data.alerts.map(alert => <button className={`incident-item ${selected?.id === alert.id ? 'selected' : ''}`} aria-pressed={selected?.id === alert.id} key={alert.id} onClick={() => { const next = new URLSearchParams(params); next.set('alert', String(alert.id)); setParams(next); }}>
        <span className={`severity-dot ${severityClass(alert.severity)}`} /><div><strong>{alert.alert_code}</strong><p>{alert.node_id} · {alert.zone || 'Unassigned zone'}</p><small>{formatTimestamp(alert.created_at)}</small><small>{alert.severity}</small></div><StatusPill value={alert.status} tone={severityClass(alert.severity)} />
      </button>)}</div> : <EmptyState title="No matching alerts" detail="There are no alerts in this status for the active site." />}</article>
      <article className="panel incident-detail">{selected ? <>
        <div className="panel-heading"><div><p className={`eyebrow ${severityClass(selected.severity)}`}>{selected.severity} · ALERT #{selected.id}</p><h2>{selected.alert_code}</h2></div><StatusPill value={selected.status} tone={severityClass(selected.severity)} /></div>
        <dl className="detail-grid"><div><dt>Source</dt><dd>{selected.node_id}</dd></div><div><dt>Zone</dt><dd>{selected.zone || 'Unassigned'}</dd></div><div><dt>Raised</dt><dd>{formatTimestamp(selected.created_at)}</dd></div><div><dt>Value</dt><dd>{selected.trigger_value}</dd></div></dl>
        <p className="incident-description">{selected.details || 'No additional device context was supplied with this alert.'}</p>
        <label className="field-label">Investigation / resolution notes<textarea value={notes} onChange={event => session.setDraft(selectedSiteId, selected.id, event.target.value)} placeholder="Record actions, observations or handover context." disabled={!can('operate_alerts') || selected.status === 'RESOLVED'} /></label>
        {draft && <p className="muted">Unsaved notes{selected.status === 'RESOLVED' ? ' — retained for reference; this alert is resolved.' : ''}</p>}
        {can('operate_alerts') && <div className="incident-actions">
          {selected.status === 'NEW' && <button className="button secondary" disabled={blocked} onClick={() => void action('acknowledge')}><Check size={16} />{pending === 'acknowledge' ? 'Acknowledging…' : 'Acknowledge'}</button>}
          {selected.status !== 'RESOLVED' && <><button className="button secondary" disabled={blocked} onClick={() => void action('assign')}><UserRoundCheck size={16} />{pending === 'assign' ? 'Assigning…' : 'Assign to me'}</button><button className="button danger" disabled={blocked} onClick={() => setConfirming(true)}><ClipboardCheck size={16} />Resolve</button></>}
        </div>}
        <div className="incident-history"><h3><ShieldAlert size={16} /> Workflow context</h3><p>{selected.acknowledged_by ? `Acknowledged by ${selected.acknowledged_by} on ${formatTimestamp(selected.acknowledged_at)}.` : 'Awaiting acknowledgement.'}</p><p>{selected.assigned_to_username ? `Assigned to ${selected.assigned_to_username} on ${formatTimestamp(selected.assigned_at)}.` : 'Not assigned to an investigator.'}</p>{selected.resolved_by && <p>Resolved by {selected.resolved_by} on {formatTimestamp(selected.resolved_at)}.</p>}{selected.resolution_notes && <p>Recorded resolution: {selected.resolution_notes}</p>}</div>
        <Modal isOpen={confirming} onClose={() => setConfirming(false)} title={`Resolve alert #${selected.id}`} subtitle={`${selected.node_id} · ${selected.severity} · ${selected.alert_code}`} initialFocusRef={cancelRef}>
          <form onSubmit={event => { event.preventDefault(); void action('resolve'); }}>
            <p>Confirm resolution only after reviewing the hazard and recording your actions.</p>
            <label className="field-label">Resolution notes<textarea required value={notes} onChange={event => session.setDraft(selectedSiteId, selected.id, event.target.value)} /></label>
            {!notes.trim() && <p className="form-error">Resolution notes are required.</p>}
            {session.feedback[key] && <p role={session.feedback[key].error ? 'alert' : 'status'}>{session.feedback[key].message}</p>}
            <div className="incident-actions"><button type="button" className="button secondary" ref={cancelRef} onClick={() => setConfirming(false)}>Cancel</button><button className="button danger" disabled={blocked || !notes.trim() || selected.status === 'RESOLVED'}>{pending === 'resolve' ? 'Resolving…' : 'Confirm resolution'}</button></div>
          </form>
        </Modal>
      </> : directReview && detail.isFetching ? <LoadingState label="Loading selected alert…" />
        : directReview && detail.isError ? <ErrorState message="The requested alert could not be loaded for this site." retry={() => void detail.refetch()} />
        : <EmptyState title="Select an alert" detail="Choose an alert from the queue to inspect its evidence and workflow history." />}</article>
    </section>
  </>;
}
