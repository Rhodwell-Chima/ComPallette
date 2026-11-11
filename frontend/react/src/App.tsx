import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './platform/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage } from './pages/AlertsPage';
import { AssetsPage, PersonnelPage } from './pages/RegistryPages';
import { DevicesPage, EnvironmentalPage } from './pages/MonitoringPages';
import { TwinPage } from './pages/TwinPage';
import { AccessPage, AuditPage, IntegrationsPage, ReportsPage, SettingsPage, SitesZonesPage } from './pages/AdministrationPages';

export function App() {
  return <Routes><Route element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="twin" element={<TwinPage />} /><Route path="alerts" element={<AlertsPage />} /><Route path="personnel" element={<PersonnelPage />} /><Route path="assets" element={<AssetsPage />} /><Route path="environment" element={<EnvironmentalPage />} /><Route path="devices" element={<DevicesPage />} /><Route path="sites-zones" element={<SitesZonesPage />} /><Route path="reports" element={<ReportsPage />} /><Route path="integrations" element={<IntegrationsPage />} /><Route path="audit" element={<AuditPage />} /><Route path="access" element={<AccessPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes>;
}
