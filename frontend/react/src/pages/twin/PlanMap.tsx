import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isCurrentEvidence, type MapCommand, type MapVisual, type Point } from './model';

const initialView = { zoom: 1, x: 0, y: 0 };
const pathData = (rings: Point[][]) => rings.map(ring => `M ${ring.map(point => point.join(' ')).join(' L ')} Z`).join(' ');

export function PlanMap({ visual, command }: { visual: MapVisual; command?: MapCommand }) {
  const { features, frame, zoneLabels, visibleByZone, selectedZone, selectedEvidence, onSelectZone } = visual;
  const [view, setView] = useState(initialView);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const applied = useRef<MapCommand>();
  const paths = useMemo(() => features.map(feature => pathData(feature.rings)), [features]);

  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!command || command === applied.current) return;
    applied.current = command;
    setView(previous => {
      if (command.action === 'fit') return initialView;
      if (command.action === 'locate') {
        const feature = command.zone == null ? undefined : zoneLabels.get(command.zone);
        return feature ? {
          zoom: Math.max(previous.zoom, 1.55),
          x: feature.center[0] - (frame.x + frame.width / 2),
          y: feature.center[1] - (frame.y + frame.height / 2),
        } : previous;
      }
      if (command.action === 'in' || command.action === 'out') {
        return { ...previous, zoom: Math.max(0.65, Math.min(5, previous.zoom * (command.action === 'in' ? 1.25 : 0.8))) };
      }
      const step = 0.19 / previous.zoom;
      const dx = command.action === 'left' ? -frame.width * step : command.action === 'right' ? frame.width * step : 0;
      const dy = command.action === 'up' ? -frame.height * step : command.action === 'down' ? frame.height * step : 0;
      return { ...previous, x: previous.x + dx, y: previous.y + dy };
    });
  }, [command, frame, zoneLabels]);

  const width = frame.width / view.zoom;
  const height = frame.height / view.zoom;
  const x = frame.x + (frame.width - width) / 2 + view.x;
  const y = frame.y + (frame.height - height) / 2 + view.y;
  const unit = Math.max(width / Math.max(1, size.width), height / Math.max(1, size.height));
  return (
    <svg ref={svg} className="dt-plan" viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="Data-backed facility layout">
      {features.map((feature, index) => {
        const zone = feature.zone;
        const active = zone && selectedZone === zone.id;
        return (
          <path key={feature.id} d={paths[index]} fillRule="evenodd"
            data-zone={zone?.id} data-selected={active || undefined}
            data-uncertain={active && selectedEvidence && !isCurrentEvidence(selectedEvidence) || undefined}
            className={zone ? 'dt-shape zone' : 'dt-shape'}
            onClick={zone ? () => onSelectZone(zone, true) : undefined}>
            <title>{zone ? `${zone.name} · ${zone.code}` : feature.label}</title>
          </path>
        );
      })}
      {[...zoneLabels.values()].map(({ id, zone, center: [cx, cy] }) => {
        if (!zone) return null;
        const entities = visibleByZone.get(zone.id) ?? [];
        const isSelected = zone.id === selectedZone;
        const uncertain = entities.some(entity => !isCurrentEvidence(entity.evidence));
        const count = entities.length;
        const longLabel = zone.name.length > 22 ? `${zone.name.slice(0, 21)}…` : zone.name;
        const showName = isSelected || (size.width >= 540 && zoneLabels.size < 18) || (view.zoom >= 1.4 && zoneLabels.size < 40);
        return (
          <g key={id} transform={`translate(${cx},${cy}) scale(${unit})`} className="dt-map-label"
            data-selected={isSelected || undefined} data-uncertain={(isSelected && selectedEvidence ? !isCurrentEvidence(selectedEvidence) : uncertain) || undefined}
            onClick={() => onSelectZone(zone, true)}>
            <title>{zone.name} · {zone.code}{count > 0 ? ` · ${count} mapped trackers in zone` : ''}</title>
            <text y={count ? -5 : 0} className="dt-zone-text">{showName ? longLabel : zone.code.length > 13 ? `${zone.code.slice(0, 12)}…` : zone.code}</text>
            {count > 0 && <>
              <rect x="-12" y="4" width="24" height="18" rx="5" className="dt-zone-count" />
              <text y="13" className="dt-count-text">{count > 99 ? '99+' : count}</text>
            </>}
          </g>
        );
      })}
    </svg>
  );
}
