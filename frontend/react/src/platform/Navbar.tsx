import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ClipboardList,
  FileBarChart,
  Layers,
  LayoutDashboard,
  Map,
  Menu,
  Network,
  PlugZap,
  Search,
  Settings,
  SunMoon,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchBackendHealth, platformApi } from '../services/api';
import { usePlatform } from './PlatformContext';
import { BackendConnection } from './BackendConnection';
import { useOperatorSession } from '../components/AuthGate';

export interface NavbarProps {
  transparent?: boolean;
  onMobileMenuToggle?: () => void;
  className?: string;
}

/**
 * High-performance Industrial Navigation Bar for ComPallette:
 * - Desktop Height: 64px - 70px (smooth shrink on scroll)
 * - Brand Lockup: Insignia mark + ComPallette Mining Cockpit title stack
 * - Nav links: Pill highlights, iconography, keyboard accessibility
 * - Dropdown menus: Hover/click triggered with smooth spring entrance & pointer bridge
 * - Mega Menu: 3 categorized columns + Featured Digital Twin stage card
 * - Sticky behavior: Fixed top with subtle elevation shadow & background blur transition
 * - Transparent Header mode: For hero/twin stages with scroll-to-solid transitions
 * - Mobile Navigation: Hamburger menu, off-canvas sliding drawer & stacked links
 * - Global Search: Expandable search with keyboard shortcut trigger (/ or ⌘K)
 * - Active Alert Indicator: Breathing status badge on notifications bell
 * - Operator Profile: Compact avatar pill with inline sign-out
 */
export function Navbar({ transparent = false, className = '' }: NavbarProps) {
  const { session, signOut } = useOperatorSession();
  const { sites, selectedSiteId, setSelectedSiteId, can, theme, toggleTheme } = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();

  // Scroll state for sticky header elevation & height shrink
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'mega' | 'operations' | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Search input state
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mega menu ref for outside click detection
  const navContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 15);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setActiveDropdown(null);
    setMobileOpen(false);
  }, [location.pathname]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navContainerRef.current && !navContainerRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global keyboard shortcut to open search with '/' or 'Cmd+K / Ctrl+K'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Search API query
  const searchResults = useQuery({
    queryKey: ['navbar-search', selectedSiteId, searchQuery],
    queryFn: () => platformApi.search(selectedSiteId, searchQuery),
    enabled: searchQuery.trim().length > 1 && Boolean(selectedSiteId),
    staleTime: 15_000,
  });

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const firstResult = searchResults.data?.results[0];
    if (firstResult) {
      navigate(firstResult.route);
      setSearchQuery('');
      setSearchExpanded(false);
    }
  };

  const handleSearchBlur = () => {
    if (!searchQuery.trim()) {
      setSearchExpanded(false);
    }
  };

  const health = useQuery({
    queryKey: ['backend-health'],
    queryFn: fetchBackendHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Query alerts to display the active notification indicator on the bell
  const alertsQuery = useQuery({
    queryKey: ['navbar-alerts', selectedSiteId],
    queryFn: () => platformApi.alerts(selectedSiteId, 'NEW'),
    enabled: Boolean(selectedSiteId),
    staleTime: 30_000,
  });
  const unacknowledgedCount = alertsQuery.data?.alerts?.length ?? 0;

  const isTransparentActive = transparent && !isScrolled;

  return (
    <>
      <header
        ref={navContainerRef}
        className={`compallette-navbar ${isScrolled ? 'is-scrolled' : ''} ${
          isTransparentActive ? 'is-transparent' : 'is-solid'
        } ${className}`}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: isScrolled ? '64px' : '70px',
          padding: '0 28px',
          backgroundColor: isTransparentActive
            ? 'transparent'
            : 'color-mix(in srgb, var(--surface) 92%, transparent)',
          backdropFilter: isTransparentActive ? 'none' : 'blur(16px)',
          borderBottom: isTransparentActive ? '1px solid transparent' : '1px solid var(--border)',
        }}
      >
        {/* Left Side: Brand Logo & Desktop Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <Link
            to="/"
            className="navbar-brand"
            aria-label="ComPallette Home Dashboard"
          >
            <div className="navbar-brand-mark" aria-hidden="true">
              C
            </div>
            <div className="navbar-brand-text">
              <strong className="navbar-brand-title">ComPallette</strong>
              <span className="navbar-brand-subtitle">Mining Cockpit</span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav
            className="navbar-desktop-nav"
            aria-label="Main Navigation"
          >
            {/* Overview / Home */}
            <NavLink
              to="/"
              end
              className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}
            >
              <LayoutDashboard size={15} />
              <span>Dashboard</span>
            </NavLink>

            {/* Operations Dropdown */}
            <div
              className="navbar-dropdown-trigger"
              onMouseEnter={() => setActiveDropdown('operations')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button
                type="button"
                className={`navbar-link-btn ${
                  ['/twin', '/alerts', '/personnel', '/assets', '/environment'].includes(location.pathname)
                    ? 'is-active'
                    : ''
                }`}
                onClick={() =>
                  setActiveDropdown((curr) => (curr === 'operations' ? null : 'operations'))
                }
                aria-expanded={activeDropdown === 'operations'}
                aria-haspopup="true"
              >
                <Activity size={15} />
                <span>Operations</span>
                <ChevronDown size={13} className={`chevron-indicator ${activeDropdown === 'operations' ? 'rotate-180' : ''}`} />
              </button>

              {/* Operations Dropdown Menu */}
              {activeDropdown === 'operations' && (
                <div className="navbar-dropdown-menu" role="menu">
                  <Link to="/twin" className="navbar-dropdown-item" role="menuitem">
                    <div className="dropdown-icon-badge"><Map size={15} /></div>
                    <div className="dropdown-item-content">
                      <strong>Digital Twin</strong>
                      <small>Spatial 2D / 3D Layout</small>
                    </div>
                  </Link>
                  <Link to="/alerts" className="navbar-dropdown-item" role="menuitem">
                    <div className="dropdown-icon-badge"><Bell size={15} /></div>
                    <div className="dropdown-item-content">
                      <strong>Alerts &amp; Incidents</strong>
                      <small>Safety Alarms Queue</small>
                    </div>
                  </Link>
                  <Link to="/personnel" className="navbar-dropdown-item" role="menuitem">
                    <div className="dropdown-icon-badge"><Users size={15} /></div>
                    <div className="dropdown-item-content">
                      <strong>Personnel</strong>
                      <small>Accountability &amp; Tags</small>
                    </div>
                  </Link>
                  <Link to="/assets" className="navbar-dropdown-item" role="menuitem">
                    <div className="dropdown-icon-badge"><Boxes size={15} /></div>
                    <div className="dropdown-item-content">
                      <strong>Assets</strong>
                      <small>Fleet &amp; Heavy Machinery</small>
                    </div>
                  </Link>
                  <Link to="/environment" className="navbar-dropdown-item" role="menuitem">
                    <div className="dropdown-icon-badge"><Activity size={15} /></div>
                    <div className="dropdown-item-content">
                      <strong>Environmental</strong>
                      <small>Gas &amp; Atmospheric Logs</small>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            {/* Mega Menu Trigger */}
            <div
              className="navbar-dropdown-trigger"
              onMouseEnter={() => setActiveDropdown('mega')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button
                type="button"
                className={`navbar-link-btn ${
                  ['/devices', '/sites-zones', '/reports', '/integrations', '/audit'].includes(
                    location.pathname
                  )
                    ? 'is-active'
                    : ''
                }`}
                onClick={() => setActiveDropdown((curr) => (curr === 'mega' ? null : 'mega'))}
                aria-expanded={activeDropdown === 'mega'}
                aria-haspopup="true"
              >
                <Boxes size={15} />
                <span>Modules &amp; Management</span>
                <ChevronDown size={13} className={`chevron-indicator ${activeDropdown === 'mega' ? 'rotate-180' : ''}`} />
              </button>

              {/* Contained Mega Menu */}
              {activeDropdown === 'mega' && (
                <div className="navbar-mega-menu" role="menu">
                  {/* Column 1: Infrastructure */}
                  <div className="mega-menu-col">
                    <p className="mega-menu-eyebrow">Infrastructure</p>
                    <Link to="/devices" className="mega-menu-link" role="menuitem">
                      <div className="dropdown-icon-badge"><Network size={14} /></div>
                      <div className="dropdown-item-content">
                        <strong>Devices &amp; Mesh</strong>
                        <small>Hardware nodes &amp; gateways</small>
                      </div>
                    </Link>
                    {can('manage_sites') && (
                      <Link to="/sites-zones" className="mega-menu-link" role="menuitem">
                        <div className="dropdown-icon-badge"><Layers size={14} /></div>
                        <div className="dropdown-item-content">
                          <strong>Sites &amp; Zones</strong>
                          <small>Facilities &amp; layout geometry</small>
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Column 2: Governance & Logs */}
                  <div className="mega-menu-col">
                    <p className="mega-menu-eyebrow">Operations</p>
                    <Link to="/reports" className="mega-menu-link" role="menuitem">
                      <div className="dropdown-icon-badge"><FileBarChart size={14} /></div>
                      <div className="dropdown-item-content">
                        <strong>Reports</strong>
                        <small>Site safety audits</small>
                      </div>
                    </Link>
                    <Link to="/integrations" className="mega-menu-link" role="menuitem">
                      <div className="dropdown-icon-badge"><PlugZap size={14} /></div>
                      <div className="dropdown-item-content">
                        <strong>Integrations</strong>
                        <small>SCADA &amp; upstream APIs</small>
                      </div>
                    </Link>
                    <Link to="/audit" className="mega-menu-link" role="menuitem">
                      <div className="dropdown-icon-badge"><ClipboardList size={14} /></div>
                      <div className="dropdown-item-content">
                        <strong>Audit Trail</strong>
                        <small>Server-verified actions</small>
                      </div>
                    </Link>
                  </div>

                  {/* Column 3: Administration */}
                  <div className="mega-menu-col">
                    <p className="mega-menu-eyebrow">System</p>
                    <Link to="/access" className="mega-menu-link" role="menuitem">
                      <div className="dropdown-icon-badge"><UserRoundCheck size={14} /></div>
                      <div className="dropdown-item-content">
                        <strong>Users &amp; Access</strong>
                        <small>Roles &amp; operator accounts</small>
                      </div>
                    </Link>
                    {(can('manage_settings') || can('manage_sites')) && (
                      <Link to="/settings" className="mega-menu-link" role="menuitem">
                        <div className="dropdown-icon-badge"><Settings size={14} /></div>
                        <div className="dropdown-item-content">
                          <strong>Settings &amp; Controls</strong>
                          <small>Thresholds, mesh &amp; system</small>
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Column 4: Featured / Quick Launch Card */}
                  <div className="mega-menu-featured">
                    <div style={{ position: 'relative', zIndex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px rgba(56, 189, 248, 0.6)' }} />
                        <strong style={{ fontSize: '0.84rem', color: '#f8fafc' }}>Digital Twin</strong>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.45 }}>
                        Live spatial telemetry with 2D / 3D location evidence.
                      </p>
                    </div>
                    <Link
                      to="/twin"
                      className="mega-menu-featured-btn"
                      onClick={() => setActiveDropdown(null)}
                    >
                      <span>Launch Stage</span>
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Direct Link: Access */}
            <NavLink
              to="/access"
              className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}
            >
              <UserRoundCheck size={15} />
              <span>Users &amp; Access</span>
            </NavLink>

            {/* Direct Link: Settings */}
            {(can('manage_settings') || can('manage_sites')) && (
              <NavLink
                to="/settings"
                className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}
              >
                <Settings size={15} />
                <span>Settings</span>
              </NavLink>
            )}
          </nav>
        </div>

        {/* Right Side: Grouped Clusters (Context + Actions) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Sub-group 1: Context Group (Search, Site Selector, Backend Status) */}
          <div
            className={`navbar-search-wrapper ${searchExpanded ? 'is-expanded' : ''}`}
            style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
          >
            {searchExpanded ? (
              <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  className="global-search"
                  style={{
                    width: '260px',
                    animation: 'navbarSearchExpand 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <Search size={15} />
                  <input
                    ref={searchInputRef}
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onBlur={handleSearchBlur}
                    placeholder="Search node, person, asset..."
                    aria-label="Global search"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => {
                      setSearchQuery('');
                      setSearchExpanded(false);
                    }}
                    style={{ padding: '2px', width: '22px', height: '22px' }}
                    aria-label="Clear and close search"
                  >
                    <X size={13} />
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="navbar-search-btn"
                onClick={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                aria-label="Open search bar"
                title="Search records (/ or ⌘K)"
              >
                <Search size={14} />
                <span>Search...</span>
                <kbd className="navbar-search-kbd">/</kbd>
              </button>
            )}

            {/* Search Results Dropdown */}
            {searchExpanded && searchQuery.trim().length > 1 && (
              <div className="search-results" style={{ width: '300px' }}>
                {searchResults.isLoading ? (
                  <span>Searching...</span>
                ) : searchResults.data?.results.length ? (
                  searchResults.data.results.map((result) => (
                    <button
                      type="button"
                      key={`${result.kind}-${result.id}`}
                      onClick={() => {
                        navigate(result.route);
                        setSearchQuery('');
                        setSearchExpanded(false);
                      }}
                    >
                      <small>{result.kind}</small>
                      {result.label}
                    </button>
                  ))
                ) : (
                  <span>No matching site records</span>
                )}
              </div>
            )}
          </div>

          {/* Active Site Selector */}
          <label className="site-selector" style={{ margin: 0 }}>
            <span className="sr-only">Active site</span>
            <Building2 size={13} className="site-selector-lead-icon" aria-hidden="true" />
            <select
              value={selectedSiteId ?? ''}
              onChange={(e) => setSelectedSiteId(Number(e.target.value))}
              disabled={!sites.length}
              aria-label="Select active site"
            >
              {sites.length ? (
                sites.map((site) => (
                  <option value={site.id} key={site.id}>
                    {site.name}
                  </option>
                ))
              ) : (
                <option>No sites available</option>
              )}
            </select>
            <ChevronDown size={13} className="site-selector-icon" aria-hidden="true" />
          </label>

          {/* Health connection status pill */}
          <BackendConnection data={health.data} isError={health.isError} dataUpdatedAt={health.dataUpdatedAt} />

          {/* Subtle separator divider between context and actions */}
          <span className="navbar-divider" aria-hidden="true" />

          {/* Sub-group 2: Action Group (Alerts Bell, Theme Switcher, Digital Twin CTA, Profile Pill) */}
          <NavLink
            to="/alerts"
            className="icon-button alerts-bell-btn"
            aria-label={unacknowledgedCount > 0 ? `View active alerts (${unacknowledgedCount} unacknowledged)` : 'View active alerts'}
            title={unacknowledgedCount > 0 ? `${unacknowledgedCount} unacknowledged alerts` : 'Alerts & Incidents'}
          >
            <Bell size={17} />
            {unacknowledgedCount > 0 && <span className="alerts-indicator-dot" aria-hidden="true" />}
          </NavLink>

          {/* Theme switcher */}
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            <SunMoon size={17} />
          </button>

          {/* Quick Settings Action */}
          {(can('manage_settings') || can('manage_sites')) && (
            <NavLink
              to="/settings"
              className={({ isActive }) => `icon-button ${isActive ? 'is-active' : ''}`}
              aria-label="Settings & Operational Controls"
              title="Settings & Operational Controls"
            >
              <Settings size={17} />
            </NavLink>
          )}

          {/* Primary Action Button: Digital Twin */}
          <Link
            to="/twin"
            className="button primary navbar-cta-btn"
            title="Launch Digital Twin Stage"
          >
            <Map size={14} />
            <span>Digital Twin</span>
          </Link>

          {/* Operator Profile Badge */}
          <div className="user-menu operator-profile-pill" title={`Signed in as ${session.username}`}>
            <span className="operator-avatar" aria-hidden="true">
              {(session.username?.[0] ?? 'O').toUpperCase()}
            </span>
            <span className="operator-name">{session.username}</span>
            <button
              type="button"
              className="signout-btn button ghost"
              onClick={() => void signOut()}
              aria-label="Sign out of operator session"
            >
              Sign out
            </button>
          </div>

          {/* Mobile Hamburger Icon */}
          <button
            type="button"
            className="icon-button navbar-mobile-hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open mobile navigation menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Mobile Off-Canvas Sliding Navigation Drawer */}
      {mobileOpen && (
        <div className="navbar-mobile-backdrop" onClick={() => setMobileOpen(false)}>
          <div
            className="navbar-mobile-drawer panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(320px, 85vw)',
              zIndex: 100,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              overflowY: 'auto',
              background: 'var(--surface)',
              boxShadow: '-10px 0 35px rgba(0, 0, 0, 0.4)',
              animation: 'navbarDrawerSlideIn 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="navbar-brand-mark" style={{ width: 30, height: 30, fontSize: '0.95rem' }}>C</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ fontSize: '0.98rem', lineHeight: 1.1, color: 'var(--text)' }}>ComPallette</strong>
                  <span style={{ fontSize: '0.62rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Cockpit</span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>

            {/* Mobile Stacked Navigation Links */}
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <NavLink to="/" end className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <LayoutDashboard size={18} /> Dashboard
              </NavLink>
              <NavLink to="/twin" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Map size={18} /> Digital Twin
              </NavLink>
              <NavLink to="/alerts" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Bell size={18} /> Alerts &amp; Incidents
              </NavLink>
              <NavLink to="/personnel" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Users size={18} /> Personnel
              </NavLink>
              <NavLink to="/assets" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Boxes size={18} /> Assets
              </NavLink>
              <NavLink to="/environment" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Activity size={18} /> Environmental
              </NavLink>
              <NavLink to="/devices" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <Network size={18} /> Devices &amp; Mesh
              </NavLink>
              {can('manage_sites') && (
                <NavLink to="/sites-zones" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                  <Layers size={18} /> Sites &amp; Zones
                </NavLink>
              )}
              <NavLink to="/reports" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <FileBarChart size={18} /> Reports
              </NavLink>
              <NavLink to="/access" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <UserRoundCheck size={18} /> Users &amp; Access
              </NavLink>
              <NavLink to="/audit" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                <ClipboardList size={18} /> Audit Log
              </NavLink>
              {(can('manage_settings') || can('manage_sites')) && (
                <NavLink to="/settings" className="navbar-mobile-link" onClick={() => setMobileOpen(false)}>
                  <Settings size={18} /> Settings &amp; Controls
                </NavLink>
              )}
            </nav>

            {/* Mobile Footer & Logout */}
            <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="operator-avatar" style={{ width: 26, height: 26, fontSize: '0.75rem' }}>
                    {(session.username?.[0] ?? 'O').toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text)' }}>{session.username}</span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                >
                  <SunMoon size={18} />
                </button>
              </div>
              <button
                type="button"
                className="button secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
