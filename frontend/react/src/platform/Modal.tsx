import { ReactNode, RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { springPresets } from './motion';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidth?: string;
  initialFocusRef?: RefObject<HTMLElement>;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '520px',
  initialFocusRef,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduced = useReducedMotion();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const dialog = modalRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const backgrounds = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlayRef.current,
    );
    const previousInert = backgrounds.map(element => element.inert);
    backgrounds.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    const initial = initialFocusRef?.current ?? dialog.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? dialog;
    initial.focus();
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hidden && !element.closest('[hidden], [inert]') && getComputedStyle(element).display !== 'none');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', containFocus);
      backgrounds.forEach((element, index) => { element.inert = previousInert[index]; });
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen, initialFocusRef]);

  // Unmount immediately on close so an exiting overlay cannot intercept restored focus.
  if (typeof document === 'undefined' || !isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          ref={overlayRef}
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
            transition={{ duration: reduced ? 0 : 0.18 }}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={subtitle ? descriptionId : undefined}
            tabIndex={-1}
            initial={reduced ? false : { opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 12 }}
            transition={reduced ? { duration: 0 } : springPresets.smooth}
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
                <h2 id={titleId}
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
                  <p id={descriptionId}
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
