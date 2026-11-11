import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOperatorSession } from '../components/AuthGate';
import { platformApi } from '../services/api';
import { Site } from '../types';

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
    capabilities: bootstrap.data?.capabilities ?? session.capabilities ?? [],
    can: (capability) => (bootstrap.data?.capabilities ?? session.capabilities ?? []).includes(capability),
    theme,
    toggleTheme: () => setTheme(current => current === 'light' ? 'dark' : 'light'),
    isLoading: bootstrap.isLoading,
  }), [bootstrap.data?.capabilities, bootstrap.isLoading, selectedSiteId, session.capabilities, sites, theme]);

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const context = useContext(PlatformContext);
  if (!context) throw new Error('usePlatform must be used inside PlatformProvider.');
  return context;
}
