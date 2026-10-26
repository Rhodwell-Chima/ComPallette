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
  const activeUnack = alerts.filter(a => a.status === 'NEW');
  const critical = activeUnack.find(a => a.severity === 'CRITICAL');
  const targetAlert = critical || activeUnack[0];

  useEffect(() => {
    if (!critical || !audioArmed) return;

    let audioCtx: AudioContext | null = null;
    try {
      const AudioClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioClass();
    } catch {
      return;
    }

    const interval = setInterval(() => {
      if (!audioCtx) return;
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
      } catch {
        // Ignore audio context error
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    };
  }, [critical, audioArmed]);

  if (!targetAlert) return null;

  return (
    <div style={{
      background: 'linear-gradient(90deg, #7f1d1d, #991b1b, #7f1d1d)',
      borderBottom: '2px solid #ef4444',
      padding: '12px 24px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: '1600px',
        margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '24px', lineHeight: 1 }}>⚠️</span>
          <div>
            <div style={{
              fontWeight: 800,
              fontSize: '14px',
              letterSpacing: '1px',
              color: '#fff',
              textTransform: 'uppercase',
            }}>
              [{targetAlert.severity}] {targetAlert.alert_code} &bull; {targetAlert.node_id} @ {targetAlert.zone || 'UNKNOWN DRIFT'}
            </div>
            <div style={{ fontSize: '13px', color: '#fecaca' }}>
              {targetAlert.details} (Triggered value: {targetAlert.trigger_value.toFixed(1)})
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-warning" onClick={() => onOpenAck(targetAlert.id)}>
            ACKNOWLEDGE INCIDENT
          </button>
          <button className="btn btn-success" onClick={() => onOpenResolve(targetAlert.id)}>
            RESOLVE
          </button>
        </div>
      </div>
    </div>
  );
};
