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
  const [timeStr, setTimeStr] = useState<string>('--:--:--');

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTimeStr(now.toTimeString().split(' ')[0] + ' (UTC+2)');
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header style={{
      backgroundColor: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-subtle)',
      padding: '12px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <span style={{
          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
          border: '1px solid var(--border-subtle)',
          color: '#38bdf8',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: '13px',
          letterSpacing: '1.5px',
          padding: '4px 10px',
          borderRadius: '4px',
        }}>
          COMPALLETTE
        </span>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.5px', color: '#fff' }}>
            Subterranean Safety Operations Center
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            MineMesh Zambia &bull; Enterprise Scalable Stack (Django + React)
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '9999px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 600,
          background: isGatewayOnline ? 'var(--color-safe-bg)' : 'var(--color-warn-bg)',
          color: isGatewayOnline ? 'var(--color-safe)' : 'var(--color-warn)',
          border: `1px solid ${isGatewayOnline ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        }}>
          <span className="pulse-dot"></span>
          <span>{isGatewayOnline ? 'GATEWAY ONLINE' : 'GATEWAY SILENT'}</span>
        </span>

        <button
          className={`btn ${!audioArmed ? 'btn-danger' : ''}`}
          onClick={onToggleAudio}
          title="Toggle audio alarm tone"
        >
          <span>{audioArmed ? '🔊' : '🔇'}</span>
          <span>{audioArmed ? 'SIREN: ARMED' : 'SIREN: MUTED'}</span>
        </button>

        <button className="btn" onClick={onRefresh}>
          <span>↻</span>
          <span>REFRESH</span>
        </button>

        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '13px', color: '#38bdf8' }}>
          {timeStr}
        </span>
      </div>
    </header>
  );
};
