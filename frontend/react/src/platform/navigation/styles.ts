import { cva } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: ClassValue[]) {
  return twMerge(clsx(classes));
}

export const navigationControl = cva(
  'nav-control relative inline-flex min-h-nav-target items-center justify-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm font-semibold text-nav-muted transition-colors duration-150 hover:bg-nav-hover hover:text-nav-text motion-reduce:transition-none',
  {
    variants: {
      layout: {
        icon: 'w-nav-target shrink-0 px-0',
        row: 'w-full justify-start px-2.5 text-left leading-snug',
        compact: 'mx-auto flex w-nav-target px-0',
        utility: 'shrink-0 px-2',
      },
    },
    defaultVariants: { layout: 'icon' },
  },
);
