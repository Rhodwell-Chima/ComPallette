import { PrimaryTimelineChart } from '../components/PrimaryTimelineChart';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  FileBarChart,
  Filter,
  Flame,
  HelpCircle,
  Layers,
  Map,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Thermometer,
  TrendingUp,
  UserPlus,
  Users,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import { useOperatorSession } from '../components/AuthGate';
import { platformApi } from '../services/api';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, formatTimestamp, PageHeader, severityClass, StatusPill } from '../platform/ui';
import { SkeletonCard, SkeletonTable } from '../platform/loading';
import { ActivityFeed, FeedItemData, StaggerContainer, StaggerItem } from '../platform/feed';
import { ChartSeverityBreakdown, ChartTimeSeriesPoint, MetricTrend } from '../types';

/**
 * Mini SVG Sparkline for high-density metric trends
 */
function MiniSparkline({ data, tone = 'default' }: { data: number[]; tone?: 'success' | 'warning' | 'critical' | 'default' }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 64;
  const height = 24;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const strokeColors = {
    success: 'var(--success, #17835d)',
    warning: 'var(--warning, #b96700)',
    critical: 'var(--danger, #c42a2a)',
    default: 'var(--primary, #1666d9)',
  };

  return (
    <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
      <polyline
        fill="none"
        stroke={strokeColors[tone]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/**
 * Secondary Donut Chart: Incident Severity Breakdown
 */
function SeverityDonutChart({ data }: { data: ChartSeverityBreakdown[] }) {
  const total = data.reduce((acc, curr) => acc + curr.count, 0);
  if (total === 0) {
    return <div className="muted" style={{ padding: '2rem', textAlign: 'center' }}>No active alarms logged.</div>;
  }

  let cumulativeAngle = 0;
  const radius = 38;
  const strokeWidth = 14;
  const center = 50;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '1rem', padding: '0.5rem 0' }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} opacity="0.3" />
        {data.map((item) => {
          if (item.count === 0) return null;
          const strokeDasharray = `${(item.count / total) * circumference} ${circumference}`;
          const strokeDashoffset = -cumulativeAngle;
          cumulativeAngle += (item.count / total) * circumference;

          return (
            <circle
              key={item.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 50 50)"
            />
          );
        })}
        <text x="50" y="47" textAnchor="middle" fill="var(--text)" fontSize="16" fontWeight="bold">
          {total}
        </text>
        <text x="50" y="60" textAnchor="middle" fill="var(--muted)" fontSize="8">
          ALARMS
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem' }}>
        {data.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: item.color }} />
            <span style={{ minWidth: 60 }}>{item.label}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { session } = useOperatorSession();
  const { selectedSite, selectedSiteId } = usePlatform();
  const navigate = useNavigate();

  // Date range selector state
  const [dateRange, setDateRange] = useState<'today' | '24h' | '7d' | '30d'>('24h');
  const [snoozedNotifications, setSnoozedNotifications] = useState<Record<string, number>>({});
  const [activityLimit, setActivityLimit] = useState(6);
  const [activityFilter, setActivityFilter] = useState<'ALL' | 'ALERT' | 'USER' | 'DEVICE'>('ALL');
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === '?') {
        setShowShortcutHelp((v) => !v);
      } else if (e.key === 'u' || e.key === 'U') {
        navigate('/access');
      } else if (e.key === 't' || e.key === 'T') {
        navigate('/twin');
      } else if (e.key === 'a' || e.key === 'A') {
        navigate('/alerts');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const dashboard = useQuery({
    queryKey: ['dashboard', selectedSiteId, dateRange],
    queryFn: () => platformApi.dashboard(selectedSiteId, { range: dateRange }),
    enabled: Boolean(selectedSiteId),
    refetchInterval: 15_000,
  });

  if (!selectedSiteId) {
    return <EmptyState title="No site is available" detail="An administrator must grant site access before operational data can be shown." />;
  }
  if (dashboard.isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonTable rows={4} columns={[60, 240, 160, 120, 80]} />
      </div>
    );
  }
  if (dashboard.isError || !dashboard.data) {
    return <ErrorState message="The dashboard could not load the selected site's live operational summary." retry={() => void dashboard.refetch()} />;
  }

  const { metrics, trends, charts, alerts, environment, activity, system_notifications = [] } = dashboard.data;

  // Filter out locally snoozed notifications
  const now = Date.now();
  const activeNotifications = system_notifications.filter((n) => !snoozedNotifications[n.id] || snoozedNotifications[n.id] < now);

  const snoozeNotification = (id: string, hours: number) => {
    setSnoozedNotifications((prev) => ({
      ...prev,
      [id]: Date.now() + hours * 3600 * 1000,
    }));
  };

  const filteredActivity = activity.filter((item) => {
    if (activityFilter === 'ALL') return true;
    if (activityFilter === 'ALERT') return item.action.includes('ALERT');
    if (activityFilter === 'USER') return item.action.includes('USER') || item.action.includes('ACCESS');
    if (activityFilter === 'DEVICE') return item.action.includes('PROVISION') || item.action.includes('NODE');
    return true;
  });

  return (
    <>
      {/* Header section with welcome greeting & quick actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div>
          <p className="eyebrow">{selectedSite?.industry ?? 'INDUSTRIAL OPERATIONS'} &middot; {selectedSite?.timezone}</p>
          <h1 style={{ margin: '2px 0 6px', fontSize: '1.75rem', letterSpacing: '-0.03em' }}>
            Welcome back, {session.username}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Active Command Centre &middot; <strong>{selectedSite?.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          {/* Date range selector */}
          <div className="segmented" style={{ margin: 0 }}>
            <button className={dateRange === 'today' ? 'active' : ''} onClick={() => setDateRange('today')}>Today</button>
            <button className={dateRange === '24h' ? 'active' : ''} onClick={() => setDateRange('24h')}>24h</button>
            <button className={dateRange === '7d' ? 'active' : ''} onClick={() => setDateRange('7d')}>7d</button>
            <button className={dateRange === '30d' ? 'active' : ''} onClick={() => setDateRange('30d')}>30d</button>
          </div>

          {/* Quick action buttons */}
          <Link className="button secondary" to="/access" title="User Management (Key: U)">
            <UserPlus size={15} /> Add Operator
          </Link>
          <Link className="button secondary" to="/reports">
            <FileBarChart size={15} /> New Report
          </Link>
          <Link className="button primary" to="/twin" title="Digital Twin (Key: T)">
            <Map size={15} /> Digital Twin
          </Link>
          <button
            type="button"
            className="button ghost icon-only"
            onClick={() => setShowShortcutHelp((v) => !v)}
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcutHelp && (
        <div
          className="panel"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 100,
            maxWidth: '320px',
            padding: '16px',
            boxShadow: '0 12px 35px rgba(0,0,0,0.3)',
            border: '1px solid var(--primary)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <strong style={{ fontSize: '0.88rem' }}>Power User Shortcuts</strong>
            <button type="button" className="icon-button" onClick={() => setShowShortcutHelp(false)}>
              <X size={15} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: '0.78rem' }}>
            <kbd style={{ padding: '2px 5px', background: 'var(--surface-muted)', borderRadius: '3px' }}>U</kbd>
            <span>Open User Management</span>
            <kbd style={{ padding: '2px 5px', background: 'var(--surface-muted)', borderRadius: '3px' }}>T</kbd>
            <span>Launch Digital Twin</span>
            <kbd style={{ padding: '2px 5px', background: 'var(--surface-muted)', borderRadius: '3px' }}>A</kbd>
            <span>View Safety Alarms</span>
            <kbd style={{ padding: '2px 5px', background: 'var(--surface-muted)', borderRadius: '3px' }}>?</kbd>
            <span>Toggle this shortcut cheatsheet</span>
          </div>
        </div>
      )}

      {/* Actionable System Alerts Banner */}
      {activeNotifications.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
          {activeNotifications.map((n) => (
            <div
              key={n.id}
              className="panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '10px 16px',
                borderLeft: `4px solid ${n.severity === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'}`,
                background: 'color-mix(in srgb, var(--surface) 95%, transparent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ShieldAlert size={18} color={n.severity === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'} />
                <div>
                  <strong style={{ fontSize: '0.84rem' }}>{n.title}</strong>
                  <span className="muted" style={{ marginLeft: '8px', fontSize: '0.78rem' }}>
                    {n.message}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {n.action_route && (
                  <Link to={n.action_route} className="button secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }}>
                    {n.action_label || 'Action'}
                  </Link>
                )}
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => snoozeNotification(n.id, 1)}
                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                >
                  <Clock size={13} /> Snooze 1h
                </button>
                <button
                  type="button"
                  className="button ghost icon-only"
                  onClick={() => snoozeNotification(n.id, 24)}
                  aria-label="Dismiss alert"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* High-density 4-6 Stat Cards with Trends & Sparklines */}
      <section className="metric-grid" aria-label="Operational summary" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {/* Card 1: Active Alerts */}
        <Link to="/alerts" className={`metric-card ${metrics.critical_alerts ? 'critical' : metrics.active_alerts ? 'warning' : 'success'}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p>Active Alarms</p>
            {trends?.active_alerts?.sparkline && (
              <MiniSparkline data={trends.active_alerts.sparkline} tone={metrics.critical_alerts ? 'critical' : 'warning'} />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <strong>{metrics.active_alerts}</strong>
            {trends?.active_alerts && (
              <span style={{ fontSize: '0.72rem', color: trends.active_alerts.direction === 'down' ? 'var(--success)' : 'var(--danger)', display: 'inline-flex', alignItems: 'center' }}>
                {trends.active_alerts.direction === 'down' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                {Math.abs(trends.active_alerts.delta_percent)}%
              </span>
            )}
          </div>
          <span>{metrics.critical_alerts} requiring critical dispatch</span>
        </Link>

        {/* Card 2: Online Personnel */}
        <Link to="/personnel" className="metric-card success">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p>Online Personnel</p>
            {trends?.online_personnel?.sparkline && (
              <MiniSparkline data={trends.online_personnel.sparkline} tone="success" />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <strong>{metrics.online_personnel}</strong>
            {trends?.online_personnel && (
              <span style={{ fontSize: '0.72rem', color: 'var(--success)', display: 'inline-flex', alignItems: 'center' }}>
                <ArrowUpRight size={14} />
                +{trends.online_personnel.delta_percent}%
              </span>
            )}
          </div>
          <span>Accounted for on active shifts</span>
        </Link>

        {/* Card 3: Tracked Assets */}
        <Link to="/assets" className="metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p>Tracked Assets</p>
            {trends?.tracked_assets?.sparkline && (
              <MiniSparkline data={trends.tracked_assets.sparkline} tone="default" />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <strong>{metrics.tracked_assets}</strong>
          </div>
          <span>Registered heavy plant & machinery</span>
        </Link>

        {/* Card 4: Online Devices */}
        <Link to="/devices" className={`metric-card ${metrics.stale_or_offline_devices ? 'warning' : 'success'}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p>Online Devices</p>
            {trends?.online_devices?.sparkline && (
              <MiniSparkline data={trends.online_devices.sparkline} tone={metrics.stale_or_offline_devices ? 'warning' : 'success'} />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <strong>{metrics.online_devices}</strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              /{metrics.online_devices + metrics.stale_or_offline_devices} total
            </span>
          </div>
          <span>{metrics.stale_or_offline_devices} stale or offline nodes</span>
        </Link>

        {/* Card 5: Ingestion Health / Rate */}
        <div className="metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p>Telemetry Uptime</p>
            {trends?.telemetry_rate?.sparkline && (
              <MiniSparkline data={trends.telemetry_rate.sparkline} tone="success" />
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <strong>{trends?.telemetry_rate?.value ?? 98.4}%</strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--success)', display: 'inline-flex', alignItems: 'center' }}>
              <CheckCircle2 size={13} /> Stable
            </span>
          </div>
          <span>Gateway mesh delivery rate</span>
        </div>
      </section>

      {/* Visualizations Section: Primary Chart (2/3) + Secondary Breakdown Charts (1/3) */}
      <section className="dashboard-charts">
        {/* Primary Chart (2/3 width) */}
        <article className="panel" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
            <div>
              <p className="eyebrow">ENVIRONMENTAL & SAFETY CHRONOLOGY</p>
              <h2 style={{ margin: '3px 0 0', fontSize: '1.05rem' }}>Atmospheric Readings vs Alarm Events</h2>
            </div>
            <Link to="/environment" className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
              Deep dive <ArrowRight size={14} />
            </Link>
          </div>
          <PrimaryTimelineChart points={charts?.primary_timeline ?? []} />
        </article>

        {/* Secondary Charts: Donut + Occupancy */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <article className="panel" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p className="eyebrow">INCIDENT SEVERITY</p>
                <h2 style={{ margin: '3px 0 0', fontSize: '0.98rem' }}>Active Risk Tiers</h2>
              </div>
              <Link to="/alerts" className="muted" style={{ fontSize: '0.76rem' }}>View queue</Link>
            </div>
            <SeverityDonutChart data={charts?.severity_breakdown ?? []} />
          </article>

          {/* Quick Links Grid */}
          <article className="panel" style={{ padding: '14px 18px' }}>
            <p className="eyebrow" style={{ marginBottom: '8px' }}>ADMIN SHORTCUTS</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              <Link to="/sites-zones" className="button ghost" style={{ justifyContent: 'flex-start', padding: '6px 8px', fontSize: '0.76rem' }}>
                <Layers size={14} /> Sites & Zones
              </Link>
              <Link to="/devices" className="button ghost" style={{ justifyContent: 'flex-start', padding: '6px 8px', fontSize: '0.76rem' }}>
                <Network size={14} /> Mesh Nodes
              </Link>
              <Link to="/reports" className="button ghost" style={{ justifyContent: 'flex-start', padding: '6px 8px', fontSize: '0.76rem' }}>
                <FileBarChart size={14} /> Compliance Logs
              </Link>
              <Link to="/audit" className="button ghost" style={{ justifyContent: 'flex-start', padding: '6px 8px', fontSize: '0.76rem' }}>
                <Radio size={14} /> Audit Ledger
              </Link>
            </div>
          </article>
        </div>
      </section>

      {/* Lower Dashboard Grid: Priority Alerts & Filterable Activity Feed */}
      <section className="dashboard-grid">
        {/* Priority Alarms Queue */}
        <article className="panel panel-wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PRIORITY QUEUE</p>
              <h2>Unresolved Safety Alarms</h2>
            </div>
            <Link to="/alerts">
              Investigate All <ArrowRight size={15} />
            </Link>
          </div>
          {alerts.length ? (
            <div className="alert-list">
              {alerts.map((alert) => (
                <Link to={`/alerts?alert=${alert.id}`} className="alert-row" key={alert.id}>
                  <span className={`severity-dot ${severityClass(alert.severity)}`} />
                  <div>
                    <strong>{alert.alert_code}</strong>
                    <p>{alert.details || `Reported from ${alert.node_id}`}</p>
                    <small>
                      {alert.node_id} &middot; {alert.zone || 'Unassigned zone'} &middot; {formatTimestamp(alert.created_at)}
                    </small>
                  </div>
                  <StatusPill value={alert.status} tone={severityClass(alert.severity)} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No active alerts" detail="Django has not reported any unresolved safety alerts for this site." />
          )}
        </article>

        {/* Real-time Filterable Activity Feed with Sticky Date Grouping */}
        <article className="panel" style={{ padding: '16px' }}>
          <div className="panel-heading" style={{ padding: '0 0 12px' }}>
            <div>
              <p className="eyebrow">AUDIT & EVENT STREAM</p>
              <h2>Recent Actions</h2>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className={`button ghost ${activityFilter === 'ALL' ? 'primary' : ''}`}
                style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                onClick={() => setActivityFilter('ALL')}
              >
                All
              </button>
              <button
                type="button"
                className={`button ghost ${activityFilter === 'ALERT' ? 'primary' : ''}`}
                style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                onClick={() => setActivityFilter('ALERT')}
              >
                Alarms
              </button>
              <button
                type="button"
                className={`button ghost ${activityFilter === 'USER' ? 'primary' : ''}`}
                style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                onClick={() => setActivityFilter('USER')}
              >
                Users
              </button>
            </div>
          </div>

          <ActivityFeed
            items={filteredActivity.slice(0, activityLimit).map((entry): FeedItemData => ({
              id: entry.id,
              timestamp: entry.timestamp,
              actor: entry.actor,
              action: entry.action,
              details: entry.details,
              category: entry.action.includes('ALERT') ? 'ALERT' : entry.action.includes('USER') ? 'USER' : 'GENERAL',
            }))}
            hasMore={activityLimit < filteredActivity.length}
            remainingCount={filteredActivity.length - activityLimit}
            onLoadMore={() => setActivityLimit((prev) => prev + 6)}
          />
        </article>
      </section>
    </>
  );
}
