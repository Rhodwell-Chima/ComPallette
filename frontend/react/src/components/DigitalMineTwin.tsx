import React, { useEffect, useRef, useState } from 'react';
import { NodeItem } from '../types';

interface DigitalMineTwinProps {
  nodes: NodeItem[];
  selectedMinerId: string;
  onSelectMiner: (nodeId: string) => void;
  onOpenDrawer?: (nodeId: string) => void;
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
  temp: number;
  fall: boolean;
}

export const DigitalMineTwin: React.FC<DigitalMineTwinProps> = ({
  nodes,
  selectedMinerId,
  onSelectMiner,
  onOpenDrawer,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simStateRef = useRef<Record<string, SimState>>({});
  const [hoveredMiner, setHoveredMiner] = useState<{ id: string; x: number; y: number; co: number; zone: string; batt: number } | null>(null);
  const [showMeshLinks, setShowMeshLinks] = useState(true);

  // Skip hoist animation state
  const hoistYRef = useRef<number>(0.16);
  const hoistDirRef = useRef<number>(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    let phase = 0;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const parentWidth = canvas.parentElement?.clientWidth ?? 900;
      const w = canvas.width = parentWidth - 2;
      const h = canvas.height = 480;
      phase = (phase + 0.04) % (Math.PI * 2);

      // Animate shaft hoist skip
      hoistYRef.current += 0.0012 * hoistDirRef.current;
      if (hoistYRef.current > 0.82) hoistDirRef.current = -1;
      if (hoistYRef.current < 0.16) hoistDirRef.current = 1;

      // Dark tactical subterranean background
      ctx.fillStyle = '#070b12';
      ctx.fillRect(0, 0, w, h);

      // Geological Strata Grid
      const depthY0 = h * 0.16;
      const depthY1 = h * 0.38;
      const depthY2 = h * 0.60;
      const depthY3 = h * 0.84;

      // Surface Topography
      const gradSurface = ctx.createLinearGradient(0, 0, 0, depthY0);
      gradSurface.addColorStop(0, '#111827');
      gradSurface.addColorStop(1, '#1e293b');
      ctx.fillStyle = gradSurface;
      ctx.fillRect(0, 0, w, depthY0);

      // Surface Ground Line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, depthY0);
      ctx.lineTo(w, depthY0);
      ctx.stroke();

      // Geological Strata Bands
      const strata = [
        { y0: depthY0, y1: depthY1, fill: 'rgba(15, 23, 42, 0.45)', label: 'DOLOMITE / SANDSTONE STRATUM' },
        { y0: depthY1, y1: depthY2, fill: 'rgba(30, 41, 59, 0.35)', label: 'ORE SHALE / QUARTZITE BED' },
        { y0: depthY2, y1: depthY3, fill: 'rgba(15, 23, 42, 0.65)', label: 'COPPER-COBALT ORE ZONE (HIGH GRADE)' },
        { y0: depthY3, y1: h,       fill: 'rgba(8, 12, 20, 0.90)',  label: 'BASEMENT COMPLEX / DEEP FOOTWALL' },
      ];

      strata.forEach(s => {
        ctx.fillStyle = s.fill;
        ctx.fillRect(0, s.y0, w, s.y1 - s.y0);

        ctx.font = '8px monospace';
        ctx.fillStyle = 'rgba(71, 85, 105, 0.4)';
        ctx.fillText(s.label, w - 240, s.y0 + 16);
      });

      // Depth Level Benchmarks
      const depths = [
        { y: depthY0, label: "0m  SURFACE PORTAL" },
        { y: depthY1, label: "-100m LEVEL 1 SUB-STATION" },
        { y: depthY2, label: "-250m LEVEL 2 HAULAGE" },
        { y: depthY3, label: "-450m LEVEL 3 DEEP STOPE" },
      ];

      depths.forEach(d => {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, d.y);
        ctx.lineTo(w, d.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#64748b';
        ctx.fillText(d.label, 14, d.y - 7);
      });

      // Main Vertical Hoisting Shaft
      const shaftX = w * 0.50;
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.moveTo(shaftX, depthY0 - 45);
      ctx.lineTo(shaftX, depthY3 + 30);
      ctx.stroke();

      ctx.strokeStyle = '#00e5ff33';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shaftX - 14, depthY0 - 45);
      ctx.lineTo(shaftX - 14, depthY3 + 30);
      ctx.moveTo(shaftX + 14, depthY0 - 45);
      ctx.lineTo(shaftX + 14, depthY3 + 30);
      ctx.stroke();

      // Hoist Cable Lines
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shaftX - 5, depthY0 - 40);
      ctx.lineTo(shaftX - 5, depthY3 + 20);
      ctx.moveTo(shaftX + 5, depthY0 - 40);
      ctx.lineTo(shaftX + 5, depthY3 + 20);
      ctx.stroke();

      // Animated Skip Hoist Cage
      const hoistY = h * hoistYRef.current;
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(shaftX - 9, hoistY - 14, 18, 28);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(shaftX - 9, hoistY - 14, 18, 28);
      // Cage cross bracings
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shaftX - 9, hoistY - 14);
      ctx.lineTo(shaftX + 9, hoistY + 14);
      ctx.moveTo(shaftX + 9, hoistY - 14);
      ctx.lineTo(shaftX - 9, hoistY + 14);
      ctx.stroke();

      // Surface Headframe Tower
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.strokeRect(shaftX - 22, depthY0 - 55, 44, 55);
      // Pulley Sheave Wheel
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(shaftX, depthY0 - 55, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Subterranean Drift Tunnels
      const drifts = [
        // Decline portal to Level 1
        [ { x: w * 0.12, y: depthY0 }, { x: w * 0.22, y: depthY0 }, { x: w * 0.38, y: depthY1 } ],
        // Level 1 crosscut
        [ { x: w * 0.36, y: depthY1 }, { x: shaftX, y: depthY1 } ],
        // Level 2 North Haulage Drift
        [ { x: w * 0.14, y: depthY2 }, { x: shaftX, y: depthY2 } ],
        // Level 2 South Haulage Drift
        [ { x: shaftX, y: depthY2 }, { x: w * 0.86, y: depthY2 } ],
        // Internal spiral decline from Level 2 to Level 3 Stope
        [ { x: w * 0.82, y: depthY2 }, { x: w * 0.74, y: depthY3 } ],
        // Level 3 Extraction Footwall & Stope
        [ { x: w * 0.40, y: depthY3 }, { x: w * 0.86, y: depthY3 } ],
      ];

      drifts.forEach(t => {
        // Outer Rock Wall
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 28;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(t[0].x, t[0].y);
        for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
        ctx.stroke();

        // Inner Tunnel Cavity
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 20;
        ctx.stroke();

        // Safety Rail Bed / Floor
        ctx.strokeStyle = '#00e5ff18';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Haulage Tracks along Level 2
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.50, depthY2 + 5);
      ctx.lineTo(w * 0.86, depthY2 + 5);
      ctx.moveTo(w * 0.50, depthY2 + 8);
      ctx.lineTo(w * 0.86, depthY2 + 8);
      ctx.stroke();

      // Dynamic Ventilation Stream Flow
      const flowOffset = (phase * 15) % 40;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.font = '9px monospace';
      ctx.fillText(`>>> INTAKE AIRFLOW >>> [ ${(phase * 2).toFixed(0)} m/s ]`, w * 0.22 + flowOffset, depthY2 + 3);
      ctx.fillText(`>>> FRESH AIR VENTILATION >>>`, w * 0.52 + flowOffset, depthY3 + 3);

      // Wireless Mesh Topology Links
      if (showMeshLinks) {
        const meshLinks = [
          [ ANCHOR_NODES[0], ANCHOR_NODES[1] ],
          [ ANCHOR_NODES[1], ANCHOR_NODES[2] ],
          [ ANCHOR_NODES[1], ANCHOR_NODES[3] ],
          [ ANCHOR_NODES[3], ANCHOR_NODES[4] ],
          [ ANCHOR_NODES[2], ANCHOR_NODES[4] ],
        ];

        meshLinks.forEach(link => {
          const x1 = link[0].x * w;
          const y1 = link[0].y * h;
          const x2 = link[1].x * w;
          const y2 = link[1].y * h;

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);

          // Animated RF Data Packets (Photons)
          const pT = (phase * 0.4) % 1;
          const px = x1 + (x2 - x1) * pT;
          const py = y1 + (y2 - y1) * pT;
          ctx.fillStyle = '#00e5ff';
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Stationary Anchor Gateways
      ANCHOR_NODES.forEach(a => {
        const ax = a.x * w;
        const ay = a.y * h;

        // Pulse radar circle
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ax, ay, 9 + Math.sin(phase) * 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#0369a1';
        ctx.fillRect(ax - 6, ay - 6, 12, 12);
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ax - 6, ay - 6, 12, 12);

        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(a.id.replace('ANCHOR-', ''), ax - 28, ay - 11);
      });

      // Miner Wearable Nodes
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
          const offsetX = (idx - (list.length - 1) / 2) * 44;
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
              temp: m.latest_temp,
              fall: false,
            };
          } else {
            const s = simStateRef.current[m.node_id];
            s.targetX = targetX;
            s.targetY = targetY;
            s.zone = zone;
            s.co = m.latest_co;
            s.batt = m.battery_v;
            s.temp = m.latest_temp;
          }

          const s = simStateRef.current[m.node_id];
          // Smooth kinematic lerp interpolation
          s.currX += (s.targetX - s.currX) * 0.10;
          s.currY += (s.targetY - s.currY) * 0.10;

          const isCrit = s.co >= 50.0;
          const isWarn = s.co >= 25.0 && s.co < 50.0;
          const isSelected = (m.node_id === selectedMinerId);

          // Danger Emergency Halo
          if (isCrit) {
            const waveRadius = 14 + (Math.sin(phase * 3) + 1) * 10;
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(s.currX, s.currY, waveRadius, 0, Math.PI * 2);
            ctx.stroke();

            // Pulsing exclamation alert badge above miner
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = '#ff3344';
            ctx.textAlign = 'center';
            ctx.fillText('⚠️ EVACUATE', s.currX, s.currY - 26);
          }

          // Tactical Reticle Target for Selected Miner
          if (isSelected) {
            ctx.save();
            ctx.translate(s.currX, s.currY);
            ctx.rotate(phase * 0.6);

            // Rotating HUD bracket
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 0.5);
            ctx.arc(0, 0, 18, Math.PI, Math.PI * 1.5);
            ctx.stroke();

            ctx.restore();

            // Dotted vector connecting selected miner to nearest anchor
            const nearestAnchor = ANCHOR_NODES.find(a => a.zone === s.zone) || ANCHOR_NODES[0];
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(s.currX, s.currY);
            ctx.lineTo(nearestAnchor.x * w, nearestAnchor.y * h);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Miner Node Body
          const nodeColor = isCrit ? '#ff3344' : isWarn ? '#f59e0b' : '#10b981';
          ctx.fillStyle = nodeColor;
          ctx.beginPath();
          ctx.arc(s.currX, s.currY, 9, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Miner ID Tag
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(m.node_id, s.currX, s.currY - 14);

          // Real-time CO Readout Tag
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillStyle = isCrit ? '#fca5a5' : isWarn ? '#fde047' : '#86efac';
          ctx.fillText(`${s.co.toFixed(1)} ppm`, s.currX, s.currY + 20);
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
        if (Math.hypot(mouseX - s.currX, mouseY - s.currY) < 22) {
          hovered = s;
          break;
        }
      }

      if (hovered) {
        canvas.style.cursor = 'pointer';
        setHoveredMiner({
          id: hovered.id,
          x: hovered.currX,
          y: hovered.currY,
          co: hovered.co,
          zone: hovered.zone,
          batt: hovered.batt,
        });
      } else {
        canvas.style.cursor = 'default';
        setHoveredMiner(null);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      for (const s of Object.values(simStateRef.current)) {
        if (Math.hypot(mouseX - s.currX, mouseY - s.currY) < 22) {
          onSelectMiner(s.id);
          if (onOpenDrawer) {
            onOpenDrawer(s.id);
          }
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
  }, [nodes, selectedMinerId, onSelectMiner, onOpenDrawer, showMeshLinks]);

  return (
    <div className="digital-twin-wrapper">
      {/* Tactical Sub-Header Toolbar */}
      <div className="twin-toolbar">
        <div className="twin-toolbar-left">
          <span className="twin-status-chip">
            <span className="pulse-dot-cyan" />
            <span>2.5D KINEMATIC DIGITAL TWIN &bull; LIVE DRIFT ELEVATION</span>
          </span>
          <span className="twin-scale-tag">ZAMBIA DEEP COPPER MINE &bull; 1:500 MESH TOPOLOGY</span>
        </div>

        <div className="twin-toolbar-right">
          <button
            className={`twin-filter-btn ${showMeshLinks ? 'active' : ''}`}
            onClick={() => setShowMeshLinks(prev => !prev)}
            title="Toggle wireless mesh RF hops"
          >
            <span>📡</span> {showMeshLinks ? 'MESH RF: VISIBLE' : 'MESH RF: HIDDEN'}
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="canvas-container" style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          className="twin-canvas"
        />

        {/* Tactical HUD Hover Tooltip Card */}
        {hoveredMiner && (
          <div
            className="hud-tooltip-card"
            style={{
              left: `${Math.min(hoveredMiner.x + 15, (canvasRef.current?.width ?? 900) - 220)}px`,
              top: `${Math.max(hoveredMiner.y - 65, 20)}px`,
            }}
          >
            <div className="hud-tooltip-header">
              <span className="hud-badge-id">{hoveredMiner.id}</span>
              <span className="hud-click-hint">CLICK TO INSPECT DOSSIER</span>
            </div>
            <div className="hud-tooltip-row">
              <span className="hud-label">ZONE:</span>
              <span className="hud-value">{hoveredMiner.zone}</span>
            </div>
            <div className="hud-tooltip-row">
              <span className="hud-label">CO GAS:</span>
              <span className={`hud-value ${hoveredMiner.co >= 50 ? 'text-crit' : hoveredMiner.co >= 25 ? 'text-warn' : 'text-safe'}`}>
                {hoveredMiner.co.toFixed(1)} ppm
              </span>
            </div>
            <div className="hud-tooltip-row">
              <span className="hud-label">BATTERY:</span>
              <span className="hud-value font-mono">{hoveredMiner.batt.toFixed(2)} V</span>
            </div>
          </div>
        )}
      </div>

      {/* Industrial Legend & Prompt Bar */}
      <div className="twin-legend-bar">
        <div className="legend-items">
          <span className="legend-pill">
            <span className="legend-dot" style={{ background: '#10b981' }} /> Nominal Wearable Miner
          </span>
          <span className="legend-pill">
            <span className="legend-dot" style={{ background: '#f59e0b' }} /> Gas Warning (&gt;25 ppm)
          </span>
          <span className="legend-pill">
            <span className="legend-dot" style={{ background: '#ff3344' }} /> Evacuation Alarm (&gt;50 ppm)
          </span>
          <span className="legend-pill">
            <span className="legend-square" style={{ background: '#0284c7', borderColor: '#38bdf8' }} /> Fixed Mesh Anchor
          </span>
          <span className="legend-pill">
            <span className="legend-line" /> Wireless RF Hop
          </span>
        </div>

        <div className="twin-action-hint">
          <span>💡 Select any miner node to open their full medical, spatial &amp; sensor dossier</span>
        </div>
      </div>
    </div>
  );
};
