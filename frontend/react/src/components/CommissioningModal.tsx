import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '../services/api';
import { usePlatform } from '../platform/PlatformContext';
import { Modal } from '../platform/Modal';
import { FormField, Input, Select } from '../platform/form';

interface CommissioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedDiscoveryId?: number;
}

export const CommissioningModal: React.FC<CommissioningModalProps> = ({
  isOpen,
  onClose,
  preselectedDiscoveryId,
}) => {
  const { selectedSiteId } = usePlatform();
  const queryClient = useQueryClient();
  const [discoveryId, setDiscoveryId] = useState<string>(preselectedDiscoveryId ? String(preselectedDiscoveryId) : '');
  const [nodeId, setNodeId] = useState('');
  const [role, setRole] = useState<'WEARABLE' | 'ANCHOR'>('WEARABLE');
  const [zoneId, setZoneId] = useState<string>('');
  const [deviceKey, setDeviceKey] = useState<string>('');
  const [feedback, setFeedback] = useState<{ error?: boolean; message: string } | null>(null);

  const gatewaysQuery = useQuery({
    queryKey: ['gateways', selectedSiteId],
    queryFn: () => platformApi.gateways(selectedSiteId!),
    enabled: isOpen && Boolean(selectedSiteId),
  });

  const zonesQuery = useQuery({
    queryKey: ['zones', selectedSiteId],
    queryFn: () => platformApi.zones(selectedSiteId!),
    enabled: isOpen && Boolean(selectedSiteId),
  });

  const discoveries = gatewaysQuery.data?.discoveries || [];
  const selectedDiscovery = discoveries.find(d => String(d.id) === (discoveryId || String(preselectedDiscoveryId))) || discoveries[0];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedDiscovery) throw new Error('No discovered hardware selected.');
      return platformApi.commissionDevice({
        gateway_id: selectedDiscovery.gateway_id,
        discovery_id: selectedDiscovery.id,
        node_id: nodeId.trim(),
        role,
        zone_id: zoneId ? Number(zoneId) : null,
        device_key: deviceKey.trim() || undefined,
        expected_version: selectedDiscovery.version,
      });
    },
    onSuccess: (data) => {
      setFeedback({ message: `Commissioning command queued (ID: ${data.command_id}). Awaiting device confirmation.` });
      void queryClient.invalidateQueries({ queryKey: ['gateways'] });
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      setTimeout(() => {
        onClose();
        setFeedback(null);
        setNodeId('');
        setDeviceKey('');
      }, 2000);
    },
    onError: (err: Error) => {
      setFeedback({ error: true, message: err.message || 'Commissioning failed.' });
    },
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Commission Discovered Hardware" subtitle="Assign identity and role to detected mesh nodes over-the-air.">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {feedback && (
          <div className={feedback.error ? 'form-error' : 'panel'} style={{ padding: '8px 12px', fontSize: '0.82rem' }}>
            {feedback.message}
          </div>
        )}
        <FormField label="Discovered Hardware" required helperText="Select hardware detected beaconing over the local mesh">
          <Select value={discoveryId || (selectedDiscovery ? String(selectedDiscovery.id) : '')} onChange={(e) => setDiscoveryId(e.target.value)} required>
            {discoveries.length === 0 ? (
              <option value="">No uncommissioned hardware detected</option>
            ) : (
              discoveries.map((d) => (
                <option key={d.id} value={d.id}>Chip #{d.hardware_id} (Gateway #{d.gateway_id})</option>
              ))
            )}
          </Select>
        </FormField>
        <FormField label="Device / Badge ID" required helperText="Unique wire-compatible identifier (max 23 chars: letters, numbers, hyphens)">
          <Input required maxLength={23} placeholder="e.g. WEARABLE-105" value={nodeId} onChange={(e) => setNodeId(e.target.value.toUpperCase())} />
        </FormField>
        <FormField label="Role" required>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'WEARABLE' | 'ANCHOR')}>
            <option value="WEARABLE">Wearable Miner Tag</option>
            <option value="ANCHOR">Stationary Zone Anchor</option>
          </Select>
        </FormField>
        {role === 'ANCHOR' && (
          <FormField label="Installation Zone" required helperText="Fixed anchor must be permanently assigned to an operational zone">
            <Select required value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">Select Zone</option>
              {zonesQuery.data?.zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name} ({z.code})</option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField label="Device Secret Key (Optional)" helperText="Leave blank for auto-generation or enter 64 hex characters (32 bytes)">
          <Input placeholder="Auto-generated if empty" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value)} />
        </FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1rem' }}>
          <button type="button" className="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button type="submit" className="button primary" disabled={mutation.isPending || !selectedDiscovery || !nodeId.trim()}>
            {mutation.isPending ? 'Queuing Downlink...' : 'Commission Device →'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
