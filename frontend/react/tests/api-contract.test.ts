import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, setAuthenticationFailureHandler, platformApi } from '../src/services/api';

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

  it('dispatches commissionDevice with PROVISION kind and structured payload', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ command_id: 'cmd-12345', state: 'QUEUED' }), { status: 201 }));
    }));

    const result = await platformApi.commissionDevice({
      gateway_id: 2,
      discovery_id: 10,
      node_id: 'TAG-TEST-01',
      role: 'WEARABLE',
      zone_id: 3,
      expected_version: 1,
      device_key: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(capturedUrl).toBe('/api/v1/commands');
    expect(capturedInit?.method).toBe('POST');
    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody.kind).toBe('PROVISION');
    expect(parsedBody.gateway_id).toBe(2);
    expect(parsedBody.discovery_id).toBe(10);
    expect(parsedBody.node_id).toBe('TAG-TEST-01');
    expect(parsedBody.role).toBe('WEARABLE');
    expect(parsedBody.zone_id).toBe(3);
    expect(parsedBody.expected_version).toBe(1);
    expect(parsedBody.operation_id).toBeDefined();
    expect(result).toEqual({ command_id: 'cmd-12345', state: 'QUEUED' });
  });
});
