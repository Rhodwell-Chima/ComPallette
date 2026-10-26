import React, { useEffect, useState } from 'react';

interface HeaderProps {
  isGatewayOnline: boolean;
  audioArmed: boolean;
  onToggleAudio: () => void;
  onRefresh: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isGatewayOnline,
  audioArmed,
  onToggleAudio,
  onRefresh,
}) => {
  const [catTime, setCatTime] = useState<string>('--:--:--');
  const [utcTime, setUtcTime] = useState<string>('--:--:--');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      // Central Africa Time (CAT = UTC+2)
      const catDate = new Date(now.getTime() + (2 * 3600 * 1000));
      setCatTime(catDate.toISOString().slice(11, 19));
      setUtcTime(now.toISOString().slice(11, 19));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="scada-header">
      {/* Brand & System Title */}
      <div className="header-brand-group">
        <div className="brand-logo-badge">
          <div className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">COMPALLETTE</span>
            <span className="brand-sub">SUBTERRANEAN OPS</span>
          </div>
        </div>

        <div className="header-divider-v" />

        <div className="header-facility-meta">
          <div className="facility-title">ZAMBIA UNDERGROUND MINING SAFETY COMMAND</div>
          <div className="facility-subtitle font-mono">
            <span>SECTOR: COPPERBELT DEEP EXTRACTION</span>
            <span className="meta-sep">&bull;</span>
            <span>WIRELESS MESH: MineMesh_Zambia (5555)</span>
          </div>
        </div>
      </div>

      {/* Center Link Status & Protocol Telemetry */}
      <div className="header-center-status">
        <div className={`gateway-pill ${isGatewayOnline ? 'gateway-active' : 'gateway-silent'}`}>
          <span className="pulse-dot-scada" />
          <span className="font-mono">
            {isGatewayOnline ? 'GATEWAY UPLINK: NOMINAL (2.0s)' : 'GATEWAY UPLINK: SILENT / BUFFERING'}
          </span>
        </div>
      </div>

      {/* Right Controls & Timestamps */}
      <div className="header-controls-group">
        {/* Siren Trigger / Toggle */}
        <button
          className={`scada-btn-toggle ${audioArmed ? 'btn-siren-armed' : 'btn-siren-muted'}`}
          onClick={onToggleAudio}
          title="Toggle audio alarm synthesizer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {audioArmed ? (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </>
            ) : (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            )}
          </svg>
          <span className="font-mono">{audioArmed ? 'SIREN ARMED' : 'SIREN MUTED'}</span>
        </button>

        {/* Sync / Refresh */}
        <button
          className="scada-icon-btn"
          onClick={onRefresh}
          title="Manual poll refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>

        {/* Dual Clock (CAT / UTC) */}
        <div className="header-clocks font-mono">
          <div className="clock-item">
            <span className="clock-label">CAT (LUSAKA)</span>
            <span className="clock-val-active">{catTime}</span>
          </div>
          <div className="clock-item">
            <span className="clock-label">UTC SYNC</span>
            <span className="clock-val-dim">{utcTime}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
