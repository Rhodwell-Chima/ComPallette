import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BatteryMedium, Gauge, RadioTower, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { platformApi } from '../services/api';
import { MeasurementReading } from '../types';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, LocationLabel, NodeStatusPill, PageHeader, StatusPill, formatTimestamp } from '../platform/ui';
import { Pagination } from '../platform/pagination';
import { SkeletonCard, SkeletonTable } from '../platform/loading';
import { StaggerContainer, StaggerItem } from '../platform/feed';

function formatMeasurementValue(value: number, unit: string) {
  if (unit === 'Pa') {
    return `${(value / 100).toFixed(1)} hPa`;
  }
  if (unit === 'Ω') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} kΩ` : `${value} Ω`;
  }
  return `${value} ${unit}`;
}

function Trend({ readings, unit }: { readings: MeasurementReading[]; unit: string }) {
  const points = [...readings].reverse();
  if (points.length < 2) return <p className="muted" style={{ padding: '1rem 0' }}>At least two reported values are required to draw a trend.</p>;
  const values = points.map(item => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinate = (value: number, index: number) =>
    `${(index / (points.length - 1)) * 100},${94 - ((value - min) / range) * 82}`;

  return (
    <div
      className="trend-container"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '12px',
        height: '160px',
        margin: '0 18px 24px',
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        background: 'var(--surface-muted)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '0.72rem', fontWeight: 600 }}>
        <span>{max.toFixed(1)} {unit}</span>
        <span>{min.toFixed(1)} {unit}</span>
      </div>
      <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Trend from ${points.length} confirmed readings`}
          style={{ width: '100%', height: '100%', display: 'block' }}
        >
          <polyline
            fill="none"
            stroke="var(--primary, #1666d9)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={values.map(coordinate).join(' ')}
          />
        </svg>
      </div>
    </div>
  );
}

export function EnvironmentalPage() {
  const { selectedSiteId } = usePlatform();
  return <EnvironmentalSitePage key={selectedSiteId ?? 'none'} />;
}

function EnvironmentalSitePage() {
  const { selectedSiteId } = usePlatform();
  const [channel, setChannel] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // 1. Channel Catalog Pagination
  const [catalogPage, setCatalogPage] = useState(1);
  const CATALOG_PAGE_SIZE = 8;

  // Lightweight Channel Snapshot Query
  const environmentOverview = useQuery({
    queryKey: ['environment-overview', selectedSiteId],
    queryFn: () => platformApi.environment(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    staleTime: 30_000,
  });

  const allChannels = environmentOverview.data?.channels ?? [];
  const selectedChannelKey = channel ?? allChannels[0]?.key;
  const currentChannelMeta = allChannels.find(c => c.key === selectedChannelKey);

  // Paginate channel catalog list
  const totalCatalogPages = Math.max(1, Math.ceil(allChannels.length / CATALOG_PAGE_SIZE));
  const displayedChannels = allChannels.slice(
    (catalogPage - 1) * CATALOG_PAGE_SIZE,
    catalogPage * CATALOG_PAGE_SIZE
  );

  // 2. Paginated Channel Readings Query
  const readingsQuery = useQuery({
    queryKey: ['environment-readings', selectedSiteId, selectedChannelKey, page, pageSize],
    queryFn: () => platformApi.readings(selectedSiteId, selectedChannelKey, { page, page_size: pageSize }),
    enabled: Boolean(selectedSiteId && selectedChannelKey),
    staleTime: 15_000,
  });

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a site to inspect its confirmed environmental channels." />;
  if (environmentOverview.isLoading) return <LoadingState label="Loading environmental channels…" />;
  if (environmentOverview.isError || !environmentOverview.data) {
    return <ErrorState message="Environmental channels could not be loaded." retry={() => void environmentOverview.refetch()} />;
  }

  const readings = readingsQuery.data?.readings ?? [];
  const totalReadings = readingsQuery.data?.total ?? 0;
  const totalPages = readingsQuery.data?.total_pages ?? 1;

  return (
    <>
      <PageHeader
        eyebrow="OPERATIONS & ATMOSPHERE"
        title="Environmental monitoring"
        description="Atmospheric telemetry, gas thresholds and freshness indicators streamed from persisted sensor telemetry. High-volume channels are server-paginated."
      />

      <section className="environment-layout">
        {/* Left Side: Channel Catalogue */}
        <article className="panel channel-catalog" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CHANNEL CATALOGUE</p>
              <h2>{allChannels.length} sensor streams</h2>
            </div>
            <Activity size={19} />
          </div>

          {allChannels.length ? (
            <>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <StaggerContainer delay={0.03}>
                  {displayedChannels.map((item) => (
                    <StaggerItem key={item.key} variant="down">
                      <button
                        type="button"
                        className={`channel-card ${selectedChannelKey === item.key ? 'selected' : ''}`}
                        onClick={() => {
                          setChannel(item.key);
                          setPage(1);
                        }}
                      >
                        <div>
                          <strong>{item.display_name}</strong>
                          <small>{item.node_id} &middot; {item.zone || 'No zone'}</small>
                        </div>
                        <b>{formatMeasurementValue(item.latest_value, item.unit)}</b>
                        <span>{item.sensor_ok ? 'Sensor reporting' : 'Sensor health unconfirmed'}</span>
                      </button>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>

              {/* Compact Pagination for the Channel Catalogue */}
              {totalCatalogPages > 1 && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                  <Pagination
                    variant="compact"
                    currentPage={catalogPage}
                    totalPages={totalCatalogPages}
                    onPageChange={(p) => setCatalogPage(p)}
                  />
                </div>
              )}
            </>
          ) : (
            <EmptyState title="No supported sensor channels" detail="Atmospheric telemetry appears here after the backend receives node readings." />
          )}
        </article>

        {/* Right Side: Channel Detail, Trend & Paginated Historical Readings */}
        <article className="panel environment-detail" style={{ minHeight: '520px' }}>
          {selectedChannelKey ? (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">CONFIRMED TREND</p>
                  <h2>{currentChannelMeta?.display_name ?? selectedChannelKey}</h2>
                </div>
                <Gauge size={19} />
              </div>

              {/* Trend visualizer in fixed-height bounded container to prevent overlap */}
              {readingsQuery.data && <Trend readings={readings} unit={currentChannelMeta?.unit ?? ''} />}
              {readingsQuery.isError && <div role="alert">
                <ErrorState message={readingsQuery.data ? 'Refresh failed—showing previously loaded readings.' : 'Readings could not be loaded.'} retry={() => void readingsQuery.refetch()} />
                {readingsQuery.data && <p className="muted">Last successful fetch: {formatTimestamp(readingsQuery.dataUpdatedAt)}</p>}
              </div>}

              {/* Paginated Historical Readings Table */}
              <div style={{ padding: '0 18px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <strong style={{ fontSize: '0.88rem' }}>Telemetry Ingestion Log</strong>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    {readingsQuery.data ? `${totalReadings} total recorded readings` : readingsQuery.isLoading ? 'Loading readings…' : 'Reading count unavailable'}
                  </span>
                </div>

                {readingsQuery.isLoading ? (
                  <SkeletonTable rows={5} columns={[140, 100, 100, 80]} />
                ) : !readingsQuery.data ? null : readings.length === 0 ? (
                  <EmptyState title={readingsQuery.isError ? "Previously loaded history was empty" : "No readings recorded"} detail={readingsQuery.isError ? "Current history is unavailable until a refresh succeeds." : "No timestamped records found for this channel."} />
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Reported At</th>
                          <th>Device Node</th>
                          <th>Facility Zone</th>
                          <th>Measurement</th>
                        </tr>
                      </thead>
                      <tbody>
                        {readings.map((reading) => (
                          <tr key={reading.id}>
                            <td>{formatTimestamp(reading.received_at)}</td>
                            <td><strong>{reading.node_id}</strong></td>
                            <td>{reading.zone || 'Unassigned'}</td>
                            <td><b>{formatMeasurementValue(reading.value, reading.unit)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Standardized Numeric Pagination */}
                {readingsQuery.data && <Pagination
                  currentPage={page}
                  totalPages={totalPages}
                  totalItems={totalReadings}
                  pageSize={pageSize}
                  onPageChange={(p) => setPage(p)}
                  onPageSizeChange={(ps) => {
                    setPageSize(ps);
                    setPage(1);
                  }}
                  pageSizeOptions={[10, 25, 50, 100]}
                />}
              </div>
            </>
          ) : (
            <EmptyState title="Choose a channel" detail="Select a measurement to inspect its actual reported history." />
          )}
        </article>
      </section>
    </>
  );
}

export function DevicesPage() {
  const { selectedSiteId } = usePlatform();
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const devices = useQuery({
    queryKey: ['devices', selectedSiteId, filter],
    queryFn: () => platformApi.devices(selectedSiteId, filter === 'ALL' ? undefined : filter),
    enabled: Boolean(selectedSiteId),
    refetchInterval: 15_000,
  });

  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a site to inspect its registered devices." />;
  if (devices.isLoading) return <LoadingState label="Loading device registry…" />;
  if (devices.isError || !devices.data) return <ErrorState message="Devices could not be loaded." retry={() => void devices.refetch()} />;

  const allNodes = devices.data.nodes || [];
  const totalNodes = allNodes.length;
  const totalPages = Math.max(1, Math.ceil(totalNodes / pageSize));
  const paginatedNodes = allNodes.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <PageHeader
        eyebrow="INFRASTRUCTURE"
        title="Devices & network"
        description="A unified registry for reporting wearables, anchors, gateways and environmental nodes. Health values shown here are persisted backend values only."
      />
      <div className="segmented" aria-label="Device status filter">
        {['ALL', 'ONLINE', 'STALE', 'OFFLINE'].map((status) => (
          <button
            className={filter === status ? 'active' : ''}
            key={status}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
          >
            {status}
          </button>
        ))}
      </div>
      <section className="panel registry-panel">
        <div className="panel-toolbar">
          <span>{totalNodes} devices</span>
          <span className="muted">
            <RadioTower size={14} /> Direct mesh topology is not displayed until validated backend link evidence exists.
          </span>
        </div>
        {totalNodes > 0 ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Type</th>
                    <th>Health</th>
                    <th>Battery</th>
                    <th>Location evidence</th>
                    <th>Sensor state</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedNodes.map((node) => (
                    <tr key={node.node_id}>
                      <td>
                        <strong><Link to={`/devices/${encodeURIComponent(node.node_id)}`}>{node.node_id}</Link></strong>
                        <small>{node.assigned_person || node.assigned_asset || 'Unassigned hardware'}</small>
                      </td>
                      <td>{node.role}</td>
                      <td><NodeStatusPill status={node.status} /></td>
                      <td>
                        <span className="battery">
                          <BatteryMedium size={15} /> {node.battery_v ? `${node.battery_v.toFixed(2)} V` : 'Not reported'}
                        </span>
                      </td>
                      <td><LocationLabel evidence={node.location_evidence} zone={node.current_zone} /></td>
                      <td>
                        <StatusPill
                          value={node.sensor_ok ? 'SENSOR OK' : 'SENSOR UNCONFIRMED'}
                          tone={node.sensor_ok ? 'success' : 'warning'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination for Devices */}
            <div style={{ padding: '0 18px 18px' }}>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={totalNodes}
                pageSize={pageSize}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(ps) => {
                  setPageSize(ps);
                  setPage(1);
                }}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            </div>
          </>
        ) : (
          <EmptyState title="No devices match this status" detail="Device state is supplied by the Django system of record." />
        )}
      </section>
    </>
  );
}
