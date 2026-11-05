import React, { useEffect, useState } from 'react';

interface HeaderProps {
  isGatewayOnline: boolean;
  audioArmed: boolean;
  theme: 'dark' | 'light';
  frontendRevision: string;
  backendRevision: string | null;
  pendingProvisioningCount?: number;
  onOpenProvisioning?: () => void;
  onToggleTheme: () => void;
  onToggleAudio: () => void;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isGatewayOnline,
  audioArmed,
  theme,
  frontendRevision,
  backendRevision,
  pendingProvisioningCount = 0,
  onOpenProvisioning,
  onToggleTheme,
  onToggleAudio,
  onRefresh,
}) => {
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="brand">Compallette</span>
        <span className="header-sep" />
        <span className="header-context">Underground Safety Monitor</span>
        <span
          className={`build-revision ${backendRevision === frontendRevision ? 'build-match' : 'build-mismatch'}`}
          title={`Frontend build: ${frontendRevision}; backend build: ${backendRevision ?? 'unavailable'}`}
        >
          UI {frontendRevision} · API {backendRevision ?? 'unavailable'}
        </span>
      </div>

      <div className="header-center" style={{ gap: '10px' }}>
        <span className={`status-pill ${isGatewayOnline ? 'status-ok' : 'status-warn'}`}>
          <span className="status-dot" />
          {isGatewayOnline ? 'Gateway reporting' : 'Gateway stale / offline'}
        </span>

        {pendingProvisioningCount > 0 && (
          <button
            className="status-pill"
            style={{
              background: 'var(--brand-subtle)',
              borderColor: 'var(--brand-light)',
              color: 'var(--brand-light)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={onOpenProvisioning}
            title="Uncommissioned nodes detected. Click to assign."
          >
            <span className="status-dot" style={{ background: 'var(--brand-light)' }} />
            {pendingProvisioningCount} {pendingProvisioningCount === 1 ? 'New Node' : 'New Nodes'} (Assign)
          </button>
        )}
      </div>

      <div className="header-right">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          className={`btn btn-ghost ${!audioArmed ? 'text-crit' : ''}`}
          onClick={onToggleAudio}
        >
          {audioArmed ? 'Siren on' : 'Siren off'}
        </button>
        <button className="btn btn-ghost" onClick={onRefresh}>Refresh</button>
        <span className="mono header-clock">{time}</span>
      </div>
    </header>
  );
};
