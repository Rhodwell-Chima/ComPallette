import type { LocationEvidence, TwinEntity, Zone } from '../../types';

export type Point = [number, number];
export type MapFeature = { id: string; label: string; zone?: Zone; rings: Point[][]; center: Point; area: number };
export type Frame = { x: number; y: number; width: number; height: number };
export type Category = 'all' | TwinEntity['kind'] | 'anchor';
export type MapAction = 'fit' | 'locate' | 'in' | 'out' | 'left' | 'right' | 'up' | 'down' | 'orbit-left' | 'orbit-right';
export type MapCommand = { action: MapAction; zone?: number };
export type MapTheme = 'light' | 'dark';
export type MapVisual = {
  features: MapFeature[];
  frame: Frame;
  zoneLabels: Map<number, MapFeature>;
  visibleByZone: Map<number, TwinEntity[]>;
  selectedZone?: number;
  selectedEvidence?: LocationEvidence;
  onSelectZone: (zone: Zone, focus?: boolean) => void;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function parseRing(value: unknown): Point[] | undefined {
  if (!Array.isArray(value)) return;
  const points: Point[] = [];
  for (const entry of value) {
    const [x, y] = Array.isArray(entry) ? entry : [object(entry).x, object(entry).y];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const previous = points[points.length - 1];
    if (previous?.[0] !== x || previous[1] !== y) points.push([x, y]);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first && first[0] === last[0] && first[1] === last[1]) points.pop();
  if (points.length < 3) return;
  const area = Math.abs(ringArea(points));
  return area > 0 && Number.isFinite(area) ? points : undefined;
}

function ringArea(points: Point[]) {
  const [x, y] = points[0];
  return points.reduce((sum, [px, py], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    return sum + (px - x) * (ny - y) - (nx - x) * (py - y);
  }, 0) / 2;
}

export function mapFeatures(geometry: Record<string, unknown> | undefined, zones: Map<number, Zone>): MapFeature[] {
  const features = geometry?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((raw, index) => {
    const feature = object(raw);
    const props = object(feature.properties);
    const shape = object(feature.geometry ?? feature);
    const coordinates = shape.coordinates;
    const parts = shape.type === 'MultiPolygon' ? (Array.isArray(coordinates) ? coordinates : []) :
      shape.type === 'Polygon' ? [coordinates] : shape.type && shape.type !== 'Feature' ? [] :
      [Array.isArray(coordinates) && Array.isArray(coordinates[0]?.[0]) ? coordinates : [coordinates ?? feature.points]];
    const zone = typeof props.zone_id === 'number' ? zones.get(props.zone_id) : undefined;
    const rawLabel = props.label ?? feature.label ?? props.name;
    const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : zone?.name ?? `Plan feature ${index + 1}`;
    return parts.flatMap((part, partIndex) => {
      if (!Array.isArray(part) || !part.length) return [];
      const parsed = part.map(parseRing);
      if (!parsed.every((ring): ring is Point[] => Boolean(ring))) return [];
      const exterior = parsed[0];
      const frame = mapBounds([{ rings: [exterior] }], 0);
      if (!frame) return [];
      return [{
        id: `${String(feature.id ?? index)}-${index}-${partIndex}`, label, zone, rings: parsed,
        center: [frame.x + frame.width / 2, frame.y + frame.height / 2] as Point,
        area: Math.abs(ringArea(exterior)),
      }];
    });
  });
}

export function mapBounds(features: { rings: Point[][] }[], padding = 0.075): Frame | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { rings } of features) for (const [x, y] of rings[0]) {
    minX = Math.min(x, minX); minY = Math.min(y, minY);
    maxX = Math.max(x, maxX); maxY = Math.max(y, maxY);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const pad = Math.max(width, height) * padding;
  const frame = { x: minX - pad, y: minY - pad, width: width + 2 * pad, height: height + 2 * pad };
  return frame.width > 0 && frame.height > 0 && Object.values(frame).every(Number.isFinite) ? frame : undefined;
}

export function indexPlan(features: MapFeature[]) {
  const zoneLabels = new Map<number, MapFeature>();
  for (const feature of features) {
    if (!feature.zone) continue;
    const previous = zoneLabels.get(feature.zone.id);
    if (!previous || feature.area > previous.area) zoneLabels.set(feature.zone.id, feature);
  }
  const levels = new Map<number, string>();
  for (const { zone } of zoneLabels.values()) {
    if (zone?.level != null) levels.set(zone.level, zone.level_name?.trim() || `Level ${zone.level}`);
  }
  // Twin exposes level identity and name. Level sort_order belongs to a separate API.
  const orderedLevels = [...levels].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }) || a[0] - b[0]);
  return { zoneLabels, levels: orderedLevels, frame: mapBounds(features) };
}

export function hasZoneEvidence(entity: TwinEntity) {
  return entity.evidence === 'CURRENT' || entity.evidence === 'CONFIRMED' || entity.evidence === 'LAST_KNOWN' ||
    entity.evidence === 'ESTIMATED' || entity.evidence === 'TRANSITIONING' || entity.evidence === 'AMBIGUOUS';
}

export const isCurrentEvidence = (evidence?: LocationEvidence) => evidence === 'CURRENT' || evidence === 'CONFIRMED';
export const entityName = (entity: TwinEntity) => entity.label?.trim() || entity.node_id;
export const normalizeQuery = (value?: string) => value?.toLowerCase().trim().replace(/\s+/g, ' ') ?? '';
export function matchesCategory(entity: TwinEntity, category: Category) {
  return category === 'all' || (category === 'anchor' ? entity.kind === 'device' && entity.role === 'ANCHOR' : entity.kind === category);
}
