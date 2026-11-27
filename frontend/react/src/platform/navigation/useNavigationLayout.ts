import { useSyncExternalStore } from 'react';

const reducedMotion = '(prefers-reduced-motion: reduce)';

function subscribeToLayout(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotion);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getLayout() {
  // innerWidth stays stable when a modal hides native scrollbars, including in WebKit.
  const { innerWidth, innerHeight } = window;
  if (innerWidth >= 1024) return 'desktop';
  if (innerWidth >= 640 && innerHeight >= 384) return 'tablet';
  return 'mobile';
}

export function useNavigationLayout() {
  return useSyncExternalStore(subscribeToLayout, getLayout, () => 'mobile');
}

export function useReducedNavigationMotion() {
  return useSyncExternalStore(subscribeToMotion, () => window.matchMedia(reducedMotion).matches, () => true);
}
