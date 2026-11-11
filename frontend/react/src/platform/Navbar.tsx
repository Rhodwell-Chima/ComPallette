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
  HelpCircle,
  Layers,
  LayoutDashboard,
  Map,
  Menu,
  Network,
  PlugZap,
  Radio,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SunMoon,
  UserCheck,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchBackendHealth, platformApi } from '../services/api';
import { usePlatform } from './PlatformContext';
import { useOperatorSession } from '../components/AuthGate';

export interface NavbarProps {
  transparent?: boolean;
  onMobileMenuToggle?: () => void;
  className?: string;
}

/**
 * High-performance Industrial Navigation Bar for ComPallette:
 * - Desktop Height: 64px - 72px (scrolled: 64px, default: 70px)
 * - Logo: Left-aligned, clickable to root dashboard
 * - Nav links: Centered/right of logo with 24-32px spacing, hover transitions & active underline
 * - Dropdown menus: Hover/click triggered with smooth fade + slide down
 * - Mega Menu: Multi-column grouped layout (Operations, Infrastructure, Management, System) with featured cards & outside-click dismissal
 * - Sticky behavior: Fixed on scroll with subtle elevation shadow & background blur transition
 * - Transparent Header mode: For hero/twin stages with scroll-to-solid transitions
 * - Mobile Navigation: Hamburger menu, off-canvas sliding drawer & stacked links
 * - Search in Nav: Expandable search input with live results dropdown
 */
export function Navbar({ transparent = false, className = '' }: NavbarProps) {
  const { session, signOut } = useOperatorSession();
  const { sites, selectedSiteId, setSelectedSiteId, can, theme, toggleTheme } = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();

  // Scroll state for sticky header elevation & height shrink
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'mega' | 'operations' | 'system' | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Search input state
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Mega menu ref for outside click detection
  const navContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
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
          transition: 'height 0.25s ease, background 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
          backgroundColor: isTransparentActive
            ? 'transparent'
            : 'color-mix(in srgb, var(--surface) 90%, transparent)',
          backdropFilter: isTransparentActive ? 'none' : 'blur(16px)',
          borderBottom: isTransparentActive ? '1px solid transparent' : '1px solid var(--border)',
          boxShadow: isScrolled ? '0 4px 20px rgba(0, 0, 0, 0.12)' : 'none',
        }}
      >
        {/* Left Side: Brand Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <Link
            to="/"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
            aria-label="ComPallette Home"
          >
            <div
              className="brand-mark"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                fontSize: '1.2rem',
                fontWeight: 800,
              }}
            >
              C
            </div>
            <div>
              <strong style={{ display: 'block', fontSize: '1.05rem', lineHeight: 1.1, color: 'var(--text)' }}>
                ComPallette
              </strong>
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)' }}>
                Industrial Intelligence
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links (Centered / Right of Logo) */}
          <nav
            className="navbar-desktop-nav"
            style={{ display: 'flex', alignItems: 'center', gap: '28px' }}
            aria-label="Main Navigation"
          >
            {/* Overview / Home */}
            <NavLink
              to="/"
              end
              className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}
            >
              Dashboard
            </NavLink>

            {/* Operations Dropdown */}
            <div
              className="navbar-dropdown-trigger"
              style={{ position: 'relative' }}
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
              >
                <span>Operations</span>
                <ChevronDown size={14} className={activeDropdown === 'operations' ? 'rotate-180' : ''} />
              </button>

              {/* Standard Dropdown Menu */}
              {activeDropdown === 'operations' && (
                <div
                  className="navbar-dropdown-menu panel"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    minWidth: '240px',
                    padding: '8px',
                    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    animation: 'navbarSlideDown 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
                  }}
                >
                  <Link to="/twin" className="navbar-dropdown-item">
                    <Map size={16} />
                    <div>
                      <strong>Digital Twin</strong>
                      <small>Spatial 2D / 3D Layout</small>
                    </div>
                  </Link>
                  <Link to="/alerts" className="navbar-dropdown-item">
                    <Bell size={16} />
                    <div>
                      <strong>Alerts & Incidents</strong>
                      <small>Safety Alarms Queue</small>
                    </div>
                  </Link>
                  <Link to="/personnel" className="navbar-dropdown-item">
                    <Users size={16} />
                    <div>
                      <strong>Personnel</strong>
                      <small>Accountability & Tags</small>
                    </div>
                  </Link>
                  <Link to="/assets" className="navbar-dropdown-item">
                    <Boxes size={16} />
                    <div>
                      <strong>Assets</strong>
                      <small>Fleet & Heavy Machinery</small>
                    </div>
                  </Link>
                  <Link to="/environment" className="navbar-dropdown-item">
                    <Activity size={16} />
                    <div>
                      <strong>Environmental</strong>
                      <small>Gas & Atmospheric Logs</small>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            {/* Mega Menu Trigger */}
            <div
              className="navbar-dropdown-trigger"
              style={{ position: 'relative' }}
              onMouseEnter={() => setActiveDropdown('mega')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button
                type="button"
                className={`navbar-link-btn ${
                  ['/devices', '/sites-zones', '/reports', '/integrations', '/audit', '/access', '/settings'].includes(
                    location.pathname
                  )
                    ? 'is-active'
                    : ''
                }`}
                onClick={() => setActiveDropdown((curr) => (curr === 'mega' ? null : 'mega'))}
                aria-expanded={activeDropdown === 'mega'}
              >
                <span>Modules &amp; Management</span>
                <ChevronDown size={14} className={activeDropdown === 'mega' ? 'rotate-180' : ''} />
              </button>

              {/* Contained Mega Menu */}
              {activeDropdown === 'mega' && (
                <div
                  className="navbar-mega-menu panel"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: '-160px',
                    width: '680px',
                    padding: '24px',
                    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.35)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr) 200px',
                    gap: '20px',
                    animation: 'navbarSlideDown 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
                  }}
                >
                  {/* Column 1: Infrastructure */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p className="eyebrow" style={{ margin: '0 0 6px' }}>Infrastructure</p>
                    <Link to="/devices" className="mega-menu-link">
                      <Network size={15} />
                      <div>
                        <strong>Devices & Mesh</strong>
                        <small>Hardware nodes & gateways</small>
                      </div>
                    </Link>
                    {can('manage_sites') && (
                      <Link to="/sites-zones" className="mega-menu-link">
                        <Layers size={15} />
                        <div>
                          <strong>Sites & Zones</strong>
                          <small>Facilities & layout geometry</small>
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Column 2: Governance & Logs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p className="eyebrow" style={{ margin: '0 0 6px' }}>Operations</p>
                    <Link to="/reports" className="mega-menu-link">
                      <FileBarChart size={15} />
                      <div>
                        <strong>Reports</strong>
                        <small>Site safety audits</small>
                      </div>
                    </Link>
                    <Link to="/integrations" className="mega-menu-link">
                      <PlugZap size={15} />
                      <div>
                        <strong>Integrations</strong>
                        <small>SCADA & upstream APIs</small>
                      </div>
                    </Link>
                    <Link to="/audit" className="mega-menu-link">
                      <ClipboardList size={15} />
                      <div>
                        <strong>Audit Trail</strong>
                        <small>Server-verified actions</small>
                      </div>
                    </Link>
                  </div>

                  {/* Column 3: Administration */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p className="eyebrow" style={{ margin: '0 0 6px' }}>System</p>
                    <Link to="/access" className="mega-menu-link">
                      <UserRoundCheck size={15} />
                      <div>
                        <strong>Users & Access</strong>
                        <small>Roles & operator accounts</small>
                      </div>
                    </Link>
                    {can('manage_sites') && (
                      <Link to="/settings" className="mega-menu-link">
                        <Settings size={15} />
                        <div>
                          <strong>Site Settings</strong>
                          <small>Timezone & industry type</small>
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Column 4: Featured / Quick Launch Card */}
                  <div
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #11254d, #183d73)',
                      color: '#eaf1ff',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <Map size={16} color="#7fb3ff" />
                        <strong style={{ fontSize: '0.85rem' }}>Digital Twin</strong>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: '#c0d4f7', lineHeight: 1.4 }}>
                        Live spatial telemetry with 2D / 3D location evidence.
                      </p>
                    </div>
                    <Link
                      to="/twin"
                      className="button primary"
                      style={{ padding: '6px 10px', fontSize: '0.75rem', marginTop: '12px' }}
                    >
                      Launch Stage <ArrowRight size={13} />
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
              Users &amp; Access
            </NavLink>
          </nav>
        </div>

        {/* Right Side: Search, Site Selector, Status Pill, Theme Toggle, User Profile & CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Expandable Search Input */}
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
                    animation: 'navbarSearchExpand 0.2s ease',
                  }}
                >
                  <Search size={16} />
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
                  >
                    <X size={14} />
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setSearchExpanded(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                aria-label="Open search bar"
                title="Search records (/)"
              >
                <Search size={18} />
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
            <select
              value={selectedSiteId ?? ''}
              onChange={(e) => setSelectedSiteId(Number(e.target.value))}
              disabled={!sites.length}
              style={{ minWidth: '150px', padding: '6px 28px 6px 10px' }}
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
            <ChevronDown size={14} />
          </label>

          {/* Health connection pill */}
          <span
            className={`connection ${health.data?.status === 'healthy' ? 'online' : 'offline'}`}
            title={health.data?.build_revision ?? 'Checking backend'}
          >
            {health.data?.status === 'healthy' ? 'Connected' : 'Checking'}
          </span>

          {/* Alerts shortcut button */}
          <NavLink to="/alerts" className="icon-button" aria-label="View active alerts">
            <Bell size={18} />
          </NavLink>

          {/* Theme switcher */}
          <button
            type="button"
            className="icon-button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            <SunMoon size={18} />
          </button>

          {/* Primary CTA Button: Launch Twin */}
          <Link
            to="/twin"
            className="button primary navbar-cta-btn"
            style={{ padding: '7px 14px', fontSize: '0.8rem' }}
          >
            <Map size={15} />
            <span>Digital Twin</span>
          </Link>

          {/* User Profile & Sign Out Menu */}
          <div className="user-menu" style={{ marginLeft: '4px' }}>
            <span>{session.username}</span>
            <button
              type="button"
              className="button ghost"
              onClick={() => void signOut()}
              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
            >
              Sign out
            </button>
          </div>

          {/* Mobile Hamburger Icon (Right Side) */}
          <button
            type="button"
            className="icon-button navbar-mobile-hamburger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open mobile navigation menu"
          >
            <Menu size={22} />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="brand-mark" style={{ width: 30, height: 30, fontSize: '1rem' }}>C</div>
                <strong>ComPallette</strong>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X size={20} />
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
            </nav>

            {/* Mobile Footer & Logout */}
            <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <span className="muted" style={{ fontSize: '0.82rem' }}>@{session.username}</span>
                <button
                  type="button"
                  className="button ghost icon-only"
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
