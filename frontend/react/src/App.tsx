import { Component, lazy, Suspense, type ReactNode } from 'react';
import { GatewaysPage } from './pages/GatewaysPage';
import { EntityDetailPage } from './pages/EntityDetailPage';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './platform/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage } from './pages/AlertsPage';
import { AssetsPage } from './pages/RegistryPages';
import { PersonnelPage } from './pages/personnel/PersonnelPage';
import { PersonDetailsPage } from './pages/personnel/PersonDetailsPage';
import { DevicesPage, EnvironmentalPage } from './pages/MonitoringPages';
import { AccessPage, AuditPage, IntegrationsPage, ReportsPage, SettingsPage, SitesZonesPage } from './pages/AdministrationPages';
import { ProtectedRoute } from './platform/rbac';
import { navigation } from './platform/navigation/config';
import { LoadingState, ErrorState } from './platform/ui';

const TwinPage = lazy(() => import('./pages/TwinPage').then(module => ({ default: module.TwinPage })));

class TwinRouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <ErrorState message="The Digital Twin workspace could not start." retry={() => window.location.reload()} />
      : this.props.children;
  }
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="twin" element={
          <TwinRouteBoundary>
            <Suspense fallback={<LoadingState label="Opening Digital Twin…" />}><TwinPage /></Suspense>
          </TwinRouteBoundary>
        } />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="personnel/:id" element={<PersonDetailsPage />} />
        <Route path="assets/:id" element={<EntityDetailPage kind="assets" />} />
        <Route path="devices/:id" element={<EntityDetailPage kind="devices" />} />
        <Route path="personnel" element={<PersonnelPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="environment" element={<EnvironmentalPage />} />
        <Route path="gateways" element={<GatewaysPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="sites-zones" element={<SitesZonesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="audit" element={<ProtectedRoute requiredCapability={navigation.audit.capability}><AuditPage /></ProtectedRoute>} />
        <Route path="access" element={<ProtectedRoute requiredCapability={navigation.access.capability}><AccessPage /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute requiredCapability={navigation.settings.capability}><SettingsPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

