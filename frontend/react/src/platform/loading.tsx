import React, { useEffect, useState } from 'react';

/**
 * Base Skeleton component with shimmer animation.
 * Uses 8% foreground blend rather than flat grey for theme coherence.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circle' | 'rectangular' | 'rounded';
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  borderRadius,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const getBorderRadius = () => {
    if (borderRadius !== undefined) return borderRadius;
    if (variant === 'circle') return '50%';
    if (variant === 'rounded') return '8px';
    if (variant === 'text') return '4px';
    return '0px';
  };

  const getDefaultHeight = () => {
    if (height !== undefined) return height;
    if (variant === 'text') return '1rem';
    if (variant === 'circle') return width ?? 40;
    return '100px';
  };

  const computedStyle: React.CSSProperties = {
    width: width ?? (variant === 'circle' ? getDefaultHeight() : '100%'),
    height: getDefaultHeight(),
    borderRadius: getBorderRadius(),
    ...style,
  };

  return <div className={`skeleton-shimmer skeleton-${variant} ${className}`} style={computedStyle} {...props} />;
}

export function SkeletonText({
  lines = 3,
  widths = ['100%', '80%', '60%'],
  gap = 8,
  lineHeight = 16,
  className = '',
}: {
  lines?: number;
  widths?: (string | number)[];
  gap?: number;
  lineHeight?: number;
  className?: string;
}) {
  return (
    <div className={`skeleton-text-group ${className}`} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" width={widths[i % widths.length]} height={lineHeight} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <Skeleton variant="circle" width={size} height={size} className={className} />;
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`panel skeleton-card-wrapper ${className}`} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton variant="text" width="40%" height={16} />
        <Skeleton variant="circle" width={24} height={24} />
      </div>
      <Skeleton variant="text" width="60%" height={32} />
      <Skeleton variant="rounded" width="100%" height={48} />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Skeleton variant="text" width="30%" height={14} />
        <Skeleton variant="text" width="25%" height={14} />
      </div>
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = [40, 200, 180, 120, 100, 80],
  className = '',
}: {
  rows?: number;
  columns?: number[];
  className?: string;
}) {
  return (
    <div className={`skeleton-table-wrapper ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '12px', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.08))' }}>
        {columns.map((colWidth, idx) => (
          <Skeleton key={idx} variant="text" width={colWidth} height={14} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))' }}>
          {columns.map((colWidth, colIdx) => (
            <Skeleton key={colIdx} variant={colIdx === 0 ? 'circle' : 'text'} width={colIdx === 0 ? 20 : colWidth} height={colIdx === 0 ? 20 : 16} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Multi-variant Spinner component
 * - simple: Circular SVG with stroke-dasharray animation
 * - dots: 3 staggered scaling dots
 * - branded: ComPallette 'C' mark with pulse
 */
export interface SpinnerProps {
  variant?: 'circular' | 'dots' | 'branded';
  size?: 'sm' | 'md' | 'lg' | 'fullscreen';
  color?: string;
  className?: string;
}

export function Spinner({ variant = 'circular', size = 'md', color, className = '' }: SpinnerProps) {
  const pixelSizes = { sm: 16, md: 24, lg: 48, fullscreen: 64 };
  const px = pixelSizes[size];

  if (variant === 'dots') {
    return (
      <div className={`spinner-dots spinner-size-${size} ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: px / 6 }}>
        <span className="dot dot-1" style={{ width: px / 4, height: px / 4, backgroundColor: color || 'currentColor' }} />
        <span className="dot dot-2" style={{ width: px / 4, height: px / 4, backgroundColor: color || 'currentColor' }} />
        <span className="dot dot-3" style={{ width: px / 4, height: px / 4, backgroundColor: color || 'currentColor' }} />
      </div>
    );
  }

  if (variant === 'branded') {
    return (
      <div className={`spinner-branded spinner-size-${size} ${className}`} style={{ width: px, height: px }}>
        <div className="brand-mark brand-pulse" style={{ width: '100%', height: '100%', fontSize: px * 0.55 }}>C</div>
      </div>
    );
  }

  // Circular SVG
  const content = (
    <svg
      className={`spinner-svg spinner-size-${size} ${className}`}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <circle className="spinner-track" cx="12" cy="12" r="10" opacity="0.2" />
      <path className="spinner-arc" d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );

  if (size === 'fullscreen') {
    return (
      <div className="spinner-fullscreen-backdrop" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
        {content}
        <span className="muted" style={{ fontSize: '0.9rem' }}>Loading industrial platform...</span>
      </div>
    );
  }

  return content;
}

/**
 * Progress Bar component (Determinate or Indeterminate)
 */
export function ProgressBar({
  value,
  height = 'subtle',
  className = '',
}: {
  value?: number; // 0 to 100. If undefined, indeterminate
  height?: 'subtle' | 'prominent';
  className?: string;
}) {
  const barHeight = height === 'subtle' ? 4 : 8;
  const isIndeterminate = value === undefined;

  return (
    <div
      className={`progress-bar-track ${className}`}
      style={{
        width: '100%',
        height: barHeight,
        borderRadius: '9999px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        className={isIndeterminate ? 'progress-bar-indeterminate' : 'progress-bar-determinate'}
        style={{
          height: '100%',
          width: isIndeterminate ? '40%' : `${Math.min(100, Math.max(0, value))}%`,
          backgroundColor: 'var(--accent, #00b4d8)',
          borderRadius: '9999px',
          transition: isIndeterminate ? 'none' : 'width 0.3s ease',
        }}
      />
    </div>
  );
}

/**
 * Fixed-dimension loading button to prevent layout shift
 */
export interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

export function LoadingButton({
  children,
  isLoading = false,
  loadingText,
  icon,
  className = '',
  disabled,
  ...props
}: LoadingButtonProps) {
  return (
    <button
      className={`button ${className} ${isLoading ? 'is-loading' : ''}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner variant="circular" size="sm" />
          <span>{loadingText || 'Saving...'}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}

/**
 * Context-aware tiered loading wrapper:
 * <300ms: no indicator
 * 300ms-1s: spinner only
 * >1s: skeleton
 * >3s: diagnostic message
 */
export function SmartLoadingState({
  skeleton,
  minDelay = 300,
  skeletonThreshold = 1000,
  staleMessageThreshold = 3000,
  diagnosticMessage = 'Data collection in progress across network nodes...',
}: {
  skeleton?: React.ReactNode;
  minDelay?: number;
  skeletonThreshold?: number;
  staleMessageThreshold?: number;
  diagnosticMessage?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const interval = setInterval(() => {
      setElapsed(performance.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (elapsed < minDelay) {
    return null; // Instant feel
  }

  if (elapsed < skeletonThreshold) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
        <Spinner variant="circular" size="md" />
      </div>
    );
  }

  return (
    <div className="smart-loading-container" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      {skeleton || <SkeletonCard />}
      {elapsed > staleMessageThreshold && (
        <p className="muted" style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
          {diagnosticMessage}
        </p>
      )}
    </div>
  );
}
