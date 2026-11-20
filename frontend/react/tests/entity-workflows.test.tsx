import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EntityDetailPage } from '../src/pages/EntityDetailPage';
import { platformApi } from '../src/services/api';

let selectedSiteId = 1;
vi.mock('../src/platform/PlatformContext', () => ({ usePlatform: () => ({ selectedSiteId, sites: [], can: () => true, setSelectedSiteId: vi.fn() }) }));
beforeEach(() => { vi.restoreAllMocks(); selectedSiteId = 1; });
const data = () => ({ id: 1, site: selectedSiteId, organisation: 1, identifier: 'P1', display_name: 'Person', version: 1, current_assignments: [], current_custody: [] });
function page() {
  return <MemoryRouter initialEntries={['/personnel/1']}><Routes><Route path="/personnel/:id" element={<EntityDetailPage kind="personnel" />} /></Routes></MemoryRouter>;
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{page()}</QueryClientProvider>);
  return { ...view, client };
}
it('retries an uncertain relationship operation with its original ID and payload', async () => {
  vi.spyOn(platformApi, 'entity').mockImplementation(async () => data());
  const action = vi.spyOn(platformApi, 'entityAction').mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ id: 1, version: 2, status: 'ok', action: 'edit' });
  setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Updated');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  const retry = await screen.findByRole('button', { name: 'Retry same operation' });
  await waitFor(() => expect(retry).toBeEnabled());
  await userEvent.click(retry);
  await screen.findByText('Change saved.');
  expect(action.mock.calls).toHaveLength(2);
  expect(action.mock.calls[1]).toEqual(action.mock.calls[0]);
});
it('closes the old form when the selected site changes', async () => {
  vi.spyOn(platformApi, 'entity').mockImplementation(async () => data());
  const view = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Old site draft');
  selectedSiteId = 2;
  view.rerender(<QueryClientProvider client={view.client}>{page()}</QueryClientProvider>);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
  expect(screen.getByLabelText('Name')).toHaveValue('');
});
