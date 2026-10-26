import React, { useEffect, useRef } from 'react';
import { TelemetryItem } from '../types';

interface TelemetryChartProps {
  minerId: string;
  history: TelemetryItem[];
}

export const TelemetryChart: React.FC<TelemetryChartProps> = ({ minerId, history }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.parentElement?.clientWidth ? canvas.parentElement.clientWidth - 24 : 320;
    const h = canvas.height = 140;

    ctx.clearRect(0, 0, w, h);

    if (history.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No telemetry points recorded yet', w / 2, h / 2);
      return;
    }

    const points = [...history].reverse();
    const maxVal = Math.max(60.0, ...points.map(p => p.co_ppm));

    // Threshold lines
    const y25 = h - (25.0 / maxVal) * (h - 20) - 10;
    const y50 = h - (50.0 / maxVal) * (h - 20) - 10;

    // 25 ppm line
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y25);
    ctx.lineTo(w, y25);
    ctx.stroke();

    // 50 ppm line
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.beginPath();
    ctx.moveTo(0, y50);
    ctx.lineTo(w, y50);
    ctx.stroke();
    ctx.setLineDash([]);

    // Trend line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const stepX = (w - 20) / Math.max(1, points.length - 1);
    points.forEach((p, idx) => {
      const x = 10 + idx * stepX;
      const y = h - (p.co_ppm / maxVal) * (h - 20) - 10;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Point dots
    points.forEach((p, idx) => {
      const x = 10 + idx * stepX;
      const y = h - (p.co_ppm / maxVal) * (h - 20) - 10;
      ctx.fillStyle = p.co_ppm >= 50 ? '#ef4444' : p.co_ppm >= 25 ? '#f59e0b' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [history]);

  const latestCo = history.length > 0 ? history[0].co_ppm.toFixed(1) : '--';

  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '4px',
      padding: '12px',
      marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {minerId ? `${minerId} CO Concentration Trend` : 'CO Concentration Trend'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8' }}>
          {latestCo} ppm
        </span>
      </div>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>
        <span>OSHA TWA: 25 ppm</span>
        <span>NIOSH Evacuation: 50 ppm</span>
      </div>
    </div>
  );
};
