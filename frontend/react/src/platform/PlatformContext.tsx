import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '../components/AuthGate';
import { platformApi } from '../services/api';
import { Site } from '../types';
import { ErrorState, LoadingState } from './ui';
import { API_CONTRACT_VERSION } from '../services/api';

interface PlatformContextValue {
  sites: Site[];
  selectedSite?: Site;
  selectedSiteId?: number;
  setSelectedSiteId: (siteId: number) => void;
  capabilities: string[];
  can: (capability: string) => boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  isLoading: boolean;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);
const SITE_STORAGE_KEY = 'compallette.selected-site';
const THEME_STORAGE_KEY = 'compallette.theme';

export function PlatformProvider({ children }: { children: ReactNode }) {
  const { session } = useOperatorSession();
  const bootstrap = useQuery({ queryKey: ['platform-bootstrap'], queryFn: platformApi.bootstrap, staleTime: 60_000 });
  const [selectedSiteId, setSelectedSite] = useState<number | undefined>(() => {
    const stored = window.localStorage.getItem(SITE_STORAGE_KEY);
    return stored ? Number(stored) : undefined;
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light');
  const sites = bootstrap.data?.sites ?? session.sites ?? [];

  useEffect(() => {
    if (sites.length && !sites.some((site: Site) => site.id === selectedSiteId)) setSelectedSite(sites[0].id);
  }, [selectedSiteId, sites]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo<PlatformContextValue>(() => ({
    sites,
    selectedSiteId,
    selectedSite: sites.find((site: Site) => site.id === selectedSiteId),
    setSelectedSiteId: (siteId) => {
      window.localStorage.setItem(SITE_STORAGE_KEY, String(siteId));
      setSelectedSite(siteId);
    },
    capabilities: bootstrap.data?.site_capabilities?.[String(selectedSiteId)] ?? [],
    can: (capability) => (bootstrap.data?.site_capabilities?.[String(selectedSiteId)] ?? []).includes(capability),
    theme,
    toggleTheme: () => setTheme(current => current === 'light' ? 'dark' : 'light'),
    isLoading: bootstrap.isLoading,
  }), [bootstrap.data, bootstrap.isLoading, selectedSiteId, session.capabilities, sites, theme]);

  if (bootstrap.isLoading) return <LoadingState label="Checking platform compatibility…" />;
  if (bootstrap.isError) return <ErrorState message="Platform configuration could not be loaded." retry={() => void bootstrap.refetch()} />;
  if (bootstrap.data?.contract_version !== API_CONTRACT_VERSION) return <ErrorState message={`Incompatible backend contract. This frontend requires contract ${API_CONTRACT_VERSION}; deploy matching frontend and backend releases.`} retry={() => void bootstrap.refetch()} />;
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const context = useContext(PlatformContext);
  if (!context) throw new Error('usePlatform must be used inside PlatformProvider.');
  return context;
}
