import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, setAuthenticationFailureHandler } from '../src/services/api';

afterEach(() => vi.unstubAllGlobals());

describe('API error contracts', () => {
  it.each([401, 403])('only expires the session on 401 (received %s)', async status => {
    const expired = vi.fn();
    const unregister = setAuthenticationFailureHandler(expired);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Access denied' }), { status })));
    try {
      await expect(request('/api/v1/gateways')).rejects.toMatchObject({ status, kind: status === 401 ? 'authentication' : 'forbidden' });
      expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    } finally { unregister(); }
  });

  it('preserves structured version conflicts for operator recovery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Relationship changed.', error_code: 'VERSION_CONFLICT', details: { current_version: 4 },
    }), { status: 409 })));
    await expect(request('/api/v1/commands')).rejects.toMatchObject({
      kind: 'conflict', code: 'VERSION_CONFLICT', details: { current_version: 4 },
    });
  });

  it('reports a lost response without retrying a mutation', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network disconnected'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('/api/v1/commands', { method: 'POST', body: '{}' })).rejects.toMatchObject({ kind: 'unavailable', status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
