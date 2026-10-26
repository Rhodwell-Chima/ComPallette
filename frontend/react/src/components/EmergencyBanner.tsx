import React, { useEffect } from 'react';
import { AlertItem } from '../types';

interface EmergencyBannerProps {
  alerts: AlertItem[];
  audioArmed: boolean;
  onOpenAck: (alertId: number) => void;
  onOpenResolve: (alertId: number) => void;
}

export const EmergencyBanner: React.FC<EmergencyBannerProps> = ({
  alerts,
  audioArmed,
  onOpenAck,
  onOpenResolve,
}) => {
  const unacked = alerts.filter(a => a.status === 'NEW');
  const critical = unacked.find(a => a.severity === 'CRITICAL');
  const target = critical || unacked[0];

  useEffect(() => {
    if (!critical || !audioArmed) return;

    let ctx: AudioContext | null = null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch { return; }

    const iv = setInterval(() => {
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* audio context error */ }
    }, 3000);

    return () => {
      clearInterval(iv);
      if (ctx && ctx.state !== 'closed') ctx.close();
    };
  }, [critical, audioArmed]);

  if (!target) return null;

  return (
    <div className="emergency-bar">
      <div className="emergency-content">
        <div className="emergency-info">
          <span className={`severity-badge severity-${target.severity.toLowerCase()}`}>
            {target.severity}
          </span>
          <span className="emergency-text">
            <strong>{target.alert_code}</strong>
            {' — '}
            {target.node_id} at {target.zone || 'unknown zone'}
            {target.details && ` · ${target.details}`}
          </span>
        </div>
        <div className="emergency-actions">
          <button className="btn btn-ghost" onClick={() => onOpenAck(target.id)}>Acknowledge</button>
          <button className="btn btn-ghost" onClick={() => onOpenResolve(target.id)}>Resolve</button>
        </div>
      </div>
    </div>
  );
};
