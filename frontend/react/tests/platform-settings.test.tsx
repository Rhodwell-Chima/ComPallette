import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../src/pages/settings/SettingsPage';

vi.mock('../src/platform/PlatformContext', () => ({
  usePlatform: () => ({ selectedSiteId: 1, selectedSite: { id: 1, code: 'PILOT', active: true }, can: () => true }),
}));

describe('settings reflect supported operational actions', () => {
  it('does not expose browser-only threshold saves as device controls', () => {
    render(<MemoryRouter initialEntries={['/settings?tab=safety']}><SettingsPage /></MemoryRouter>);
    expect(screen.getByText('Remote threshold changes are unavailable')).toBeVisible();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
  it('links gateway operations to the backend-connected workflow', () => {
    render(<MemoryRouter initialEntries={['/settings?tab=network']}><SettingsPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Open gateways' })).toHaveAttribute('href', '/gateways');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
  it('offers real audit and integration pages without a simulated webhook test', () => {
    render(<MemoryRouter initialEntries={['/settings?tab=integrations']}><SettingsPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'View audit records' })).toHaveAttribute('href', '/audit');
    expect(screen.queryByRole('button', { name: /test webhook/i })).not.toBeInTheDocument();
  });
});
