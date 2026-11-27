export const POLL_TRACKING_MS = 5_000;
export const POLL_OPERATIONAL_MS = 15_000;

export const queryKeys = {
  dashboard: (siteId?: number, canViewAudit = false) => ['dashboard', siteId, canViewAudit] as const,
  alerts: (siteId?: number, status = 'ALL') => ['alerts', siteId, status] as const,
  alertDetail: (siteId?: number, alertId?: number) => ['alerts', siteId, 'detail', alertId] as const,
  alertSite: (siteId: number) => ['alerts', siteId] as const,
};
