import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, Box, Cpu, MapPin, Radio, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AlertItem, AuditItem, ChartZoneOccupancy, EnhancedDashboardData, MeasurementReading } from '../../types';
import { StatusPill, severityClass } from '../../platform/ui';
import { countValue, measurementLabel, numberValue, recentActivity, validTimestamp, type ActivityFilter } from './dashboardModel';

type FormatTime = (timestamp: unknown) => string;
const integer = new Intl.NumberFormat();
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const count = (value: unknown) => {
  const safe = countValue(value);
  return safe === undefined ? 'Unavailable' : integer.format(safe);
};

export function DashboardLink({ to, children, prominent = false }: {
  to: string;
  children: ReactNode;
  prominent?: boolean;
}) {
  return <Link to={to} tabIndex={0} className={prominent ? 'dashboard-link dashboard-link-prominent' : 'dashboard-link'}>
    {children}<ArrowUpRight size={15} aria-hidden="true" />
  </Link>;
}

export function PanelHeading({ id, title, subtitle, action }: {
  id: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return <div className="dashboard-panel-heading flex flex-wrap items-start justify-between">
    <div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    {action}
  </div>;
}

export function IncidentPanel({ alerts, metrics, formatTime, current }: {
  alerts: AlertItem[];
  metrics?: EnhancedDashboardData['metrics'];
  formatTime: FormatTime;
  current: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const critical = countValue(metrics?.critical_alerts);
  const unresolved = countValue(metrics?.active_alerts);
  const severe = (critical ?? 0) > 0 || alerts.some(alert => alert.severity === 'CRITICAL');
  const visible = expanded ? alerts : alerts.slice(0, 3);

  return <section className="dashboard-panel dashboard-incidents" data-critical={severe || undefined} aria-labelledby="dashboard-incidents">
    <PanelHeading id="dashboard-incidents" title="Unresolved incidents"
      subtitle={unresolved === undefined ? 'Total unavailable' : `${integer.format(unresolved)} unresolved · ${count(critical)} critical`}
      action={<DashboardLink to="/alerts" prominent>Open incident queue</DashboardLink>} />
    {visible.length ? <ul className="dashboard-list">
      {visible.map(alert => <li key={alert.id}>
        <Link className="dashboard-incident-row" to={`/alerts?alert=${alert.id}&review=1`} tabIndex={0}>
          <span className="dashboard-row-content">
            <strong>{alert.alert_code}</strong>
            {alert.details && <span className="dashboard-row-note">{alert.details}</span>}
            <span className="dashboard-row-note">{alert.zone || 'Zone not reported'} · {alert.node_id || 'Device not reported'} · {formatTime(alert.created_at)}</span>
          </span>
          <span className="dashboard-row-badges">
            <StatusPill value={alert.severity} tone={severityClass(alert.severity)} />
            <StatusPill value={alert.status} tone="neutral" />
          </span>
          <ArrowUpRight className="dashboard-row-arrow" size={16} aria-hidden="true" />
        </Link>
      </li>)}
    </ul> : <p className="dashboard-empty">
      {unresolved === 0 && critical !== undefined && critical === 0
        ? current ? 'No unresolved incidents reported in this snapshot.' : 'The previous snapshot reported no unresolved incidents. Current conditions are unverified.'
        : 'Incident details are unavailable. Open the queue to check the site.'}
    </p>}
    {(alerts.length > 3 || (unresolved !== undefined && unresolved > alerts.length)) && <div className="dashboard-panel-footer">
      {unresolved !== undefined && unresolved > alerts.length && <p>{integer.format(alerts.length)} of {integer.format(unresolved)} incidents are in this preview.</p>}
      {alerts.length > 3 && <button className="dashboard-control" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show fewer incidents' : `Show ${integer.format(alerts.length - 3)} more in preview`}
      </button>}
    </div>}
  </section>;
}

export function OperationalMetrics({ metrics }: { metrics?: EnhancedDashboardData['metrics'] }) {
  const unresponsive = countValue(metrics?.stale_or_offline_devices);
  const entries = [
    { label: 'Online devices', value: metrics?.online_devices, icon: Cpu, to: '/devices',
      note: unresponsive === undefined ? 'Degraded device count unavailable' : `${integer.format(unresponsive)} stale or offline`, warning: Boolean(unresponsive) },
    { label: 'Personnel with online nodes', value: metrics?.online_personnel, icon: UsersRound, to: '/personnel', note: 'Based on assigned node status' },
    { label: 'Registered assets', value: metrics?.tracked_assets, icon: Box, to: '/assets', note: 'Assets registered to this site' },
  ];
  return <section aria-labelledby="dashboard-overview">
    <h2 id="dashboard-overview" className="dashboard-section-title">Operational metrics</h2>
    <div className="dashboard-metrics dashboard-panel grid">
      {entries.map(({ label, icon: Icon, to, value, note, warning }) => <Link className="dashboard-metric" key={label} to={to} tabIndex={0}>
        <span className="dashboard-metric-label"><Icon size={18} aria-hidden="true" />{label}<ArrowUpRight size={15} aria-hidden="true" /></span>
        <strong>{count(value)}</strong><span className="dashboard-row-note" data-warning={warning || undefined}>{note}</span>
      </Link>)}
    </div>
  </section>;
}

export function SpatialPanel({ zones }: { zones?: ChartZoneOccupancy[] }) {
  return <section className="dashboard-panel" aria-labelledby="dashboard-spatial">
    <PanelHeading id="dashboard-spatial" title="Recorded zone associations"
      subtitle="Assigned nodes with recorded zones · up to six zones" action={<DashboardLink to="/twin">Open Digital Twin</DashboardLink>} />
    {Array.isArray(zones) && zones.length ? <>
      <div className="dashboard-table-wrap">
        <table><caption className="sr-only">Personnel and asset records by associated zone</caption>
          <thead><tr><th scope="col">Zone</th><th scope="col">Personnel</th><th scope="col">Assets</th></tr></thead>
          <tbody>{zones.map((row, index) => <tr key={`${row.zone}:${index}`}>
            <th scope="row">{row.zone || 'Unnamed zone'}</th><td>{count(row.personnel_count)}</td><td>{count(row.asset_count)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="dashboard-panel-footer">These counts describe recorded associations. Open Digital Twin for individual location evidence.</p>
    </> : <p className="dashboard-empty"><MapPin size={17} aria-hidden="true" />{Array.isArray(zones) ? 'No zone associations were returned.' : 'Zone data is unavailable.'}</p>}
  </section>;
}

export function ReadingPanel({ readings, formatTime, available }: {
  readings: MeasurementReading[];
  formatTime: FormatTime;
  available: boolean;
}) {
  return <section className="dashboard-panel" aria-labelledby="dashboard-readings">
    <PanelHeading id="dashboard-readings" title="Latest environmental readings"
      subtitle="Last reported sample per device and measurement" action={<DashboardLink to="/environment">All readings</DashboardLink>} />
    {readings.length ? <ul className="dashboard-list dashboard-readings">
      {readings.slice(0, 5).map(reading => <li className="dashboard-reading-row" key={reading.id}>
        <span className="dashboard-row-content">
          <strong>{measurementLabel(reading.measurement_key)}</strong>
          <span className="dashboard-row-note">{reading.node_id} · {reading.zone || 'Zone not reported'}</span>
          <span className="dashboard-row-note">Received {formatTime(reading.received_at)}</span>
        </span>
        <span className="dashboard-reading-value">
          {numberValue(reading.value) && reading.unit ? <>{decimal.format(reading.value)} <small>{reading.unit}</small></> : 'Unavailable'}
        </span>
      </li>)}
    </ul> : <p className="dashboard-empty"><Radio size={17} aria-hidden="true" />{available ? 'No environmental samples were reported.' : 'Environmental readings are unavailable.'}</p>}
    {readings.length > 5 && <p className="dashboard-panel-footer">Five most recent streams shown · {integer.format(readings.length)} total</p>}
  </section>;
}

export function ActivityPanel({ entries, formatTime }: { entries?: AuditItem[]; formatTime: FormatTime }) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [limit, setLimit] = useState(6);
  const filtered = useMemo(() => recentActivity(Array.isArray(entries) ? entries : [], filter), [entries, filter]);
  return <section className="dashboard-panel" aria-labelledby="dashboard-activity">
    <PanelHeading id="dashboard-activity" title="Recent operator activity"
      subtitle="Up to 12 recorded audit events for this site" action={<DashboardLink to="/audit">Open audit trail</DashboardLink>} />
    <div className="dashboard-activity-controls">
      <label htmlFor="dashboard-event-filter">Event type</label>
      <select id="dashboard-event-filter" value={filter} onChange={event => {
        setFilter(event.target.value as ActivityFilter);
        setLimit(6);
      }}>
        <option value="all">All events</option><option value="alerts">Alerts</option>
        <option value="users">Users and access</option><option value="devices">Devices</option>
      </select>
    </div>
    {filtered.length ? <ul className="dashboard-list">{filtered.slice(0, limit).map(entry =>
      <li key={entry.id} className="dashboard-activity-row">
        <div className="dashboard-row-content"><strong>{entry.action.replace(/_/g, ' ')}</strong><span className="dashboard-row-note">{entry.details}</span></div>
        <span className="dashboard-row-note">{entry.actor || 'Actor not reported'} · {formatTime(entry.timestamp)}</span>
      </li>,
    )}</ul> : <p className="dashboard-empty">{Array.isArray(entries) ? 'No recent events match this filter.' : 'Activity data is unavailable.'}</p>}
    {filtered.length > limit && <div className="dashboard-panel-footer">
      <button className="dashboard-control" type="button" onClick={() => setLimit(limit + 6)}>Show more events</button>
    </div>}
  </section>;
}

export function dashboardTimeFormatter(timeZone: string): FormatTime {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  return timestamp => validTimestamp(timestamp) ? formatter.format(timestamp) : 'Not reported';
}
