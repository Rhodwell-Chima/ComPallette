import { GatewaysPage } from './pages/GatewaysPage';
import { EntityDetailPage } from './pages/EntityDetailPage';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './platform/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage } from './pages/AlertsPage';
import { AssetsPage, PersonnelPage } from './pages/RegistryPages';
import { DevicesPage, EnvironmentalPage } from './pages/MonitoringPages';
import { TwinPage } from './pages/TwinPage';
import { AccessPage, AuditPage, IntegrationsPage, ReportsPage, SettingsPage, SitesZonesPage } from './pages/AdministrationPages';
import { ProtectedRoute } from './platform/rbac';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="twin" element={<TwinPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="personnel/:id" element={<EntityDetailPage kind="personnel" />} />
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
        <Route path="audit" element={<ProtectedRoute requiredCapability="view_audit"><AuditPage /></ProtectedRoute>} />
        <Route path="access" element={<ProtectedRoute requiredCapability="manage_users"><AccessPage /></ProtectedRoute>} />
        <Route path="settings" element={<ProtectedRoute requiredCapability="manage_settings"><SettingsPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

