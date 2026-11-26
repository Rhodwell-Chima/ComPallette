import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Code2,
  Download,
  Edit2,
  FileBarChart,
  Filter,
  KeyRound,
  Lock,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useOperatorSession } from '../components/AuthGate';
import { platformApi } from '../services/api';
import { usePlatform } from '../platform/PlatformContext';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusPill, formatTimestamp } from '../platform/ui';
import { LoadingButton, SkeletonTable } from '../platform/loading';
import { Pagination } from '../platform/pagination';
import { FormField, Input, Select, SearchInput } from '../platform/form';
import { Modal } from '../platform/Modal';
import { AdminUserItem, UserStatus } from '../types';



/**
 * Slide-over User Detail Drawer
 */
function UserDetailDrawer({
  userId,
  onClose,
  onSaved,
}: {
  userId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { selectedSiteId } = usePlatform();
  const { session } = useOperatorSession();
  const [newPassword, setNewPassword] = useState('');
  const queryClient = useQueryClient();
  const userQuery = useQuery({
    queryKey: ['user-detail', userId, selectedSiteId],
    queryFn: () => platformApi.userDetail(userId, selectedSiteId),
  });

  const [editForm, setEditForm] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    role: string;
    status: UserStatus;
  }>({
    first_name: '',
    last_name: '',
    email: '',
    role: 'VIEWER',
    status: 'ACTIVE',
  });

  useEffect(() => {
    if (userQuery.data) {
      setEditForm({
        first_name: userQuery.data.first_name || '',
        last_name: userQuery.data.last_name || '',
        email: userQuery.data.email || '',
        role: userQuery.data.role || 'VIEWER',
        status: userQuery.data.status || 'ACTIVE',
      });
    }
  }, [userQuery.data]);

  const updateMutation = useMutation({
    mutationFn: () => platformApi.updateUser(userId, session.is_superuser ? editForm : { role: editForm.role, status: editForm.status }, selectedSiteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-detail', userId, selectedSiteId] });
      onSaved();
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => platformApi.resetUserPassword(userId, newPassword, selectedSiteId),
    onSuccess: () => setNewPassword(''),
  });

  if (userQuery.isLoading) {
    return (
      <div className="panel" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 90vw)', zIndex: 50, padding: '24px', background: 'var(--surface)', boxShadow: '-12px 0 35px rgba(0,0,0,0.3)' }}>
        <p className="muted">Loading user profile...</p>
      </div>
    );
  }

  const user = userQuery.data;
  if (!user) return null;

  return (
    <div
      className="panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(480px, 92vw)',
        zIndex: 50,
        padding: '24px',
        background: 'var(--surface)',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.35)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--primary), #0c4fac)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 'bold',
              fontSize: '1.1rem',
            }}
          >
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{user.full_name}</h2>
            <small className="muted">@{user.username} &middot; ID: #{user.id}</small>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close drawer">
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <StatusPill value={user.status} tone={user.status === 'ACTIVE' ? 'success' : 'critical'} />
        <StatusPill value={user.role} tone="warning" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateMutation.mutate();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <label className="field-label">
            First Name
            <input
              disabled={!session.is_superuser}
              value={editForm.first_name}
              onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
            />
          </label>
          <label className="field-label">
            Last Name
            <input
              disabled={!session.is_superuser}
              value={editForm.last_name}
              onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
            />
          </label>
        </div>

        <label className="field-label">
          Email Address
          <input
            type="email"
            disabled={!session.is_superuser}
              value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <label className="field-label">
            Role
            <select
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
            >
              {['ORG_ADMIN', 'SITE_ADMIN', 'OPERATIONS', 'SAFETY', 'TECHNICIAN', 'VIEWER'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Account Status
            <select
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value as UserStatus })}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="PENDING">PENDING</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <LoadingButton
            type="submit"
            className="primary"
            isLoading={updateMutation.isPending}
            loadingText="Updating..."
            icon={<Save size={15} />}
          >
            Save Changes
          </LoadingButton>

          <button
            type="button"
            className="button secondary"
            disabled={!session.is_superuser || !newPassword || resetMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            <KeyRound size={15} /> Reset Password
          </button>
        </div>
      </form>

      {session.is_superuser && <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>}
      {resetMutation.isSuccess && <p role="status">Password changed.</p>}
      {resetMutation.isError && <p role="alert">{resetMutation.error.message}</p>}
      <hr style={{ border: '0', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

      {/* Permissions Breakdown */}
      <div>
        <p className="eyebrow" style={{ marginBottom: '8px' }}>EFFECTIVE CAPABILITIES</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {user.capabilities.map((cap) => (
            <StatusPill key={cap} value={cap} tone="success" />
          ))}
        </div>
      </div>

      {/* Hardware Linkages */}
      <div>
        <p className="eyebrow" style={{ marginBottom: '8px' }}>HARDWARE BINDINGS</p>
        <dl className="metadata-list" style={{ padding: 0 }}>
          <div>
            <dt>Personnel Tag</dt>
            <dd>{user.assigned_personnel_id || 'None registered'}</dd>
          </div>
          <div>
            <dt>Assigned Node</dt>
            <dd>{user.assigned_node_id || 'No hardware paired'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/**
 * User Status Dot component
 */
function StatusDot({ status }: { status: UserStatus }) {
  const dotColors: Record<UserStatus, string> = {
    ACTIVE: '#17835d',
    PENDING: '#e0a96d',
    SUSPENDED: '#c42a2a',
    INVITED: '#1666d9',
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.76rem',
        fontWeight: 650,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: dotColors[status] || '#888',
        }}
      />
      {status}
    </span>
  );
}

export function AccessPage() {
  const { selectedSiteId } = usePlatform();
  return <AccessContent key={selectedSiteId ?? 'none'} />;
}

function AccessContent() {
  const { session } = useOperatorSession();
  const { selectedSiteId, selectedSite, capabilities, can } = usePlatform();
  const queryClient = useQueryClient();

  // Filter & Pagination state
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selection state for Bulk Actions
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeDrawerUserId, setActiveDrawerUserId] = useState<number | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('VIEWER');

  // Query users
  const usersQuery = useQuery({
    queryKey: ['admin-users', selectedSiteId, page, pageSize, search, roleFilter, statusFilter],
    queryFn: () =>
      platformApi.users({
        site_id: selectedSiteId,
        page,
        page_size: pageSize,
        search,
        role: roleFilter,
        status: statusFilter,
      }),
    enabled: Boolean(selectedSiteId),
  });

  // Bulk actions mutation
  const bulkMutation = useMutation({
    mutationFn: (action: 'activate' | 'suspend') =>
      platformApi.bulkUserAction(action, selectedIds, selectedSiteId),
    onSuccess: () => {
      setSelectedIds([]);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: () =>
      platformApi.createUser(selectedSiteId!, { username: newUsername, email: newEmail, role: newRole }),
    onSuccess: () => {
      setNewUsername('');
      setNewEmail('');
      setShowAddUserModal(false);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['memberships'] });
    },
  });

  const users = usersQuery.data?.users || [];
  const total = usersQuery.data?.total || 0;
  const totalPages = usersQuery.data?.total_pages || 1;

  // Master checkbox selection
  const allSelected = users.length > 0 && selectedIds.length === users.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(users.map((u) => u.id));
    }
  };

  const toggleSelectUser = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Export to CSV
  const exportToCsv = () => {
    if (!users.length) return;
    const exportUsers = selectedIds.length
      ? users.filter((u) => selectedIds.includes(u.id))
      : users;

    const headers = ['ID', 'Username', 'Full Name', 'Email', 'Role', 'Status', 'Site', 'Organisation'];
    const rows = exportUsers.map((u) => [
      u.id,
      u.username,
      `"${u.full_name}"`,
      u.email,
      u.role,
      u.status,
      `"${u.site_name || ''}"`,
      `"${u.organisation_name}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `compallette_users_${selectedSite?.code || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!selectedSiteId) {
    return <EmptyState title="No site selected" detail="Select a permitted site before managing users." />;
  }

  return (
    <>
      <PageHeader
        eyebrow="SYSTEM & GOVERNANCE"
        title="User & Access Administration"
        description="Manage authenticated field operators, role permissions, and site memberships with server-enforced security."
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="button secondary"
              onClick={exportToCsv}
              disabled={!users.length}
            >
              <Download size={15} /> Export CSV
            </button>
            {can('manage_users') && (
              <button
                type="button"
                className="button primary"
                onClick={() => setShowAddUserModal(true)}
              >
                <UserPlus size={15} /> Add Operator
              </button>
            )}
          </div>
        }
      />

      {/* Add Operator Modal */}
      <Modal
        isOpen={showAddUserModal}
        onClose={() => setShowAddUserModal(false)}
        title="Provision New Operator"
        subtitle="Create an authorized operational account on this deployment."
        maxWidth="460px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createUserMutation.mutate();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          <FormField label="Django Username" required helperText="Unique operational username">
            <Input
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="e.g. jdoe_shift1"
            />
          </FormField>

          <FormField label="Email Address" helperText="Corporate or shift alert email">
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="operator@mine.internal"
            />
          </FormField>

          <FormField label="Role" required>
            <Select
              value={newRole}
              options={['ORG_ADMIN', 'SITE_ADMIN', 'OPERATIONS', 'SAFETY', 'TECHNICIAN', 'VIEWER'].map((r) => ({
                value: r,
                label: r,
              }))}
              onChange={(e) => setNewRole(e.target.value)}
            />
          </FormField>

          {createUserMutation.isError && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger, #ef4444)',
                borderRadius: '7px',
                padding: '0.65rem 0.85rem',
                color: 'var(--danger, #ef4444)',
                fontSize: '0.82rem',
                marginTop: '0.25rem',
              }}
            >
              Could not register user. Ensure the username is unique and valid.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className="button ghost"
              onClick={() => setShowAddUserModal(false)}
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              className="primary"
              isLoading={createUserMutation.isPending}
              loadingText="Registering..."
              icon={<UserPlus size={15} />}
            >
              Create Account
            </LoadingButton>
          </div>
        </form>
      </Modal>


      {/* Slide-over User Detail Drawer */}
      {activeDrawerUserId !== null && (
        <UserDetailDrawer
          userId={activeDrawerUserId}
          onClose={() => setActiveDrawerUserId(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['admin-users'] })}
        />
      )}

      {/* Filter and Search Toolbar */}
      <section className="panel" style={{ padding: '14px 18px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', flex: 1 }}>
            <div className="registry-search" style={{ minWidth: 'min(280px, 100%)' }}>
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter by name, username, or email..."
                aria-label="Filter users"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--surface-muted)',
                color: 'inherit',
                border: '1px solid var(--border)',
                fontSize: '0.8rem',
              }}
            >
              <option value="">All Roles</option>
              {['ORG_ADMIN', 'SITE_ADMIN', 'OPERATIONS', 'SAFETY', 'TECHNICIAN', 'VIEWER'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                background: 'var(--surface-muted)',
                color: 'inherit',
                border: '1px solid var(--border)',
                fontSize: '0.8rem',
              }}
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
              <option value="PENDING">PENDING</option>
            </select>

            {(search || roleFilter || statusFilter) && (
              <button
                type="button"
                className="button ghost"
                style={{ padding: '5px 8px', fontSize: '0.75rem' }}
                onClick={() => {
                  setSearch('');
                  setRoleFilter('');
                  setStatusFilter('');
                  setPage(1);
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Floating Bulk Actions Bar when items selected */}
          {selectedIds.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'color-mix(in srgb, var(--primary) 12%, var(--surface))',
                border: '1px solid var(--primary)',
              }}
            >
              <strong style={{ fontSize: '0.78rem' }}>{selectedIds.length} selected</strong>
              <button
                type="button"
                className="button ghost"
                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                onClick={() => bulkMutation.mutate('activate')}
              >
                <UserCheck size={13} /> Activate
              </button>
              <button
                type="button"
                className="button ghost"
                style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                onClick={() => bulkMutation.mutate('suspend')}
              >
                <UserMinus size={13} /> Suspend
              </button>

            </div>
          )}
        </div>
      </section>

      {/* Data Table with Sticky Header */}
      <section className="panel" style={{ overflow: 'hidden' }}>
        {usersQuery.isLoading ? (
          <div style={{ padding: '16px' }}>
            <SkeletonTable rows={6} columns={[40, 180, 160, 110, 90, 120, 60]} />
          </div>
        ) : usersQuery.isError ? (
          <ErrorState message="Could not load operator accounts." retry={() => void usersQuery.refetch()} />
        ) : users.length === 0 ? (
          <EmptyState
            title="No operators found"
            detail="No operator accounts matched your query. Adjust your search criteria or register a new operator."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="button ghost icon-only"
                      onClick={toggleSelectAll}
                      style={{ padding: 0 }}
                      aria-label="Select all rows"
                    >
                      {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </th>
                  <th>Operator</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelected = selectedIds.includes(u.id);
                  return (
                    <tr
                      key={u.id}
                      style={{
                        backgroundColor: isSelected
                          ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
                          : undefined,
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="button ghost icon-only"
                          onClick={() => toggleSelectUser(u.id)}
                          style={{ padding: 0 }}
                          aria-label={`Select ${u.username}`}
                        >
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: '50%',
                              backgroundColor: 'var(--surface-muted)',
                              color: 'var(--text)',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            {u.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <strong>{u.full_name}</strong>
                            <small>@{u.username}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.78rem' }}>{u.email}</span>
                      </td>
                      <td>
                        <StatusPill value={u.role} tone="warning" />
                      </td>
                      <td>
                        <StatusDot status={u.status} />
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: '0.75rem' }}>
                          {u.last_active ? formatTimestamp(u.last_active) : 'Never logged in'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '4px' }}>
                          <button
                            type="button"
                            className="button ghost icon-only"
                            onClick={() => setActiveDrawerUserId(u.id)}
                            title="Edit operator"
                            style={{ padding: '4px' }}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            className="button ghost icon-only"
                            onClick={() => setActiveDrawerUserId(u.id)}
                            disabled={!session.is_superuser}
                            title="Reset password"
                            style={{ padding: '4px' }}
                          >
                            <KeyRound size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Standardized Pagination Component */}
        <div style={{ padding: '0 18px 18px' }}>
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </div>
      </section>
    </>
  );
}

const DEMO_MINING_GEOMETRY = {
  version: 1,
  features: [
    {
      id: 'surface-portal',
      label: 'Surface Portal & Adit',
      zone_code: 'SURFACE-PORTAL',
      points: [[20, 25], [90, 25], [90, 65], [20, 65]],
    },
    {
      id: 'headframe-hoist',
      label: 'Shaft Headframe & Hoist',
      points: [[145, 15], [205, 15], [205, 65], [145, 65]],
    },
    {
      id: 'surface-vent-substation',
      label: 'Intake Vent & Substation',
      points: [[235, 20], [305, 20], [305, 60], [235, 60]],
    },
    {
      id: 'surface-transfer-yard',
      label: 'Surface Transfer Apron',
      points: [[85, 48], [240, 48], [240, 68], [85, 68]],
    },
    {
      id: 'main-shaft-barrel',
      label: 'Main Hoisting Shaft Barrel',
      points: [[165, 65], [185, 65], [185, 415], [165, 415]],
    },
    {
      id: 'secondary-vent-raise',
      label: 'Emergency Return Vent Raise',
      points: [[260, 60], [275, 60], [275, 395], [260, 395]],
    },
    {
      id: 'decline-spiral-ramp-s1',
      label: 'Decline Ramp (S -> L1)',
      points: [[45, 65], [65, 65], [95, 125], [75, 125]],
    },
    {
      id: 'level-1-station',
      label: 'Level 1 Station & Inset',
      zone_code: 'LEVEL-1-STATION',
      points: [[140, 115], [210, 115], [210, 160], [140, 160]],
    },
    {
      id: 'level-1-battery-bay',
      label: 'Level 1 Battery & Charging',
      points: [[60, 125], [140, 125], [140, 165], [60, 165]],
    },
    {
      id: 'level-1-pump-station',
      label: 'Dewatering Pump & Sump',
      points: [[210, 120], [260, 120], [260, 165], [210, 165]],
    },
    {
      id: 'decline-ramp-1-to-2',
      label: 'Decline Ramp (L1 -> L2)',
      points: [[75, 165], [95, 165], [65, 225], [45, 225]],
    },
    {
      id: 'level-2-haulage',
      label: 'Level 2 Arterial Haulage Way',
      zone_code: 'LEVEL-2-HAULAGE-WAY',
      points: [[40, 215], [245, 215], [245, 255], [40, 255]],
    },
    {
      id: 'level-2-workshop',
      label: 'Underground Heavy Fleet Workshop',
      points: [[50, 255], [130, 255], [130, 295], [50, 295]],
    },
    {
      id: 'level-2-passing-loop',
      label: 'Arterial Passing Siding',
      points: [[130, 250], [225, 250], [225, 280], [130, 280]],
    },
    {
      id: 'level-2-north-drift',
      label: 'Level 2 North Drift',
      zone_code: 'LEVEL-2-NORTH-DRIFT',
      points: [[245, 195], [335, 195], [335, 240], [245, 240]],
    },
    {
      id: 'level-2-drill-cubby',
      label: 'Diamond Drill Cubby',
      points: [[305, 165], [345, 165], [345, 195], [305, 195]],
    },
    {
      id: 'central-ore-pass',
      label: 'Gravity Ore Pass Chute',
      points: [[220, 240], [240, 240], [240, 345], [220, 345]],
    },
    {
      id: 'decline-ramp-2-to-250',
      label: 'Decline Ramp (L2 -> L250)',
      points: [[55, 295], [75, 295], [95, 340], [75, 340]],
    },
    {
      id: 'level-250-south',
      label: 'Level 250 Refuge Station',
      zone_code: 'LEVEL-250-SOUTH',
      points: [[70, 335], [165, 335], [165, 385], [70, 385]],
    },
    {
      id: 'level-250-magazine',
      label: 'Explosives Magazine Bunker',
      points: [[15, 340], [65, 340], [65, 380], [15, 380]],
    },
    {
      id: 'decline-ramp-250-to-3',
      label: 'Production Decline (L250 -> L3)',
      points: [[120, 385], [140, 385], [175, 420], [155, 420]],
    },
    {
      id: 'level-3-active-stope',
      label: 'Level 3 Active Production Stope',
      zone_code: 'LEVEL-3-ACTIVE-STOPE',
      points: [[235, 385], [335, 385], [335, 440], [235, 440]],
    },
    {
      id: 'level-3-footwall-drift',
      label: 'Footwall Mucking Drift',
      points: [[155, 410], [250, 410], [250, 440], [155, 440]],
    },
    {
      id: 'level-3-drawpoints',
      label: 'Stope Undercut Drawpoints',
      points: [[250, 425], [305, 425], [305, 445], [250, 445]],
    },
    {
      id: 'level-3-vent-drift',
      label: 'Return Air Exhaust Drift',
      points: [[315, 395], [355, 395], [355, 435], [315, 435]],
    },
  ],
};

export function SitesZonesPage() {
  const [searchParams] = useSearchParams();
  const targetedZoneId = Number(searchParams.get('zone'));
  const { selectedSite, selectedSiteId, can } = usePlatform();
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name: '', zone_type: 'OPERATIONAL', description: '', is_restricted: false, is_hazardous: false });
  const [layoutText, setLayoutText] = useState('');
  const queryClient = useQueryClient();
  const structures = useQuery({ queryKey: ['structures', selectedSiteId], queryFn: () => platformApi.structures(selectedSiteId!), enabled: Boolean(selectedSiteId) });
  const zones = useQuery({ queryKey: ['zones', selectedSiteId], queryFn: () => platformApi.zones(selectedSiteId!), enabled: Boolean(selectedSiteId) });
  const layout = useQuery({ queryKey: ['layout', selectedSiteId], queryFn: () => platformApi.layout(selectedSiteId!), enabled: Boolean(selectedSiteId) });
  const createZone = useMutation({ mutationFn: () => platformApi.createZone(selectedSiteId!, zoneForm), onSuccess: () => { setZoneForm({ code: '', name: '', zone_type: 'OPERATIONAL', description: '', is_restricted: false, is_hazardous: false }); setShowZoneForm(false); void queryClient.invalidateQueries({ queryKey: ['zones'] }); } });
  const saveLayout = useMutation({ mutationFn: (geometry: Record<string, unknown>) => platformApi.updateLayout(selectedSiteId!, geometry, layout.data!.version), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['layout'] }); void queryClient.invalidateQueries({ queryKey: ['twin'] }); } });
  useEffect(() => { if (layout.data) setLayoutText(JSON.stringify(layout.data.geometry, null, 2)); }, [layout.data]);

  useEffect(() => {
    if (targetedZoneId && zones.data) {
      const el = document.getElementById(`zone-card-${targetedZoneId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [targetedZoneId, zones.data]);

  const handleLoadDemoGeometry = () => {
    const formatted = JSON.stringify(DEMO_MINING_GEOMETRY, null, 2);
    setLayoutText(formatted);
    saveLayout.mutate(DEMO_MINING_GEOMETRY);
  };
  if (!selectedSiteId || !selectedSite) return <EmptyState title="No site selected" detail="Select a permitted site before editing its hierarchy or facility layout." />;
  if (zones.isLoading || structures.isLoading || layout.isLoading) return <LoadingState label="Loading site configuration…" />;
  if (zones.isError || structures.isError || layout.isError || !zones.data || !structures.data || !layout.data) return <ErrorState message="Site configuration could not be loaded." retry={() => { void zones.refetch(); void structures.refetch(); void layout.refetch(); }} />;
  const submitZone = (event: FormEvent) => { event.preventDefault(); createZone.mutate(); };
  const submitLayout = (event: FormEvent) => { event.preventDefault(); try { saveLayout.mutate(JSON.parse(layoutText)); } catch { window.alert('Facility layout must be valid JSON.'); } };
  return <>
    <PageHeader eyebrow="INFRASTRUCTURE" title="Sites & zones" description="Industry-neutral facility configuration: structures may be shafts, tunnels, buildings or warehouses, while zones hold restrictions, hazards and optional persisted geometry." actions={can('manage_sites') ? <button className="button primary" onClick={() => setShowZoneForm(value => !value)}><Plus size={16} /> Add zone</button> : undefined} />
    <section className="site-config-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">SITE HIERARCHY</p><h2>{selectedSite.name}</h2></div><Building2 size={19} /></div><dl className="metadata-list"><div><dt>Organisation</dt><dd>{selectedSite.organisation_name}</dd></div><div><dt>Industry</dt><dd>{selectedSite.industry}</dd></div><div><dt>Timezone</dt><dd>{selectedSite.timezone}</dd></div><div><dt>Structures</dt><dd>{structures.data.structures.length}</dd></div></dl></article>
      <article className="panel zone-list"><div className="panel-heading"><div><p className="eyebrow">MANAGED ZONES</p><h2>{zones.data.zones.length} configured</h2></div></div>{zones.data.zones.length ? zones.data.zones.map(zone => (
        <div
          id={`zone-card-${zone.id}`}
          className={`zone-row ${zone.id === targetedZoneId ? 'is-targeted-zone' : ''}`}
          key={zone.id}
          style={zone.id === targetedZoneId ? { border: '2px solid var(--primary)', borderRadius: '8px', padding: '8px' } : undefined}
        >
          <div><strong>{zone.name}</strong><small>{zone.code} · {zone.zone_type}</small></div>
          <div>{zone.is_restricted && <StatusPill value="Restricted" tone="warning" />}{zone.is_hazardous && <StatusPill value="Hazard" tone="critical" />}</div>
        </div>
      )) : <EmptyState title="No zones yet" detail="Create meaningful operational zones before positioning entities in the Twin." />}</article></section>
      {/* Add Zone Pop-up Modal */}
      <Modal
        isOpen={showZoneForm}
        onClose={() => setShowZoneForm(false)}
        title="Add Managed Zone"
        subtitle="Configure physical sectors, boundaries, or hazardous operational zones."
        maxWidth="500px"
      >
        <form onSubmit={submitZone} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <FormField label="Zone Code" required helperText="Unique identifier for spatial telemetry">
            <Input
              required
              value={zoneForm.code}
              placeholder="e.g. ZONE-SEC-04"
              onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value.toUpperCase() })}
            />
          </FormField>

          <FormField label="Zone Name" required helperText="Descriptive sector name">
            <Input
              required
              value={zoneForm.name}
              placeholder="e.g. Level 3 Extraction Shaft"
              onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
            />
          </FormField>

          <FormField label="Zone Type">
            <Input
              value={zoneForm.zone_type}
              placeholder="e.g. OPERATIONAL, REFUGE, WORKSHOP"
              onChange={(e) => setZoneForm({ ...zoneForm, zone_type: e.target.value })}
            />
          </FormField>

          <FormField label="Description">
            <Input
              value={zoneForm.description}
              placeholder="Optional notes or safety directives"
              onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })}
            />
          </FormField>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: '0.5rem 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={zoneForm.is_restricted}
                onChange={(e) => setZoneForm({ ...zoneForm, is_restricted: e.target.checked })}
              />
              <span>Restricted Access (Authorized personnel only)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={zoneForm.is_hazardous}
                onChange={(e) => setZoneForm({ ...zoneForm, is_hazardous: e.target.checked })}
              />
              <span style={{ color: zoneForm.is_hazardous ? 'var(--danger, #ef4444)' : 'inherit' }}>
                Hazard Area (Atmospheric or geotechnical risk)
              </span>
            </label>
          </div>

          {createZone.isError && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid var(--danger, #ef4444)',
                borderRadius: '7px',
                padding: '0.65rem 0.85rem',
                color: 'var(--danger, #ef4444)',
                fontSize: '0.82rem',
              }}
            >
              Zone could not be created. Ensure the zone code is unique for this site.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button type="button" className="button ghost" onClick={() => setShowZoneForm(false)}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={createZone.isPending}>
              <Plus size={16} />
              {createZone.isPending ? 'Saving...' : 'Save Zone'}
            </button>
          </div>
        </form>
      </Modal>

    <form className="panel layout-editor" onSubmit={submitLayout}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">FACILITY LAYOUT</p>
          <h2>Shared 2D / 3D geometry</h2>
          <p>Only persisted geometry is rendered in the Digital Twin. An empty layout intentionally produces a setup state.</p>
        </div>
        <Code2 size={19} />
      </div>
      <textarea
        value={layoutText}
        onChange={event => setLayoutText(event.target.value)}
        disabled={!can('manage_sites')}
        aria-label="Facility layout geometry JSON"
      />
      {can('manage_sites') && (
        <div className="page-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            className="button secondary"
            onClick={handleLoadDemoGeometry}
            disabled={saveLayout.isPending}
            title="Populate and save multi-level underground mining facility geometry"
          >
            <Sparkles size={16} /> Load Demo Mining Geometry
          </button>
          <button className="button primary" disabled={saveLayout.isPending}>
            <Save size={16} /> Save layout
          </button>
        </div>
      )}
      {saveLayout.isError && <p className="form-error">The layout was not saved. Confirm that the JSON object is valid.</p>}
    </form>
  </>;
}

export function ReportsPage() {
  const { selectedSiteId } = usePlatform();
  const report = useQuery({ queryKey: ['reports', selectedSiteId], queryFn: () => platformApi.reports(selectedSiteId), enabled: Boolean(selectedSiteId) });
  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a site to view its reporting summary." />;
  if (report.isLoading) return <LoadingState label="Loading report summary…" />;
  if (report.isError || !report.data) return <ErrorState message="The report summary could not be loaded." retry={() => void report.refetch()} />;
  return <><PageHeader eyebrow="MANAGEMENT" title="Reports" description="An on-demand, site-scoped summary based on persisted records. Export scheduling and external distribution are not configured in this deployment." /><section className="summary-cards">{Object.entries(report.data.summary).map(([key, value]) => <article className="summary-card" key={key}><FileBarChart size={18} /><span>{key.replace(/_/g, ' ')}</span><strong>{value}</strong></article>)}</section></>;
}

export function AuditPage() {
  const { selectedSiteId } = usePlatform();
  const audit = useQuery({ queryKey: ['audit', selectedSiteId], queryFn: () => platformApi.audit(selectedSiteId), enabled: Boolean(selectedSiteId) });
  if (!selectedSiteId) return <EmptyState title="No site selected" detail="Select a site to view its audit trail." />;
  if (audit.isLoading) return <LoadingState label="Loading audit history…" />;
  if (audit.isError || !audit.data) return <ErrorState message="Audit history could not be loaded." retry={() => void audit.refetch()} />;
  return <><PageHeader eyebrow="MANAGEMENT" title="Audit log" description="A server-generated record of safety events and authenticated operator actions for the active site." /><section className="panel"><div className="table-scroll"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead><tbody>{audit.data.audit_log.map(entry => <tr key={entry.id}><td>{formatTimestamp(entry.timestamp)}</td><td><StatusPill value={entry.action} /></td><td>{entry.actor}</td><td>{entry.details}</td></tr>)}</tbody></table></div>{!audit.data.audit_log.length && <EmptyState title="No audit entries" detail="New system activity and authenticated operator actions will be preserved here." />}</section></>;
}

export function IntegrationsPage() {
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: platformApi.integrations, staleTime: 60_000 });
  if (integrations.isLoading) return <LoadingState label="Checking configured integrations…" />;
  if (integrations.isError || !integrations.data) return <ErrorState message="Integration configuration could not be loaded." retry={() => void integrations.refetch()} />;
  return <><PageHeader eyebrow="MANAGEMENT" title="Integrations" description="External connections are disclosed only when Django confirms they are configured." />{integrations.data.integrations.length ? <section className="panel">Configured integrations will appear here.</section> : <EmptyState title="No integrations are configured" detail={integrations.data.message} />}</>;
}

export { SettingsPage } from './settings';
