import { ReactNode } from 'react';
import { usePlatform } from '../PlatformContext';
import { AccessDeniedPage } from './AccessDeniedPage';

export interface ProtectedRouteProps {
  children: ReactNode;
  requiredCapability?: string;
}

export function ProtectedRoute({ children, requiredCapability }: ProtectedRouteProps) {
  const { can, isLoading } = usePlatform();

  if (isLoading) {
    return null; // PlatformContext handles bootstrap loading skeletons
  }

  if (requiredCapability && !can(requiredCapability)) {
    return <AccessDeniedPage requiredCapability={requiredCapability} />;
  }

  return <>{children}</>;
}
