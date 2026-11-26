import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommissioningModal } from '../src/components/CommissioningModal';
import { platformApi } from '../src/services/api';

vi.mock('../src/platform/PlatformContext', () => ({
  usePlatform: () => ({ selectedSiteId: 1, can: () => true }),
}));

afterEach(() => vi.restoreAllMocks());

function setupModal(props: { isOpen: boolean; onClose: () => void; preselectedDiscoveryId?: number }) {
  vi.spyOn(platformApi, 'gateways').mockResolvedValue({
    gateways: [{ id: 4, node_id: 'GW-1', site_id: 1, active: true, credentials_installed: true, credential_version: 1 }],
    discoveries: [
      { id: 10, gateway_id: 4, hardware_id: 'CHIP-A1', sender_id: 'PROV-CHIP-A1', version: 3, last_seen: '' },
      { id: 11, gateway_id: 4, hardware_id: 'CHIP-B2', sender_id: 'PROV-CHIP-B2', version: 1, last_seen: '' },
    ],
    devices: [],
    commands: [],
  });
  vi.spyOn(platformApi, 'zones').mockResolvedValue({
    zones: [
      { id: 7, code: 'Z-EAST', name: 'East Drift', zone_type: 'OPERATIONAL', description: '', is_restricted: false, is_hazardous: false, active: true, geometry: {}, site: 1 },
    ],
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <CommissioningModal {...props} />
    </QueryClientProvider>
  );
  return { ...view, client };
}

describe('CommissioningModal', () => {
  it('renders discovered devices and submits a wearable commissioning command', async () => {
    const commission = vi.spyOn(platformApi, 'commissionDevice').mockResolvedValue({
      command_id: 'cmd-999',
      state: 'QUEUED',
    });
    const onClose = vi.fn();

    setupModal({ isOpen: true, onClose });

    expect(await screen.findByText('Commission Discovered Hardware')).toBeInTheDocument();
    expect(await screen.findByText('Chip #CHIP-A1 (Gateway #4)')).toBeInTheDocument();

    const deviceIdInput = screen.getByPlaceholderText('e.g. WEARABLE-105');
    await userEvent.type(deviceIdInput, 'tag-miner-01');
    expect(deviceIdInput).toHaveValue('TAG-MINER-01');

    const submitBtn = screen.getByRole('button', { name: 'Commission Device →' });
    expect(submitBtn).toBeEnabled();
    await userEvent.click(submitBtn);

    await waitFor(() => expect(commission).toHaveBeenCalledOnce());
    expect(commission).toHaveBeenCalledWith({
      gateway_id: 4,
      discovery_id: 10,
      node_id: 'TAG-MINER-01',
      role: 'WEARABLE',
      zone_id: null,
      device_key: undefined,
      expected_version: 3,
    });

    expect(await screen.findByText(/Commissioning command queued \(ID: cmd-999\)/)).toBeInTheDocument();
  });

  it('reveals installation zone requirement when ANCHOR role is selected', async () => {
    const commission = vi.spyOn(platformApi, 'commissionDevice').mockResolvedValue({
      command_id: 'cmd-anchor-1',
      state: 'QUEUED',
    });
    const onClose = vi.fn();

    setupModal({ isOpen: true, onClose, preselectedDiscoveryId: 11 });

    expect(await screen.findByText('Commission Discovered Hardware')).toBeInTheDocument();

    // Select ANCHOR role
    const roleSelect = screen.getByDisplayValue('Wearable Miner Tag');
    await userEvent.selectOptions(roleSelect, 'ANCHOR');

    // Installation zone select appears
    expect(await screen.findByText('Installation Zone')).toBeInTheDocument();
    const zoneSelect = screen.getByDisplayValue('Select Zone');
    await userEvent.selectOptions(zoneSelect, '7');

    const deviceIdInput = screen.getByPlaceholderText('e.g. WEARABLE-105');
    await userEvent.type(deviceIdInput, 'anchor-east-01');

    await userEvent.click(screen.getByRole('button', { name: 'Commission Device →' }));

    await waitFor(() => expect(commission).toHaveBeenCalledOnce());
    expect(commission).toHaveBeenCalledWith({
      gateway_id: 4,
      discovery_id: 11,
      node_id: 'ANCHOR-EAST-01',
      role: 'ANCHOR',
      zone_id: 7,
      device_key: undefined,
      expected_version: 1,
    });
  });

  it('displays error notice when commissioning API fails', async () => {
    vi.spyOn(platformApi, 'commissionDevice').mockRejectedValue(new Error('Hardware ID already active'));
    const onClose = vi.fn();

    setupModal({ isOpen: true, onClose });

    await userEvent.type(await screen.findByPlaceholderText('e.g. WEARABLE-105'), 'FAIL-TAG');
    await userEvent.click(screen.getByRole('button', { name: 'Commission Device →' }));

    expect(await screen.findByText('Hardware ID already active')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
