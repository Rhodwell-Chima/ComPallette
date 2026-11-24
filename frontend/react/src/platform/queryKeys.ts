export const POLL_TRACKING_MS = 5_000;
export const POLL_OPERATIONAL_MS = 15_000;

export const queryKeys = {
  alerts: (siteId?: number, status = 'ALL') => ['alerts', siteId, status] as const,
  alertSite: (siteId: number) => ['alerts', siteId] as const,
};
