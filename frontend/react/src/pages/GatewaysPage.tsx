import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '../services/api';
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
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const records = useQuery({ queryKey: ['gateways', selectedSiteId], queryFn: () => platformApi.gateways(selectedSiteId!), enabled: !!selectedSiteId && can('manage_devices'), refetchInterval: 5000 });
  const mutation = useMutation({ mutationFn: async (input: { type: 'gateway' | 'command'; data: Record<string, unknown> }) => {
    return input.type === 'gateway' ? platformApi.gatewayAction(input.data) : platformApi.command(input.data);
  }, onSuccess: async (result: any) => {
    setSecret(result.credential ?? ''); setMessage(result.command_id ? `Command ${result.command_id}: ${result.state}. Awaiting device confirmation.` : 'Gateway record saved.');
    await client.invalidateQueries({ queryKey: ['gateways'] });
    await client.invalidateQueries({ queryKey: ['devices'] });
  }, onError: (error: Error) => setMessage(`Outcome not confirmed: ${error.message}. Refresh before retrying.`) });
  if (!can('manage_devices')) return <p>Device-management access is required.</p>;
  if (records.isLoading) return <LoadingState label="Loading gateways…" />;
  if (!records.data || records.isError) return <ErrorState message="Gateways could not be loaded." retry={() => void records.refetch()} />;
  const discovery = records.data.discoveries.find(d => String(d.id) === discoveryId);
  return <>
    <PageHeader eyebrow="INFRASTRUCTURE" title="Gateways and commissioning" description="Registered site gateways, discovered hardware and confirmed device commands." />
    {message && <p role="status">{message}</p>}
    {secret && <section className="panel" style={{ padding: '1rem' }}><h2>New gateway credential</h2><p>Shown once. Store securely and configure both the gateway and broker. Broker credential installation is a separate deployment step.</p><code style={{ overflowWrap: 'anywhere' }}>{secret}</code><button className="button" onClick={() => setSecret('')}>Hide credential</button></section>}
    <section className="panel" style={{ padding: '1rem' }}><h2>Register a gateway</h2>
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ type: 'gateway', data: { site: selectedSiteId, node_id: nodeId, hardware_id: hardwareId } }); }}>
        <label>Gateway ID <input required maxLength={23} value={nodeId} onChange={e => setNodeId(e.target.value)} /></label>{' '}
        <label>Hardware ID <input required maxLength={32} value={hardwareId} onChange={e => setHardwareId(e.target.value)} /></label>{' '}
        <button className="button primary" disabled={mutation.isPending}>Register</button>
      </form>
      {records.data.gateways.map(g => <p key={g.id}><Link to={`/devices/${g.node_id}`}>{g.node_id}</Link> · {g.active ? 'Enabled' : 'Revoked'} · credential version {g.credential_version}{' '}
        <button className="button" disabled={mutation.isPending || !g.active} onClick={() => mutation.mutate({ type: 'gateway', data: { site: selectedSiteId, gateway_id: g.id, action: 'rotate' } })}>Rotate credential</button>{' '}
        <button className="button" disabled={mutation.isPending || !g.active} onClick={() => mutation.mutate({ type: 'gateway', data: { site: selectedSiteId, gateway_id: g.id, action: 'revoke' } })}>Revoke</button>
      </p>)}
    </section>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>Commission discovered hardware</h2>
      <form onSubmit={e => { e.preventDefault(); if (discovery) mutation.mutate({ type: 'command', data: { operation_id: crypto.randomUUID(), gateway_id: discovery.gateway_id, discovery_id: discovery.id, node_id: targetId, kind: 'PROVISION', role } }); }}>
        <label>Discovery <select required value={discoveryId} onChange={e => setDiscoveryId(e.target.value)}><option value="">Select hardware</option>{records.data.discoveries.map(d => <option key={d.id} value={d.id}>{d.hardware_id} · gateway #{d.gateway_id}</option>)}</select></label>{' '}
        <label>New device ID <input required maxLength={23} value={targetId} onChange={e => setTargetId(e.target.value)} /></label>{' '}
        <label>Role <select value={role} onChange={e => setRole(e.target.value)}><option value="WEARABLE">Tracking device</option><option value="ANCHOR">Fixed anchor</option></select></label>{' '}
        <button className="button primary" disabled={mutation.isPending || !discovery}>Queue provisioning</button>
      </form>
    </section>
    <section className="panel" style={{ padding: '1rem', marginTop: '1rem' }}><h2>Command history</h2><p>Sent does not mean executed. Expired means execution was not confirmed before the deadline.</p>{records.data.commands.map(c => <p key={c.id}>{c.kind} · <Link to={`/devices/${c.node_id}`}>{c.node_id}</Link> · {c.state} · expires {new Date(c.expires_at).toLocaleString()}</p>)}</section>
  </>;
}
