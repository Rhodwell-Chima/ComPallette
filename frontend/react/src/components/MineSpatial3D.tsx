import React, { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { NodeItem } from '../types';

interface MineSpatial3DProps {
  nodes: NodeItem[];
  selectedMinerId: string;
  onSelectMiner: (nodeId: string) => void;
  onOpenDrawer?: (nodeId: string) => void;
  theme?: 'dark' | 'light';
}

// 3D coordinates for zones in the mine model
interface Zone3D {
  name: string;
  center: [number, number, number];
  bounds: [number, number, number];
  depthLabel: string;
}

const ZONES_3D: Record<string, Zone3D> = {
  'SURFACE-PORTAL': {
    name: 'Surface Portal',
    center: [0, 2, 0],
    bounds: [20, 4, 15],
    depthLabel: '0m Surface',
  },
  'LEVEL-1-STATION': {
    name: 'Level 1 Station',
    center: [0, -10, 0],
    bounds: [25, 4, 12],
    depthLabel: '-100m Level 1',
  },
  'LEVEL-2-NORTH-DRIFT': {
    name: 'Level 2 North Drift',
    center: [-24, -22, -8],
    bounds: [20, 4, 8],
    depthLabel: '-250m L2 North',
  },
  'LEVEL-2-HAULAGE-WAY': {
    name: 'Level 2 Haulage Way',
    center: [24, -22, 8],
    bounds: [26, 4, 8],
    depthLabel: '-250m L2 Haulage',
  },
  'LEVEL-3-ACTIVE-STOPE': {
    name: 'Level 3 Active Stope',
    center: [20, -38, -6],
    bounds: [30, 6, 18],
    depthLabel: '-450m L3 Deep Stope',
  },
};

const ANCHORS_3D = [
  { id: 'ANCHOR-SHAFT1-SURFACE', pos: [0, 1.5, 0] as [number, number, number], zone: 'SURFACE-PORTAL' },
  { id: 'ANCHOR-LVL1-STATION', pos: [0, -10, 0] as [number, number, number], zone: 'LEVEL-1-STATION' },
  { id: 'ANCHOR-LVL2-NORTH', pos: [-24, -22, -8] as [number, number, number], zone: 'LEVEL-2-NORTH-DRIFT' },
  { id: 'ANCHOR-LVL2-HAULAGE', pos: [24, -22, 8] as [number, number, number], zone: 'LEVEL-2-HAULAGE-WAY' },
  { id: 'ANCHOR-LVL3-STOPE', pos: [20, -38, -6] as [number, number, number], zone: 'LEVEL-3-ACTIVE-STOPE' },
];

const MESH_CONNECTIONS: [number, number][] = [
  [0, 1], // Surface to Level 1
  [1, 2], // Level 1 to L2 North
  [1, 3], // Level 1 to L2 Haulage
  [3, 4], // L2 Haulage to Level 3 Stope
  [2, 4], // L2 North cross-link to Level 3
];

// Vertical Hoist Skip Cage
const HoistSkip: React.FC = () => {
  const meshRef = useRef<THREE.Group>(null);
  const posY = useRef<number>(0);
  const dir = useRef<number>(-1);

  useFrame((_, delta) => {
    posY.current += dir.current * delta * 5.0;
    if (posY.current < -38) dir.current = 1;
    if (posY.current > 1) dir.current = -1;

    if (meshRef.current) {
      meshRef.current.position.y = posY.current;
    }
  });

  return (
    <group ref={meshRef} position={[0, 0, 0]}>
      {/* Skip Cage Body */}
      <mesh>
        <boxGeometry args={[2.2, 3.4, 2.2]} />
        <meshStandardMaterial color="#0284c7" metalness={0.6} roughness={0.3} wireframe={false} />
      </mesh>
      {/* Cage Frame Outline */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(2.25, 3.45, 2.25)]} />
        <lineBasicMaterial color="#38bdf8" />
      </lineSegments>
      {/* Light inside hoist */}
      <pointLight color="#38bdf8" intensity={1.5} distance={8} />
    </group>
  );
};

// Tunnel Infrastructure & Shaft
const MineGeometry: React.FC = () => {
  return (
    <group>
      {/* Surface Terrain Plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 80]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <gridHelper args={[120, 24, '#38bdf8', '#334155']} position={[0, 0.05, 0]} />

      {/* Surface Headframe Tower */}
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[1.8, 3.2, 12, 4]} />
        <meshStandardMaterial color="#475569" wireframe />
      </mesh>

      {/* Vertical Hoist Shaft Structure */}
      <mesh position={[0, -20, 0]}>
        <cylinderGeometry args={[2.5, 2.5, 42, 8]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.25} wireframe side={THREE.DoubleSide} />
      </mesh>

      {/* Shaft Guide Cables */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -1, 10, 0,  -1, -40, 0,
                 1, 10, 0,   1, -40, 0,
                 0, 10, -1,  0, -40, -1,
                 0, 10, 1,   0, -40, 1,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#64748b" transparent opacity={0.5} />
      </lineSegments>

      {/* Hoist Skip */}
      <HoistSkip />

      {/* Strata Benchmark Slices */}
      {[
        { y: -10, label: 'Level 1 (-100m)', color: '#38bdf8' },
        { y: -22, label: 'Level 2 (-250m)', color: '#38bdf8' },
        { y: -38, label: 'Level 3 (-450m)', color: '#00e5ff' },
      ].map(lvl => (
        <group key={lvl.y} position={[0, lvl.y, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[100, 60]} />
            <meshBasicMaterial color={lvl.color} transparent opacity={0.03} side={THREE.DoubleSide} />
          </mesh>
          <gridHelper args={[100, 20, lvl.color, '#1e293b']} />
        </group>
      ))}

      {/* Level 1 Crosscut Tunnel */}
      <mesh position={[0, -10, 0]}>
        <boxGeometry args={[28, 3.5, 4]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.5} wireframe />
      </mesh>

      {/* Level 2 North Drift Tunnel */}
      <mesh position={[-16, -22, -4]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[24, 3.6, 4.5]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.5} wireframe />
      </mesh>

      {/* Level 2 Haulage Way Tunnel */}
      <mesh position={[18, -22, 4]} rotation={[0, -0.25, 0]}>
        <boxGeometry args={[26, 3.8, 5]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.5} wireframe />
      </mesh>

      {/* Internal Spiral Decline linking Level 2 Haulage to Level 3 */}
      <mesh position={[24, -30, 0]} rotation={[0.4, 0, -0.3]}>
        <cylinderGeometry args={[2.5, 2.5, 20, 8]} />
        <meshStandardMaterial color="#334155" transparent opacity={0.35} wireframe />
      </mesh>

      {/* Level 3 Active Stope Extraction Chamber */}
      <mesh position={[20, -38, -6]}>
        <boxGeometry args={[32, 6, 20]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.4} wireframe />
      </mesh>

      {/* Ambient Station Lights */}
      <pointLight position={[0, -10, 0]} color="#38bdf8" intensity={0.8} distance={20} />
      <pointLight position={[-20, -22, -6]} color="#38bdf8" intensity={0.8} distance={20} />
      <pointLight position={[20, -22, 6]} color="#38bdf8" intensity={0.8} distance={20} />
      <pointLight position={[20, -38, -6]} color="#eab308" intensity={1.2} distance={30} />
    </group>
  );
};

// Stationary Mesh Anchors
const MeshAnchors: React.FC = () => {
  return (
    <group>
      {ANCHORS_3D.map(a => (
        <group key={a.id} position={a.pos}>
          {/* Beacon Core */}
          <mesh>
            <boxGeometry args={[1.2, 1.2, 1.2]} />
            <meshStandardMaterial color="#0284c7" emissive="#0284c7" emissiveIntensity={0.6} />
          </mesh>
          {/* Wireframe Border */}
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(1.3, 1.3, 1.3)]} />
            <lineBasicMaterial color="#e0f2fe" />
          </lineSegments>
          {/* Anchor Label Tag */}
          <Html position={[0, 1.5, 0]} center distanceFactor={45} style={{ pointerEvents: 'none' }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid #38bdf8',
              borderRadius: '3px',
              padding: '2px 5px',
              color: '#93c5fd',
              fontSize: '10px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}>
              {a.id.replace('ANCHOR-', '')}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
};

// Animated RF Links between Anchors
const MeshRFLinks: React.FC<{ visible: boolean }> = ({ visible }) => {
  const photonRef = useRef<THREE.Group>(null);
  const phase = useRef<number>(0);

  useFrame((_, delta) => {
    phase.current = (phase.current + delta * 0.8) % 1;
    if (photonRef.current) {
      photonRef.current.children.forEach((child, idx) => {
        const link = MESH_CONNECTIONS[idx % MESH_CONNECTIONS.length];
        const p1 = new THREE.Vector3(...ANCHORS_3D[link[0]].pos);
        const p2 = new THREE.Vector3(...ANCHORS_3D[link[1]].pos);
        child.position.lerpVectors(p1, p2, phase.current);
      });
    }
  });

  const lines = useMemo(() => {
    const points: THREE.Vector3[] = [];
    MESH_CONNECTIONS.forEach(([i, j]) => {
      points.push(new THREE.Vector3(...ANCHORS_3D[i].pos));
      points.push(new THREE.Vector3(...ANCHORS_3D[j].pos));
    });
    return points;
  }, []);

  if (!visible) return null;

  return (
    <group>
      {/* Connection Beams */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(lines.flatMap(p => [p.x, p.y, p.z])),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.35} />
      </lineSegments>

      {/* Animated Traveling RF Photons */}
      <group ref={photonRef}>
        {MESH_CONNECTIONS.map(([i, j]) => (
          <mesh key={`${i}-${j}`}>
            <sphereGeometry args={[0.3, 8, 8]} />
            <meshBasicMaterial color="#00e5ff" />
          </mesh>
        ))}
      </group>
    </group>
  );
};

// Individual Wearable Miner in 3D Space
const MinerNode3D: React.FC<{
  node: NodeItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onOpenDrawer?: (id: string) => void;
}> = ({ node, isSelected, onSelect, onOpenDrawer }) => {
  const groupRef = useRef<THREE.Group>(null);
  const currentPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const [hovered, setHovered] = useState(false);
  const pulseRef = useRef<THREE.Mesh>(null);

  // Derive target 3D coordinates based on current zone & miner hash
  const targetPos = useMemo(() => {
    const zoneInfo = ZONES_3D[node.current_zone || 'SURFACE-PORTAL'] || ZONES_3D['SURFACE-PORTAL'];
    const hash = node.node_id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const offsetX = ((hash % 11) - 5) * 1.5;
    const offsetZ = (((hash * 3) % 9) - 4) * 0.9;
    return new THREE.Vector3(
      zoneInfo.center[0] + offsetX,
      zoneInfo.center[1] + 1.2,
      zoneInfo.center[2] + offsetZ
    );
  }, [node.current_zone, node.node_id]);

  useFrame((_, delta) => {
    // Smooth kinematic interpolation in 3D
    currentPos.current.lerp(targetPos, Math.min(1, delta * 3.5));
    if (groupRef.current) {
      groupRef.current.position.copy(currentPos.current);
    }

    // Pulse emergency halo for critical nodes
    if (pulseRef.current && node.latest_co >= 50.0) {
      const scale = 1.0 + Math.sin(Date.now() * 0.008) * 0.4;
      pulseRef.current.scale.set(scale, scale, scale);
    }
  });

  const co = node.latest_co || 0;
  const isCrit = co >= 50.0;
  const isWarn = co >= 25.0 && co < 50.0;
  const color = isCrit ? '#ef4444' : isWarn ? '#eab308' : '#22c55e';

  return (
    <group ref={groupRef}>
      {/* Miner Interactive Body */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.node_id);
          if (onOpenDrawer) onOpenDrawer(node.node_id);
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[hovered || isSelected ? 1.1 : 0.85, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 0.8 : 0.4}
          roughness={0.2}
        />
      </mesh>

      {/* Cap Lamp Headlight Beam */}
      <spotLight
        position={[0, 0, 0.4]}
        target-position={[0, -0.5, 4]}
        color="#ffffff"
        intensity={1.2}
        angle={0.6}
        penumbra={0.5}
        distance={12}
      />

      {/* Critical Evacuation Alert Wave */}
      {isCrit && (
        <mesh ref={pulseRef}>
          <sphereGeometry args={[1.8, 16, 16]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.35} wireframe />
        </mesh>
      )}

      {/* Selected Indicator Reticle */}
      {isSelected && (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.5, 1.7, 24]} />
            <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
          </mesh>
          <pointLight color="#38bdf8" intensity={1.5} distance={6} />
        </group>
      )}

      {/* Billboard Floating Miner Badge & Readout */}
      <Html position={[0, 2.0, 0]} center distanceFactor={40} style={{ pointerEvents: 'none' }}>
        <div style={{
          background: isCrit ? 'rgba(239, 68, 68, 0.9)' : 'rgba(15, 23, 42, 0.85)',
          border: `1px solid ${isSelected ? '#38bdf8' : color}`,
          borderRadius: '4px',
          padding: '3px 7px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
          textAlign: 'center',
          minWidth: '70px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: '#ffffff',
            lineHeight: 1.2,
          }}>
            {node.node_id}
          </div>
          <div style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            color: isCrit ? '#fecaca' : isWarn ? '#fef08a' : '#bbf7d0',
            fontWeight: 600,
          }}>
            {co.toFixed(1)} ppm
          </div>
        </div>
      </Html>
    </group>
  );
};

export const MineSpatial3D: React.FC<MineSpatial3DProps> = ({
  nodes,
  selectedMinerId,
  onSelectMiner,
  onOpenDrawer,
  theme = 'dark',
}) => {
  const [showMeshLinks, setShowMeshLinks] = useState(true);
  const controlsRef = useRef<any>(null);

  const wearableMiners = useMemo(() => nodes.filter(n => n.role === 'WEARABLE'), [nodes]);

  const bgColor = theme === 'dark' ? '#08080c' : '#e4e4e7';
  const fogColor = theme === 'dark' ? '#08080c' : '#d4d4d8';

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  const handlePresetView = (view: 'iso' | 'side' | 'top') => {
    if (!controlsRef.current) return;
    if (view === 'iso') {
      controlsRef.current.object.position.set(38, 25, 45);
      controlsRef.current.target.set(0, -18, 0);
    } else if (view === 'side') {
      controlsRef.current.object.position.set(0, -18, 60);
      controlsRef.current.target.set(0, -18, 0);
    } else if (view === 'top') {
      controlsRef.current.object.position.set(0, 60, 0);
      controlsRef.current.target.set(0, -18, 0);
    }
    controlsRef.current.update();
  };

  return (
    <div className="twin-wrap">
      {/* 3D Viewport Toolbar */}
      <div className="twin-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-1)' }}>
            <span className="status-dot" style={{ background: 'var(--brand-light)' }} />
            3D Mine Spatial Model
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>Full Subterranean Stope Volumetric Twin</span>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => handlePresetView('iso')} title="Perspective View">
            ISO
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => handlePresetView('side')} title="Side Cross-Section">
            Section
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => handlePresetView('top')} title="Top Plan View">
            Plan
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleResetCamera} title="Reset camera angle">
            Reset
          </button>
          <button
            className={`btn btn-sm ${showMeshLinks ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setShowMeshLinks(prev => !prev)}
          >
            {showMeshLinks ? 'Mesh links on' : 'Mesh links off'}
          </button>
        </div>
      </div>

      {/* Three.js Canvas Container */}
      <div style={{ position: 'relative', height: '480px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <Canvas
          camera={{ position: [38, 25, 45], fov: 48, near: 0.5, far: 250 }}
          style={{ width: '100%', height: '100%', background: bgColor }}
        >
          <color attach="background" args={[bgColor]} />
          <fog attach="fog" args={[fogColor, 40, 140]} />

          <ambientLight intensity={0.6} />
          <directionalLight position={[20, 40, 20]} intensity={1.2} />

          {/* Orbit Controls with Damping */}
          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.06}
            maxDistance={120}
            minDistance={8}
            target={[0, -18, 0]}
          />

          {/* Mine Subterranean Infrastructure */}
          <MineGeometry />

          {/* Fixed Mesh Anchors */}
          <MeshAnchors />

          {/* Wireless RF Mesh Links */}
          <MeshRFLinks visible={showMeshLinks} />

          {/* Wearable Miners */}
          {wearableMiners.map(node => (
            <MinerNode3D
              key={node.node_id}
              node={node}
              isSelected={node.node_id === selectedMinerId}
              onSelect={onSelectMiner}
              onOpenDrawer={onOpenDrawer}
            />
          ))}
        </Canvas>
      </div>

      {/* Legend & Navigation Hint */}
      <div className="twin-bar" style={{ marginTop: '4px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="twin-legend">
          <span><span className="legend-dot" style={{ background: 'var(--safe)' }} /> Safe (&lt;25 ppm)</span>
          <span><span className="legend-dot" style={{ background: 'var(--warn)' }} /> Warning (25-50 ppm)</span>
          <span><span className="legend-dot" style={{ background: 'var(--crit)' }} /> Evacuation (&gt;50 ppm)</span>
          <span><span className="legend-sq" style={{ background: '#0284c7', borderColor: '#38bdf8' }} /> Mesh Anchor</span>
          <span><span style={{ display: 'inline-block', width: '12px', height: '2px', background: '#38bdf8', marginRight: '4px', verticalAlign: 'middle' }} /> RF Link</span>
        </div>

        <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>
          Left click + drag to rotate &bull; Right click to pan &bull; Scroll to zoom &bull; Click miner for details
        </span>
      </div>
    </div>
  );
};
