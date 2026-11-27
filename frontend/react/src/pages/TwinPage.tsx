import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, ChevronDown, Focus, Layers3, LocateFixed,
  Map as MapIcon, Minus, Network, Plus, Radio, RefreshCw, RotateCcw, RotateCw, Search, Users, X,
} from 'lucide-react';
import { usePlatform } from '../platform/PlatformContext';
import { Pagination } from '../platform/pagination';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, formatTimestamp } from '../platform/ui';
import { ApiError, platformApi } from '../services/api';
import type { TwinData, TwinEntity, Zone } from '../types';
import { PlanMap } from './twin/PlanMap';
import {
  entityName, hasZoneEvidence, indexPlan, mapFeatures, matchesCategory, normalizeQuery,
  type Category, type MapAction, type MapCommand, type MapTheme,
} from './twin/model';
import './twin/twin.css';

const SchematicMap = lazy(() => import('./twin/SchematicMap'));
const trackersPerPage = 6;
const layers = [
  { kind: 'personnel', label: 'Personnel', icon: Users },
  { kind: 'asset', label: 'Assets', icon: Box },
  { kind: 'device', label: 'Devices', icon: Radio },
] as const;
const categories = [['all', 'All trackers'], ['personnel', 'Personnel'], ['asset', 'Assets'], ['device', 'Devices'], ['anchor', 'Anchors (devices)']] as const;
const panControls = [[ 'left', 'Pan left', ArrowLeft ], ['up', 'Pan up', ArrowUp], ['down', 'Pan down', ArrowDown], ['right', 'Pan right', ArrowRight]] as const;
type Selection = { type: 'entity'; id: string } | { type: 'zone'; id: number };
type Kind = TwinEntity['kind'];
type Mode = '2d' | '3d';

class SchematicBoundary extends Component<{ fallback: ReactNode; onFailure: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function observedTime(value?: number | null) {
  return typeof value === 'number' && value > 0 && Number.isFinite(new Date(value).valueOf()) ? value : undefined;
}

function observationAge(value: number) {
  const elapsed = Date.now() - value;
  if (elapsed < 0) return;
  const unit = elapsed >= 86_400_000 ? 'day' : elapsed >= 3_600_000 ? 'hour' : elapsed >= 60_000 ? 'minute' : 'second';
  const divisor = { day: 86_400_000, hour: 3_600_000, minute: 60_000, second: 1000 }[unit];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.floor(elapsed / divisor), unit);
}

export function TwinPage() {
  const { selectedSiteId, selectedSite, theme } = usePlatform();
  const twin = useQuery({
    queryKey: ['twin', selectedSiteId],
    queryFn: () => platformApi.twin(selectedSiteId),
    enabled: selectedSiteId != null,
    refetchInterval: 15_000,
    retry: false,
  });
  const scopeRejected = twin.error instanceof ApiError && [401, 403, 404, 410].includes(twin.error.status);
  const data = !scopeRejected && selectedSiteId != null && twin.data?.site?.id === selectedSiteId ? twin.data : undefined;
  const refresh = () => void twin.refetch();
  return (
    <div className="dt-workspace">
      <div className="dt-heading">
        <div><h1>Digital Twin</h1><p>{selectedSite ? <><strong>{selectedSite.name}</strong><span aria-hidden="true"> · </span>{selectedSite.code}</> : 'Select a site to open its mine plan.'}</p></div>
        {data && <a className="button secondary dt-jump" href="#dt-trackers" onClick={() => document.getElementById('dt-trackers')?.focus({ preventScroll: true })}>View trackers <ArrowDown size={15} /></a>}
      </div>
      {selectedSiteId == null ? <EmptyState title="No site selected" detail="Choose a site to open its Digital Twin." /> :
        data ? <TwinWorkspace key={selectedSiteId} siteId={selectedSiteId} theme={theme} data={data} fetchedAt={twin.dataUpdatedAt}
          delayed={twin.isError || twin.fetchStatus === 'paused'} fetching={twin.fetchStatus !== 'idle'} refresh={refresh} /> :
          twin.isPending ? <LoadingState label="Loading the mine plan and trackers…" /> :
            <ErrorState message="The Digital Twin could not load data for this site." retry={refresh} />}
    </div>
  );
}

function TwinWorkspace({ siteId, theme, data, fetchedAt, delayed, fetching, refresh }: {
  siteId: number; theme: MapTheme; data: TwinData; fetchedAt: number; delayed: boolean; fetching: boolean; refresh: () => void;
}) {
  const [mode, setMode] = useState<Mode>('2d');
  const [stageOverride, setStageOverride] = useState<MapTheme>();
  const [layersOn, setLayersOn] = useState<ReadonlySet<Kind>>(() => new Set(layers.map(layer => layer.kind)));
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [trackerPage, setTrackerPage] = useState(1);
  const [selection, setSelection] = useState<Selection>();
  const [level, setLevel] = useState<number>();
  const [command, setCommand] = useState<MapCommand>();
  const [schematicFailed, setSchematicFailed] = useState(false);
  const inspectorTitle = useRef<HTMLHeadingElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const focusInspector = useRef(false);
  const restoreFocus = useRef<string>();
  const stageTheme = stageOverride ?? theme;

  const zones = useMemo(() => new Map(data.zones.filter(zone => zone.site === siteId).map(zone => [zone.id, zone])), [data.zones, siteId]);
  const zoneCodes = useMemo(() => new Map([...zones.values()].map(zone => [zone.code, zone])), [zones]);
  const geometry = data.layout?.site === siteId ? data.layout.geometry : undefined;
  const features = useMemo(() => mapFeatures(geometry, zones), [geometry, zones]);
  const plan = useMemo(() => indexPlan(features), [features]);
  const activeLevel = plan.levels.some(([id]) => id === level) ? level : undefined;
  const displayed = useMemo(() => activeLevel == null ? features : features.filter(feature => feature.zone?.level === activeLevel), [features, activeLevel]);
  const activePlan = useMemo(() => displayed === features ? plan : indexPlan(displayed), [displayed, features, plan]);
  const mappedZones = useMemo(() => [...activePlan.zoneLabels.values()]
    .flatMap(({ zone }) => zone ? [zone] : [])
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [activePlan.zoneLabels]);

  const trackers = useMemo(() => {
    const byId = new Map<string, TwinEntity>();
    const zoneById = new Map<string, Zone>();
    const byZone = new Map<number, TwinEntity[]>();
    for (const entity of data.entities) {
      if (!entity.id || byId.has(entity.id)) continue;
      byId.set(entity.id, entity);
      if (!hasZoneEvidence(entity)) continue;
      const zone = entity.zone_id != null ? zones.get(entity.zone_id) : zoneCodes.get(entity.zone_code);
      if (!zone) continue;
      zoneById.set(entity.id, zone);
      const inZone = byZone.get(zone.id);
      if (inZone) inZone.push(entity); else byZone.set(zone.id, [entity]);
    }
    return { byId, zoneById, byZone, list: [...byId.values()] };
  }, [data.entities, zones, zoneCodes]);

  const mapped = useMemo(() => {
    const byZone = new Map<number, TwinEntity[]>();
    let count = 0;
    for (const zoneId of activePlan.zoneLabels.keys()) {
      const entries = trackers.byZone.get(zoneId)?.filter(entity => layersOn.has(entity.kind));
      if (entries?.length) {
        byZone.set(zoneId, entries);
        count += entries.length;
      }
    }
    return { byZone, count };
  }, [activePlan.zoneLabels, layersOn, trackers.byZone]);

  const normalized = normalizeQuery(search);
  const results = useMemo(() => trackers.list.filter(entity =>
    matchesCategory(entity, category) && (!normalized ||
      [entity.label, entity.node_id, entity.zone_code, trackers.zoneById.get(entity.id)?.name]
        .some(value => normalizeQuery(value).includes(normalized)))), [category, normalized, trackers]);
  const totalTrackerPages = Math.max(1, Math.ceil(results.length / trackersPerPage));
  const activeTrackerPage = Math.min(trackerPage, totalTrackerPages);
  const trackerOffset = (activeTrackerPage - 1) * trackersPerPage;

  const selected = selection?.type === 'entity' ? trackers.byId.get(selection.id) : undefined;
  const zone = selected ? trackers.zoneById.get(selected.id) : selection?.type === 'zone' ? zones.get(selection.id) : undefined;
  const detailOpen = Boolean(selection);
  const hasGeometry = zone != null && plan.zoneLabels.has(zone.id);
  const mapLevelHidden = hasGeometry && !activePlan.zoneLabels.has(zone.id);
  const mapLayerHidden = selected != null && !layersOn.has(selected.kind);
  const filterHidden = selected != null && !results.includes(selected);
  const selectedZone = hasGeometry && !mapLayerHidden && !mapLevelHidden ? zone.id : undefined;

  useEffect(() => {
    if (focusInspector.current) {
      inspectorTitle.current?.focus();
      focusInspector.current = false;
    }
  }, [selection]);

  useEffect(() => {
    if (trackerPage !== activeTrackerPage) setTrackerPage(activeTrackerPage);
  }, [activeTrackerPage, trackerPage]);

  const inspectZone = useCallback((next: Zone, focus = true) => {
    restoreFocus.current = 'dt-fit';
    focusInspector.current = focus;
    setSelection({ type: 'zone', id: next.id });
  }, []);

  function inspectEntity(entity: TwinEntity, fromList: boolean) {
    if (fromList) restoreFocus.current = `dt-entry-${encodeURIComponent(entity.id)}`;
    focusInspector.current = true;
    setSelection({ type: 'entity', id: entity.id });
    const location = trackers.zoneById.get(entity.id);
    if (location && activePlan.zoneLabels.has(location.id) && layersOn.has(entity.kind)) {
      setCommand({ action: 'locate', zone: location.id });
    }
  }

  function closeDetail() {
    setSelection(undefined);
    requestAnimationFrame(() => (restoreFocus.current && document.getElementById(restoreFocus.current) || listTitle.current)?.focus());
  }

  function clearFilters() {
    updateSearch('');
    setCategory('all');
  }

  function updateSearch(value: string) {
    setSearch(value);
    setTrackerPage(1);
  }

  function toggleLayer(kind: Kind) {
    setLayersOn(current => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setCommand(undefined);
    setSchematicFailed(false);
    setMode(next);
  }

  function changeLevel(next?: number) {
    setCommand(undefined);
    setLevel(next);
  }

  const onSchematicFailure = useCallback(() => setSchematicFailed(true), []);
  const returnToPlan = () => {
    switchMode('2d');
    requestAnimationFrame(() => document.getElementById('dt-mode-plan')?.focus());
  };
  const fallback = <EmptyState title="3D view unavailable" detail="This browser could not render the schematic. Your tracker selection is still available."
    action={<button type="button" className="button secondary" onClick={returnToPlan}>Return to 2D plan</button>} />;
  const visual = activePlan.frame && {
    features: displayed, frame: activePlan.frame, zoneLabels: activePlan.zoneLabels,
    visibleByZone: mapped.byZone, selectedZone, selectedEvidence: selected?.evidence, onSelectZone: inspectZone,
  };
  const members = zone ? trackers.byZone.get(zone.id) ?? [] : [];
  const timestamp = observedTime(selected?.observed_at);

  function mapControl(action: MapAction, label: string, Icon: typeof ArrowLeft, id?: string) {
    return <button key={action} type="button" id={id} className="dt-map-button" title={label} aria-label={label}
      disabled={!visual || (mode === '3d' && schematicFailed)} onClick={() => setCommand({ action })}>
      <Icon size={17} />{action === 'fit' && <span>{label}</span>}
    </button>;
  }

  return (
    <>
      <div className="dt-retrieval">
        <div><span className="dt-retrieved"><Radio size={14} /> Data retrieved <time dateTime={new Date(fetchedAt).toISOString()}>{formatTimestamp(fetchedAt)}</time></span>
          {delayed && <span className="dt-delay" role="status">Updates delayed · showing the last successful data</span>}
        </div>
        <button type="button" className="button secondary dt-refresh" aria-label={delayed ? 'Retry Digital Twin' : 'Refresh Digital Twin'}
          onClick={refresh} disabled={fetching}><RefreshCw size={15} />{delayed ? 'Retry' : 'Refresh'}</button>
      </div>
      <div className="dt-grid">
        <section className="dt-map-panel panel" aria-labelledby="dt-plan-title">
          <div className="dt-toolbar">
            <div className="dt-toolbar-row">
              <div className="dt-modes" role="group" aria-label="Map view">
                <button id="dt-mode-plan" type="button" aria-pressed={mode === '2d'} onClick={() => switchMode('2d')}><MapIcon size={16} /> 2D Plan</button>
                <button type="button" aria-pressed={mode === '3d'} onClick={() => switchMode('3d')}><Layers3 size={16} /> 3D Schematic</button>
              </div>
              <label className="dt-select-label">Stage theme
                <select value={stageOverride ?? 'app'} onChange={event => setStageOverride(event.target.value === 'app' ? undefined : event.target.value as MapTheme)}>
                  <option value="app">App theme</option><option value="dark">Dark</option><option value="light">Light</option>
                </select>
              </label>
            </div>
            <div className="dt-toolbar-row dt-layer-row">
              <div className="dt-layer-controls" role="group" aria-label="Map visibility">
                <span className="dt-control-label">Map layers</span>
                {layers.map(({ kind, label, icon: Icon }) => (
                  <button type="button" key={kind} aria-pressed={layersOn.has(kind)} onClick={() => toggleLayer(kind)}><Icon size={15} /> {label}</button>
                ))}
              </div>
              {plan.levels.length > 0 && <label className="dt-select-label">Map level
                <select value={activeLevel ?? 'all'} onChange={event => changeLevel(event.target.value === 'all' ? undefined : Number(event.target.value))}>
                  <option value="all">All plan features</option>
                  {plan.levels.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>}
            </div>
          </div>
          <div className="dt-stage" data-stage-theme={stageTheme} data-mode={mode}>
            <div className="dt-stage-heading">
              <div><h2 id="dt-plan-title">{mode === '2d' ? 'Mine plan' : 'Mine schematic'}</h2>
                <p>{activeLevel != null ? plan.levels.find(([id]) => id === activeLevel)?.[1] : data.layout?.version ? `Layout version ${data.layout.version}` : 'Site layout'}</p>
              </div>
              <span className="dt-map-total">{mapped.count} mapped {mapped.count === 1 ? 'tracker' : 'trackers'}</span>
            </div>
            <div className="dt-viewport">
              {!visual ? <EmptyState title="No usable mine plan" detail="The tracker list still shows this site’s reported location evidence." /> :
                mode === '2d' ? <PlanMap key={activeLevel ?? 'all'} visual={visual} command={command} /> :
                schematicFailed ? fallback :
                  <SchematicBoundary key={activeLevel ?? 'all'} fallback={fallback} onFailure={onSchematicFailure}>
                    <Suspense fallback={<LoadingState label="Opening the schematic…" />}>
                      <SchematicMap visual={visual} command={command} theme={stageTheme} onFailure={onSchematicFailure} fallback={fallback} />
                    </Suspense>
                  </SchematicBoundary>}
            </div>
            <div className="dt-stage-controls" role="group" aria-label="Map navigation">
              <div className="dt-map-control-group">{mapControl('fit', mode === '2d' ? 'Fit to view' : 'Reset view', Focus, 'dt-fit')}</div>
              <div className="dt-map-control-group">{mapControl('out', 'Zoom out', Minus)}{mapControl('in', 'Zoom in', Plus)}</div>
              <div className="dt-map-control-group" role="group" aria-label="Pan map">
                {panControls.map(([action, label, Icon]) => mapControl(action, label, Icon))}
              </div>
              {mode === '3d' && <div className="dt-map-control-group" role="group" aria-label="Orbit schematic">
                {mapControl('orbit-left', 'Rotate left', RotateCcw)}{mapControl('orbit-right', 'Rotate right', RotateCw)}
              </div>}
            </div>
          </div>
          <div className="dt-map-key">
            <span><i className="dt-key-swatch" /> Mine geometry</span>
            <span><i className="dt-key-swatch zone" /> Managed zone</span>
            <span><i className="dt-key-swatch uncertain" /> Last-known or uncertain</span>
            <span className="dt-map-note">{mode === '3d' ? 'Schematic thickness has no surveyed scale.' : 'Number badges count trackers by zone.'}</span>
            {mappedZones.length > 0 && <label className="dt-select-label dt-zone-picker">Inspect mapped zone
              <select id="dt-zone-picker" value={zone && activePlan.zoneLabels.has(zone.id) ? zone.id : ''}
                onChange={event => {
                  const next = zones.get(Number(event.target.value));
                  if (!next) return;
                  inspectZone(next);
                  restoreFocus.current = 'dt-zone-picker';
                  setCommand({ action: 'locate', zone: next.id });
                }}>
                <option value="" disabled>Choose zone</option>
                {mappedZones.map(option => <option key={option.id} value={option.id}>{option.name} · {option.code}</option>)}
              </select>
            </label>}
          </div>
          <div className="dt-topology">
            <Network size={18} />
            <div><strong>Network topology unavailable</strong><p>{data.topology_status === 'UNAVAILABLE_PENDING_VALIDATED_DIRECT_LINK_EVIDENCE'
              ? 'Direct wireless links have yet to be validated.' : 'This response has no supported direct wireless link evidence.'}</p></div>
          </div>
        </section>

        <aside className="dt-inspector panel" id="dt-trackers" aria-label="Tracker inspector" tabIndex={-1}>
          {detailOpen ? (
            <>
              <div className="dt-detail-bar">
                <button type="button" className="dt-quiet" onClick={closeDetail}><ArrowLeft size={16} /> All trackers</button>
                <button type="button" className="dt-square" aria-label="Close details" onClick={closeDetail}><X size={17} /></button>
              </div>
              <div className="dt-detail">
                <h2 ref={inspectorTitle} tabIndex={-1}>{selected ? entityName(selected) : zone?.name ?? 'Selection unavailable'}</h2>
                {selected ? (
                  <>
                    <div className="dt-identity"><span>{selected.node_id}</span>{selected.status && <NodeStatusPill status={selected.status} />}</div>
                    <dl className="dt-fields">
                      <div><dt>Tracker type</dt><dd>{layers.find(layer => layer.kind === selected.kind)?.label} · {selected.role === 'ANCHOR' ? 'Anchor' : selected.role === 'GATEWAY' ? 'Gateway' : 'Wearable'}</dd></div>
                      <div><dt>Location evidence</dt><dd><LocationLabel evidence={selected.evidence} zone={zone?.code ?? (hasZoneEvidence(selected) ? selected.zone_code : undefined)} /></dd></div>
                      {zone && <div><dt>Managed zone</dt><dd>{zone.name}{zone.level_name ? ` · ${zone.level_name}` : ''}</dd></div>}
                      <div><dt>Location observed</dt><dd>{timestamp ? <><time dateTime={new Date(timestamp).toISOString()}>{formatTimestamp(timestamp)}</time><small>{observationAge(timestamp)}</small></> : 'Timestamp unavailable'}</dd></div>
                    </dl>
                    {!hasZoneEvidence(selected) ? <p className="dt-context">Location unknown. This tracker has no zone to highlight.</p> :
                      !hasGeometry ? <p className="dt-context">The reported zone has no matching geometry in this plan.</p> : null}
                    {filterHidden && <div className="dt-reveal">This tracker is outside the current list filters. <button type="button" className="dt-quiet" onClick={clearFilters}>Clear list filters</button></div>}
                    <div className="dt-detail-actions">
                      {hasGeometry && (mapLevelHidden || mapLayerHidden) && <button type="button" className="button secondary"
                        onClick={() => {
                          if (mapLayerHidden) setLayersOn(current => new Set([...current, selected.kind]));
                          if (mapLevelHidden) changeLevel(zone.level ?? undefined);
                          else setCommand({ action: 'locate', zone: zone.id });
                        }}><LocateFixed size={16} /> Reveal on map</button>}
                      {selectedZone != null && <button type="button" className="button secondary"
                        onClick={() => { setCommand({ action: 'locate', zone: selectedZone }); document.getElementById('dt-fit')?.focus(); }}><LocateFixed size={16} /> Locate zone</button>}
                      <Link className="button secondary" to={`/devices/${encodeURIComponent(selected.node_id)}`}>Device diagnostics <ArrowRight size={16} /></Link>
                    </div>
                  </>
                ) : zone ? (
                  <>
                    <p className="dt-context">{zone.code}{zone.level_name ? ` · ${zone.level_name}` : ''}</p>
                    <p>Map evidence is shown at zone level.</p>
                    {mapLevelHidden && <button type="button" className="button secondary" onClick={() => changeLevel(zone.level ?? undefined)}>Reveal zone on map</button>}
                  </>
                ) : <p className="dt-context">The latest site data no longer includes this selection.</p>}
                {zone && (!selected || selected.role === 'ANCHOR') && <ZoneTrackers key={selected?.id ?? zone.id}
                  members={members.filter(entity => entity.id !== selected?.id)}
                  onSelect={entity => inspectEntity(entity, false)} />}
              </div>
            </>
          ) : (
            <>
              <div className="dt-inspector-title">
                <h2 ref={listTitle} tabIndex={-1}>Trackers</h2>
                <span>{trackers.list.length} at this site</span>
              </div>
              <div className="dt-list-controls">
                <label htmlFor="dt-search">Search trackers</label>
                <div className="dt-search">
                  <Search size={16} />
                  <input id="dt-search" type="search" placeholder="Name, node ID, or zone" value={search} onChange={event => updateSearch(event.target.value)} />
                  {search && <button type="button" className="dt-square" aria-label="Clear tracker search" onClick={() => { updateSearch(''); document.getElementById('dt-search')?.focus(); }}><X size={16} /></button>}
                </div>
                <label className="dt-list-category"><span>Tracker type</span><span className="dt-select-wrap"><select value={category} onChange={e => { setCategory(e.target.value as Category); setTrackerPage(1); }}>
                  {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select><ChevronDown size={15} /></span></label>
              </div>
              <div className="dt-results">
                <p role={totalTrackerPages > 1 ? 'status' : undefined}>
                  {totalTrackerPages > 1 ? `${trackerOffset + 1}–${Math.min(trackerOffset + trackersPerPage, results.length)} of ` : ''}
                  {results.length} {results.length === 1 ? 'result' : 'results'}
                </p>
                {results.length > 0 ? <ul className="dt-tracker-list">{results.slice(trackerOffset, trackerOffset + trackersPerPage).map(entity => (
                  <li key={entity.id}><TrackerRow entity={entity} id={`dt-entry-${encodeURIComponent(entity.id)}`} onSelect={() => inspectEntity(entity, true)} /></li>
                ))}</ul> : trackers.list.length === 0 ? <p className="dt-list-empty">No trackers are reported for this site.</p> :
                  <div className="dt-list-empty"><strong>No trackers match your filters.</strong><button type="button" className="dt-quiet" onClick={clearFilters}>Clear list filters</button></div>}
                <TrackerPagination label="Tracker pages" page={activeTrackerPage} totalPages={totalTrackerPages} onPageChange={setTrackerPage} />
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function TrackerPagination({ label, page, totalPages, onPageChange }: {
  label: string; page: number; totalPages: number; onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="dt-pagination" aria-label={label}>
      <Pagination variant="compact" currentPage={page} totalPages={totalPages}
        onPageChange={onPageChange} enableKeyboardNavigation={false} />
    </nav>
  );
}

function ZoneTrackers({ members, onSelect }: { members: TwinEntity[]; onSelect: (entity: TwinEntity) => void }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(members.length / trackersPerPage));
  const activePage = Math.min(page, totalPages);
  const offset = (activePage - 1) * trackersPerPage;
  useEffect(() => {
    if (page !== activePage) setPage(activePage);
  }, [activePage, page]);
  return (
    <div className="dt-related">
      <h3>Trackers reported in this zone</h3>
      {members.length ? <ul className="dt-tracker-list">
        {members.slice(offset, offset + trackersPerPage).map(entity => (
          <li key={entity.id}><TrackerRow entity={entity} onSelect={() => onSelect(entity)} /></li>
        ))}
      </ul> : <p className="dt-context">No other trackers are reported in this zone.</p>}
      <TrackerPagination label="Trackers in zone pages" page={activePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

function TrackerRow({ entity, id, onSelect }: { entity: TwinEntity; id?: string; onSelect: () => void }) {
  const Icon = layers.find(layer => layer.kind === entity.kind)?.icon ?? Radio;
  return (
    <button type="button" className="dt-tracker" id={id} onClick={onSelect}>
      <span className="dt-tracker-icon"><Icon size={18} /></span>
      <span className="dt-tracker-copy">
        <strong>{entityName(entity)}</strong>
        <span>{entity.node_id}{entity.kind === 'device' && entity.role === 'ANCHOR' ? ' · Anchor' : ''}</span>
        <LocationLabel evidence={entity.evidence} zone={hasZoneEvidence(entity) ? entity.zone_code : undefined} />
      </span>
      <ArrowRight size={15} className="dt-tracker-arrow" />
    </button>
  );
}
