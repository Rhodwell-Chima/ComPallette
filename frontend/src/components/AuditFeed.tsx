import React from 'react';
import { AuditItem } from '../types';

interface AuditFeedProps {
  logs: AuditItem[];
}

export const AuditFeed: React.FC<AuditFeedProps> = ({ logs }) => {
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
        Safety Incident &amp; Audit Trail
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '380px',
        overflowY: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
      }}>
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', padding: '12px', textAlign: 'center' }}>No audit events logged.</div>
        ) : (
          logs.map(l => {
            const dateStr = new Date(l.timestamp).toTimeString().split(' ')[0];
            const borderCol = l.action === 'ALERT_TRIGGERED' ? 'var(--color-crit)'
              : l.action === 'ALERT_ACKNOWLEDGED' ? 'var(--color-warn)'
              : l.action === 'ALERT_RESOLVED' ? 'var(--color-safe)'
              : 'var(--color-info)';

            return (
              <div key={l.id} style={{
                backgroundColor: 'var(--bg-card)',
                borderLeft: `3px solid ${borderCol}`,
                padding: '6px 10px',
                borderRadius: '0 3px 3px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '10px' }}>
                  <span>{l.action} &bull; {l.actor}</span>
                  <span>{dateStr}</span>
                </div>
                <div style={{ color: 'var(--text-main)' }}>{l.details}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
