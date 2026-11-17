import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Modal } from '../src/platform/Modal';
import { PrimaryTimelineChart } from '../src/components/PrimaryTimelineChart';
import { BackendConnection } from '../src/platform/BackendConnection';
import { AlertSessionProvider, useAlertSession } from '../src/platform/AlertSessionContext';
import { AlertsPage } from '../src/pages/AlertsPage';
import { EnvironmentalPage } from '../src/pages/MonitoringPages';
import { ApiError, platformApi } from '../src/services/api';
import { AuthGate } from '../src/components/AuthGate';
import * as api from '../src/services/api';

let site = 1;
vi.mock('../src/platform/PlatformContext', () => ({ usePlatform: () => ({ selectedSiteId: site, can: () => true }) }));
const alert = (id: number, status = 'NEW') => ({ id, node_id: `NODE-${id}`, alert_code: `ALARM-${id}`, severity: 'CRITICAL', status, created_at: 1700000000000, trigger_value: 50, investigation_notes: '', resolution_notes: '', zone: 'ZONE-A' });
const clientFor = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
function setupAlerts(client = clientFor()) {
  const view = render(<QueryClientProvider client={client}><MemoryRouter><AlertSessionProvider><AlertsPage /></AlertSessionProvider></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => { site = 1; vi.restoreAllMocks(); });

describe('dialog keyboard lifecycle', () => {
  it('moves, contains and restores focus; handles Escape and restores background', async () => {
    const user = userEvent.setup();
    function Demo() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open</button><Modal isOpen={open} title="Register" subtitle="Details" onClose={() => setOpen(false)}><label>Name<input /></label><button>Save</button></Modal></>; }
    const { container } = render(<Demo />);
    await user.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Register' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(container.inert).toBe(true);
    await user.tab(); expect(screen.getByText('Save')).toHaveFocus();
    await user.tab(); expect(screen.getByLabelText('Close dialog')).toHaveFocus();
    await user.tab({ shift: true }); expect(screen.getByText('Save')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Open')).toHaveFocus();
    expect(container.inert).toBeFalsy();
    expect(document.body.style.overflow).toBe('');
  });
  it('supports container fallback and backdrop dismissal', async () => {
    const close = vi.fn();
    render(<Modal isOpen title="Notice" onClose={close}><p>Read me</p></Modal>);
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveFocus();
    await userEvent.click(dialog.previousElementSibling as HTMLElement);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('native-unit timeline', () => {
  it.each([[[]], [[0]], [[5, 5, 5]], [[0, 4, 18]]])('handles data %j without invalid geometry', values => {
    const points = values.map((value, index) => ({ timestamp: 1700000000000 + [0, 1000, 10000][index], label: '', gas_ppm: value, dust_ugm3: value, active_alerts: value, environmental_index: 0 }));
    const { container } = render(<PrimaryTimelineChart points={points} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    if (values.length) { expect(screen.getAllByRole('img')).toHaveLength(3); expect(container.querySelectorAll('circle')).toHaveLength(values.length * 3); }
    else expect(screen.getByText('No historical readings in this range.')).toBeVisible();
  });
  it('uses time spacing and exposes original values with metric filtering', async () => {
    const points = [0, 1000, 10000].map((time, i) => ({ timestamp: 1700000000000 + time, label: '', gas_ppm: i + 1, dust_ugm3: 10, active_alerts: 2, environmental_index: 0 }));
    const { container } = render(<PrimaryTimelineChart points={points} />);
    const circles = container.querySelectorAll('figure:first-of-type circle');
    expect(Number(circles[1].getAttribute('cx')) - Number(circles[0].getAttribute('cx'))).toBeCloseTo(53.5);
    await userEvent.click(screen.getByRole('button', { name: 'Gas (ppm)' })); expect(screen.getAllByRole('img')).toHaveLength(1);
    await userEvent.click(screen.getByText('View chart data')); expect(screen.getByRole('table')).toBeVisible();
  });
});

it('reports backend failure even when cached health is healthy', () => {
  const data = { status: 'healthy' as const, service: 'test', version: '', build_revision: '', database: '' };
  const { rerender } = render(<BackendConnection isError={false} dataUpdatedAt={0} />);
  expect(screen.getByRole('status')).toHaveTextContent('Checking');
  rerender(<BackendConnection data={data} isError={false} dataUpdatedAt={1700000000000} />); expect(screen.getByRole('status')).toHaveTextContent('Connected');
  rerender(<BackendConnection data={data} isError dataUpdatedAt={1700000000000} />); expect(screen.getByRole('status')).toHaveTextContent('Status unverified');
  rerender(<BackendConnection isError dataUpdatedAt={0} />); expect(screen.getByRole('status')).toHaveTextContent('Connection failed');
  rerender(<BackendConnection data={data} isError={false} dataUpdatedAt={1700000000000} />); expect(screen.getByRole('status')).toHaveTextContent('Connected');
});

describe('alert workflow', () => {
  beforeEach(() => { vi.spyOn(platformApi, 'alerts').mockImplementation(async (_site, status) => ({ alerts: [alert(1), alert(2, 'ACKNOWLEDGED')].filter(a => !status || a.status === status), count: 2 }) as never); });
  it('isolates drafts across selection, filtering, site changes and polling', async () => {
    const user = userEvent.setup(); const view = setupAlerts();
    const notes = await screen.findByLabelText('Investigation / resolution notes');
    await user.type(notes, 'Draft for first');
    await user.click(screen.getByRole('button', { name: /ALARM-2/ })); expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue('');
    await user.type(screen.getByLabelText('Investigation / resolution notes'), 'Draft for second');
    await user.click(screen.getByRole('button', { name: 'NEW', exact: true }));
    await waitFor(() => expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue('Draft for first'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['alerts'] }); });
    expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue('Draft for first');
    site = 2; view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><AlertSessionProvider><AlertsPage /></AlertSessionProvider></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue(''));
    site = 1; view.rerender(<QueryClientProvider client={view.client}><MemoryRouter><AlertSessionProvider><AlertsPage /></AlertSessionProvider></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue('Draft for first'));
  });
  it('requires notes and explicit resolution confirmation, initially focusing Cancel', async () => {
    const resolve = vi.spyOn(platformApi, 'resolveAlert').mockResolvedValue(); setupAlerts();
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve', exact: true }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText('Resolution notes'), '  Checked ventilation  ');
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm resolution' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(1, 'Checked ventilation'));
    await screen.findByText('Resolution succeeded for alert #1.');
  });
  it.each(['acknowledge', 'assign', 'resolve'] as const)('%s rejection stays tied to its alert and preserves drafts', async kind => {
    const methods = { acknowledge: 'acknowledgeAlert', assign: 'assignAlert', resolve: 'resolveAlert' } as const;
    vi.spyOn(platformApi, methods[kind]).mockRejectedValue(new ApiError('Rejected', 400, 'validation'));
    setupAlerts(); await userEvent.type(await screen.findByLabelText('Investigation / resolution notes'), 'Keep evidence');
    const names = { acknowledge: 'Acknowledge', assign: 'Assign to me', resolve: 'Resolve' };
    await userEvent.click(screen.getByRole('button', { name: names[kind], exact: true }));
    if (kind === 'resolve') await userEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }));
    await waitFor(() => expect(screen.getAllByText(/failed for alert #1: Rejected/).length).toBeGreaterThan(0));
    if (kind === 'resolve') { await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); }
    await userEvent.click(screen.getByRole('button', { name: /ALARM-2/ }));
    expect(screen.getByText(/failed for alert #1: Rejected/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /ALARM-1/ })); expect(screen.getByLabelText('Investigation / resolution notes')).toHaveValue('Keep evidence');
  });
  it.each(['acknowledge', 'assign', 'resolve'] as const)('%s transport failure refreshes before allowing a manual retry', async kind => {
    const methods = { acknowledge: 'acknowledgeAlert', assign: 'assignAlert', resolve: 'resolveAlert' } as const;
    const mutation = vi.spyOn(platformApi, methods[kind]).mockRejectedValue(new ApiError('Lost response', 0, 'unavailable'));
    setupAlerts(); await userEvent.type(await screen.findByLabelText('Investigation / resolution notes'), 'Evidence');
    const names = { acknowledge: 'Acknowledge', assign: 'Assign to me', resolve: 'Resolve' };
    await userEvent.click(screen.getByRole('button', { name: names[kind], exact: true }));
    if (kind === 'resolve') await userEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }));
    await waitFor(() => expect(screen.getAllByText(/Server state has been refreshed/).length).toBeGreaterThan(0));
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(platformApi.alerts).toHaveBeenCalledTimes(3);
  });
});

describe('environmental request states', () => {
  const channel = { key: 'co', display_name: 'CO stream', unit: 'ppm', latest_value: 5, latest_at: 1700000000000, node_id: 'N1', zone: '', sensor_ok: true };
  const response = { readings: [{ id: 1, value: 5, unit: 'ppm', node_id: 'N1', received_at: 1700000000000, zone: '' }], total: 1, page: 1, page_size: 25, total_pages: 1 };
  beforeEach(() => { vi.spyOn(platformApi, 'environment').mockResolvedValue({ channels: [channel], readings: [] }); });
  function mount() { const client = clientFor(); render(<QueryClientProvider client={client}><MemoryRouter><EnvironmentalPage /></MemoryRouter></QueryClientProvider>); return client; }
  it('does not describe a failed first request as empty history and recovers', async () => {
    const readings = vi.spyOn(platformApi, 'readings').mockRejectedValue(new Error('offline')); mount();
    await screen.findByText('Readings could not be loaded.'); expect(screen.queryByText('No readings recorded')).not.toBeInTheDocument();
    readings.mockResolvedValue({ ...response, readings: [], total: 0 } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByText('No readings recorded');
  });
  it('retains previous readings with a refresh-failed warning', async () => {
    const readings = vi.spyOn(platformApi, 'readings').mockResolvedValue(response as never); const client = mount();
    await screen.findByText('1 total recorded readings'); readings.mockRejectedValue(new Error('offline'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['environment-readings'] }); });
    await screen.findByText('Refresh failed—showing previously loaded readings.'); expect(screen.getByText('1 total recorded readings')).toBeVisible(); expect(screen.getByText(/Last successful fetch:/)).toBeVisible();
  });
});

it('prevents duplicate login submissions and preserves login errors', async () => {
  vi.spyOn(api, 'initialiseCsrf').mockResolvedValue(); vi.spyOn(api, 'getOperatorSession').mockResolvedValue(null);
  let reject!: (reason: unknown) => void;
  const signIn = vi.spyOn(api, 'signInOperator').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<AuthGate><p>Private</p></AuthGate>);
  await userEvent.type(await screen.findByLabelText('Username'), 'operator'); await userEvent.type(screen.getByLabelText('Password'), 'test-only');
  await userEvent.dblClick(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled(); expect(signIn).toHaveBeenCalledOnce();
  await act(async () => reject(new ApiError('Invalid login', 400, 'validation')));
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid login'); expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

describe('session draft lifetime and mutation races', () => {
  function Editor() {
    const session = useAlertSession(); const key = session.keyFor(1, 1);
    return <><input aria-label="Draft" value={session.drafts[key]?.text ?? ''} onChange={event => session.setDraft(1, 1, event.target.value)} /><button onClick={() => void session.run(1, 1, 'assign', session.drafts[key]?.text ?? '')}>Assign draft</button><p>{session.feedback[key]?.message}</p></>;
  }
  function Harness() { const [show, setShow] = useState(true); return <><button onClick={() => setShow(!show)}>Navigate</button>{show && <Editor />}</>; }
  it('retains drafts across navigation, preserves newer edits during success, and clears on session unmount', async () => {
    let complete!: () => void;
    vi.spyOn(platformApi, 'assignAlert').mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    vi.spyOn(platformApi, 'alerts').mockResolvedValue({ alerts: [], count: 0 });
    const client = clientFor(); const tree = <QueryClientProvider client={client}><AlertSessionProvider><Harness /></AlertSessionProvider></QueryClientProvider>;
    const view = render(tree); await userEvent.type(screen.getByLabelText('Draft'), 'Original');
    await userEvent.click(screen.getByText('Navigate')); await userEvent.click(screen.getByText('Navigate')); expect(screen.getByLabelText('Draft')).toHaveValue('Original');
    await userEvent.dblClick(screen.getByText('Assign draft')); expect(platformApi.assignAlert).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText('Draft'), ' newer');
    await act(async () => complete()); await screen.findByText('Assignment succeeded for alert #1.');
    expect(screen.getByLabelText('Draft')).toHaveValue('Original newer');
    view.unmount(); render(tree); expect(screen.getByLabelText('Draft')).toHaveValue('');
  });
  it.each(['acknowledge', 'assign'] as const)('%s success is announced without repeating requests', async action => {
    vi.spyOn(platformApi, 'alerts').mockResolvedValue({ alerts: [alert(1)], count: 1 } as never);
    const method = action === 'acknowledge' ? 'acknowledgeAlert' : 'assignAlert';
    vi.spyOn(platformApi, method).mockResolvedValue(); setupAlerts();
    await userEvent.click(await screen.findByRole('button', { name: action === 'acknowledge' ? 'Acknowledge' : 'Assign to me' }));
    await screen.findByText(`${action === 'acknowledge' ? 'Acknowledgement' : 'Assignment'} succeeded for alert #1.`); expect(platformApi[method]).toHaveBeenCalledOnce();
  });
  it('blocks another mutation when the uncertain outcome cannot be reconciled', async () => {
    const fetchAlerts = vi.spyOn(platformApi, 'alerts').mockResolvedValueOnce({ alerts: [alert(1)], count: 1 } as never).mockRejectedValue(new Error('offline'));
    const acknowledge = vi.spyOn(platformApi, 'acknowledgeAlert').mockRejectedValue(new ApiError('offline', 0, 'unavailable'));
    setupAlerts(); await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await screen.findByText(/Server state is unavailable. Refresh state before retrying./); expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDisabled();
    fetchAlerts.mockResolvedValue({ alerts: [alert(1, 'ACKNOWLEDGED')], count: 1 } as never);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh server state' })); await screen.findByText(/Server state refreshed for alert #1/);
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument(); expect(acknowledge).toHaveBeenCalledOnce();
  });
});
