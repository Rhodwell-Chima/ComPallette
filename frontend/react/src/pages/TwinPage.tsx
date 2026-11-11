import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Eye, Layers3, Map, MonitorCog, Sun, Moon, Users } from 'lucide-react';
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

function Twin2D({ data, visible, selected, onSelect, theme }: { data: TwinData; visible: Set<TwinEntity['kind']>; selected?: string; onSelect: (entityId: string) => void; theme: 'light' | 'dark' }) {
  const features = useMemo(() => polygons(data), [data]);
  if (!features.length) return <EmptyState title="Facility geometry has not been configured" detail="Add a persisted layout with polygon features before the 2D Twin can render this site. No decorative facility map is shown." />;
  const frame = bounds(features);
  const groups = groupedEntities(features, data.entities, visible);

  const isLight = theme === 'light';

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
          return (
            <g key={feature.id}>
              <polygon
                className={`twin-zone ${isOperational ? 'operational' : 'corridor'}`}
                points={feature.points.map(point => point.join(',')).join(' ')}
              >
                <title>{feature.label}</title>
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

        {/* Render Grouped Telemetry Pins */}
        {groups.map(group => {
          const [x, y] = centre(group.feature.points);
          const active = group.entities.some(entity => entity.id === selected);
          const radius = Math.max(frame.width, frame.height) * 0.026;
          return (
            <g
              className={`zone-entity-group ${active ? 'selected' : ''}`}
              key={group.feature.id}
              onClick={() => onSelect(group.entities[0].id)}
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(group.entities[0].id);
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={radius}
                filter={isLight ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' : 'none'}
              />
              <text x={x} y={y} className="zone-entity-count">
                {group.entities.length}
              </text>
              <text x={x} y={y + Math.max(frame.width, frame.height) * 0.052} className="zone-entity-label">
                {group.entities.map(entity => entity.kind).filter((kind, index, values) => values.indexOf(kind) === index).join(' + ')}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="twin-caption">Entity badges represent a zone grouping, not an exact physical coordinate.</p>
    </div>
  );
}

function NormalizedZone({ polygon, frame, onClick, theme }: { polygon: Polygon; frame: ReturnType<typeof bounds>; onClick: () => void; theme: 'light' | 'dark' }) {
  const scale = 12 / Math.max(frame.width, frame.height);
  const shape = useMemo(
    () => new THREE.Shape(polygon.points.map(([x, y]) => new THREE.Vector2((x - (frame.minX + frame.width / 2)) * scale, (y - (frame.minY + frame.height / 2)) * scale))),
    [frame.height, frame.minX, frame.minY, frame.width, polygon.points, scale]
  );
  const isLight = theme === 'light';
  const isOperational = Boolean(polygon.zoneCode);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <extrudeGeometry args={[shape, { depth: isOperational ? 0.38 : 0.16, bevelEnabled: false }]} />
      <meshStandardMaterial
        color={
          isLight
            ? (isOperational ? '#2563eb' : '#94a3b8')
            : (isOperational ? '#38bdf8' : '#1e3352')
        }
        transparent
        opacity={isLight ? (isOperational ? 0.85 : 0.55) : (isOperational ? 0.82 : 0.48)}
        roughness={isOperational ? 0.35 : 0.6}
        metalness={isOperational ? 0.25 : 0.05}
      />
    </mesh>
  );
}

function Twin3D({ data, onSelect, theme }: { data: TwinData; onSelect: (entityId: string) => void; theme: 'light' | 'dark' }) {
  const features = useMemo(() => polygons(data), [data]);
  if (!features.length) return <EmptyState title="No geometry for 3D mode" detail="The 3D workspace uses the same persisted facility geometry as 2D. Configure the layout first." />;
  const frame = bounds(features);
  const isLight = theme === 'light';

  return (
    <div className="twin-three">
      <Canvas camera={{ position: [0, 11, 16], fov: 40 }}>
        <color attach="background" args={[isLight ? '#f8fafc' : '#08111f']} />
        <ambientLight intensity={isLight ? 1.1 : 0.8} />
        <directionalLight position={[6, 12, 9]} intensity={isLight ? 1.6 : 1.4} />
        <directionalLight position={[-6, -4, -5]} intensity={isLight ? 0.6 : 0.3} />
        {features.map(feature => (
          <NormalizedZone
            key={feature.id}
            polygon={feature}
            frame={frame}
            theme={theme}
            onClick={() => {
              const entity = data.entities.find(item => item.zone_code === feature.zoneCode);
              if (entity) onSelect(entity.id);
            }}
          />
        ))}
        <OrbitControls makeDefault />
      </Canvas>
      <p className="twin-caption">3D mode is generated from the configured facility geometry. Drag to rotate, scroll to zoom.</p>
    </div>
  );
}

export function TwinPage() {
  const { selectedSiteId, theme, toggleTheme } = usePlatform();
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [visible, setVisible] = useState<Set<TwinEntity['kind']>>(new Set(['personnel', 'asset', 'device']));
  const [selectedId, setSelectedId] = useState<string>();

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
        description="A real-time spatial operations workspace displaying persisted facility geometry and server-backed zone evidence."
      />

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
            />
          ) : (
            <Twin3D
              data={twin.data}
              onSelect={setSelectedId}
              theme={theme}
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
          <p className="eyebrow">ENTITY INSPECTOR</p>
          {selected ? (
            <>
              <h2>{selected.label}</h2>
              <StatusPill value={selected.kind} />
              <dl className="metadata-list">
                <div>
                  <dt>Device</dt>
                  <dd>{selected.node_id}</dd>
                </div>
                <div>
                  <dt>Reported zone</dt>
                  <dd><LocationLabel evidence={selected.evidence} zone={selected.zone_code} /></dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd>{formatTimestamp(selected.observed_at)}</dd>
                </div>
                <div>
                  <dt>Device health</dt>
                  <dd><NodeStatusPill status={selected.status} /></dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <p>Select a zone grouping or entity below to inspect its server-provided evidence.</p>
              <div className="twin-entity-list">
                {twin.data.entities
                  .filter(entity => visible.has(entity.kind))
                  .map(entity => (
                    <button
                      className={selectedId === entity.id ? 'selected' : ''}
                      onClick={() => setSelectedId(entity.id)}
                      key={entity.id}
                    >
                      <span style={{ fontWeight: 600 }}>{entity.label}</span>
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
