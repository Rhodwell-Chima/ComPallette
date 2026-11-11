import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import {
  getPrefersReducedMotion,
  pageBackVariants,
  pageDashboardVariants,
  pageDrillDownVariants,
  reducedMotionVariants,
} from './motion';

export function AppShell() {
  const location = useLocation();

  // Route history depth tracking for directional transition variant selection
  const prevPathRef = useRef(location.pathname);
  const [direction, setDirection] = useState<'dashboard' | 'drilldown' | 'back'>('dashboard');

  useEffect(() => {
    const prev = prevPathRef.current;
    const current = location.pathname;
    if (current === '/') {
      setDirection('dashboard');
    } else if (prev === '/' && current !== '/') {
      setDirection('drilldown');
    } else if (prev !== '/' && current === '/') {
      setDirection('back');
    } else {
      setDirection('drilldown');
    }
    prevPathRef.current = current;

    // Reset scroll to top on forward/normal route change
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  const prefersReduced = getPrefersReducedMotion();
  const currentVariants = prefersReduced
    ? reducedMotionVariants
    : direction === 'dashboard'
    ? pageDashboardVariants
    : direction === 'back'
    ? pageBackVariants
    : pageDrillDownVariants;

  // On the Digital Twin stage (/twin), we can optionally provide a sleek transparent header effect
  const isTwinStage = location.pathname === '/twin';

  return (
    <div className="app-shell full-width-layout" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Universal Desktop & Mobile Navbar with Mega Menu, Dropdowns, Sticky Elevation & Search */}
      <Navbar transparent={isTwinStage} />

      {/* Main Page Stage with Animated Directional Transitions */}
      <main
        className="page-content"
        style={{
          position: 'relative',
          overflowX: 'hidden',
          flex: 1,
          width: '100%',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={currentVariants}
            style={{ width: '100%' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
