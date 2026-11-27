import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onlineManager, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock3, RefreshCw } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { PrimaryTimelineChart } from '../components/PrimaryTimelineChart';
import { usePlatform } from '../platform/PlatformContext';
import { POLL_OPERATIONAL_MS, queryKeys } from '../platform/queryKeys';
import { ApiError, platformApi } from '../services/api';
import {
  ActivityPanel, IncidentPanel, OperationalMetrics, PanelHeading, ReadingPanel, SpatialPanel, dashboardTimeFormatter,
} from './dashboard/DashboardPanels';
import { latestStreams, monitoringTimeZone, prioritizeIncidents, snapshotState, validTimestamp } from './dashboard/dashboardModel';

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(onChange);
const statusBadge = cva('dashboard-status', {
  variants: { tone: { neutral: '', attention: 'dashboard-status-attention' } },
  defaultVariants: { tone: 'neutral' },
});
const labels = {
  loading: 'Loading snapshot',
  unavailable: 'Snapshot unavailable',
  offline: 'Browser offline',
  stale: 'Snapshot unverified',
  refreshing: 'Snapshot received',
  current: 'Snapshot received',
};

export function DashboardPage() {
  const { selectedSite, selectedSiteId, can, scopeUnverified } = usePlatform();
  const canViewAudit = can('view_audit');
  const online = useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true);
  const [clock, setClock] = useState(Date.now);
  const timeZone = monitoringTimeZone(selectedSite?.timezone);
  const formatTime = useMemo(() => dashboardTimeFormatter(timeZone), [timeZone]);
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(selectedSiteId, canViewAudit),
    queryFn: async ({ signal }) => {
      const data = await platformApi.dashboard(selectedSiteId, signal);
      if (data.site?.id !== selectedSiteId) throw new ApiError('Dashboard site does not match the active site.', 409, 'conflict');
      return canViewAudit ? data : { ...data, activity: [] };
    },
    enabled: Boolean(selectedSiteId),
    refetchInterval: POLL_OPERATIONAL_MS,
    staleTime: POLL_OPERATIONAL_MS / 2,
    gcTime: 0,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), POLL_OPERATIONAL_MS / 2);
    return () => window.clearInterval(timer);
  }, []);

  const rejectedScope = dashboard.error instanceof ApiError && dashboard.error.status >= 400 && dashboard.error.status < 500;
  const snapshot = rejectedScope ? undefined : dashboard.data;
  const receivedAt = snapshot ? dashboard.dataUpdatedAt : undefined;
  const state = snapshotState({
    receivedAt,
    generatedAt: snapshot?.snapshot_at,
    online: online && !dashboard.isPaused,
    failed: dashboard.isError || Boolean(scopeUnverified),
    fetching: dashboard.isFetching,
    now: Math.max(clock, receivedAt ?? 0),
  });
  const alerts = useMemo(() => prioritizeIncidents(snapshot?.alerts), [snapshot?.alerts]);
  const readings = useMemo(() => latestStreams(snapshot?.environment), [snapshot?.environment]);
  const historyWindow = snapshot?.history_window;
  const windowRange = historyWindow && validTimestamp(historyWindow.start_at) && validTimestamp(historyWindow.end_at) && historyWindow.end_at > historyWindow.start_at
    ? historyWindow : undefined;
  const observedScope = selectedSiteId && selectedSite;

  return <div className="dashboard-shell">
    <div className="dashboard-workspace">
      <header className="dashboard-header flex flex-wrap items-end justify-between">
        <div className="min-w-0">
          <h1>Operations cockpit</h1>
          <p>{selectedSite ? <>{selectedSite.name} · {timeZone}</> : 'Monitoring overview'}</p>
        </div>
        {observedScope && <div className="dashboard-header-actions flex flex-wrap items-center">
          <button className="dashboard-control" type="button" disabled={dashboard.isFetching || !online} onClick={() => void dashboard.refetch()}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh snapshot
          </button>
        </div>}
      </header>

      {!observedScope ? <section className="dashboard-panel dashboard-load"><h2>No site is available</h2><p>Select an authorized site to view monitoring data.</p></section> : <>
        <div className="dashboard-integrity flex flex-wrap items-center" data-state={state}>
          <span role="status" className={statusBadge({ tone: ['offline', 'stale', 'unavailable'].includes(state) ? 'attention' : 'neutral' })}>
            {['offline', 'stale', 'unavailable'].includes(state) ? <AlertTriangle size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
            {labels[state]}
          </span>
          <span className="dashboard-row-note">
            {receivedAt ? <>Last response {formatTime(receivedAt)}{validTimestamp(snapshot?.snapshot_at) && <> · Snapshot generated {formatTime(snapshot.snapshot_at)}</>}</>
              : 'No snapshot has been received for this site.'}
            {(state === 'stale' || state === 'offline') && receivedAt ? ' · Showing previously received data' : ''}
            {state === 'refreshing' && ' · Refreshing'}
          </span>
        </div>
        {scopeUnverified && <p className="dashboard-scope-note" role="status">Site access could not be refreshed.{canViewAudit && ' Recent operator activity is hidden until access is verified.'}</p>}

        {snapshot ? <>
          <IncidentPanel key={selectedSiteId} alerts={alerts} metrics={snapshot.metrics} formatTime={formatTime} current={state === 'current' || state === 'refreshing'} />
          <OperationalMetrics metrics={snapshot.metrics} />
          <div className="dashboard-detail-grid grid">
            <SpatialPanel zones={snapshot.charts?.zone_occupancy} />
            <ReadingPanel readings={readings} formatTime={formatTime} available={Array.isArray(snapshot.environment)} />
          </div>
          <div className={canViewAudit && !scopeUnverified ? 'dashboard-analysis-grid grid' : 'dashboard-analysis-grid dashboard-analysis-single grid'}>
            <section className="dashboard-panel dashboard-history" aria-labelledby="dashboard-history">
              <PanelHeading id="dashboard-history" title="Monitoring history"
                subtitle={windowRange ? `${formatTime(windowRange.start_at)} to ${formatTime(windowRange.end_at)} · ${timeZone}` : `Previous 12 hours · ${timeZone}`} />
              <p className="dashboard-history-note">Hourly mean of recorded environmental samples. Unresolved incidents are counted at bucket end.</p>
              {Array.isArray(snapshot.charts?.primary_timeline)
                ? <PrimaryTimelineChart points={snapshot.charts.primary_timeline} initialMetric="gas_ppm" timeZone={timeZone} window={windowRange} />
                : <p className="dashboard-empty">Historical data is unavailable.</p>}
            </section>
            {canViewAudit && !scopeUnverified && <ActivityPanel key={selectedSiteId} entries={snapshot.activity} formatTime={formatTime} />}
          </div>
        </> : <section className="dashboard-panel dashboard-load" aria-busy={state === 'loading'}>
          <h2>{state === 'loading' ? 'Loading operational data' : 'Operational data unavailable'}</h2>
          <p>{state === 'loading' ? 'Requesting the incident queue and site summary.' : 'The selected site has no verified snapshot to display.'}</p>
          {state === 'loading' && <div className="dashboard-skeleton" aria-hidden="true"><span /><span /><span /></div>}
        </section>}
      </>}
    </div>
  </div>;
}
