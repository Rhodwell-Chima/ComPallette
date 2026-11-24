import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, LoaderCircle, MapPin, Radio, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AlertSeverity, LocationEvidence, NodeStatus } from '../types';

export function formatTimestamp(value?: number | null): string {
  if (!value) return 'Not reported';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function severityClass(severity: AlertSeverity | string): string {
  return severity === 'CRITICAL' ? 'critical' : severity === 'WARNING' ? 'warning' : 'info';
}

export function StatusPill({ value, tone }: { value: string; tone?: string }) {
  return <span className={`status-pill ${tone ?? value.toLowerCase()}`}>{value.replace(/_/g, ' ')}</span>;
}

export function LocationLabel({ evidence, zone }: { evidence?: LocationEvidence; zone?: string }) {
  const label =
    evidence === 'CURRENT' ? 'Current zone' :
    evidence === 'CONFIRMED' ? 'Confirmed zone' :
    evidence === 'TRANSITIONING' ? 'Transitioning zone' :
    evidence === 'AMBIGUOUS' ? 'Ambiguous zone' :
    evidence === 'LAST_KNOWN' ? 'Last-known zone' :
    evidence === 'ESTIMATED' ? 'Estimated zone' :
    'Location unknown';
  return <span className={`location-label ${evidence?.toLowerCase() ?? 'unknown'}`} title={label}><MapPin size={13} /> {zone && evidence !== 'UNKNOWN' ? `${label}: ${zone}` : label}</span>;
}

export function NodeStatusPill({ status }: { status?: NodeStatus }) {
  const icon = status === 'ONLINE' ? <CheckCircle2 size={13} /> : status === 'STALE' ? <Clock3 size={13} /> : <XCircle size={13} />;
  return <span className={`node-status ${status?.toLowerCase() ?? 'offline'}`}>{icon}{status ?? 'UNKNOWN'}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function MetricCard({ label, value, note, tone = 'neutral', href }: { label: string; value: string | number; note?: string; tone?: 'neutral' | 'critical' | 'warning' | 'success'; href?: string }) {
  const content = <><p>{label}</p><strong>{value}</strong>{note && <span>{note}</span>}</>;
  return href ? <Link className={`metric-card ${tone}`} to={href}>{content}</Link> : <article className={`metric-card ${tone}`}>{content}</article>;
}

export function LoadingState({ label = 'Loading operational data…' }: { label?: string }) {
  return <div className="query-state"><LoaderCircle className="spin" size={24} /><p>{label}</p></div>;
}

export function ErrorState({ message, retry }: { message?: string; retry?: () => void }) {
  return <div className="query-state error"><AlertTriangle size={24} /><p>{message ?? 'This information could not be loaded.'}</p>{retry && <button className="button secondary" onClick={retry}>Try again</button>}</div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="empty-state"><CircleDashed size={26} /><h2>{title}</h2><p>{detail}</p>{action}</div>;
}

export function DataFreshness({ timestamp }: { timestamp?: number | null }) {
  return <span className="data-freshness"><Radio size={13} /> Updated {formatTimestamp(timestamp)}</span>;
}
