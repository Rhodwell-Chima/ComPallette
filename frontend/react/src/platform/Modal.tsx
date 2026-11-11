import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { springPresets } from './motion';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '520px',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999, // Render above sticky navbar (zIndex 40)
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            overflowY: 'auto',
          }}
        >
          {/* Backdrop overlay (darkened + blurred) - separate stacking from dialog */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              backgroundColor: 'rgba(11, 18, 37, 0.65)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          />

          {/* Centered Dialog Window (Opaque surface, strictly above backdrop) */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={springPresets.smooth}
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              maxWidth,
              maxHeight: 'calc(100vh - 3rem)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--surface, #ffffff)',
              border: '1px solid var(--border, #dce3ee)',
              borderRadius: '12px',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
              color: 'var(--text, #172033)',
              overflow: 'hidden',
              margin: 'auto',
              isolation: 'isolate',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border, #dce3ee)',
                backgroundColor: 'var(--surface, #ffffff)',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: 'var(--text, #172033)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {title}
                </h2>
                {subtitle && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.8rem',
                      color: 'var(--muted, #64748b)',
                      lineHeight: 1.4,
                    }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px',
                  borderRadius: '6px',
                  color: 'var(--muted, #64748b)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--text, #172033)';
                  e.currentTarget.style.backgroundColor = 'var(--surface-muted, #f7f9fc)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--muted, #64748b)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div
              style={{
                padding: '1.5rem',
                overflowY: 'auto',
                flex: 1,
                backgroundColor: 'var(--surface, #ffffff)',
                color: 'var(--text, #172033)',
              }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
