import { useLayoutEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Edges, Html, OrbitControls } from '@react-three/drei';
import { DoubleSide, OrthographicCamera, Path, Shape, Spherical, Vector3 } from 'three';
import { isCurrentEvidence, type MapCommand, type MapFeature, type MapTheme, type MapVisual, type Point } from './model';

const darkness = {
  dark: { corridor: '#485f74', zone: '#718697', edge: '#9bafc1', zoneEdge: '#c4d1dc', selected: '#507da5', selectedEdge: '#93d6ff', uncertain: '#92724c', uncertainEdge: '#ffce86' },
  light: { corridor: '#9aabb9', zone: '#d2dde5', edge: '#4d6275', zoneEdge: '#597084', selected: '#78abd2', selectedEdge: '#225c8a', uncertain: '#c6a16f', uncertainEdge: '#855200' },
};
const schematicThickness = (feature: MapFeature) => feature.zone ? 0.36 : 0.17;
const initialPosition = new Vector3(4, 12, 11);
const cameraOptions = { position: initialPosition.toArray(), near: 0.05, far: 150 };
const pixelRatio: [number, number] = [1, 1.75];

function controlsPosition(frame: MapVisual['frame'], [x, y]: Point) {
  const scale = 12 / Math.max(frame.width, frame.height);
  return [(x - frame.x - frame.width / 2) * scale, (y - frame.y - frame.height / 2) * scale] as const;
}

function hasCoarsePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function SceneControls({ visual, command }: { visual: MapVisual; command?: MapCommand }) {
  const { camera, invalidate, size } = useThree();
  const orbit = useRef<ComponentRef<typeof OrbitControls>>(null);
  const framed = useRef(false);
  const applied = useRef<MapCommand>();
  const touch = hasCoarsePointer();

  useLayoutEffect(() => {
    const controls = orbit.current;
    if (!(camera instanceof OrthographicCamera) || !controls || size.width <= 0 || size.height <= 0) return;
    if (framed.current && applied.current === command) return;
    const action = framed.current ? command?.action : 'fit';
    framed.current = true;
    applied.current = command;
    if (action === 'fit') {
      controls.target.set(0, 0, 0);
      camera.position.copy(initialPosition);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      const basis = camera.quaternion.clone().invert();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const corner = new Vector3();
      for (const feature of visual.features) for (const point of feature.rings[0]) {
        const [x, z] = controlsPosition(visual.frame, point);
        for (const elevation of [0, schematicThickness(feature)]) {
          corner.set(x, elevation, z).applyQuaternion(basis);
          minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
        }
      }
      const center = new Vector3((maxX + minX) / 2, (maxY + minY) / 2, 0).applyQuaternion(camera.quaternion);
      controls.target.add(center);
      camera.position.add(center);
      camera.zoom = 0.88 * Math.min(size.width / (maxX - minX), size.height / (maxY - minY));
    } else if (action === 'in' || action === 'out') {
      camera.zoom = Math.min(250, Math.max(8, camera.zoom * (action === 'in' ? 1.25 : 0.8)));
    } else if (action === 'locate') {
      const feature = command?.zone == null ? undefined : visual.zoneLabels.get(command.zone);
      if (feature) {
        const [x, z] = controlsPosition(visual.frame, feature.center);
        const next = new Vector3(x, 0, z);
        camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
      }
    } else if (action === 'orbit-left' || action === 'orbit-right') {
      const spherical = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      spherical.theta += action === 'orbit-left' ? -Math.PI / 10 : Math.PI / 10;
      camera.position.setFromSpherical(spherical).add(controls.target);
    } else if (action) {
      const step = Math.min(size.width, size.height) / camera.zoom * 0.18;
      const direction = new Vector3(action === 'left' ? -step : action === 'right' ? step : 0,
        action === 'up' ? step : action === 'down' ? -step : 0, 0).applyQuaternion(camera.quaternion);
      controls.target.add(direction);
      camera.position.add(direction);
    }
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }, [camera, command, invalidate, size.width, size.height, visual.features, visual.frame, visual.zoneLabels]);

  return <OrbitControls ref={orbit} enableDamping={false} enableRotate={!touch} enablePan={!touch} enableZoom={false} maxPolarAngle={Math.PI / 2.2} />;
}

function Surface({ feature, visual, theme }: { feature: MapFeature; visual: MapVisual; theme: MapTheme }) {
  const { frame, selectedZone, selectedEvidence, zoneLabels, visibleByZone, onSelectZone } = visual;
  const shape = useMemo(() => {
    const draw = (path: Path, ring: Point[]) => {
      ring.forEach((point, index) => {
        const [x, z] = controlsPosition(frame, point);
        if (index === 0) path.moveTo(x, -z);
        else path.lineTo(x, -z);
      });
      path.closePath();
      return path;
    };
    const result = new Shape();
    draw(result, feature.rings[0]);
    result.holes = feature.rings.slice(1).map(ring => draw(new Path(), ring));
    return result;
  }, [feature.rings, frame]);
  const depth = schematicThickness(feature);
  const extrusion = useMemo(() => ({ depth, bevelEnabled: false }), [depth]);
  const { zone } = feature;
  const selected = zone && zone.id === selectedZone;
  const uncertain = selectedEvidence && !isCurrentEvidence(selectedEvidence);
  const palette = darkness[theme];
  const [x, z] = controlsPosition(frame, feature.center);
  const members = zone ? visibleByZone.get(zone.id) ?? [] : [];
  const labelUncertain = selected && selectedEvidence ? uncertain : members.some(entity => !isCurrentEvidence(entity.evidence));
  const showLabel = zone && zoneLabels.get(zone.id) === feature && (selected || zoneLabels.size <= 14);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={zone ? event => {
        event.stopPropagation();
        if (event.delta <= 5) onSelectZone(zone, true);
      } : undefined}>
        <extrudeGeometry args={[shape, extrusion]} />
        <meshStandardMaterial color={selected ? (uncertain ? palette.uncertain : palette.selected) : zone ? palette.zone : palette.corridor}
          side={DoubleSide} roughness={0.86} metalness={0} />
        <Edges threshold={18} color={selected ? (uncertain ? palette.uncertainEdge : palette.selectedEdge) : zone ? palette.zoneEdge : palette.edge} />
      </mesh>
      {showLabel && (
        <Html position={[x, depth + 0.15, z]} center zIndexRange={[4, 1]} style={{ pointerEvents: 'none' }}>
          <span className="dt-schematic-tag" data-selected={selected || undefined} data-uncertain={labelUncertain || undefined} aria-hidden="true">
            {zone.code.length > 15 ? `${zone.code.slice(0, 14)}…` : zone.code}{members.length ? <b>{members.length > 99 ? '99+' : members.length}</b> : null}
          </span>
        </Html>
      )}
    </>
  );
}

export default function SchematicMap({ visual, command, theme, onFailure, fallback }: {
  visual: MapVisual; command?: MapCommand; theme: MapTheme; onFailure: () => void; fallback: React.ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrapper = stage.current;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    wrapper?.addEventListener('webglcontextlost', onContextLost, true);
    return () => wrapper?.removeEventListener('webglcontextlost', onContextLost, true);
  }, [onFailure]);

  return (
    <div ref={stage} className="dt-three" role="img" aria-label="Three-dimensional schematic of the mine plan">
      <Canvas orthographic frameloop="demand" dpr={pixelRatio} camera={cameraOptions} fallback={fallback}>
        <ambientLight intensity={1.25} />
        <directionalLight position={[-5, 10, -5]} intensity={2.15} />
        <directionalLight position={[4, 3, 6]} intensity={0.6} />
        {visual.features.map(feature => <Surface key={feature.id} feature={feature} visual={visual} theme={theme} />)}
        <SceneControls visual={visual} command={command} />
      </Canvas>
    </div>
  );
}
