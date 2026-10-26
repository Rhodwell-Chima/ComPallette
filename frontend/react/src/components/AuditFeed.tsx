import React from 'react';
import { AuditItem } from '../types';

interface AuditFeedProps {
  logs: AuditItem[];
}

export const AuditFeed: React.FC<AuditFeedProps> = ({ logs }) => {
  return (
    <div style={{ marginTop: '12px' }}>
      <div className="audit-title">Safety &amp; System Audit Log</div>
      <div className="audit-list">
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-3)', padding: '16px', textAlign: 'center', fontSize: '11px' }}>
            No incident or audit events recorded.
          </div>
        ) : (
          logs.map(l => {
            const dateStr = new Date(l.timestamp).toTimeString().split(' ')[0];
            const accentClass =
              l.action === 'ALERT_TRIGGERED'
                ? 'audit-accent-crit'
                : l.action === 'ALERT_ACKNOWLEDGED'
                ? 'audit-accent-warn'
                : l.action === 'ALERT_RESOLVED'
                ? 'audit-accent-safe'
                : 'audit-accent-info';

            return (
              <div key={l.id} className={`audit-item ${accentClass}`}>
                <div className="audit-meta">
                  <span style={{ fontWeight: 600 }}>{l.action} &bull; {l.actor}</span>
                  <span className="mono">{dateStr}</span>
                </div>
                <div style={{ color: 'var(--text-1)', fontSize: '11px' }}>{l.details}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
