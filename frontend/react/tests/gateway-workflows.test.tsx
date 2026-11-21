import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GatewaysPage } from '../src/pages/GatewaysPage';
import { platformApi } from '../src/services/api';

vi.mock('../src/platform/PlatformContext', () => ({ usePlatform: () => ({ selectedSiteId: 1, can: () => true }) }));
afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(platformApi, 'gateways').mockResolvedValue({
    gateways: [{ id: 4, node_id: 'GW-1', site_id: 1, active: true, credentials_installed: true, credential_version: 3 }],
    discoveries: [{ id: 8, gateway_id: 4, hardware_id: 'ABC123', sender_id: 'PROV-ABC123', version: 2, last_seen: '' }],
    devices: [{ node_id: 'TRACK-1', hardware_id: 'DEF456', version: 5, role: 'WEARABLE' }], commands: [],
  });
  vi.spyOn(platformApi, 'zones').mockResolvedValue({ zones: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><GatewaysPage /></MemoryRouter></QueryClientProvider>);
}

it('keeps the same diagnostic request after a lost response', async () => {
  const command = vi.spyOn(platformApi, 'command').mockRejectedValueOnce(new Error('Response lost'))
    .mockResolvedValueOnce({ command_id: 'same-command', state: 'DEVICE_CONFIRMED' });
  setup();
  await userEvent.selectOptions(await screen.findByLabelText('Gateway'), '4');
  await userEvent.selectOptions(screen.getByLabelText('Device'), 'TRACK-1');
  await userEvent.click(screen.getByRole('button', { name: 'Request status' }));
  const retry = await screen.findByRole('button', { name: 'Retry same request' });
  await waitFor(() => expect(retry).toBeEnabled());
  await userEvent.click(retry);
  expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);
  expect(command.mock.calls[0][0]).toMatchObject({ gateway_id: 4, node_id: 'TRACK-1', expected_version: 5, kind: 'DIAGNOSTIC' });
  expect(command.mock.calls[0][0].operation_id).toEqual(expect.any(String));
  await screen.findByText('Command same-command: DEVICE_CONFIRMED.');
  expect(screen.queryByText(/Awaiting device confirmation/)).not.toBeInTheDocument();
});

it('sends discovery version and operation identity for commissioning', async () => {
  const command = vi.spyOn(platformApi, 'command').mockResolvedValue({ command_id: 'new-command', state: 'QUEUED' });
  setup();
  await userEvent.selectOptions(await screen.findByLabelText('Discovery'), '8');
  await userEvent.type(screen.getByLabelText('New device ID'), 'TRACK-NEW');
  await userEvent.click(screen.getByRole('button', { name: 'Queue provisioning' }));
  await waitFor(() => expect(command).toHaveBeenCalledOnce());
  expect(command.mock.calls[0][0]).toMatchObject({ gateway_id: 4, discovery_id: 8, expected_version: 2, role: 'WEARABLE', kind: 'PROVISION', node_id: 'TRACK-NEW' });
});

it('guards credential rotation with its current version', async () => {
  const mutate = vi.spyOn(platformApi, 'gatewayAction').mockResolvedValue({ notice: 'Install locally.' });
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Rotate credential' }));
  expect(mutate.mock.calls[0][0]).toMatchObject({ gateway_id: 4, site: 1, action: 'rotate', expected_version: 3, operation_id: expect.any(String) });
  await screen.findByText('Install locally.');
});
