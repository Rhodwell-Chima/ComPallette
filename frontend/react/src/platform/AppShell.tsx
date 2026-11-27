import { useEffect, useRef } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { AppSidebar } from './navigation/ResponsiveNavigation';
import { useNavigationLayout } from './navigation/useNavigationLayout';

export function AppShell() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const content = useRef<HTMLElement>(null);
  const layout = useNavigationLayout();

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    window.scrollTo(0, 0);
    content.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="app-shell cockpit-shell min-h-dvh" data-navigation-layout={layout}>
        <a className="nav-skip-link" href="#main-content" tabIndex={0}>Skip to main content</a>
        <Navbar mobile={layout === 'mobile'} />
        <div className="flex min-w-0 grow items-start">
          {layout !== 'mobile' && <AppSidebar desktop={layout === 'desktop'} />}
          <main ref={content} id="main-content" tabIndex={-1} className="page-content min-w-0 grow">
            <Outlet />
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
