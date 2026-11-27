import { useId, type MouseEvent } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { matchPath, NavLink } from 'react-router-dom';
import { usePlatform } from '../PlatformContext';
import { INDUSTRIAL_EASE } from '../motion';
import { navigationGroups, type NavigationDestination } from './config';
import { cn, navigationControl } from './styles';

type NavigationLayout = 'expanded' | 'compact' | 'drawer';

function NavigationItem({
  item,
  layout,
  pathname,
  animateSelection,
  onNavigate,
}: {
  item: NavigationDestination;
  layout: NavigationLayout;
  pathname: string;
  animateSelection: boolean;
  onNavigate?: () => void;
}) {
  const compact = layout === 'compact';
  const Icon = item.icon;
  const exact = Boolean(matchPath(item.to, pathname));
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      tabIndex={0}
      aria-current={exact ? 'page' : 'location'}
      className={cn('nav-destination', navigationControl({ layout: compact ? 'compact' : 'row' }))}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (exact && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) {
          onNavigate?.();
        }
      }}
    >
      {({ isActive }) => (
        <>
          {isActive && (animateSelection
            ? <motion.span
                className="nav-selection"
                layoutId="active-destination"
                transition={{ duration: 0.22, ease: INDUSTRIAL_EASE }}
                aria-hidden="true"
              />
            : <span className="nav-selection" aria-hidden="true" />)}
          <Icon className="relative size-5 shrink-0" aria-hidden="true" />
          <span className={compact ? 'sr-only' : 'nav-link-label relative'}>{item.label}</span>
        </>
      )}
    </NavLink>
  );

  if (!compact) return link;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="nav-tooltip" side="right" sideOffset={8} collisionPadding={8}>
          {item.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function NavigationList({
  layout,
  pathname,
  animateSelection = false,
  onNavigate,
}: {
  layout: NavigationLayout;
  pathname: string;
  animateSelection?: boolean;
  onNavigate?: () => void;
}) {
  const { can } = usePlatform();
  const instanceId = useId();

  return (
    <LayoutGroup id={instanceId}>
      <nav aria-label="Primary navigation" className={cn('grid content-start px-2 pb-3', layout === 'compact' ? 'gap-2' : 'gap-4 px-3')}>
        {navigationGroups.map(({ label, items }) => {
          const visible = items.filter(item => !item.capability || can(item.capability));
          if (!visible.length) return null;
          const labelId = `${instanceId}-${visible[0].id}`;
          return (
            <div key={label} className={layout === 'compact' ? 'nav-compact-group' : undefined}>
              <h2 id={labelId} className={layout === 'compact' ? 'sr-only' : 'nav-group-heading'}>{label}</h2>
              <ul aria-labelledby={labelId} className="nav-list">
                {visible.map(item => (
                  <li key={item.id}>
                    <NavigationItem item={item} layout={layout} pathname={pathname} animateSelection={animateSelection} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
