import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Eye, Layers3, Map, MonitorCog, Radio, Sun, Moon, Users, Wifi } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { platformApi } from '../services/api';
import { TwinData, TwinEntity } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, PageHeader, StatusPill, formatTimestamp } from '../platform/ui';

type Point = [number, number];
type Polygon = { id: string; label: string; zoneCode?: string; points: Point[] };

function toPoint(value: unknown): Point | undefined {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') return [value[0], value[1]];
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (typeof item.x === 'number' && typeof item.y === 'number') return [item.x, item.y];
  }
  return undefined;
}

function polygons(data: TwinData): Polygon[] {
  const geometry = data.layout?.geometry;
  const features = Array.isArray(geometry?.features) ? geometry.features : [];
  return features.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const feature = raw as Record<string, unknown>;
    const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {};
    const candidate = feature.geometry && typeof feature.geometry === 'object' ? feature.geometry as Record<string, unknown> : feature;
    const coordinates = candidate.coordinates ?? feature.points;
    const ring = Array.isArray(coordinates) && Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
    if (!Array.isArray(ring)) return [];
    const points = ring.map(toPoint).filter((point): point is Point => Boolean(point));
    if (points.length < 3) return [];
    return [{ id: String(feature.id ?? properties.id ?? `feature-${index}`), label: String(properties.label ?? feature.label ?? properties.name ?? `Layout feature ${index + 1}`), zoneCode: typeof properties.zone_code === 'string' ? properties.zone_code : typeof feature.zone_code === 'string' ? feature.zone_code : undefined, points }];
  });
}

function bounds(features: Polygon[]) {
  const points = features.flatMap(feature => feature.points);
  const xs = points.map(point => point[0]); const ys = points.map(point => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 || 1;
  return { minX: minX - pad, minY: minY - pad, width: Math.max(maxX - minX + pad * 2, 1), height: Math.max(maxY - minY + pad * 2, 1) };
}

function centre(points: Point[]): Point {
  const total = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]] as Point, [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function groupedEntities(features: Polygon[], entities: TwinEntity[], visible: Set<TwinEntity['kind']>) {
  return features.map(feature => ({ feature, entities: entities.filter(entity => visible.has(entity.kind) && entity.evidence !== 'UNKNOWN' && entity.zone_code === feature.zoneCode) })).filter(group => group.entities.length);
}

interface HoveredInfo {
  sectionId: string;
  sectionLabel: string;
  zoneCode?: string;
  anchor?: TwinEntity;
  entities: TwinEntity[];
  x: number;
  y: number;
}

function Twin2D({
  data,
  visible,
  selected,
  onSelect,
  theme,
  onHover,
  onLeave,
  hoveredSectionId,
}: {
  data: TwinData;
  visible: Set<TwinEntity['kind']>;
  selected?: string;
  onSelect: (entityId: string) => void;
  theme: 'light' | 'dark';
  onHover: (info: HoveredInfo) => void;
  onLeave: () => void;
  hoveredSectionId?: string;
}) {
  const features = useMemo(() => polygons(data), [data]);
  if (!features.length) return <EmptyState title="Facility geometry has not been configured" detail="Add a persisted layout with polygon features before the 2D Twin can render this site. No decorative facility map is shown." />;
  const frame = bounds(features);

  return (
    <div className="twin-canvas">
      <svg
        viewBox={`${frame.minX} ${frame.minY} ${frame.width} ${frame.height}`}
        role="img"
        aria-label="Data-backed facility layout"
      >
        <rect
          x={frame.minX}
          y={frame.minY}
          width={frame.width}
          height={frame.height}
          className="twin-background"
        />

        {/* Render Chamber Zones & Corridors */}
        {features.map(feature => {
          const isOperational = Boolean(feature.zoneCode);
          const isHovered = hoveredSectionId === feature.id;
          const anchor = data.entities.find(e => e.role === 'ANCHOR' && e.zone_code === feature.zoneCode);
          const sectionEntities = data.entities.filter(
            e => visible.has(e.kind) && e.evidence !== 'UNKNOWN' && e.zone_code === feature.zoneCode
          );
          const isSelected = selected && (selected === anchor?.id || sectionEntities.some(e => e.id === selected));

          return (
            <g key={feature.id}>
              <polygon
                className={`twin-zone ${isOperational ? 'operational' : 'corridor'} ${isHovered ? 'hovered' : ''} ${isSelected ? 'selected' : ''}`}
                points={feature.points.map(point => point.join(',')).join(' ')}
                onMouseMove={(e) => {
                  onHover({
                    sectionId: feature.id,
                    sectionLabel: feature.label,
                    zoneCode: feature.zoneCode,
                    anchor,
                    entities: sectionEntities,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onMouseLeave={onLeave}
                onClick={() => {
                  const target = anchor ?? (sectionEntities.length ? sectionEntities[0] : undefined);
                  if (target) onSelect(target.id);
                }}
              >
                <title>{`${feature.label}${feature.zoneCode ? ` (${feature.zoneCode})` : ''}`}</title>
              </polygon>
              <text
                x={centre(feature.points)[0]}
                y={centre(feature.points)[1]}
                className={`twin-zone-label ${isOperational ? 'operational' : 'corridor'}`}
              >
                {feature.label}
              </text>
            </g>
          );
        })}

        {/* Render Interactive Anchor Pins on Operational Horizons */}
        {features
          .filter(feature => Boolean(feature.zoneCode))
          .map(feature => {
            const [x, y] = centre(feature.points);
            const anchor = data.entities.find(e => e.role === 'ANCHOR' && e.zone_code === feature.zoneCode);
            const sectionEntities = data.entities.filter(
              e => visible.has(e.kind) && e.evidence !== 'UNKNOWN' && e.zone_code === feature.zoneCode
            );
            const isSelected = selected && (selected === anchor?.id || sectionEntities.some(e => e.id === selected));
            const isHovered = hoveredSectionId === feature.id;
            const radius = Math.max(frame.width, frame.height) * 0.024;
            const target = anchor ?? (sectionEntities.length ? sectionEntities[0] : undefined);

            return (
              <g
                className={`twin-anchor-pin ${isSelected ? 'selected' : ''}`}
                key={`pin-${feature.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (target) onSelect(target.id);
                }}
                onMouseMove={(e) => {
                  e.stopPropagation();
                  onHover({
                    sectionId: feature.id,
                    sectionLabel: feature.label,
                    zoneCode: feature.zoneCode,
                    anchor,
                    entities: sectionEntities,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                onMouseLeave={onLeave}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && target) onSelect(target.id);
                }}
              >
                {/* Glowing beacon concentric pulse ring */}
                <circle
                  className="twin-anchor-pulse"
                  cx={x}
                  cy={y}
                  r={radius * 1.45}
                  fill={isHovered ? 'rgba(56, 189, 248, 0.35)' : 'rgba(16, 185, 129, 0.25)'}
                />
                {/* Solid Anchor Beacon Center */}
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={isSelected ? '#f59e0b' : (isHovered ? '#38bdf8' : '#10b981')}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                {/* Detected occupants counter or beacon dot */}
                {sectionEntities.length > 0 ? (
                  <text x={x} y={y} className="zone-entity-count">
                    {sectionEntities.length}
                  </text>
                ) : (
                  <circle cx={x} cy={y} r={radius * 0.32} fill="#ffffff" />
                )}
                {/* Anchor tag text below */}
                <text x={x} y={y + radius * 2.2} className="zone-entity-label">
                  {anchor ? `⚓ ${anchor.node_id.replace('ANCHOR-', '')}` : 'Station'}
                </text>
              </g>
            );
          })}
      </svg>
      <p className="twin-caption">Hover on any anchor beacon or section to inspect details; click to view telemetry in the sidebar.</p>
    </div>
  );
}

function NormalizedZone({
  polygon,
  frame,
  onClick,
  onHover,
  onLeave,
  theme,
  isHovered,
  isSelected,
  anchor,
  entities,
}: {
  polygon: Polygon;
  frame: ReturnType<typeof bounds>;
  onClick: () => void;
  onHover: (info: HoveredInfo) => void;
  onLeave: () => void;
  theme: 'light' | 'dark';
  isHovered: boolean;
  isSelected: boolean;
  anchor?: TwinEntity;
  entities: TwinEntity[];
}) {
  const scale = 12 / Math.max(frame.width, frame.height);
  const shape = useMemo(
    () => new THREE.Shape(polygon.points.map(([x, y]) => new THREE.Vector2((x - (frame.minX + frame.width / 2)) * scale, (y - (frame.minY + frame.height / 2)) * scale))),
    [frame.height, frame.minX, frame.minY, frame.width, polygon.points, scale]
  );
  const isLight = theme === 'light';
  const isOperational = Boolean(polygon.zoneCode);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover({
          sectionId: polygon.id,
          sectionLabel: polygon.label,
          zoneCode: polygon.zoneCode,
          anchor,
          entities,
          x: e.nativeEvent.clientX,
          y: e.nativeEvent.clientY,
        });
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onLeave();
      }}
    >
      <extrudeGeometry args={[shape, { depth: isOperational ? 0.38 : 0.16, bevelEnabled: false }]} />
      <meshStandardMaterial
        color={
          isSelected
            ? '#f59e0b'
            : isHovered
            ? (isLight ? '#0284c7' : '#38bdf8')
            : isLight
            ? (isOperational ? '#2563eb' : '#94a3b8')
            : (isOperational ? '#38bdf8' : '#1e3352')
        }
        emissive={isSelected ? '#d97706' : (isHovered ? (isLight ? '#0284c7' : '#0369a1') : '#000000')}
        emissiveIntensity={isSelected || isHovered ? 0.35 : 0}
        transparent
        opacity={isLight ? (isOperational ? 0.88 : 0.55) : (isOperational ? 0.85 : 0.48)}
        roughness={isOperational ? 0.35 : 0.6}
        metalness={isOperational ? 0.25 : 0.05}
      />
    </mesh>
  );
}

function Anchor3D({
  feature,
  frame,
  scale,
  anchor,
  entities,
  isSelected,
  isHovered,
  onHover,
  onLeave,
  onSelect,
  theme,
}: {
  feature: Polygon;
  frame: ReturnType<typeof bounds>;
  scale: number;
  anchor?: TwinEntity;
  entities: TwinEntity[];
  isSelected: boolean;
  isHovered: boolean;
  onHover: (info: HoveredInfo) => void;
  onLeave: () => void;
  onSelect: (entityId: string) => void;
  theme: 'light' | 'dark';
}) {
  const [cx, cy] = centre(feature.points);
  const x3d = (cx - (frame.minX + frame.width / 2)) * scale;
  const z3d = (cy - (frame.minY + frame.height / 2)) * scale;
  const isLight = theme === 'light';
  const target = anchor ?? (entities.length ? entities[0] : undefined);

  return (
    <group position={[x3d, 0.38, z3d]}>
      {/* Anchor Physical Mast */}
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.04, 0.07, 0.44, 16]} />
        <meshStandardMaterial
          color={isLight ? '#64748b' : '#94a3b8'}
          metalness={0.6}
          roughness={0.2}
        />
      </mesh>

      {/* Anchor Beacon Glowing Head */}
      <mesh
        position={[0, 0.46, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (target) onSelect(target.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover({
            sectionId: feature.id,
            sectionLabel: feature.label,
            zoneCode: feature.zoneCode,
            anchor,
            entities,
            x: e.nativeEvent.clientX,
            y: e.nativeEvent.clientY,
          });
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onLeave();
        }}
      >
        <sphereGeometry args={[0.13, 24, 24]} />
        <meshStandardMaterial
          color={isSelected ? '#f59e0b' : (isHovered ? '#38bdf8' : '#10b981')}
          emissive={isSelected ? '#d97706' : (isHovered ? '#0284c7' : '#059669')}
          emissiveIntensity={0.8}
          roughness={0.1}
        />
      </mesh>

      {/* Floating 3D Anchor HTML Tag */}
      <Html position={[0, 0.76, 0]} center distanceFactor={14}>
        <div
          className={`twin-3d-anchor-tag ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (target) onSelect(target.id);
          }}
          onPointerEnter={(e) => {
            onHover({
              sectionId: feature.id,
              sectionLabel: feature.label,
              zoneCode: feature.zoneCode,
              anchor,
              entities,
              x: e.clientX,
              y: e.clientY,
            });
          }}
          onPointerLeave={onLeave}
        >
          <Radio size={12} className="anchor-tag-icon" />
          <span>{anchor?.node_id ?? feature.label.split(' ')[0]}</span>
          {entities.length > 0 && <span className="anchor-tag-badge">{entities.length}</span>}
        </div>
      </Html>
    </group>
  );
}

function Twin3D({
  data,
  visible,
  selected,
  onSelect,
  theme,
  onHover,
  onLeave,
  hoveredSectionId,
}: {
  data: TwinData;
  visible: Set<TwinEntity['kind']>;
  selected?: string;
  onSelect: (entityId: string) => void;
  theme: 'light' | 'dark';
  onHover: (info: HoveredInfo) => void;
  onLeave: () => void;
  hoveredSectionId?: string;
}) {
  const features = useMemo(() => polygons(data), [data]);
  if (!features.length) return <EmptyState title="No geometry for 3D mode" detail="The 3D workspace uses the same persisted facility geometry as 2D. Configure the layout first." />;
  const frame = bounds(features);
  const isLight = theme === 'light';
  const scale = 12 / Math.max(frame.width, frame.height);

  return (
    <div className="twin-three">
      <Canvas camera={{ position: [0, 11, 16], fov: 40 }}>
        <color attach="background" args={[isLight ? '#f8fafc' : '#08111f']} />
        <ambientLight intensity={isLight ? 1.1 : 0.8} />
        <directionalLight position={[6, 12, 9]} intensity={isLight ? 1.6 : 1.4} />
        <directionalLight position={[-6, -4, -5]} intensity={isLight ? 0.6 : 0.3} />

        {features.map(feature => {
          const anchor = data.entities.find(e => e.role === 'ANCHOR' && e.zone_code === feature.zoneCode);
          const sectionEntities = data.entities.filter(
            e => visible.has(e.kind) && e.evidence !== 'UNKNOWN' && e.zone_code === feature.zoneCode
          );
          const isSelected = selected && (selected === anchor?.id || sectionEntities.some(e => e.id === selected));
          const target = anchor ?? (sectionEntities.length ? sectionEntities[0] : undefined);

          return (
            <NormalizedZone
              key={feature.id}
              polygon={feature}
              frame={frame}
              theme={theme}
              isHovered={hoveredSectionId === feature.id}
              isSelected={Boolean(isSelected)}
              anchor={anchor}
              entities={sectionEntities}
              onHover={onHover}
              onLeave={onLeave}
              onClick={() => {
                if (target) onSelect(target.id);
              }}
            />
          );
        })}

        {/* 3D Anchor Beacons */}
        {features
          .filter(feature => Boolean(feature.zoneCode))
          .map(feature => {
            const anchor = data.entities.find(e => e.role === 'ANCHOR' && e.zone_code === feature.zoneCode);
            const sectionEntities = data.entities.filter(
              e => visible.has(e.kind) && e.evidence !== 'UNKNOWN' && e.zone_code === feature.zoneCode
            );
            const isSelected = selected && (selected === anchor?.id || sectionEntities.some(e => e.id === selected));

            return (
              <Anchor3D
                key={`anchor-3d-${feature.id}`}
                feature={feature}
                frame={frame}
                scale={scale}
                anchor={anchor}
                entities={sectionEntities}
                isSelected={Boolean(isSelected)}
                isHovered={hoveredSectionId === feature.id}
                onHover={onHover}
                onLeave={onLeave}
                onSelect={onSelect}
                theme={theme}
              />
            );
          })}

        <OrbitControls makeDefault />
      </Canvas>
      <p className="twin-caption">3D mode is generated from the configured facility geometry. Drag to rotate, scroll to zoom. Hover on anchor markers to inspect.</p>
    </div>
  );
}

export function TwinPage() {
  const { selectedSiteId, theme, toggleTheme } = usePlatform();
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [visible, setVisible] = useState<Set<TwinEntity['kind']>>(new Set(['personnel', 'asset', 'device']));
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null);

  const twin = useQuery({
    queryKey: ['twin', selectedSiteId],
    queryFn: () => platformApi.twin(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: 15_000,
  });

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a site to open its Digital Twin." />;
  if (twin.isLoading) return <LoadingState label="Loading configured facility layout…" />;
  if (twin.isError || !twin.data) return <ErrorState message="The Digital Twin could not load the selected site's layout and entity evidence." retry={() => void twin.refetch()} />;

  const selected = twin.data.entities.find(entity => entity.id === selectedId);
  const toggle = (kind: TwinEntity['kind']) => setVisible(current => {
    const next = new Set(current);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    return next;
  });

  return (
    <div className="twin-workspace">
      <PageHeader
        eyebrow="OPERATIONS WORKSPACE"
        title="Digital Twin"
        description="A real-time spatial operations workspace displaying persisted facility geometry, anchor infrastructure, and server-backed zone evidence."
      />

      {/* Floating Hover Card (Shows which section is labeled what on hover) */}
      {hoveredInfo && (
        <div
          className="twin-hover-card"
          style={{
            left: `${Math.min(hoveredInfo.x + 14, window.innerWidth - 320)}px`,
            top: `${Math.max(hoveredInfo.y - 45, 75)}px`,
          }}
        >
          <div className="hover-card-header">
            <Radio size={16} className="hover-radio-icon" />
            <div>
              <strong>{hoveredInfo.sectionLabel}</strong>
              {hoveredInfo.zoneCode && <span className="hover-zone-tag">{hoveredInfo.zoneCode}</span>}
            </div>
          </div>

          <div className="hover-card-body">
            <div className="hover-row">
              <span className="hover-key">Anchor Device:</span>
              <span className="hover-val">
                {hoveredInfo.anchor ? (
                  <span className="anchor-pill-inline">
                    <Wifi size={12} /> {hoveredInfo.anchor.node_id} ({hoveredInfo.anchor.status})
                  </span>
                ) : (
                  <span className="text-muted">Structural Conduit</span>
                )}
              </span>
            </div>

            <div className="hover-row">
              <span className="hover-key">Occupancy:</span>
              <span className="hover-val">
                {hoveredInfo.entities.length > 0 ? (
                  <strong>
                    {hoveredInfo.entities.filter(e => e.kind === 'personnel').length} Personnel
                    {hoveredInfo.entities.some(e => e.kind === 'asset') ? `, ${hoveredInfo.entities.filter(e => e.kind === 'asset').length} Assets` : ''}
                  </strong>
                ) : (
                  <span className="text-muted">No mobile personnel detected</span>
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: 2D/3D Mode, Entity Filters, Theme Switcher */}
      <div className="twin-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="segmented">
            <button className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>
              <Map size={15} /> 2D
            </button>
            <button className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>
              <Layers3 size={15} /> 3D
            </button>
          </div>

          <div className="layer-controls">
            {(['personnel', 'asset', 'device'] as const).map(kind => (
              <button
                className={visible.has(kind) ? 'active' : ''}
                key={kind}
                onClick={() => toggle(kind)}
              >
                {kind === 'personnel' ? <Users size={14} /> : kind === 'asset' ? <Box size={14} /> : <Eye size={14} />}
                <span>{kind}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Quick In-Stage Theme Switcher */}
        <button
          type="button"
          onClick={toggleTheme}
          className="button secondary"
          style={{
            padding: '6px 12px',
            fontSize: '0.8rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
        </button>
      </div>

      <section className="twin-layout">
        <article className="twin-stage">
          {mode === '2d' ? (
            <Twin2D
              data={twin.data}
              visible={visible}
              selected={selectedId}
              onSelect={setSelectedId}
              theme={theme}
              onHover={setHoveredInfo}
              onLeave={() => setHoveredInfo(null)}
              hoveredSectionId={hoveredInfo?.sectionId}
            />
          ) : (
            <Twin3D
              data={twin.data}
              visible={visible}
              selected={selectedId}
              onSelect={setSelectedId}
              theme={theme}
              onHover={setHoveredInfo}
              onLeave={() => setHoveredInfo(null)}
              hoveredSectionId={hoveredInfo?.sectionId}
            />
          )}
          {twin.data.topology_status && (
            <p className="topology-note">
              <MonitorCog size={14} /> Network topology: {twin.data.topology_status.replace(/_/g, ' ').toLowerCase()}.
            </p>
          )}
        </article>

        {/* Sidebar Telemetry Inspector */}
        <aside className="twin-inspector">
          <p className="eyebrow">{selected?.role === 'ANCHOR' ? 'ANCHOR INSPECTOR' : 'ENTITY INSPECTOR'}</p>
          {selected ? (
            <>
              <h2>{selected.label || selected.node_id}</h2>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '12px' }}>
                <StatusPill value={selected.role === 'ANCHOR' ? 'Infrastructure Anchor' : selected.kind} />
                <NodeStatusPill status={selected.status} />
              </div>
              <dl className="metadata-list">
                <div>
                  <dt>Device ID</dt>
                  <dd style={{ fontFamily: 'monospace', fontWeight: 700 }}>{selected.node_id}</dd>
                </div>
                <div>
                  <dt>Network Role</dt>
                  <dd>{selected.role}</dd>
                </div>
                <div>
                  <dt>Reported Zone</dt>
                  <dd><LocationLabel evidence={selected.evidence} zone={selected.zone_code} /></dd>
                </div>
                <div>
                  <dt>Last Observed</dt>
                  <dd>{formatTimestamp(selected.observed_at)}</dd>
                </div>
              </dl>

              {/* If this is an Anchor, display all personnel/assets currently detected at this anchor */}
              {selected.role === 'ANCHOR' && (
                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <p className="eyebrow" style={{ marginBottom: '8px' }}>
                    OCCUPANTS AT THIS ANCHOR ({twin.data.entities.filter(e => e.zone_code === selected.zone_code && e.id !== selected.id).length})
                  </p>
                  <div className="twin-entity-list" style={{ maxHeight: '240px' }}>
                    {twin.data.entities
                      .filter(e => e.zone_code === selected.zone_code && e.id !== selected.id)
                      .map(entity => (
                        <button
                          key={entity.id}
                          className={selectedId === entity.id ? 'selected' : ''}
                          onClick={() => setSelectedId(entity.id)}
                        >
                          <span style={{ fontWeight: 600 }}>{entity.label}</span>
                          <StatusPill value={entity.kind} />
                        </button>
                      ))}
                    {!twin.data.entities.some(e => e.zone_code === selected.zone_code && e.id !== selected.id) && (
                      <p className="text-muted" style={{ fontSize: '0.78rem', margin: '4px 0' }}>
                        No personnel or assets currently reporting at this anchor station.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p>Select an anchor beacon, zone, or entity to inspect its server-backed spatial evidence.</p>
              <div className="twin-entity-list">
                {twin.data.entities
                  .filter(entity => visible.has(entity.kind))
                  .map(entity => (
                    <button
                      className={selectedId === entity.id ? 'selected' : ''}
                      onClick={() => setSelectedId(entity.id)}
                      key={entity.id}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600 }}>{entity.label}</span>
                        <small style={{ color: 'var(--muted)', fontSize: '0.68rem' }}>
                          {entity.role === 'ANCHOR' ? '⚓ Stationary Anchor' : entity.node_id}
                        </small>
                      </div>
                      <LocationLabel evidence={entity.evidence} zone={entity.zone_code} />
                    </button>
                  ))}
              </div>
            </>
          )}
        </aside>
      </section>
    </div>
  );
}
