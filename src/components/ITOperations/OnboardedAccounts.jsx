import React, { useEffect, useMemo, useState } from "react";
import {
  FaSearch, FaDownload, FaPlus, FaCheckCircle, FaSync
} from "react-icons/fa";
import "./ITOperations.css";

const mockRows = [
  {
    id: 1,
    name: "Avery Chen",
    email: "avery.chen@example.com",
    department: "Engineering",
    role: "Software Engineer",
    startDate: "2025-01-10",
    mfa: true,
    laptopIssued: true,
    accounts: { o365: true, jira: true, github: true, vpn: true },
    notes: "Starter kit issued",
  },
  {
    id: 2,
    name: "Luis Romero",
    email: "luis.romero@example.com",
    department: "Operations",
    role: "Field Tech",
    startDate: "2025-01-20",
    mfa: false,
    laptopIssued: false,
    accounts: { o365: true, jira: false, github: false, vpn: false },
    notes: "",
  },
];

export default function OnboardedAccounts() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    setRows(mockRows);
  }, []);

  const depts = useMemo(() => {
    const all = Array.from(new Set(rows.map(r => r.department))).sort();
    return all;
  }, [rows]);

  const filtered = useMemo(() => {
    let data = [...rows];
    if (query.trim()) {
      const q = query.toLowerCase();
      data = data.filter(
        r =>
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.role.toLowerCase().includes(q)
      );
    }
    if (dept) data = data.filter(r => r.department === dept);
    if (onlyIncomplete) {
      data = data.filter(
        r => !(r.mfa && r.laptopIssued && r.accounts.o365 && r.accounts.jira && r.accounts.github && r.accounts.vpn)
      );
    }
    return data.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  }, [rows, query, dept, onlyIncomplete]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(new Set(filtered.map(r => r.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const markChecklistComplete = (ids) => {
    setRows(prev =>
      prev.map(r =>
        ids.includes(r.id)
          ? { ...r, mfa: true, laptopIssued: true, accounts: { o365: true, jira: true, github: true, vpn: true } }
          : r
      )
    );
    clearSelection();
  };

  const exportCSV = () => {
    const header = [
      "Name", "Email", "Department", "Role", "Start Date",
      "MFA", "Laptop", "O365", "Jira", "GitHub", "VPN", "Notes"
    ];
    const lines = filtered.map(r => [
      r.name, r.email, r.department, r.role, r.startDate,
      r.mfa, r.laptopIssued, r.accounts.o365, r.accounts.jira, r.accounts.github, r.accounts.vpn, r.notes || ""
    ]);
    const csv = [header, ...lines]
      .map(row => row.map(x => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "onboarded_accounts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const addRow = () => {
    const id = Date.now();
    setRows(prev => [
      {
        id,
        name: "New Hire",
        email: "new.hire@example.com",
        department: "Engineering",
        role: "TBD",
        startDate: new Date().toISOString().slice(0, 10),
        mfa: false,
        laptopIssued: false,
        accounts: { o365: false, jira: false, github: false, vpn: false },
        notes: "",
      },
      ...prev,
    ]);
  };

  return (
    <div className="ops-card">
      <div className="ops-toolbar">
        <div className="ops-left-tools">
          <div className="ops-search">
            <FaSearch />
            <input
              placeholder="Search name, email, role…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="ops-select" value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All Departments</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <label className="ops-checkbox">
            <input
              type="checkbox"
              checked={onlyIncomplete}
              onChange={() => setOnlyIncomplete(v => !v)}
            />
            Show incomplete only
          </label>
        </div>

        <div className="ops-right-tools">
          <button className="btn btn-ghost" onClick={() => { setQuery(""); setDept(""); setOnlyIncomplete(false); }}>
            <FaSync /> Reset
          </button>
          <button className="btn" onClick={addRow}>
            <FaPlus /> Add
          </button>
          <button className="btn" onClick={exportCSV}>
            <FaDownload /> CSV
          </button>
          <button
            className="btn btn-primary"
            disabled={selected.size === 0}
            onClick={() => markChecklistComplete(Array.from(selected))}
            title="Mark MFA/Laptop/All accounts complete for selected"
          >
            <FaCheckCircle /> Mark Complete
          </button>
        </div>
      </div>

      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th style={{width: 36}}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())}
                />
              </th>
              <th>Name</th>
              <th>Email</th>
              <th>Dept</th>
              <th>Role</th>
              <th>Start</th>
              <th>MFA</th>
              <th>Laptop</th>
              <th>O365</th>
              <th>Jira</th>
              <th>GitHub</th>
              <th>VPN</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                </td>
                <td>{r.name}</td>
                <td className="ops-mono">{r.email}</td>
                <td>{r.department}</td>
                <td>{r.role}</td>
                <td className="ops-mono">{r.startDate}</td>
                <td>
                  <ToggleCell value={r.mfa} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, mfa: v } : x))} />
                </td>
                <td>
                  <ToggleCell value={r.laptopIssued} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, laptopIssued: v } : x))} />
                </td>
                <td><ToggleCell value={r.accounts.o365} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, accounts: { ...x.accounts, o365: v } } : x))} /></td>
                <td><ToggleCell value={r.accounts.jira} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, accounts: { ...x.accounts, jira: v } } : x))} /></td>
                <td><ToggleCell value={r.accounts.github} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, accounts: { ...x.accounts, github: v } } : x))} /></td>
                <td><ToggleCell value={r.accounts.vpn} onChange={(v) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, accounts: { ...x.accounts, vpn: v } } : x))} /></td>
                <td className="ops-notes">
                  <input
                    className="ops-notes-input"
                    value={r.notes}
                    onChange={(e) => setRows(prev => prev.map(x => x.id === r.id ? { ...x, notes: e.target.value } : x))}
                    placeholder="Add note…"
                  />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={13} className="ops-empty">No results.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ToggleCell({ value, onChange }) {
  return (
    <button
      className={`ops-toggle ${value ? "on" : "off"}`}
      onClick={() => onChange(!value)}
      type="button"
    >
      <span className="dot" />
      {value ? "Yes" : "No"}
    </button>
  );
}
