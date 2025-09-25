import React, { useEffect, useMemo, useState } from "react";
import { FaSearch, FaDownload, FaSync, FaCheckDouble } from "react-icons/fa";
import "./ITOperations.css";

const mockRows = [
  {
    id: 11,
    name: "Priya Das",
    email: "priya.das@example.com",
    department: "Finance",
    lastDay: "2024-12-20",
    disabled: true,
    archived: true,
    assetsReturned: true,
    notes: "Mailbox export saved to /archives/finance",
  },
  {
    id: 12,
    name: "Caleb Reed",
    email: "caleb.reed@example.com",
    department: "Engineering",
    lastDay: "2025-01-07",
    disabled: false,
    archived: false,
    assetsReturned: false,
    notes: "",
  },
];

export default function TerminatedAccounts() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [showOpenTasks, setShowOpenTasks] = useState(false);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => setRows(mockRows), []);

  const depts = useMemo(
    () => Array.from(new Set(rows.map(r => r.department))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    let data = [...rows];
    if (query.trim()) {
      const q = query.toLowerCase();
      data = data.filter(
        r => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)
      );
    }
    if (dept) data = data.filter(r => r.department === dept);
    if (showOpenTasks) data = data.filter(r => !(r.disabled && r.archived && r.assetsReturned));
    return data.sort((a, b) => (a.lastDay < b.lastDay ? 1 : -1));
  }, [rows, query, dept, showOpenTasks]);

  const toggleSelect = (id) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAllFiltered = () => setSelected(new Set(filtered.map(r => r.id)));
  const clearSelection = () => setSelected(new Set());

  const bulkMarkDisabled = () => {
    const ids = Array.from(selected);
    setRows(prev => prev.map(r => (ids.includes(r.id) ? { ...r, disabled: true } : r)));
    clearSelection();
  };
  const bulkMarkArchived = () => {
    const ids = Array.from(selected);
    setRows(prev => prev.map(r => (ids.includes(r.id) ? { ...r, archived: true } : r)));
    clearSelection();
  };
  const bulkMarkAssets = () => {
    const ids = Array.from(selected);
    setRows(prev => prev.map(r => (ids.includes(r.id) ? { ...r, assetsReturned: true } : r)));
    clearSelection();
  };

  const exportCSV = () => {
    const header = ["Name","Email","Dept","Last Day","Disabled","Archived","Assets Returned","Notes"];
    const lines = filtered.map(r => [
      r.name, r.email, r.department, r.lastDay, r.disabled, r.archived, r.assetsReturned, r.notes || ""
    ]);
    const csv = [header, ...lines]
      .map(row => row.map(x => `"${String(x).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "terminated_accounts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ops-card">
      <div className="ops-toolbar">
        <div className="ops-left-tools">
          <div className="ops-search">
            <FaSearch />
            <input
              placeholder="Search name or email…"
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
              checked={showOpenTasks}
              onChange={() => setShowOpenTasks(v => !v)}
            />
            Show with open tasks
          </label>
        </div>

        <div className="ops-right-tools">
          <button className="btn btn-ghost" onClick={() => { setQuery(""); setDept(""); setShowOpenTasks(false); }}>
            <FaSync /> Reset
          </button>
          <button className="btn" onClick={exportCSV}>
            <FaDownload /> CSV
          </button>
          <div className="ops-bulk">
            <button className="btn" disabled={!selected.size} onClick={bulkMarkDisabled}>Mark Disabled</button>
            <button className="btn" disabled={!selected.size} onClick={bulkMarkArchived}>Mark Archived</button>
            <button className="btn btn-primary" disabled={!selected.size} onClick={bulkMarkAssets}>
              <FaCheckDouble /> Assets Returned
            </button>
          </div>
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
              <th>Last Day</th>
              <th>Disabled</th>
              <th>Archived</th>
              <th>Assets Returned</th>
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
                <td className="ops-mono">{r.lastDay}</td>
                <td><Toggle value={r.disabled} onChange={v => setRows(prev => prev.map(x => x.id === r.id ? { ...x, disabled: v } : x))} /></td>
                <td><Toggle value={r.archived} onChange={v => setRows(prev => prev.map(x => x.id === r.id ? { ...x, archived: v } : x))} /></td>
                <td><Toggle value={r.assetsReturned} onChange={v => setRows(prev => prev.map(x => x.id === r.id ? { ...x, assetsReturned: v } : x))} /></td>
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
                <td colSpan={9} className="ops-empty">No results.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={`ops-toggle ${value ? "on" : "off"}`}
      onClick={() => onChange(!value)}
    >
      <span className="dot" />
      {value ? "Done" : "Open"}
    </button>
  );
}
