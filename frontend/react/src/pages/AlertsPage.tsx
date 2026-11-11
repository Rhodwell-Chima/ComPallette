import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, ShieldAlert, UserRoundCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { platformApi } from '../services/api';
import { AlertItem, AlertStatus } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusPill, formatTimestamp, severityClass } from '../platform/ui';

const filters: Array<'ALL' | AlertStatus> = ['ALL', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'];

export function AlertsPage() {
  const { selectedSiteId, can } = usePlatform();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'ALL' | AlertStatus>('ALL');
  const [selectedId, setSelectedId] = useState<number | undefined>(() => Number(params.get('alert')) || undefined);
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ['alerts', selectedSiteId, filter], queryFn: () => platformApi.alerts(selectedSiteId, filter === 'ALL' ? undefined : filter), enabled: Boolean(selectedSiteId), refetchInterval: 10_000 });
  const invalidate = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['alerts'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['audit'] })]);
  const acknowledge = useMutation({ mutationFn: platformApi.acknowledgeAlert, onSuccess: invalidate });
  const assign = useMutation({ mutationFn: ({ id, note }: { id: number; note: string }) => platformApi.assignAlert(id, note), onSuccess: invalidate });
  const resolve = useMutation({ mutationFn: ({ id, note }: { id: number; note: string }) => platformApi.resolveAlert(id, note), onSuccess: invalidate });
  const selected = alerts.data?.alerts.find(alert => alert.id === selectedId);

  useEffect(() => { if (!selectedId && alerts.data?.alerts.length) setSelectedId(alerts.data.alerts[0].id); }, [alerts.data?.alerts, selectedId]);
  const select = (alert: AlertItem) => { setSelectedId(alert.id); setParams({ alert: String(alert.id) }); setNotes(alert.investigation_notes || alert.resolution_notes || ''); };
  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a permitted site to review its alerts." />;
  if (alerts.isLoading) return <LoadingState label="Loading site alerts…" />;
  if (alerts.isError || !alerts.data) return <ErrorState message="Site alerts could not be loaded." retry={() => void alerts.refetch()} />;
  const working = acknowledge.isPending || assign.isPending || resolve.isPending;

  return <>
    <PageHeader eyebrow="OPERATIONS" title="Alerts & incidents" description="A server-audited workflow from new alert through acknowledgement, investigation and resolution." />
    <div className="segmented" aria-label="Alert status filter">{filters.map(item => <button className={filter === item ? 'active' : ''} key={item} onClick={() => { setFilter(item); setSelectedId(undefined); }}>{item.replace(/_/g, ' ')}</button>)}</div>
    <section className="incident-layout"><article className="panel incident-list-panel">{alerts.data.alerts.length ? <div className="incident-list">{alerts.data.alerts.map(alert => <button className={`incident-item ${selectedId === alert.id ? 'selected' : ''}`} key={alert.id} onClick={() => select(alert)}><span className={`severity-dot ${severityClass(alert.severity)}`} /><div><strong>{alert.alert_code}</strong><p>{alert.node_id} · {alert.zone || 'Unassigned zone'}</p><small>{formatTimestamp(alert.created_at)}</small></div><StatusPill value={alert.status} tone={severityClass(alert.severity)} /></button>)}</div> : <EmptyState title="No matching alerts" detail="There are no alerts in this status for the active site." />}</article>
      <article className="panel incident-detail">{selected ? <><div className="panel-heading"><div><p className={`eyebrow ${severityClass(selected.severity)}`}>{selected.severity} · ALERT #{selected.id}</p><h2>{selected.alert_code}</h2></div><StatusPill value={selected.status} tone={severityClass(selected.severity)} /></div><dl className="detail-grid"><div><dt>Source</dt><dd>{selected.node_id}</dd></div><div><dt>Zone</dt><dd>{selected.zone || 'Unassigned'}</dd></div><div><dt>Raised</dt><dd>{formatTimestamp(selected.created_at)}</dd></div><div><dt>Value</dt><dd>{selected.trigger_value}</dd></div></dl><p className="incident-description">{selected.details || 'No additional device context was supplied with this alert.'}</p><label className="field-label">Investigation / resolution notes<textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Record actions, observations or handover context." disabled={!can('operate_alerts') || selected.status === 'RESOLVED'} /></label>{can('operate_alerts') && <div className="incident-actions">{selected.status === 'NEW' && <button className="button secondary" disabled={working} onClick={() => acknowledge.mutate(selected.id)}><Check size={16} /> Acknowledge</button>}{selected.status !== 'RESOLVED' && <button className="button secondary" disabled={working} onClick={() => assign.mutate({ id: selected.id, note: notes })}><UserRoundCheck size={16} /> Assign to me</button>}{selected.status !== 'RESOLVED' && <button className="button danger" disabled={working} onClick={() => resolve.mutate({ id: selected.id, note: notes || 'Hazard cleared.' })}><ClipboardCheck size={16} /> Resolve</button>}</div>}<div className="incident-history"><h3><ShieldAlert size={16} /> Workflow context</h3><p>{selected.acknowledged_by ? `Acknowledged by ${selected.acknowledged_by} on ${formatTimestamp(selected.acknowledged_at)}.` : 'Awaiting acknowledgement.'}</p><p>{selected.assigned_to_username ? `Assigned to ${selected.assigned_to_username} on ${formatTimestamp(selected.assigned_at)}.` : 'Not assigned to an investigator.'}</p>{selected.resolved_by && <p>Resolved by {selected.resolved_by} on {formatTimestamp(selected.resolved_at)}.</p>}</div></> : <EmptyState title="Select an alert" detail="Choose an alert from the queue to inspect its evidence and workflow history." />}</article></section>
  </>;
}
