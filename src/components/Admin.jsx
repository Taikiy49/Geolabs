import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import '../styles/Admin.css';
import API_URL from '../config';
import { useMsal } from '@azure/msal-react';
import {
  FaSyncAlt,
  FaPlus,
  FaTrashAlt,
  FaDownload,
  FaSearch,
  FaLock,
  FaCheckCircle,
} from 'react-icons/fa';

// Move rolePriority outside component to make it a true constant
const rolePriority = { Owner: 0, Admin: 1, User: 2 };

export default function Admin() {
  const { accounts } = useMsal();
  const currentUserEmail = accounts[0]?.username || '';
  const SUPER_OWNER_EMAIL = 'tyamashita@geolabs.net';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('All'); // All | User | Admin | Owner
  const [sortBy, setSortBy] = useState('role'); // 'email' | 'role'
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState({}); // {email: true}
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false); // blocks bulk ops
  const [statusMsg, setStatusMsg] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/users`);
      setUsers(res.data || []);
    } catch (e) {
      console.error('Error fetching users:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const currentUserRole =
    (users.find(u => u.email === currentUserEmail)?.role) || 'User';

  const isOwner =
    currentUserEmail === SUPER_OWNER_EMAIL || currentUserRole === 'Owner';

  const canEdit = (targetEmail, targetRole) => {
    if (currentUserEmail === SUPER_OWNER_EMAIL) return true;           // Super owner can edit all
    if (targetEmail === SUPER_OWNER_EMAIL) return false;               // No one can edit super owner
    if (!isOwner) return false;                                        // Must be Owner to edit
    if (targetEmail === currentUserEmail) return false;                // Can't edit yourself
    return targetRole === 'User' || targetRole === 'Admin';            // Can't edit other Owners
  };

  const canDelete = (targetEmail, targetRole) => {
    if (targetEmail === SUPER_OWNER_EMAIL) return false;
    if (targetEmail === currentUserEmail) return false;
    if (!isOwner && currentUserEmail !== SUPER_OWNER_EMAIL) return false;
    // Only delete Users/Admins. Owners require super owner – disallow to be safe.
    return targetRole === 'User' || targetRole === 'Admin';
  };

  const optionsFor = (targetEmail, targetRole) => {
    if (currentUserEmail === SUPER_OWNER_EMAIL) return ['User', 'Admin', 'Owner'];
    if (targetRole === 'User' || targetRole === 'Admin') return ['User', 'Admin'];
    return [targetRole]; // locked
  };

  const updateRole = async (email, role) => {
    try {
      await axios.post(`${API_URL}/api/update-role`, { email, role });
      setUsers(prev => prev.map(u => (u.email === email ? { ...u, role } : u)));
    } catch (e) {
      console.error('Error updating role:', e);
      alert(e.response?.data?.error || 'Failed to update role.');
    }
  };

  const deleteUser = async (email) => {
    try {
      await axios.post(`${API_URL}/api/delete-user`, { email });
      setUsers(prev => prev.filter(u => u.email !== email));
    } catch (e) {
      console.error('Error deleting user:', e);
      alert(e.response?.data?.error || 'Failed to delete user.');
    }
  };

  const addUser = async () => {
    const email = newEmail.trim();
    if (!email) return;
    try {
      await axios.post(`${API_URL}/api/register-user`, { email });
      setNewEmail('');
      setStatusMsg(`Invited/registered: ${email}`);
      fetchUsers();
    } catch (e) {
      console.error('Error registering user:', e);
      alert(e.response?.data?.error || 'Failed to register user.');
    }
  };

  // Derived views
  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (users || []).filter(u => {
      if (roleFilter !== 'All' && u.role !== roleFilter) return false;
      if (!t) return true;
      return `${u.email} ${u.role}`.toLowerCase().includes(t);
    });
  }, [users, roleFilter, search]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let va, vb;
      if (sortBy === 'role') {
        va = rolePriority[a.role] ?? 99;
        vb = rolePriority[b.role] ?? 99;
      } else {
        va = (a.email || '').toLowerCase();
        vb = (b.email || '').toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sortBy, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  // Selection
  const toggleSelect = (email) =>
    setSelected(prev => ({ ...prev, [email]: !prev[email] }));

  const pageSelectableEmails = pageRows
    .filter(u => canEdit(u.email, u.role) || canDelete(u.email, u.role))
    .map(u => u.email);

  const allPageSelected =
    pageSelectableEmails.length > 0 &&
    pageSelectableEmails.every(e => selected[e]);

  const toggleSelectAll = () => {
    setSelected(prev => {
      const next = { ...prev };
      if (allPageSelected) {
        pageSelectableEmails.forEach(e => { delete next[e]; });
      } else {
        pageSelectableEmails.forEach(e => { next[e] = true; });
      }
      return next;
    });
  };

  const selectedUsers = sorted.filter(u => selected[u.email]);
  const selectedCount = selectedUsers.length;

  // Bulk ops
  const bulkSetRole = async (role) => {
    if (!selectedCount) return;
    if (!window.confirm(`Change role to ${role} for ${selectedCount} selected user(s)?`)) return;
    setBusy(true);
    try {
      for (const u of selectedUsers) {
        if (canEdit(u.email, u.role)) {
          if (role === 'Owner' && currentUserEmail !== SUPER_OWNER_EMAIL) continue;
          if (u.role === role) continue;
          // eslint-disable-next-line no-await-in-loop
          await updateRole(u.email, role);
        }
      }
      setStatusMsg(`Bulk updated role to ${role}.`);
      setSelected({});
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (!selectedCount) return;
    if (!window.confirm(`Delete ${selectedCount} selected user(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      for (const u of selectedUsers) {
        if (canDelete(u.email, u.role)) {
          // eslint-disable-next-line no-await-in-loop
          await deleteUser(u.email);
        }
      }
      setStatusMsg(`Bulk delete complete.`);
      setSelected({});
      fetchUsers();
    } finally {
      setBusy(false);
    }
  };

  const exportCSV = () => {
    const rows = sorted.map(u => ({ email: u.email, role: u.role }));
    const header = 'email,role';
    const csv = header + '\n' + rows.map(r => `${r.email},${r.role}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const roleCounts = useMemo(() => {
    const out = { Owner: 0, Admin: 0, User: 0 };
    (users || []).forEach(u => { if (out[u.role] !== undefined) out[u.role]++; });
    return out;
  }, [users]);

  if (loading) {
    return (
      <div className="admin-wrap">
        <div className="admin-topbar">Loading users…</div>
      </div>
    );
  }

  return (
    <div className="admin-wrap">
      {/* Top controls */}
      <div className="admin-topbar">
        <div className="admin-left">
          <div className="admin-heading">Admin</div>

          <div className="admin-stats">
            <span className="admin-pill admin-owner">Owners: {roleCounts.Owner}</span>
            <span className="admin-pill admin-admin">Admins: {roleCounts.Admin}</span>
            <span className="admin-pill admin-user">Users: {roleCounts.User}</span>
          </div>

          <button className="admin-btn" onClick={fetchUsers} title="Refresh">
            <FaSyncAlt /><span>Refresh</span>
          </button>

          <button className="admin-btn" onClick={exportCSV} title="Export CSV">
            <FaDownload /><span>Export</span>
          </button>
        </div>

        <div className="admin-right">
          <div className="admin-inline">
            <FaSearch className="admin-mini" />
            <input
              className="admin-input"
              placeholder="Search email/role…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <select
            className="admin-select"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            title="Filter by role"
          >
            <option>All</option>
            <option>User</option>
            <option>Admin</option>
            <option>Owner</option>
          </select>

          <div className="admin-inline admin-add">
            <input
              className="admin-input"
              placeholder="Add/register email…"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <button className="admin-btn" onClick={addUser} title="Register user">
              <FaPlus /><span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bulk bar */}
      <div className="admin-bulkbar">
        <span>{selectedCount} selected</span>
        <div className="admin-sep" />
        <button className="admin-btn admin-ghost" disabled={!selectedCount || busy} onClick={() => bulkSetRole('User')}>→ User</button>
        <button className="admin-btn admin-ghost" disabled={!selectedCount || busy} onClick={() => bulkSetRole('Admin')}>→ Admin</button>
        <button
          className="admin-btn admin-ghost"
          disabled={!selectedCount || busy || currentUserEmail !== SUPER_OWNER_EMAIL}
          title={currentUserEmail === SUPER_OWNER_EMAIL ? '' : 'Super owner only'}
          onClick={() => bulkSetRole('Owner')}
        >
          → Owner
        </button>
        <div className="admin-sep" />
        <button className="admin-btn admin-danger" disabled={!selectedCount || busy} onClick={bulkDelete}>
          <FaTrashAlt /><span>Delete</span>
        </button>

        {!!statusMsg && (
          <span className="admin-status"><FaCheckCircle className="admin-mini admin-ok" /> {statusMsg}</span>
        )}
      </div>

      {/* Table */}
      <div className="admin-tablewrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="admin-check">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                  title="Select page"
                />
              </th>
              <th onClick={() => onSort('email')} className="admin-th admin-sort">
                Email{sortBy === 'email' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th onClick={() => onSort('role')} className="admin-th admin-sort">
                Role{sortBy === 'role' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th className="admin-th">Change Role</th>
              <th className="admin-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(u => {
              const isSelf = u.email === currentUserEmail;
              const editable = canEdit(u.email, u.role);
              const deletable = canDelete(u.email, u.role);
              const locked = !editable && !deletable;

              return (
                <tr key={u.email} className={`admin-row admin-${u.role.toLowerCase()}-row`}>
                  <td className="admin-check">
                    {(editable || deletable) ? (
                      <input
                        type="checkbox"
                        checked={!!selected[u.email]}
                        onChange={() => toggleSelect(u.email)}
                      />
                    ) : (
                      <FaLock className="admin-mini admin-muted" title="Locked" />
                    )}
                  </td>
                  <td className="admin-email">
                    {u.email}
                    {isSelf && <span className="admin-you">(you)</span>}
                  </td>
                  <td>
                    <span className={`admin-badge admin-${u.role.toLowerCase()}`}>{u.role}</span>
                  </td>
                  <td>
                    {editable ? (
                      <select
                        className="admin-select"
                        value={u.role}
                        onChange={(e) => updateRole(u.email, e.target.value)}
                      >
                        {optionsFor(u.email, u.role).map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="admin-muted">{locked ? 'Locked' : u.role}</span>
                    )}
                  </td>
                  <td>
                    {deletable ? (
                      <button
                        className="admin-btn admin-danger"
                        onClick={() => {
                          if (window.confirm(`Delete ${u.email}?`)) deleteUser(u.email);
                        }}
                      >
                        <FaTrashAlt /><span>Delete</span>
                      </button>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td className="admin-empty" colSpan={5}>No results.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="admin-pager">
        <button className="admin-btn" onClick={() => setPage(1)} disabled={page === 1}>⏮</button>
        <button className="admin-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>◀</button>
        <span className="admin-page">{page} / {totalPages}</span>
        <button className="admin-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>▶</button>
        <button className="admin-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>⏭</button>

        <select
          className="admin-select admin-right"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
        >
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>
    </div>
  );
};
