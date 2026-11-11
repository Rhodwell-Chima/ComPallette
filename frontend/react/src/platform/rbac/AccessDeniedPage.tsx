import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { springPresets } from '../motion';
import { usePlatform } from '../PlatformContext';

export interface AccessDeniedPageProps {
  requiredCapability?: string;
}

export function AccessDeniedPage({ requiredCapability }: AccessDeniedPageProps) {
  const { capabilities } = usePlatform();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springPresets.smooth}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '50%',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '2px solid var(--color-error, #ef4444)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-error, #ef4444)',
          marginBottom: '1.5rem',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-error, #ef4444)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        HTTP 403 Forbidden
      </div>

      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--color-text, #f8fafc)', marginBottom: '0.75rem' }}>
        Access Restricted
      </h1>

      <p style={{ maxWidth: '480px', color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        Your operator profile does not possess the authorization privileges required to view or execute actions in this administrative domain.
      </p>

      {requiredCapability && (
        <div
          style={{
            background: 'var(--color-surface, rgba(15, 23, 42, 0.6))',
            border: '1px solid var(--color-border, rgba(255, 255, 255, 0.1))',
            borderRadius: '6px',
            padding: '0.75rem 1.25rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Missing Capability:</span>
          <code
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
              padding: '2px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontWeight: 600,
            }}
          >
            {requiredCapability}
          </code>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem' }}>
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'var(--color-accent, #3b82f6)',
            color: '#fff',
            padding: '0.65rem 1.25rem',
            borderRadius: '6px',
            fontSize: '0.88rem',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Return to Operational Dashboard
        </Link>
      </div>
    </motion.div>
  );
}
