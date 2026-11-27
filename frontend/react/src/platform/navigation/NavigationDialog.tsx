import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn, navigationControl } from './styles';

type NavigationDialogProps = Pick<ComponentPropsWithoutRef<typeof Dialog.Content>, 'onCloseAutoFocus' | 'onOpenAutoFocus'> & {
  open: boolean;
  layout?: 'sheet' | 'center';
  title: string;
  children: ReactNode;
};

// Source-owned Sheet/Dialog styling over Radix, following the shadcn composition pattern.
export function NavigationDialog({ open, layout = 'center', title, children, onCloseAutoFocus, onOpenAutoFocus }: NavigationDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.inert = !open;
  }, [open]);

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="nav-overlay" />
      <Dialog.Content
        ref={contentRef}
        aria-describedby={undefined}
        aria-modal="true"
        className={cn('nav-dialog bg-nav-surface text-nav-text', layout === 'sheet' ? 'nav-sheet' : 'nav-centered-dialog')}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        <div className="nav-dialog-header flex items-center justify-between gap-3">
          <Dialog.Title className="nav-dialog-title">{title}</Dialog.Title>
          <Dialog.Close className={navigationControl()} aria-label={layout === 'sheet' ? 'Close navigation' : 'Close search'}>
            <X size={20} aria-hidden="true" />
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
