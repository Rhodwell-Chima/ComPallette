import {
  AlertItem,
  AuditItem,
  NodeItem,
  ProvisioningRequest,
  SystemSummary,
  TelemetryItem,
} from '../types';

const API_BASE = '';

export type ApiErrorKind = 'authentication' | 'validation' | 'unavailable' | 'server';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: ApiErrorKind,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface OperatorSession {
  authenticated: boolean;
  username?: string;
  is_staff?: boolean;
}

export interface BackendHealth {
  status: 'healthy';
  service: string;
  version: string;
  build_revision: string;
  database: string;
}

type AuthenticationFailureHandler = () => void;
let authenticationFailureHandler: AuthenticationFailureHandler | undefined;

/**
 * Registers the UI boundary that owns the operator session. Protected API
 * calls use it to stop dashboard polling when that session is no longer valid.
 */
export function setAuthenticationFailureHandler(handler: AuthenticationFailureHandler): () => void {
  authenticationFailureHandler = handler;
  return () => {
    if (authenticationFailureHandler === handler) authenticationFailureHandler = undefined;
  };
}

function csrfToken(): string {
  return decodeURIComponent(
    document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1] ?? '',
  );
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status >= 400 && status < 500) return 'validation';
  return 'server';
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json();
    if (typeof payload?.error === 'string') return payload.error;
    if (typeof payload?.detail === 'string') return payload.detail;
  } catch {
    // The status below is still a safe, useful error when a proxy returns HTML.
  }

  if (response.status === 401 || response.status === 403) return 'Your operator session is not authorised.';
  if (response.status >= 500) return 'The backend could not complete the request.';
  return `The backend rejected the request (${response.status}).`;
}

interface RequestOptions {
  notifyAuthenticationFailure?: boolean;
}

async function request(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
    });
  } catch {
    throw new ApiError('The ComPallette backend is unavailable. Check the service and network connection.', 0, 'unavailable');
  }

  if (response.ok) return response;

  const kind = errorKind(response.status);
  if (kind === 'authentication' && options.notifyAuthenticationFailure !== false) {
    authenticationFailureHandler?.();
  }
  throw new ApiError(await responseMessage(response), response.status, kind);
}

function jsonRequest(method: 'POST' | 'DELETE', body?: unknown): RequestInit {
  return {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-CSRFToken': csrfToken(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export async function initialiseCsrf(): Promise<void> {
  await request('/api/v1/auth/csrf', {}, { notifyAuthenticationFailure: false });
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  try {
    return await (await request('/api/v1/auth/session', {}, { notifyAuthenticationFailure: false })).json();
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'authentication') return null;
    throw error;
  }
}

export async function signInOperator(username: string, password: string): Promise<OperatorSession> {
  return (await request(
    '/api/v1/auth/session',
    jsonRequest('POST', { username, password }),
    { notifyAuthenticationFailure: false },
  )).json();
}

export async function signOutOperator(): Promise<void> {
  await request('/api/v1/auth/session', jsonRequest('DELETE'), { notifyAuthenticationFailure: false });
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  return (await request('/health/', {}, { notifyAuthenticationFailure: false })).json();
}

export async function fetchSummary(): Promise<SystemSummary> {
  return (await request('/api/v1/system/summary')).json();
}

export async function fetchNodes(statusFilter?: string): Promise<NodeItem[]> {
  let url = '/api/v1/nodes';
  if (statusFilter && statusFilter !== 'ALL') url += `?status=${encodeURIComponent(statusFilter)}`;
  const data = await (await request(url)).json();
  return data.nodes || [];
}

export async function fetchAlerts(statusFilter?: string, limit: number = 20): Promise<AlertItem[]> {
  let url = `/api/v1/alerts?limit=${limit}`;
  if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
  const data = await (await request(url)).json();
  return data.alerts || [];
}

export async function fetchNodeHistory(nodeId: string, limit: number = 30): Promise<TelemetryItem[]> {
  const data = await (await request(`/api/v1/nodes/${encodeURIComponent(nodeId)}/history?limit=${limit}`)).json();
  return data.history || [];
}

export async function fetchAudit(limit: number = 20): Promise<AuditItem[]> {
  const data = await (await request(`/api/v1/audit?limit=${limit}`)).json();
  return data.audit_log || [];
}

export async function acknowledgeAlert(alertId: number, officerName: string): Promise<void> {
  await request(`/api/v1/alerts/${alertId}/ack/`, jsonRequest('POST', { officer_name: officerName }));
}

export async function resolveAlert(alertId: number, officerName: string, notes: string): Promise<void> {
  await request(`/api/v1/alerts/${alertId}/resolve/`, jsonRequest('POST', {
    officer_name: officerName,
    notes,
  }));
}

export async function fetchPendingProvisioning(): Promise<ProvisioningRequest[]> {
  const data = await (await request('/api/v1/provision/pending')).json();
  return data.pending_nodes || [];
}

export async function assignNodeProvisioning(
  chipId: string,
  deviceId: string,
  role: string,
  zoneId: string,
  officerName: string = 'Safety_Officer',
): Promise<unknown> {
  return (await request('/api/v1/provision/assign', jsonRequest('POST', {
    chip_id: chipId,
    device_id: deviceId,
    role,
    zone_id: zoneId,
    officer_name: officerName,
  }))).json();
}
