import { BackendHealth } from '../services/api';
import { formatTimestamp } from './ui';

export function BackendConnection({ data, isError, dataUpdatedAt }: { data?: BackendHealth; isError: boolean; dataUpdatedAt: number }) {
  const label = isError ? (data ? 'Status unverified' : 'Connection failed') : data?.status === 'healthy' ? 'Connected' : data ? 'Status unverified' : 'Checking';
  const connected = label === 'Connected';
  return <span className={`connection backend-connection ${connected ? 'online' : 'offline'}`} role="status" title={data?.build_revision}>
    <span>Backend: {label}</span>
    {dataUpdatedAt > 0 && <small>Last successful check: {formatTimestamp(dataUpdatedAt)}</small>}
  </span>;
}
