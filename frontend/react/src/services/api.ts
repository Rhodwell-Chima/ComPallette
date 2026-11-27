import { GatewaysResponse, GatewayMutationResult, CommandMutationResult } from './platformContracts';
import {
  AlertItem,
  AuditItem,
  NodeItem,
  SystemSummary,
  TelemetryItem,
  AssetItem,
  DashboardData,
  EnhancedDashboardData,
  EnvironmentChannel,
  FacilityLayout,
  MeasurementReading,
  Organisation,
  PersonnelItem,
  SearchResult,
  Site,
  Structure,
  SiteMembership,
  TwinData,
  Zone,
  AdminUserItem,
  AdminUserListResponse,
} from '../types';

const API_BASE = '';
export const API_CONTRACT_VERSION = 2;

export type ApiErrorKind = 'authentication' | 'forbidden' | 'conflict' | 'retired' | 'validation' | 'unavailable' | 'server';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: ApiErrorKind,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface OperatorSession {
  authenticated: boolean;
  username?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  capabilities?: string[];
  sites?: Site[];
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
let operatorRequestGeneration = 0;
const operatorRequests = new Set<AbortController>();

/** Invalidate before logout/account changes so late responses cannot affect a new session. */
export function invalidateOperatorRequests(): void {
  operatorRequestGeneration += 1;
  for (const controller of operatorRequests) controller.abort();
  operatorRequests.clear();
}

function assertRequestGeneration(generation: number): void {
  if (generation !== operatorRequestGeneration) throw new DOMException('The operator session changed.', 'AbortError');
}

export function setAuthenticationFailureHandler(handler: AuthenticationFailureHandler): () => void {
  authenticationFailureHandler = handler;
  return () => {
    if (authenticationFailureHandler === handler) authenticationFailureHandler = undefined;
  };
}

export const registerAuthenticationFailureHandler = setAuthenticationFailureHandler;

function csrfToken(): string {
  return decodeURIComponent(
    document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1] ?? '',
  );
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401) return 'authentication';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'retired';
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

export async function request(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
  const generation = operatorRequestGeneration;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  operatorRequests.add(controller);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      signal: controller.signal,
    });
    assertRequestGeneration(generation);
  } catch (error) {
    if (controller.signal.aborted || generation !== operatorRequestGeneration) throw new DOMException('Request cancelled.', 'AbortError');
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('The ComPallette backend is unavailable. Check the service and network connection.', 0, 'unavailable');
  } finally {
    operatorRequests.delete(controller);
    init.signal?.removeEventListener('abort', abort);
  }

  if (response.ok) return response;

  const payload = await response.clone().json().catch(() => ({}));
  const message = await responseMessage(response);
  assertRequestGeneration(generation);
  const kind = errorKind(response.status);
  if (kind === 'authentication' && options.notifyAuthenticationFailure !== false) {
    authenticationFailureHandler?.();
  }
  throw new ApiError(message, response.status, kind, payload.error_code, payload.details ?? payload);
}

function jsonRequest(method: string, body?: unknown): RequestInit {
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

export async function fetchCsrfToken(): Promise<string> {
  await initialiseCsrf();
  return csrfToken();
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

export async function fetchSystemSummary(): Promise<SystemSummary> {
  return fetchSummary();
}

function siteQuery(siteId?: number, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams();
  if (siteId) search.set('site_id', String(siteId));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

async function json<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
  const generation = operatorRequestGeneration;
  const response = await request(path, init, options);
  const data: T = await response.json();
  assertRequestGeneration(generation);
  return data;
}

export const platformApi = {
  entity: (kind: string, id: string) => json<Record<string, any>>(`/api/v1/entities/${kind}/${encodeURIComponent(id)}`),
  entityAction: (kind: string, id: string, input: Record<string, unknown>) => json<Record<string, unknown>>(`/api/v1/entities/${kind}/${encodeURIComponent(id)}`, jsonRequest('POST', input)),
  transferPreview: (kind: string, id: string, destination: number) => json<{ assignment_ids: number[]; custody_ids: number[] }>(`/api/v1/entities/${kind}/${encodeURIComponent(id)}?preview_destination=${destination}`),
  eligibleDevices: (site: number, q = '') => json<{ nodes: NodeItem[] }>(`/api/v1/devices/eligible${siteQuery(site, { q })}`),
  gateways: (site: number) => json<GatewaysResponse>(`/api/v1/gateways${siteQuery(site)}`),
  gatewayAction: (input: Record<string, unknown>) => json<GatewayMutationResult>('/api/v1/gateways', jsonRequest('POST', input)),
  command: (input: Record<string, unknown>) => json<CommandMutationResult>('/api/v1/commands', jsonRequest('POST', input)),
  commissionDevice: (data: {
    gateway_id: number;
    discovery_id: number;
    node_id: string;
    role: 'WEARABLE' | 'ANCHOR';
    zone_id?: number | null;
    device_key?: string;
    expected_version: number;
  }) =>
    json<CommandMutationResult>(
      '/api/v1/commands',
      jsonRequest('POST', {
        operation_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        kind: 'PROVISION',
        ...data,
      }),
    ),
  bootstrap: () => json<{ contract_version: number; build_revision: string; organisations: Organisation[]; sites: Site[]; capabilities: string[]; site_capabilities?: Record<string, string[]> }>('/api/v1/platform/bootstrap'),
  dashboard: (siteId?: number, signal?: AbortSignal) =>
    json<EnhancedDashboardData>(`/api/v1/dashboard${siteQuery(siteId)}`, { signal }),
  sites: () => json<{ sites: Site[] }>('/api/v1/sites'),
  createSite: (input: Pick<Site, 'organisation' | 'name' | 'code' | 'industry' | 'timezone'>) => json<Site>('/api/v1/sites', jsonRequest('POST', input)),
  updateSite: (siteId: number, input: Partial<Site>) => json<Site>(`/api/v1/sites/${siteId}`, jsonRequest('PATCH', input)),
  structures: (siteId: number) => json<{ structures: Structure[] }>(`/api/v1/sites/${siteId}/structures`),
  zones: (siteId: number) => json<{ zones: Zone[] }>(`/api/v1/sites/${siteId}/zones`),
  createZone: (siteId: number, input: Pick<Zone, 'code' | 'name' | 'zone_type' | 'description' | 'is_restricted' | 'is_hazardous'>) => json<Zone>(`/api/v1/sites/${siteId}/zones`, jsonRequest('POST', input)),
  layout: (siteId: number) => json<FacilityLayout>(`/api/v1/sites/${siteId}/layout`),
  updateLayout: (siteId: number, geometry: Record<string, unknown>, expectedVersion: number) => json<FacilityLayout>(`/api/v1/sites/${siteId}/layout`, jsonRequest('PUT', { geometry, expected_version: expectedVersion })),
  personnel: (siteId?: number, q?: string) => json<{ personnel: PersonnelItem[]; count: number }>(`/api/v1/personnel${siteQuery(siteId, { q })}`),
  createPersonnel: (input: Pick<PersonnelItem, 'identifier' | 'display_name' | 'team' | 'employment_status'> & { site?: number; assigned_node?: string | null }) => json<PersonnelItem>('/api/v1/personnel', jsonRequest('POST', input)),
  assets: (siteId?: number, q?: string) => json<{ assets: AssetItem[]; count: number }>(`/api/v1/assets${siteQuery(siteId, { q })}`),
  createAsset: (input: Pick<AssetItem, 'identifier' | 'name' | 'asset_type' | 'operational_status'> & { site?: number; assigned_node?: string | null }) => json<AssetItem>('/api/v1/assets', jsonRequest('POST', input)),
  devices: (siteId?: number, status?: string) => json<{ nodes: NodeItem[]; count: number }>(`/api/v1/nodes${siteQuery(siteId, { status })}`),
  environment: (siteId?: number) => json<{ channels: EnvironmentChannel[]; readings: MeasurementReading[] }>(`/api/v1/environment/overview${siteQuery(siteId)}`),
  readings: (
    siteId?: number,
    key?: string,
    params: { page?: number; page_size?: number } = {},
  ) =>
    json<{
      readings: MeasurementReading[];
      total: number;
      page: number;
      page_size: number;
      total_pages: number;
    }>(
      `/api/v1/environment/readings${siteQuery(siteId, {
        key,
        page: params.page,
        page_size: params.page_size,
      })}`,
    ),
  twin: (siteId?: number) => json<TwinData>(`/api/v1/digital-twin${siteQuery(siteId)}`),
  alerts: (siteId?: number, status?: string, limit = 100) => json<{ alerts: AlertItem[]; count: number }>(`/api/v1/alerts${siteQuery(siteId, { status, limit })}`),
  alertDetail: (siteId: number, alertId: number, signal?: AbortSignal) =>
    json<AlertItem>(`/api/v1/alerts/${alertId}${siteQuery(siteId)}`, { signal }),
  acknowledgeAlert: (id: number) => json<void>(`/api/v1/alerts/${id}/ack`, jsonRequest('POST')),
  assignAlert: (id: number, notes: string) => json<void>(`/api/v1/alerts/${id}/assign`, jsonRequest('POST', { notes })),
  resolveAlert: (id: number, notes: string) => json<void>(`/api/v1/alerts/${id}/resolve`, jsonRequest('POST', { notes })),
  audit: (siteId?: number, params: { limit?: number; offset?: number } = {}) =>
    json<{ audit_log: AuditItem[]; count: number; total?: number; offset?: number; limit?: number }>(
      `/api/v1/audit${siteQuery(siteId, { limit: params.limit ?? 20, offset: params.offset ?? 0 })}`,
    ),
  search: (siteId: number | undefined, q: string) => json<{ results: SearchResult[] }>(`/api/v1/search${siteQuery(siteId, { q })}`),
  reports: (siteId?: number) => json<{ site: Site | null; summary: Record<string, number> }>(`/api/v1/reports/summary${siteQuery(siteId)}`),
  integrations: () => json<{ integrations: unknown[]; message: string }>('/api/v1/integrations'),
  memberships: (siteId?: number) => json<{ memberships: SiteMembership[] }>(`/api/v1/access/memberships${siteQuery(siteId)}`),
  assignMembership: (siteId: number | undefined, username: string, role: string) => json<SiteMembership>(`/api/v1/access/memberships${siteQuery(siteId)}`, jsonRequest('POST', { username, role })),

  // User Administration APIs
  users: (params: { site_id?: number; page?: number; page_size?: number; search?: string; role?: string; status?: string } = {}) =>
    json<AdminUserListResponse>(`/api/v1/users${siteQuery(params.site_id, {
      page: params.page,
      page_size: params.page_size,
      search: params.search,
      role: params.role,
      status: params.status,
    })}`),
  userDetail: (userId: number, siteId?: number) => json<AdminUserItem>(`/api/v1/users/${userId}${siteQuery(siteId)}`),
  createUser: (siteId: number, input: { username: string; email: string; role: string }) =>
    json<{ id: number; message: string }>(`/api/v1/users${siteQuery(siteId)}`, jsonRequest('POST', input)),
  updateUser: (userId: number, input: Partial<AdminUserItem>, siteId?: number) =>
    json<AdminUserItem>(`/api/v1/users/${userId}${siteQuery(siteId)}`, jsonRequest('PATCH', input)),
  bulkUserAction: (action: 'activate' | 'suspend' | 'delete' | 'change_role', userIds: number[], siteId?: number, extra?: Record<string, unknown>) =>
    json<{ message: string; updated: number }>(`/api/v1/users/bulk${siteQuery(siteId)}`, jsonRequest('POST', { action, user_ids: userIds, ...extra })),
  resetUserPassword: (userId: number, password: string, siteId?: number) =>
    json<{ message: string }>(`/api/v1/users/${userId}/reset-password${siteQuery(siteId)}`, jsonRequest('POST', { password })),
};

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
