import React, { useEffect, useRef, useState } from 'react';
import { NodeItem } from '../types';

interface DigitalMineTwinProps {
  nodes: NodeItem[];
  selectedMinerId: string;
  onSelectMiner: (nodeId: string) => void;
}

interface Waypoint {
  x: number;
  y: number;
  label: string;
  depth: string;
}

const ZONE_WAYPOINTS: Record<string, Waypoint> = {
  "SURFACE-PORTAL":       { x: 0.16, y: 0.16, label: "Surface Portal", depth: "0m" },
  "LEVEL-1-STATION":      { x: 0.50, y: 0.38, label: "Level 1 Station", depth: "-100m" },
  "LEVEL-2-NORTH-DRIFT":  { x: 0.22, y: 0.60, label: "Level 2 North Drift", depth: "-250m" },
  "LEVEL-2-HAULAGE-WAY":  { x: 0.78, y: 0.60, label: "Level 2 Haulage Way", depth: "-250m" },
  "LEVEL-3-ACTIVE-STOPE": { x: 0.72, y: 0.84, label: "Level 3 Active Stope", depth: "-450m" },
};

const ANCHOR_NODES = [
  { id: "ANCHOR-SHAFT1-SURFACE", x: 0.50, y: 0.16, zone: "SURFACE-PORTAL" },
  { id: "ANCHOR-LVL1-STATION",   x: 0.50, y: 0.38, zone: "LEVEL-1-STATION" },
  { id: "ANCHOR-LVL2-NORTH",     x: 0.22, y: 0.60, zone: "LEVEL-2-NORTH-DRIFT" },
  { id: "ANCHOR-LVL2-HAULAGE",   x: 0.78, y: 0.60, zone: "LEVEL-2-HAULAGE-WAY" },
  { id: "ANCHOR-LVL3-STOPE",     x: 0.72, y: 0.84, zone: "LEVEL-3-ACTIVE-STOPE" },
];

interface SimState {
  id: string;
  currX: number;
  currY: number;
  targetX: number;
  targetY: number;
  zone: string;
  co: number;
  batt: number;
}

export const DigitalMineTwin: React.FC<DigitalMineTwinProps> = ({
  nodes,
  selectedMinerId,
  onSelectMiner,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simStateRef = useRef<Record<string, SimState>>({});
  const [hoverText, setHoverText] = useState<string>('Click any miner to inspect historical trends');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    let phase = 0;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width = canvas.parentElement?.clientWidth ? canvas.parentElement.clientWidth - 2 : 900;
      const h = canvas.height = 460;
      phase = (phase + 0.04) % (Math.PI * 2);

      ctx.clearRect(0, 0, w, h);

      // Depth benchmark lines
      const depthY0 = h * 0.16;
      const depthY1 = h * 0.38;
      const depthY2 = h * 0.60;
      const depthY3 = h * 0.84;

      // Surface ground filling
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, depthY0);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, depthY0);
      ctx.lineTo(w, depthY0);
      ctx.stroke();

      const depths = [
        { y: depthY0, label: "0m  (SURFACE EL)" },
        { y: depthY1, label: "-100m (LEVEL 1)" },
        { y: depthY2, label: "-250m (LEVEL 2)" },
        { y: depthY3, label: "-450m (LEVEL 3)" },
      ];

      ctx.font = '10px monospace';
      ctx.fillStyle = '#475569';
      depths.forEach(d => {
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(0, d.y);
        ctx.lineTo(w, d.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(d.label, 12, d.y - 6);
      });

      // Tunnels
      const tunnels = [
        [ { x: w * 0.12, y: depthY0 }, { x: w * 0.22, y: depthY0 }, { x: w * 0.36, y: depthY1 } ],
        [ { x: w * 0.50, y: depthY0 - 25 }, { x: w * 0.50, y: depthY3 + 25 } ],
        [ { x: w * 0.32, y: depthY1 }, { x: w * 0.50, y: depthY1 } ],
        [ { x: w * 0.14, y: depthY2 }, { x: w * 0.50, y: depthY2 } ],
        [ { x: w * 0.50, y: depthY2 }, { x: w * 0.86, y: depthY2 } ],
        [ { x: w * 0.82, y: depthY2 }, { x: w * 0.72, y: depthY3 } ],
        [ { x: w * 0.38, y: depthY3 }, { x: w * 0.84, y: depthY3 } ],
      ];

      tunnels.forEach(t => {
        ctx.strokeStyle = '#131c2e';
        ctx.lineWidth = 26;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(t[0].x, t[0].y);
        for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
        ctx.stroke();

        ctx.strokeStyle = '#1e2c47';
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Haulage rail tracks
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.50, depthY2 + 5);
      ctx.lineTo(w * 0.86, depthY2 + 5);
      ctx.moveTo(w * 0.50, depthY2 + 8);
      ctx.lineTo(w * 0.86, depthY2 + 8);
      ctx.stroke();

      // Ventilation Flow Text
      ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.font = '10px sans-serif';
      ctx.fillText('>>> VENTILATION AIRFLOW >>>', w * 0.24, depthY2 + 3);
      ctx.fillText('>>> FRESH AIR INTAKE >>>', w * 0.48, depthY3 + 3);

      // Headframe tower
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.48, depthY0 - 45, w * 0.04, 45);

      // Wireless mesh links
      const meshLinks = [
        [ ANCHOR_NODES[0], ANCHOR_NODES[1] ],
        [ ANCHOR_NODES[1], ANCHOR_NODES[2] ],
        [ ANCHOR_NODES[1], ANCHOR_NODES[3] ],
        [ ANCHOR_NODES[3], ANCHOR_NODES[4] ],
        [ ANCHOR_NODES[2], ANCHOR_NODES[4] ],
      ];

      meshLinks.forEach(link => {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(link[0].x * w, link[0].y * h);
        ctx.lineTo(link[1].x * w, link[1].y * h);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Stationary Anchors
      ANCHOR_NODES.forEach(a => {
        const ax = a.x * w;
        const ay = a.y * h;

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ax, ay, 8 + Math.sin(phase) * 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#0284c7';
        ctx.fillRect(ax - 5, ay - 5, 10, 10);
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1;
        ctx.strokeRect(ax - 5, ay - 5, 10, 10);

        ctx.font = '9px monospace';
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(a.id.replace('ANCHOR-', ''), ax - 25, ay - 10);
      });

      // Miner avatars
      const wearableMiners = nodes.filter(n => n.role === 'WEARABLE');
      const byZone: Record<string, NodeItem[]> = {};
      wearableMiners.forEach(m => {
        const z = m.current_zone || 'SURFACE-PORTAL';
        if (!byZone[z]) byZone[z] = [];
        byZone[z].push(m);
      });

      for (const [zone, list] of Object.entries(byZone)) {
        const wp = ZONE_WAYPOINTS[zone] || ZONE_WAYPOINTS['SURFACE-PORTAL'];
        const baseX = wp.x * w;
        const baseY = wp.y * h;

        list.forEach((m, idx) => {
          const offsetX = (idx - (list.length - 1) / 2) * 36;
          const targetX = baseX + offsetX;
          const targetY = baseY;

          if (!simStateRef.current[m.node_id]) {
            simStateRef.current[m.node_id] = {
              id: m.node_id,
              currX: targetX,
              currY: targetY,
              targetX: targetX,
              targetY: targetY,
              zone,
              co: m.latest_co,
              batt: m.battery_v,
            };
          } else {
            simStateRef.current[m.node_id].targetX = targetX;
            simStateRef.current[m.node_id].targetY = targetY;
            simStateRef.current[m.node_id].zone = zone;
            simStateRef.current[m.node_id].co = m.latest_co;
            simStateRef.current[m.node_id].batt = m.battery_v;
          }

          const s = simStateRef.current[m.node_id];
          s.currX += (s.targetX - s.currX) * 0.08;
          s.currY += (s.targetY - s.currY) * 0.08;

          const isCrit = s.co >= 50.0;
          const isWarn = s.co >= 25.0 && s.co < 50.0;
          const isSelected = (m.node_id === selectedMinerId);

          if (isCrit) {
            const pulseR = 14 + (Math.sin(phase * 2) + 1) * 8;
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.currX, s.currY, pulseR, 0, Math.PI * 2);
            ctx.stroke();
          }

          if (isSelected) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.currX, s.currY, 13, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.fillStyle = isCrit ? '#ef4444' : isWarn ? '#f59e0b' : '#10b981';
          ctx.beginPath();
          ctx.arc(s.currX, s.currY, 8, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(m.node_id, s.currX, s.currY - 14);

          ctx.font = '9px monospace';
          ctx.fillStyle = isCrit ? '#fca5a5' : isWarn ? '#fde047' : '#86efac';
          ctx.fillText(`${s.co.toFixed(1)} ppm`, s.currX, s.currY + 18);
        });
      }

      ctx.textAlign = 'left';
      animId = requestAnimationFrame(render);
    };

    render();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let hovered: SimState | null = null;
      for (const s of Object.values(simStateRef.current)) {
        if (Math.hypot(mouseX - s.currX, mouseY - s.currY) < 18) {
          hovered = s;
          break;
        }
      }

      if (hovered) {
        canvas.style.cursor = 'pointer';
        setHoverText(`${hovered.id} | Zone: ${hovered.zone} | CO: ${hovered.co.toFixed(1)} ppm | Batt: ${hovered.batt.toFixed(2)}V`);
      } else {
        canvas.style.cursor = 'default';
        setHoverText('Click any miner to inspect historical trends');
      }
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      for (const s of Object.values(simStateRef.current)) {
        if (Math.hypot(mouseX - s.currX, mouseY - s.currY) < 18) {
          onSelectMiner(s.id);
          break;
        }
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [nodes, selectedMinerId, onSelectMiner]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span><strong style={{ color: '#38bdf8' }}>SUBTERRANEAN DIGITAL MODEL</strong> &bull; Cross-Sectional Drift Schematic</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>SCALE: 1:500 &bull; WIRELESS MESH MINE TOPOLOGY</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '460px',
          background: '#070b14',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          display: 'block',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-dim)', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span> Normal Miner
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></span> Gas Warning (&gt;25 ppm)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span> Critical Alarm / Man Down
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#38bdf8' }}></span> Fixed Mesh Anchor
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{hoverText}</span>
      </div>
    </div>
  );
};
