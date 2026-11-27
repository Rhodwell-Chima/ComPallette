import * as Popover from '@radix-ui/react-popover';
import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from 'lucide-react';
import { type BackendHealth } from '../services/api';
import { formatTimestamp } from './ui';
import { POLL_OPERATIONAL_MS } from './queryKeys';
import { cn, navigationControl } from './navigation/styles';

export function BackendConnection({
  data,
  isError,
  dataUpdatedAt,
  routeKey,
}: {
  data?: BackendHealth;
  isError: boolean;
  dataUpdatedAt: number;
  routeKey?: string;
}) {
  const label = isError
    ? data ? 'Status unverified' : 'Connection failed'
    : data?.status === 'healthy' ? 'Connected' : data ? 'Status unverified' : 'Checking';
  const Icon = label === 'Connected' ? CircleCheck
    : label === 'Checking' ? LoaderCircle
    : label === 'Connection failed' ? CircleX : CircleHelp;

  const details = [
    ['Service', data?.service || 'Unavailable'],
    ['Database', data?.database || 'Unavailable'],
    ['Version', data?.version || 'Unavailable'],
    ['Revision', data?.build_revision || 'Unavailable'],
    ['Last response', dataUpdatedAt > 0 ? formatTimestamp(dataUpdatedAt) : 'No response yet'],
  ];

  return (
    <>
      <span className="sr-only" role="status">Backend telemetry link: {label}</span>
      <Popover.Root key={routeKey}>
        <Popover.Trigger
          className={cn(navigationControl({ layout: 'utility' }), 'nav-connection')}
          data-connection={label}
          aria-label={`Backend telemetry link: ${label}`}
          title={`Backend telemetry link: ${label}`}
        >
          <Icon size={20} aria-hidden="true" />
          <span className="nav-connection-label" aria-hidden="true">{label}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="nav-floating nav-diagnostics" align="end" sideOffset={8} collisionPadding={8} aria-label="Backend diagnostics">
            <h2 className="nav-dialog-title">Backend diagnostics</h2>
            <p className="nav-diagnostics-status">{label}</p>
            <dl>
              {details.map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <p className="nav-diagnostics-poll">Checked every {POLL_OPERATIONAL_MS / 1000} seconds</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
