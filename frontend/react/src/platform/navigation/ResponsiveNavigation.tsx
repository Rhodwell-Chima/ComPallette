import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Building2, ChevronDown, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { matchPath, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { usePlatform } from '../PlatformContext';
import { INDUSTRIAL_EASE } from '../motion';
import { NavigationDialog } from './NavigationDialog';
import { NavigationList } from './NavigationList';
import { navigation } from './config';
import { navigationControl } from './styles';
import { useReducedNavigationMotion } from './useNavigationLayout';

const STORAGE_KEY = 'compallette.sidebar-collapsed';

export function Brand() {
  return (
    <div className="nav-brand flex min-w-0 shrink-0 items-center gap-2.5">
      <span className="nav-brand-mark" aria-hidden="true">C</span>
      <span className="nav-brand-name">
        <strong>ComPallette</strong><small>Mining Cockpit</small>
      </span>
    </div>
  );
}

export function SiteSelector() {
  const { sites, selectedSiteId, selectedSite, setSelectedSiteId } = usePlatform();
  return (
    <div className="nav-site relative min-w-0">
      <Building2 size={16} className="nav-site-icon pointer-events-none absolute" aria-hidden="true" />
      <select
        aria-label="Active site"
        title={selectedSite?.name}
        value={selectedSiteId ?? ''}
        disabled={!sites.length}
        onChange={event => setSelectedSiteId(Number(event.target.value))}
      >
        {!sites.length && <option value="">No sites</option>}
        {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <span className="nav-site-code" aria-hidden="true">{selectedSite?.code || selectedSite?.name || 'No sites'}</span>
      <ChevronDown size={14} className="nav-site-chevron pointer-events-none absolute" aria-hidden="true" />
    </div>
  );
}

export function MobileNavigation() {
  const { pathname } = useLocation();
  const [openedAt, setOpenedAt] = useState<string>();
  const previousPath = useRef(pathname);
  const open = openedAt === pathname;
  useEffect(() => { setOpenedAt(undefined); }, [pathname]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        previousPath.current = pathname;
        setOpenedAt(next ? pathname : undefined);
      }}
    >
      <Dialog.Trigger className={navigationControl()} aria-label="Open navigation">
        <Menu size={22} className="nav-menu-icon" aria-hidden="true" />
        <span className="nav-compact-brand nav-brand-mark" aria-hidden="true">C<Menu size={13} /></span>
      </Dialog.Trigger>
      <NavigationDialog
        open={open}
        layout="sheet"
        title="ComPallette navigation"
        onCloseAutoFocus={event => {
          if (previousPath.current !== pathname || !document.querySelector('[aria-label="Open navigation"]')) {
            event.preventDefault();
            document.getElementById('main-content')?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="nav-sheet-scroll">
          <NavigationList layout="drawer" pathname={pathname} onNavigate={() => setOpenedAt(undefined)} />
        </div>
      </NavigationDialog>
    </Dialog.Root>
  );
}

export function AppSidebar({ desktop }: { desktop: boolean }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  const { pathname } = useLocation();
  const navigationId = useId();
  const reducedMotion = useReducedNavigationMotion();
  const isTwin = Boolean(matchPath(navigation.twin.to, pathname));
  const compact = !desktop || collapsed;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); }
    catch { /* The sidebar remains usable with browser storage disabled. */ }
  }

  return (
    <motion.aside
      className="nav-sidebar sticky flex shrink-0 flex-col self-start border-r border-nav-border bg-nav-sidebar"
      data-layout={compact ? 'compact' : 'expanded'}
      initial={false}
      animate={{ width: compact ? 'var(--nav-rail-width)' : 'var(--nav-sidebar-width)' }}
      transition={{ duration: reducedMotion || !desktop || isTwin ? 0 : collapsed ? 0.22 : 0.26, ease: INDUSTRIAL_EASE }}
    >
      <div id={navigationId} className="nav-sidebar-scroll">
        <NavigationList layout={compact ? 'compact' : 'expanded'} pathname={pathname} animateSelection={!reducedMotion} />
      </div>
      {desktop && (
        <div className="nav-sidebar-footer">
          <button
            type="button"
            className={navigationControl({ layout: compact ? 'compact' : 'row' })}
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls={navigationId}
            title={collapsed ? 'Expand sidebar' : undefined}
          >
            {collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
            {!compact && <span className="nav-link-label">Collapse sidebar</span>}
          </button>
        </div>
      )}
    </motion.aside>
  );
}
