import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import {
  FaSyncAlt, FaPlus, FaTrash, FaDownload, FaSearch, FaUserLock, FaUserCheck,
  FaUsers, FaUser, FaList, FaTimes, FaCheck
} from "react-icons/fa";
import "./ITOperations.css";

/**
 * Simple Graph client via fetch + MSAL token
 */
async function graphFetch(instance, account, { url, method = "GET", body, scopes }) {
  const { accessToken } = await instance.acquireTokenSilent({
    account,
    scopes: scopes || ["User.Read"]
  });
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text || url}`);
  }
  return res.json();
}

/** CSV helper */
function toCSV(rows, cols) {
  const head = cols.map(c => `"${c.header.replace(/"/g, '""')}"`).join(",");
  const body = rows.map(r =>
    cols.map(c => {
      const v = (typeof c.accessor === "function" ? c.accessor(r) : r[c.accessor]) ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(",")
  ).join("\n");
  return `${head}\n${body}`;
}

/** Reusable chip */
function Chip({ children, kind = "default" }) {
  return <span className={`chip chip-${kind}`}>{children}</span>;
}

/** Toolbar input */
function SearchBox({ value, onChange, onClear, placeholder }) {
  return (
    <div className="ops-search">
      <FaSearch aria-hidden="true" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
      />
      {value && <button className="ops-clear" onClick={onClear} aria-label="Clear search"><FaTimes /></button>}
    </div>
  );
}

/** Sort toggle */
function Sorter({ value, onChange, options }) {
  return (
    <select className="ops-select" value={value} onChange={e => onChange(e.target.value)} aria-label="Sort by">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Bulk actions wrapper */
function BulkBar({ count, onExport, onRefresh, actions }) {
  if (!count) return null;
  return (
    <div className="ops-bulkbar" role="region" aria-label="Bulk actions">
      <div className="ops-bulk-left">
        <strong>{count}</strong> selected
      </div>
      <div className="ops-bulk-right">
        {actions}
        <button className="btn" onClick={onExport} title="Export CSV"><FaDownload /> Export</button>
        <button className="btn" onClick={onRefresh} title="Refresh"><FaSyncAlt /> Refresh</button>
      </div>
    </div>
  );
}

/* ---------------------------
   USERS TAB
--------------------------- */
function UsersTab({ instance, account }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("displayName:asc");
  const [statusFilter, setStatusFilter] = useState("all"); // all|blocked|enabled
  const [sel, setSel] = useState(new Set());
  const tableRef = useRef(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // basic fields; add what you need
      const selFields = "id,displayName,userPrincipalName,accountEnabled,jobTitle,department,createdDateTime";
      // If searching, use /users?$search (needs Request-Header Consistency: ConsistencyLevel: eventual)
      let list = [];
      if (q.trim()) {
        const { accessToken } = await instance.acquireTokenSilent({ account, scopes: ["Directory.Read.All"] });
        const res = await fetch(`https://graph.microsoft.com/v1.0/users?$search="${encodeURIComponent(q.trim())}"&$select=${selFields}&$top=50`, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "ConsistencyLevel": "eventual"
          }
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        list = data.value || [];
      } else {
        const data = await graphFetch(instance, account, {
          url: `/users?$select=${selFields}&$top=50`,
          scopes: ["Directory.Read.All"]
        });
        list = data.value || [];
      }
      setRows(list);
      setSel(new Set());
    } finally {
      setLoading(false);
    }
  }, [instance, account, q]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleSel = (id) => {
    setSel(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allChecked = rows.length && sel.size === rows.length;
  const toggleAll = () => {
    setSel(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))));
  };

  const sortedFiltered = useMemo(() => {
    let out = [...rows];
    if (statusFilter !== "all") {
      const want = statusFilter === "blocked" ? false : true;
      out = out.filter(r => r.accountEnabled === want);
    }
    const [col, dir] = sort.split(":");
    out.sort((a, b) => {
      const va = (a[col] ?? "").toString().toLowerCase();
      const vb = (b[col] ?? "").toString().toLowerCase();
      if (va < vb) return dir === "asc" ? -1 : 1;
      if (va > vb) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }, [rows, sort, statusFilter]);

  // Actions
  const bulkBlock = async (block) => {
    if (!sel.size) return;
    const ids = [...sel];
    setLoading(true);
    try {
      await Promise.all(ids.map(id =>
        graphFetch(instance, account, {
          url: `/users/${id}`,
          method: "PATCH",
          scopes: ["User.ReadWrite.All"],
          body: { accountEnabled: !block }
        })
      ));
      await fetchUsers();
    } catch (e) {
      alert(`Failed to ${block ? "block" : "enable"}: ${e.message}`);
      setLoading(false);
    }
  };

  const forcePwdReset = async () => {
    if (!sel.size) return;
    const ids = [...sel];
    setLoading(true);
    try {
      await Promise.all(ids.map(id =>
        graphFetch(instance, account, {
          url: `/users/${id}`,
          method: "PATCH",
          scopes: ["User.ReadWrite.All"],
          body: { passwordPolicies: "DisablePasswordExpiration", passwordProfile: { forceChangePasswordNextSignIn: true } }
        })
      ));
      await fetchUsers();
    } catch (e) {
      alert(`Failed to set password reset: ${e.message}`);
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const cols = [
      { header: "Display Name", accessor: "displayName" },
      { header: "UPN", accessor: "userPrincipalName" },
      { header: "Enabled", accessor: (r) => r.accountEnabled ? "Yes" : "No" },
      { header: "Job Title", accessor: "jobTitle" },
      { header: "Department", accessor: "department" },
      { header: "Created", accessor: "createdDateTime" }
    ];
    const csv = toCSV(sortedFiltered.filter(r => sel.has(r.id)), cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "users.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="ops-card">
      <div className="ops-toolbar">
        <div className="ops-left-tools">
          <SearchBox
            value={q}
            onChange={setQ}
            onClear={() => setQ("")}
            placeholder="Search users (name, UPN)…"
          />
          <select
            className="ops-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            aria-label="Status"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="blocked">Blocked</option>
          </select>
          <Sorter
            value={sort}
            onChange={setSort}
            options={[
              { value: "displayName:asc", label: "Name ↑" },
              { value: "displayName:desc", label: "Name ↓" },
              { value: "userPrincipalName:asc", label: "UPN ↑" },
              { value: "userPrincipalName:desc", label: "UPN ↓" }
            ]}
          />
        </div>
        <div className="ops-right-tools">
          <button className="btn" onClick={fetchUsers} title="Refresh"><FaSyncAlt /> Refresh</button>
        </div>
      </div>

      <BulkBar
        count={sel.size}
        onExport={exportCsv}
        onRefresh={fetchUsers}
        actions={
          <>
            <button className="btn" onClick={() => bulkBlock(true)} title="Block sign-in"><FaUserLock /> Block</button>
            <button className="btn" onClick={() => bulkBlock(false)} title="Enable sign-in"><FaUserCheck /> Enable</button>
            <button className="btn" onClick={forcePwdReset} title="Force password reset"><FaList /> Force Reset</button>
          </>
        }
      />

      <div className="ops-table-wrap" ref={tableRef}>
        <table className="ops-table" role="grid" aria-label="Users table">
          <thead>
            <tr>
              <th style={{width: 36}}>
                <input
                  type="checkbox"
                  checked={!!allChecked}
                  aria-label="Select all"
                  onChange={toggleAll}
                />
              </th>
              <th>Name</th>
              <th>UPN</th>
              <th>Status</th>
              <th>Job Title</th>
              <th>Department</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sortedFiltered.length === 0 && (
              <tr><td colSpan={7} className="ops-empty">No users</td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="ops-empty">Loading…</td></tr>
            )}
            {!loading && sortedFiltered.map(u => {
              const checked = sel.has(u.id);
              return (
                <tr key={u.id} className={checked ? "is-selected" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`Select ${u.displayName}`}
                      onChange={() => toggleSel(u.id)}
                    />
                  </td>
                  <td className="text-strong">{u.displayName || "(no name)"}</td>
                  <td className="mono">{u.userPrincipalName}</td>
                  <td>
                    {u.accountEnabled
                      ? <Chip kind="ok"><FaCheck /> Enabled</Chip>
                      : <Chip kind="warn"><FaTimes /> Blocked</Chip>}
                  </td>
                  <td>{u.jobTitle || "-"}</td>
                  <td>{u.department || "-"}</td>
                  <td className="mono">{(u.createdDateTime || "").slice(0,10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------
   GROUPS TAB
--------------------------- */
function GroupsTab({ instance, account }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const fields = "id,displayName,mail,groupTypes,securityEnabled,mailEnabled,createdDateTime";
      let list = [];
      if (q.trim()) {
        const { accessToken } = await instance.acquireTokenSilent({ account, scopes: ["Directory.Read.All"] });
        const res = await fetch(`https://graph.microsoft.com/v1.0/groups?$search="${encodeURIComponent(q.trim())}"&$select=${fields}&$top=50`, {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "ConsistencyLevel": "eventual"
          }
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        list = data.value || [];
      } else {
        const data = await graphFetch(instance, account, {
          url: `/groups?$select=${fields}&$top=50`,
          scopes: ["Directory.Read.All"]
        });
        list = data.value || [];
      }
      setRows(list);
      setSel(new Set());
    } finally {
      setLoading(false);
    }
  }, [instance, account, q]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const toggleSel = (id) => {
    setSel(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allChecked = rows.length && sel.size === rows.length;
  const toggleAll = () => setSel(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));

  const delGroups = async () => {
    if (!sel.size) return;
    if (!window.confirm(`Delete ${sel.size} group(s)?`)) return;
    try {
      setLoading(true);
      await Promise.all([...sel].map(id =>
        graphFetch(instance, account, {
          url: `/groups/${id}`, method: "DELETE", scopes: ["Group.ReadWrite.All"]
        })
      ));
      await fetchGroups();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const cols = [
      { header: "Display Name", accessor: "displayName" },
      { header: "Mail", accessor: "mail" },
      { header: "Types", accessor: (g) => (g.groupTypes || []).join("|") },
      { header: "Security Enabled", accessor: (g) => g.securityEnabled ? "Yes" : "No" },
      { header: "Mail Enabled", accessor: (g) => g.mailEnabled ? "Yes" : "No" },
      { header: "Created", accessor: (g) => (g.createdDateTime || "").slice(0,10) }
    ];
    const csv = toCSV(rows.filter(r => sel.has(r.id)), cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "groups.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="ops-card">
      <div className="ops-toolbar">
        <div className="ops-left-tools">
          <SearchBox value={q} onChange={setQ} onClear={() => setQ("")} placeholder="Search groups…" />
        </div>
        <div className="ops-right-tools">
          <button className="btn" onClick={fetchGroups}><FaSyncAlt /> Refresh</button>
          <button className="btn" onClick={exportCsv}><FaDownload /> Export</button>
          <button className="btn btn-danger" onClick={delGroups} title="Delete selected"><FaTrash /> Delete</button>
        </div>
      </div>

      <div className="ops-table-wrap">
        <table className="ops-table" role="grid" aria-label="Groups table">
          <thead>
            <tr>
              <th style={{width:36}}>
                <input type="checkbox" checked={!!allChecked} onChange={toggleAll} aria-label="Select all"/>
              </th>
              <th>Name</th>
              <th>Mail</th>
              <th>Type</th>
              <th>Security</th>
              <th>Mail Enabled</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="ops-empty">No groups</td></tr>}
            {loading && <tr><td colSpan={7} className="ops-empty">Loading…</td></tr>}
            {!loading && rows.map(g => {
              const type = (g.groupTypes || []).includes("Unified") ? "Microsoft 365" : "Security";
              const checked = sel.has(g.id);
              return (
                <tr key={g.id} className={checked ? "is-selected" : ""}>
                  <td><input type="checkbox" checked={checked} onChange={() => toggleSel(g.id)} aria-label={`Select ${g.displayName}`}/></td>
                  <td className="text-strong">{g.displayName}</td>
                  <td className="mono">{g.mail || "-"}</td>
                  <td><Chip kind="neutral"><FaUsers /> {type}</Chip></td>
                  <td>{g.securityEnabled ? <Chip kind="ok">Yes</Chip> : <Chip kind="muted">No</Chip>}</td>
                  <td>{g.mailEnabled ? <Chip kind="ok">Yes</Chip> : <Chip kind="muted">No</Chip>}</td>
                  <td className="mono">{(g.createdDateTime || "").slice(0,10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------
   LICENSES TAB (Assigned counts)
--------------------------- */
function LicensesTab({ instance, account }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSkus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await graphFetch(instance, account, {
        url: "/subscribedSkus?$top=50",
        scopes: ["Directory.Read.All"]
      });
      setRows(data.value || []);
    } finally {
      setLoading(false);
    }
  }, [instance, account]);

  useEffect(() => { fetchSkus(); }, [fetchSkus]);

  return (
    <section className="ops-card">
      <div className="ops-toolbar">
        <div className="ops-left-tools">
          <h3 className="ops-h3"><FaList /> Licenses</h3>
        </div>
        <div className="ops-right-tools">
          <button className="btn" onClick={fetchSkus}><FaSyncAlt /> Refresh</button>
        </div>
      </div>

      <div className="ops-table-wrap">
        <table className="ops-table" role="grid" aria-label="Licenses table">
          <thead>
            <tr>
              <th>SKU Part Number</th>
              <th>Friendly Name</th>
              <th>Total</th>
              <th>Consumed</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="ops-empty">No licenses</td></tr>}
            {loading && <tr><td colSpan={5} className="ops-empty">Loading…</td></tr>}
            {!loading && rows.map(sku => {
              const total = sku.prepaidUnits?.enabled ?? 0;
              const consumed = sku.consumedUnits ?? 0;
              const avail = Math.max(0, total - consumed);
              return (
                <tr key={sku.skuId}>
                  <td className="mono">{sku.skuPartNumber}</td>
                  <td>{sku.skuPartNumber.replaceAll("_", " ")}</td>
                  <td>{total}</td>
                  <td>{consumed}</td>
                  <td>{avail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------
   MAIN
--------------------------- */
const TABS = [
  { key: "users", label: "Users", icon: <FaUser /> },
  { key: "groups", label: "Groups", icon: <FaUsers /> },
  { key: "licenses", label: "Licenses", icon: <FaList /> },
];

export default function ITOperations() {
  const { instance, accounts } = useMsal();
  const account = accounts?.[0];

  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    return TABS.find(t => t.key === p)?.key || "users";
  });

  // keep URL & memory in sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [tab]);

  const Content = useMemo(() => {
    if (!account) return () => <div className="ops-empty">Sign in required…</div>;
    switch (tab) {
      case "users": return () => <UsersTab instance={instance} account={account} />;
      case "groups": return () => <GroupsTab instance={instance} account={account} />;
      case "licenses": return () => <LicensesTab instance={instance} account={account} />;
      default: return () => null;
    }
  }, [tab, instance, account]);

  return (
    <div className="ops-wrap">
      <header className="ops-header">
        <div className="ops-header-left">
          <p className="ops-subtitle">Search, sort, and manage Microsoft 365 (Entra) objects.</p>
        </div>

        <nav className="ops-tabs" role="tablist" aria-label="Entra tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`ops-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
              title={t.label}
            >
              <span className="ops-tab-icn">{t.icon}</span>
              <span className="ops-tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="ops-main">
        <Content />
      </main>
    </div>
  );
}
