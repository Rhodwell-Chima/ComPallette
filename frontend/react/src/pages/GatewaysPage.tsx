import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, platformApi } from '../services/api';
import { usePlatform } from '../platform/PlatformContext';
import { PageHeader, LoadingState, ErrorState } from '../platform/ui';
import { Link } from 'react-router-dom';

export function GatewaysPage() {
  const { selectedSiteId } = usePlatform();
  return <GatewaysContent key={selectedSiteId ?? 'none'} />;
}

function GatewaysContent() {
  const { selectedSiteId, can } = usePlatform();
  const client = useQueryClient();
  const [nodeId, setNodeId] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [discoveryId, setDiscoveryId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [role, setRole] = useState('WEARABLE');
  const [zoneId, setZoneId] = useState('');
  const [diagnosticNode, setDiagnosticNode] = useState('');
  const [diagnosticGateway, setDiagnosticGateway] = useState('');
  const [retry, setRetry] = useState<{ type: 'gateway' | 'command'; data: Record<string, unknown> }>();
  const zones = useQuery({ queryKey: ['zones', selectedSiteId], queryFn: () => platformApi.zones(selectedSiteId!), enabled: !!selectedSiteId && can('manage_devices') });
  const [message, setMessage] = useState('');
  const records = useQuery({ queryKey: ['gateways', selectedSiteId], queryFn: () => platformApi.gateways(selectedSiteId!), enabled: !!selectedSiteId && can('manage_devices'), refetchInterval: 5000 });
  const mutation = useMutation({ mutationFn: async (input: { type: 'gateway' | 'command'; data: Record<string, unknown> }) => {
    return input.type === 'gateway' ? platformApi.gatewayAction(input.data) : platformApi.command(input.data);
  }, onSuccess: async result => {
    setRetry(undefined);
    setMessage('command_id' in result ? `Command ${result.command_id}: ${result.state}.${['QUEUED', 'SENT', 'GATEWAY_RECEIVED'].includes(result.state) ? ' Awaiting device confirmation.' : ''}` : result.notice ?? 'Gateway record saved.');
    await client.invalidateQueries({ queryKey: ['gateways'] });
    await client.invalidateQueries({ queryKey: ['devices'] });
  }, onError: async (error: Error, input) => {
    const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
    setMessage(rejected ? `Request rejected: ${error.message}` : 'Outcome not confirmed. Server state is being refreshed.');
    setRetry(!rejected ? input : undefined);
    await records.refetch();
  } });
  if (!can('manage_devices')) return <p>Device-management access is required.</p>;
  if (records.isLoading) return <LoadingState label="Loading gateways…" />;
  if (!records.data || records.isError) return <ErrorState message="Gateways could not be loaded." retry={() => void records.refetch()} />;
  const discovery = records.data.discoveries.find(d => String(d.id) === discoveryId);
  return <>
    <PageHeader eyebrow="INFRASTRUCTURE" title="Gateways and commissioning" description="Registered site gateways, discovered hardware and confirmed device commands." />
    {message && <p role="status">{message}</p>}
    {retry && <button className="button" disabled={mutation.isPending || records.isFetching} onClick={() => mutation.mutate(retry)}>Retry same request</button>}
    <section className="panel" style={{ padding: '1rem' }}><h2>Register a gateway</h2>
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ type: 'gateway', data: { operation_id: crypto.randomUUID(), site: selectedSiteId, node_id: nodeId, hardware_id: hardwareId } }); }}>
        <label>Gateway ID <input required maxLength={23} value={nodeId} onChange={e => setNodeId(e.target.value)} /></label>{' '}
        <label>Hardware ID <input required maxLength={32} value={hardwareId} onChange={e => setHardwareId(e.target.value)} /></label>{' '}
        <button className="button primary" disabled={mutation.isPending || !!retry}>Register</button>
      </form>
      {records.data.gateways.map(g => <p key={g.id}><Link to={`/devices/${g.node_id}`}>{g.node_id}</Link> · {!g.active ? 'Revoked' : g.credentials_installed ? 'Credentials installed' : 'Awaiting local credential installation'} · credential version {g.credential_version}{' '}
        <button className="button" disabled={mutation.isPending || !!retry || !g.active} onClick={() => mutation.mutate({ type: 'gateway', data: { operation_id: crypto.randomUUID(), expected_version: g.credential_version, site: selectedSiteId, gateway_id: g.id, action: 'rotate' } })}>Rotate credential</button>{' '}
        <button className="button" disabled={mutation.isPending || !!retry || !g.active} onClick={() => mutation.mutate({ type: 'gateway', data: { operation_id: crypto.randomUUID(), expected_version: g.credential_version, site: selectedSiteId, gateway_id: g.id, action: 'revoke' } })}>Revoke</button>
      </p>)}
    </section>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>Commission discovered hardware</h2>
      <form onSubmit={e => { e.preventDefault(); if (discovery) mutation.mutate({ type: 'command', data: { operation_id: crypto.randomUUID(), gateway_id: discovery.gateway_id, discovery_id: discovery.id, node_id: targetId, kind: 'PROVISION', role, expected_version: discovery.version, zone_id: zoneId ? Number(zoneId) : null } }); }}>
        <label>Discovery <select required value={discoveryId} onChange={e => setDiscoveryId(e.target.value)}><option value="">Select hardware</option>{records.data.discoveries.map(d => <option key={d.id} value={d.id}>{d.hardware_id} · gateway #{d.gateway_id}</option>)}</select></label>{' '}
        <label>New device ID <input required maxLength={23} value={targetId} onChange={e => setTargetId(e.target.value)} /></label>{' '}
        <label>Role <select value={role} onChange={e => setRole(e.target.value)}><option value="WEARABLE">Tracking device</option><option value="ANCHOR">Fixed anchor</option></select></label>{' '}
        {role === 'ANCHOR' && <label>Installation zone <select required value={zoneId} onChange={e => setZoneId(e.target.value)}><option value="">Select a zone</option>{zones.data?.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>}
        <button className="button primary" disabled={mutation.isPending || !!retry || !discovery || !records.data.gateways.some(g => g.id === discovery.gateway_id && g.active && g.credentials_installed)}>Queue provisioning</button>
      </form>
    </section>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>Device diagnostics</h2>
      <form onSubmit={e => { e.preventDefault(); const device = records.data.devices.find(d => d.node_id === diagnosticNode); if (device) mutation.mutate({ type: 'command', data: { operation_id: crypto.randomUUID(), gateway_id: Number(diagnosticGateway), kind: 'DIAGNOSTIC', node_id: device.node_id, expected_version: device.version } }); }}>
        <label>Gateway <select required value={diagnosticGateway} onChange={e => setDiagnosticGateway(e.target.value)}><option value="">Select gateway</option>{records.data.gateways.filter(g => g.active && g.credentials_installed).map(g => <option key={g.id} value={g.id}>{g.node_id}</option>)}</select></label>
        <label>Device <select required value={diagnosticNode} onChange={e => setDiagnosticNode(e.target.value)}><option value="">Select device</option>{records.data.devices.map(d => <option key={d.node_id} value={d.node_id}>{d.node_id}</option>)}</select></label>
        <button className="button primary" disabled={mutation.isPending || !!retry}>Request status</button>
      </form><p>Diagnostics expire after 30 seconds. A timeout does not establish device health.</p>
    </section>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>Command history</h2><p>Sent does not mean executed. Expired means execution was not confirmed before the deadline.</p>{records.data.commands.map(c => <p key={c.id}>{c.kind} · <Link to={`/devices/${c.node_id}`}>{c.node_id}</Link> · {c.state} · expires {new Date(c.expires_at).toLocaleString()}</p>)}</section>
  </>;
}
