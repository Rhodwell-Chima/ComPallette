import { createContext, ReactNode, useContext, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, platformApi } from '../services/api';

export type AlertAction = 'acknowledge' | 'assign' | 'resolve';
type Draft = { text: string; version: number };
type Feedback = { message: string; error: boolean; uncertain?: boolean };
const keyFor = (site: number, id: number) => `${site}:${id}`;
const labels = { acknowledge: 'Acknowledgement', assign: 'Assignment', resolve: 'Resolution' };

function useAlertSessionState() {
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const version = useRef(0);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [pending, setPending] = useState<Record<string, AlertAction | 'refresh'>>({});
  const locks = useRef(new Set<string>());
  const setDraft = (site: number, id: number, text: string) => {
    const draft = { text, version: ++version.current };
    setDrafts(previous => ({ ...previous, [keyFor(site, id)]: draft }));
  };
  const refresh = async (site: number) => {
    await client.invalidateQueries({ queryKey: ['alerts', site], refetchType: 'none' });
    await client.fetchQuery({ queryKey: ['alerts', site, 'ALL'], queryFn: () => platformApi.alerts(site), staleTime: 0, retry: false });
    await Promise.all([
      client.invalidateQueries({ queryKey: ['alerts', site] }),
      client.invalidateQueries({ queryKey: ['dashboard', site] }),
      client.invalidateQueries({ queryKey: ['audit'] }),
    ]);
  };
  const clearSubmitted = (key: string, submitted?: Draft) => {
    if (!submitted) return;
    setDrafts(previous => {
      if (previous[key]?.version !== submitted.version) return previous;
      const next = { ...previous }; delete next[key]; return next;
    });
  };
  const run = async (site: number, id: number, action: AlertAction, text: string) => {
    const key = keyFor(site, id);
    if (locks.current.has(key) || feedback[key]?.uncertain) return false;
    locks.current.add(key);
    setPending(previous => ({ ...previous, [key]: action }));
    setFeedback(previous => ({ ...previous, [key]: { message: `${labels[action]} pending for alert #${id}…`, error: false } }));
    const submitted = drafts[key];
    try {
      if (action === 'acknowledge') await platformApi.acknowledgeAlert(id);
      else if (action === 'assign') await platformApi.assignAlert(id, text);
      else await platformApi.resolveAlert(id, text.trim());
      if (action !== 'acknowledge') clearSubmitted(key, submitted);
      setFeedback(previous => ({ ...previous, [key]: { message: `${labels[action]} succeeded for alert #${id}.`, error: false } }));
      try { await refresh(site); } catch {
        setFeedback(previous => ({ ...previous, [key]: { message: `${labels[action]} succeeded for alert #${id}, but the latest state could not be loaded. Refresh before another action.`, error: true, uncertain: true } }));
      }
      return true;
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      setFeedback(previous => ({ ...previous, [key]: {
        message: uncertain ? `${labels[action]} outcome could not be confirmed for alert #${id}. Checking server state; do not repeat the action yet.` : `${labels[action]} failed for alert #${id}: ${error.message}`,
        error: true, uncertain,
      } }));
      if (uncertain) {
        try {
          await refresh(site);
          setFeedback(previous => ({ ...previous, [key]: { message: `${labels[action]} outcome was uncertain for alert #${id}. Server state has been refreshed. Review its status and notes before deciding whether to retry.`, error: true } }));
        } catch {
          setFeedback(previous => ({ ...previous, [key]: { message: `${labels[action]} outcome could not be confirmed for alert #${id}. Server state is unavailable. Refresh state before retrying.`, error: true, uncertain: true } }));
        }
      }
      return false;
    } finally {
      locks.current.delete(key);
      setPending(previous => { const next = { ...previous }; delete next[key]; return next; });
    }
  };
  const reconcile = async (site: number, id: number) => {
    const key = keyFor(site, id);
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setPending(previous => ({ ...previous, [key]: 'refresh' }));
    try {
      await refresh(site);
      setFeedback(previous => ({ ...previous, [key]: { message: `Server state refreshed for alert #${id}. Review status and notes before another action.`, error: false } }));
    } catch {
      setFeedback(previous => ({ ...previous, [key]: { message: `Server state is still unavailable for alert #${id}. No action was retried.`, error: true, uncertain: true } }));
    } finally {
      locks.current.delete(key);
      setPending(previous => { const next = { ...previous }; delete next[key]; return next; });
    }
  };
  return { drafts, feedback, pending, setDraft, run, reconcile, keyFor };
}
const AlertSessionContext = createContext<ReturnType<typeof useAlertSessionState> | null>(null);
export function AlertSessionProvider({ children }: { children: ReactNode }) {
  const value = useAlertSessionState();
  return <AlertSessionContext.Provider value={value}>{children}</AlertSessionContext.Provider>;
}
export function useAlertSession() {
  const value = useContext(AlertSessionContext);
  if (!value) throw new Error('AlertSessionProvider is required');
  return value;
}
