import { useEffect, useRef, useState } from 'react';
import { Activity, Clock, Database, Globe, Server, ShieldAlert } from 'lucide-react';
import { BackendHealth } from '../services/api';
import { formatTimestamp } from './ui';

export function BackendConnection({
  data,
  isError,
  dataUpdatedAt,
}: {
  data?: BackendHealth;
  isError: boolean;
  dataUpdatedAt: number;
}) {
  const label = isError
    ? data
      ? 'Status unverified'
      : 'Connection failed'
    : data?.status === 'healthy'
    ? 'Connected'
    : data
    ? 'Status unverified'
    : 'Checking';

  const isConnected = label === 'Connected';
  const isChecking = label === 'Checking';
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Pop up appears only after hovering on it for some time (400ms dwell delay)
    hoverTimerRef.current = setTimeout(() => {
      setIsPopoverOpen(true);
    }, 400);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setIsPopoverOpen(false);
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`backend-status-pill connection backend-connection ${
        isConnected ? 'online' : isChecking ? 'checking' : 'offline'
      }`}
      role="status"
      tabIndex={0}
      title={data?.build_revision}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      aria-label={`Backend telemetry link: ${label}`}
    >
      <span className="backend-beacon" aria-hidden="true">
        <span className="beacon-core" />
        <span className="beacon-ring" />
      </span>

      <span className="backend-label-group">
        <span className="backend-title">Backend:</span>
        <span className="backend-state">{label}</span>
      </span>

      {/* Pop-up delayed hover diagnostic card */}
      {isPopoverOpen && (
        <div
          className="backend-popover-card"
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="backend-popover-header">
            <div className="backend-popover-icon-box">
              {isConnected ? <Activity size={15} /> : <ShieldAlert size={15} />}
            </div>
            <div>
              <strong className="backend-popover-title">Service Telemetry</strong>
              <span className="backend-popover-subtitle">
                {isConnected ? 'Active & Synced' : isChecking ? 'Handshaking...' : 'Connection Disrupted'}
              </span>
            </div>
          </div>

          <div className="backend-popover-grid">
            <div className="backend-popover-row">
              <span className="popover-row-key">
                <Server size={12} /> Gateway Service
              </span>
              <span className="popover-row-val">{data?.service || 'ComPallette ASGI'}</span>
            </div>

            <div className="backend-popover-row">
              <span className="popover-row-key">
                <Database size={12} /> Database
              </span>
              <span className="popover-row-val">{data?.database || 'PostgreSQL'}</span>
            </div>

            <div className="backend-popover-row">
              <span className="popover-row-key">
                <Globe size={12} /> Version
              </span>
              <span className="popover-row-val">{data?.version ? `v${data.version}` : 'v2.0'}</span>
            </div>

            <div className="backend-popover-row">
              <span className="popover-row-key">
                <Clock size={12} /> Last Heartbeat
              </span>
              <span className="popover-row-val">
                {dataUpdatedAt > 0 ? formatTimestamp(dataUpdatedAt) : 'Pending handshake'}
              </span>
            </div>
          </div>

          <div className="backend-popover-footer">
            <small>Polled automatically every 30 seconds</small>
          </div>
        </div>
      )}
    </div>
  );
}
