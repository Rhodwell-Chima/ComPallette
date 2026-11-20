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
  const width = 72;
  const height = 26;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const strokeColors = {
    success: 'var(--success, #0d7a53)',
    warning: 'var(--warning, #b45309)',
    critical: 'var(--danger, #b91c1c)',
    default: 'var(--primary, #155dfc)',
  };

  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const gradientId = `spark-grad-${tone}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColors[tone]} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColors[tone]} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points={areaPoints} />
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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.75rem 1rem', textAlign: 'center', gap: '6px' }}>
        <CheckCircle2 size={24} style={{ color: 'var(--success)' }} />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>All Clear</span>
        <span className="muted" style={{ fontSize: '0.74rem' }}>No active safety alarms logged.</span>
      </div>
    );
  }

  let cumulativeAngle = 0;
  const radius = 36;
  const strokeWidth = 12;
  const center = 48;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.25rem', padding: '0.75rem 0.5rem' }}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} opacity="0.35" />
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
              transform="rotate(-90 48 48)"
              strokeLinecap="round"
            />
          );
        })}
        <text x="48" y="45" textAnchor="middle" fill="var(--text)" fontSize="17" fontWeight="800" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {total}
        </text>
        <text x="48" y="58" textAnchor="middle" fill="var(--muted)" fontSize="8" fontWeight="700" letterSpacing="0.06em">
          ALARMS
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, fontSize: '0.78rem' }}>
        {data.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: item.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--muted)', fontSize: '0.76rem', fontWeight: 550 }}>{item.label}</span>
            </div>
            <strong style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.84rem' }}>{item.count}</strong>
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
      {/* Header section with site badge, breadcrumb & quick actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '22px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span className="status-pill success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', padding: '2px 7px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              LIVE TELEMETRY
            </span>
            <span className="muted" style={{ fontSize: '0.74rem' }}>
              {selectedSite?.name} &middot; {selectedSite?.timezone ?? 'UTC'}
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text)' }}>
            Operations Cockpit
          </h1>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
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
            <FileBarChart size={15} /> Reports
          </Link>
          <Link className="button primary" to="/twin" title="Digital Twin (Key: T)">
            <Map size={15} /> Digital Twin
          </Link>
          <button
            type="button"
            className="button ghost icon-only"
            onClick={() => setShowShortcutHelp((v) => !v)}
            title="Keyboard Shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <HelpCircle size={17} />
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
            boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <strong style={{ fontSize: '0.86rem', color: 'var(--text)' }}>Command Shortcuts</strong>
            <button type="button" className="icon-button" onClick={() => setShowShortcutHelp(false)} aria-label="Close shortcuts">
              <X size={15} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', fontSize: '0.78rem', alignItems: 'center' }}>
            <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem' }}>U</kbd>
            <span>User Management</span>
            <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem' }}>T</kbd>
            <span>Launch Digital Twin</span>
            <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem' }}>A</kbd>
            <span>Safety Alarms</span>
            <kbd style={{ padding: '2px 6px', background: 'var(--surface-muted)', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem' }}>?</kbd>
            <span>Toggle Cheatsheet</span>
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
                padding: '12px 18px',
                borderRadius: '10px',
                border: `1px solid ${n.severity === 'CRITICAL' ? 'color-mix(in srgb, var(--danger) 45%, var(--border))' : 'color-mix(in srgb, var(--warning) 45%, var(--border))'}`,
                background: `color-mix(in srgb, ${n.severity === 'CRITICAL' ? 'var(--danger)' : 'var(--warning)'} 5%, var(--surface))`,
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
            <strong>{trends?.telemetry_rate ? `${trends.telemetry_rate.value}%` : '99.8%'}</strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <CheckCircle2 size={13} /> Active
            </span>
          </div>
          <span>Gateway mesh delivery rate</span>
        </div>
      </section>

      {/* Visualizations Section: Primary Chart (2/3) + Secondary Breakdown Charts (1/3) */}
      <section className="dashboard-charts">
        {/* Primary Chart (2/3 width) */}
        <article className="panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <span className="status-pill info" style={{ fontSize: '0.65rem' }}>TIME SERIES</span>
                <span className="muted" style={{ fontSize: '0.74rem' }}>Multivariate sensor trend</span>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Atmospheric Readings vs Alarm Events
              </h2>
            </div>
            <Link to="/environment" className="button secondary" style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Full Sensor Telemetry <ArrowRight size={13} />
            </Link>
          </div>
          <PrimaryTimelineChart points={charts?.primary_timeline ?? []} />
        </article>

        {/* Secondary Charts: Donut + Occupancy */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <article className="panel" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div>
                <span className="status-pill warning" style={{ fontSize: '0.65rem', marginBottom: '3px' }}>INCIDENT RISK</span>
                <h2 style={{ margin: '3px 0 0', fontSize: '0.98rem', fontWeight: 700 }}>Severity Distribution</h2>
              </div>
              <Link to="/alerts" className="muted" style={{ fontSize: '0.76rem' }}>View queue</Link>
            </div>
            <SeverityDonutChart data={charts?.severity_breakdown ?? []} />
          </article>

          {/* Quick Links Grid */}
          <article className="panel" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted)' }}>
                System Controls
              </h3>
              <span className="muted" style={{ fontSize: '0.7rem' }}>Quick Jump</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              <Link to="/sites-zones" className="button secondary" style={{ justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.78rem' }}>
                <Layers size={14} style={{ color: 'var(--primary)' }} /> Zones
              </Link>
              <Link to="/devices" className="button secondary" style={{ justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.78rem' }}>
                <Network size={14} style={{ color: 'var(--primary)' }} /> Mesh Nodes
              </Link>
              <Link to="/reports" className="button secondary" style={{ justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.78rem' }}>
                <FileBarChart size={14} style={{ color: 'var(--primary)' }} /> Compliance
              </Link>
              <Link to="/audit" className="button secondary" style={{ justifyContent: 'flex-start', padding: '8px 10px', fontSize: '0.78rem' }}>
                <Radio size={14} style={{ color: 'var(--primary)' }} /> Audit Ledger
              </Link>
            </div>
          </article>
        </div>
      </section>

      {/* Lower Dashboard Grid: Priority Alerts & Filterable Activity Feed */}
      <section className="dashboard-grid">
        {/* Priority Alarms Queue */}
        <article className="panel panel-wide" style={{ overflow: 'hidden' }}>
          <div className="panel-heading" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                <span className="status-pill critical" style={{ fontSize: '0.65rem' }}>PRIORITY QUEUE</span>
                <span className="muted" style={{ fontSize: '0.74rem' }}>{alerts.length} Active Incident{alerts.length === 1 ? '' : 's'}</span>
              </div>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>Unresolved Safety Alarms</h2>
            </div>
            <Link to="/alerts" className="button secondary" style={{ padding: '5px 10px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              Investigate All <ArrowRight size={14} />
            </Link>
          </div>
          {alerts.length ? (
            <div className="alert-list" style={{ padding: '4px 0' }}>
              {alerts.map((alert) => (
                <Link to={`/alerts?alert=${alert.id}`} className="alert-row" key={alert.id} style={{ padding: '12px 18px' }}>
                  <span className={`severity-dot ${severityClass(alert.severity)}`} />
                  <div>
                    <strong style={{ fontSize: '0.86rem', color: 'var(--text)' }}>{alert.alert_code}</strong>
                    <p style={{ margin: '3px 0 4px', color: 'var(--muted)', fontSize: '0.78rem' }}>
                      {alert.details || `Reported from ${alert.node_id}`}
                    </p>
                    <small style={{ color: 'var(--muted)', fontSize: '0.71rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span>{alert.node_id}</span>
                      <span>&middot;</span>
                      <span>{alert.zone || 'Unassigned zone'}</span>
                      <span>&middot;</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimestamp(alert.created_at)}</span>
                    </small>
                  </div>
                  <StatusPill value={alert.status} tone={severityClass(alert.severity)} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2.5rem 1.5rem' }}>
              <CheckCircle2 size={30} style={{ color: 'var(--success)' }} />
              <h2 style={{ margin: '8px 0 2px', fontSize: '0.95rem' }}>All Clear</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>No unresolved safety alerts reported for this operational site.</p>
            </div>
          )}
        </article>

        {/* Real-time Filterable Activity Feed with Sticky Date Grouping */}
        <article className="panel" style={{ padding: '18px' }}>
          <div className="panel-heading" style={{ padding: '0 0 14px', borderBottom: '1px solid var(--border)', marginBottom: '14px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                <span className="status-pill info" style={{ fontSize: '0.65rem' }}>AUDIT LOG</span>
                <span className="muted" style={{ fontSize: '0.74rem' }}>Real-time stream</span>
              </div>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>Recent Actions</h2>
            </div>
            <div className="segmented" style={{ margin: 0 }}>
              <button
                type="button"
                className={activityFilter === 'ALL' ? 'active' : ''}
                onClick={() => setActivityFilter('ALL')}
              >
                All
              </button>
              <button
                type="button"
                className={activityFilter === 'ALERT' ? 'active' : ''}
                onClick={() => setActivityFilter('ALERT')}
              >
                Alarms
              </button>
              <button
                type="button"
                className={activityFilter === 'USER' ? 'active' : ''}
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
