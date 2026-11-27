import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, LogOut, Moon, Sun } from 'lucide-react';
import { useOperatorSession } from '../components/AuthGate';
import { usePlatform } from './PlatformContext';
import { BackendConnection } from './BackendConnection';
import { fetchBackendHealth, platformApi } from '../services/api';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router-dom';
import { POLL_OPERATIONAL_MS, POLL_TRACKING_MS, queryKeys } from './queryKeys';
import { navigation } from './navigation/config';
import { Brand, MobileNavigation, SiteSelector } from './navigation/ResponsiveNavigation';
import { GlobalSearch } from './navigation/GlobalSearch';
import { cn, navigationControl } from './navigation/styles';

function IncidentLink() {
  const { selectedSiteId } = usePlatform();
  const alerts = useQuery({
    queryKey: queryKeys.alerts(selectedSiteId, 'NEW'),
    queryFn: () => platformApi.alerts(selectedSiteId, 'NEW'),
    enabled: Boolean(selectedSiteId),
    refetchInterval: POLL_TRACKING_MS,
    select: data => data.alerts.length,
  });
  const count = alerts.data;
  const description = alerts.isError ? 'New alert count unavailable'
    : count === 100 ? 'At least 100 new alerts'
    : count != null ? `${count} new ${count === 1 ? 'alert' : 'alerts'}` : '';
  const badge = alerts.isError ? '!' : count && (count > 99 ? '99+' : count);
  const { label, to, icon: Icon } = navigation.alerts;

  return (
    <nav aria-label="Incident navigation">
      <NavLink
        to={to}
        tabIndex={0}
        className={({ isActive }) => cn(navigationControl(), 'nav-incident-link', isActive && 'bg-nav-hover text-nav-accent hover:text-nav-accent')}
        aria-label={label}
        aria-description={description || undefined}
        title={description ? `${label} · ${description}` : label}
      >
        <Icon size={20} aria-hidden="true" />
        {Boolean(badge) && (
          <span className="nav-alert-count" data-stale={alerts.isError || undefined} aria-hidden="true">
            {badge}
          </span>
        )}
      </NavLink>
      <span className="sr-only" role="status">{description}</span>
    </nav>
  );
}

function ConnectionControl() {
  const { pathname } = useLocation();
  const health = useQuery({
    queryKey: ['backend-health'],
    queryFn: fetchBackendHealth,
    refetchInterval: POLL_OPERATIONAL_MS,
    retry: 1,
  });
  return <BackendConnection data={health.data} isError={health.isError} dataUpdatedAt={health.dataUpdatedAt} routeKey={pathname} />;
}

function AccountMenu() {
  const { pathname } = useLocation();
  const { session, signOut } = useOperatorSession();
  const { theme, toggleTheme } = usePlatform();
  const name = session.username?.trim() || 'Operator';
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : Sun;

  return (
    <DropdownMenu.Root key={pathname}>
      <DropdownMenu.Trigger
        className={cn(navigationControl({ layout: 'utility' }), 'nav-account-trigger')}
        aria-label={`Account for ${name}`}
      >
        <span className="nav-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="nav-account-name truncate" aria-hidden="true">{name}</span>
        <ChevronDown size={14} className="nav-account-chevron shrink-0" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="nav-floating nav-account-menu" align="end" sideOffset={8} collisionPadding={8}>
          <DropdownMenu.Label className="nav-account-label wrap-anywhere">{name}</DropdownMenu.Label>
          <DropdownMenu.Separator className="nav-menu-separator" />
          <DropdownMenu.Item className="nav-menu-item" onSelect={toggleTheme}>
            <ThemeIcon size={18} aria-hidden="true" /> Switch to {nextTheme} theme
          </DropdownMenu.Item>
          <DropdownMenu.Item className="nav-menu-item" onSelect={() => void signOut()}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Navbar({ mobile }: { mobile: boolean }) {
  return (
    <header className="nav-header sticky flex min-w-0 items-center bg-nav-surface text-nav-text">
      {mobile && <MobileNavigation />}
      <Brand />
      <SiteSelector />
      <GlobalSearch />
      <IncidentLink />
      <ConnectionControl />
      <AccountMenu />
    </header>
  );
}
