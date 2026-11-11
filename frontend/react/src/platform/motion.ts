import { Variants, Transition } from 'framer-motion';

/**
 * High-performance cubic-bezier easing curve for smooth deceleration.
 * [0.32, 0.72, 0, 1]
 */
export const INDUSTRIAL_EASE = [0.32, 0.72, 0, 1] as const;

export const defaultTransition: Transition = {
  duration: 0.25,
  ease: INDUSTRIAL_EASE,
};

export const fastExitTransition: Transition = {
  duration: 0.15,
  ease: 'easeIn',
};

/**
 * 1. Dashboard / Main Top-Level Pages:
 * Enter: fade 200ms + slide-up 12px
 * Exit: fade 150ms
 * No scale
 */
export const pageDashboardVariants: Variants = {
  initial: {
    opacity: 0,
    y: 12,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: INDUSTRIAL_EASE,
    },
  },
  exit: {
    opacity: 0,
    transition: fastExitTransition,
  },
};

/**
 * 2. Detail / Drill-down:
 * Enter: slide from right 100%
 * Exit: slide to left 20% + fade
 * Implies: going deeper into telemetry / drawer / record
 */
export const pageDrillDownVariants: Variants = {
  initial: {
    x: '100%',
    opacity: 0.8,
  },
  animate: {
    x: '0%',
    opacity: 1,
    transition: {
      duration: 0.25,
      ease: INDUSTRIAL_EASE,
    },
  },
  exit: {
    x: '-20%',
    opacity: 0,
    transition: fastExitTransition,
  },
};

/**
 * 3. Back / Up Navigation:
 * Enter: slide from left 100%
 * Exit: slide to right 20% + fade
 * Implies: returning to higher level
 */
export const pageBackVariants: Variants = {
  initial: {
    x: '-100%',
    opacity: 0.8,
  },
  animate: {
    x: '0%',
    opacity: 1,
    transition: {
      duration: 0.25,
      ease: INDUSTRIAL_EASE,
    },
  },
  exit: {
    x: '20%',
    opacity: 0,
    transition: fastExitTransition,
  },
};

/**
 * 4. Modal / Drawer / Overlays:
 * Enter: scale from 0.95 + fade
 * Exit: scale to 0.95 + fade (faster)
 */
export const pageModalVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.2,
      ease: INDUSTRIAL_EASE,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: fastExitTransition,
  },
};

/**
 * Instant fallback variants when operator prefers reduced motion
 */
export const reducedMotionVariants: Variants = {
  initial: { opacity: 1 },
  animate: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 1, transition: { duration: 0 } },
};

/**
 * Detects system preference for reduced motion
 */
export function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}


// =========================================================================
// STAGGERED MOTION ENGINE (Fast 60ms stagger, [0.25, 0.1, 0.25, 1] curve)
// =========================================================================

export const STAGGER_EASE = [0.25, 0.1, 0.25, 1] as const;

export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06, // 60ms fast stagger
      delayChildren: 0,
      ease: STAGGER_EASE,
    },
  },
};

export const staggerItemDownVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: STAGGER_EASE,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.15 },
  },
};

export const staggerItemUpVariants: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: STAGGER_EASE,
    },
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.15 },
  },
};

export const staggerItemRightVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.3,
      ease: STAGGER_EASE,
    },
  },
  exit: {
    opacity: 0,
    x: 16,
    transition: { duration: 0.15 },
  },
};

export const staggerItemScaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: STAGGER_EASE,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.15 },
  },
};

// =========================================================================
// INDUSTRIAL MOTION & PHYSICS PRESETS
// =========================================================================

/**
 * Spring presets calibrated for industrial tactile feedback
 */
export const springPresets = {
  snappy: { type: 'spring', stiffness: 400, damping: 30 } as const,
  smooth: { type: 'spring', stiffness: 200, damping: 25 } as const,
  bouncy: { type: 'spring', stiffness: 300, damping: 10 } as const,
  gentle: { type: 'spring', stiffness: 100, damping: 15 } as const,
};

/**
 * Tween presets for predictable timed animations
 */
export const tweenPresets = {
  fast: { duration: 0.15, ease: 'easeOut' } as const,
  normal: { duration: 0.25, ease: INDUSTRIAL_EASE } as const,
  slow: { duration: 0.4, ease: INDUSTRIAL_EASE } as const,
};

/**
 * Interactive micro-gestures (whileHover, whileTap)
 */
export const microGestures = {
  buttonPress: {
    whileHover: { scale: 1.02, transition: { duration: 0.15 } },
    whileTap: { scale: 0.97, transition: { duration: 0.1 } },
  },
  cardInteractive: {
    whileHover: { y: -2, transition: springPresets.snappy },
    whileTap: { scale: 0.99, transition: { duration: 0.1 } },
  },
  iconRotate: {
    whileHover: { rotate: 15, transition: springPresets.bouncy },
  },
};

/**
 * Component-specific animation variants
 */
export const dropdownVariants: Variants = {
  hidden: { opacity: 0, y: -8, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springPresets.snappy,
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: tweenPresets.fast,
  },
};

export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.94 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springPresets.bouncy,
  },
  exit: {
    opacity: 0,
    y: 8,
    scale: 0.96,
    transition: tweenPresets.fast,
  },
};

export const drawerVariants: Variants = {
  hidden: { x: '100%', opacity: 0.5 },
  visible: {
    x: '0%',
    opacity: 1,
    transition: springPresets.smooth,
  },
  exit: {
    x: '100%',
    opacity: 0,
    transition: tweenPresets.normal,
  },
};

