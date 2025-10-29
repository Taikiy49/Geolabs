// src/pages/CoreBoxInventory.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import API_URL from "../config";
import "../styles/CoreBoxInventory.css";

/* =========================
   Helpers & micro-components
   ========================= */
const pageSizes = [10, 25, 50, 100];

function Badge({ children, tone = "neutral" }) {
  return <span className={`cbi-badge cbi-badge--${tone}`}>{children}</span>;
}

function IconBtn({ title, onClick, children, danger, disabled, type = "button" }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`cbi-iconbtn ${danger ? "cbi-iconbtn--danger" : ""}`}
      disabled={disabled}
      type={type}
    >
      {children}
    </button>
  );
}

const emptyDraft = {
  work_order: "",
  project: "",
  engineer: "",
  report_submission_date: "",
  storage_expiry_date: "",
  complete: "",
  keep_or_dump: "",
  island: "",
  year: ""
};

export default function CoreBoxInventory() {
  // data
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);

  // filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState(""); // debounced search
  const [island, setIsland] = useState("");
  const [year, setYear] = useState("");
  const [complete, setComplete] = useState("");
  const [keepOrDump, setKeepOrDump] = useState("");
  const [expiredOnly, setExpiredOnly] = useState(false);

  // sorting & paging
  const [sortBy, setSortBy] = useState("report_submission_date");
  const [sortDir, setSortDir] = useState("DESC");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // dropdown options
  const [years, setYears] = useState([]);
  const [islands, setIslands] = useState([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // create / edit
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);

  // selection / confirm / toast
  const [selected, setSelected] = useState(new Set());
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id));
  const [confirming, setConfirming] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // history drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changes, setChanges] = useState([]);
  const [changesLoading, setChangesLoading] = useState(false);

  // paging calc
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / pageSize)),
    [count, pageSize]
  );

  // lock body scroll when blocking UI open
  useEffect(() => {
    const lock = confirming || historyOpen;
    const prev = document.body.style.overflow;
    document.body.style.overflow = lock ? "hidden" : prev || "";
    return () => { document.body.style.overflow = prev || ""; };
  }, [confirming, historyOpen]);

  // global ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (confirming) setConfirming(null);
        else if (historyOpen) setHistoryOpen(false);
        else if (editingId != null) { setEditingId(null); setEditDraft(emptyDraft); }
        else if (showNew) { setShowNew(false); setDraft(emptyDraft); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, historyOpen, editingId, showNew]);

  // keyboard shortcuts: Ctrl/Cmd+N (new), Ctrl/Cmd+S (CSV), Ctrl/Cmd+F (focus search)
  const searchRef = useRef(null);
  useEffect(() => {
    const onHotkey = (e) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (k === "n") { e.preventDefault(); onNew(); }
      if (k === "s") { e.preventDefault(); exportCSV(); }
      if (k === "f") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onHotkey);
    return () => window.removeEventListener("keydown", onHotkey);
  }, [rows, draft]);

  // fetch options (islands / years)
  const fetchOptions = async () => {
    try {
      const [y, i] = await Promise.all([
        axios.get(`${API_URL}/api/core-boxes/years`),
        axios.get(`${API_URL}/api/core-boxes/islands`),
      ]);
      setYears(y.data.years || []);
      setIslands(i.data.islands || []);
    } catch {
      setYears([]);
      setIslands([]);
    }
  };

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // fetch table rows
  const fetchRows = async () => {
    const params = {
      q: debouncedQ || undefined,
      island: island || undefined,
      year: year || undefined,
      complete: complete || undefined,
      keep_or_dump: keepOrDump || undefined,
      expired: expiredOnly ? "1" : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      page_size: pageSize,
    };
    try {
      setLoading(true);
      setError("");
      const res = await axios.get(`${API_URL}/api/core-boxes`, { params });
      setRows(res.data.rows || []);
      setCount(res.data.total || 0);
      setSelected(new Set());
    } catch (e) {
      console.error("Failed to fetch core boxes", e);
      setRows([]);
      setCount(0);
      setError(e.response?.data?.error || "Failed to load records.");
    } finally {
      setLoading(false);
    }
  };

  const fetchChanges = async () => {
    try {
      setChangesLoading(true);
      const res = await axios.get(`${API_URL}/api/core-boxes/changes`, {
        params: { limit: 200 }
      });
      setChanges(res.data.changes || []);
    } catch (e) {
      console.error("Failed to load changes", e);
      setChanges([]);
    } finally {
      setChangesLoading(false);
    }
  };

  useEffect(() => { fetchOptions(); }, []);
  useEffect(() => { fetchRows(); /* eslint-disable-next-line */ }, [debouncedQ, island, year, complete, keepOrDump, expiredOnly, sortBy, sortDir, page, pageSize]);
  useEffect(() => { if (historyOpen) fetchChanges(); }, [historyOpen]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    else { setSortBy(col); setSortDir("ASC"); }
    setPage(1);
  };

  const clearSort = () => { setSortBy("report_submission_date"); setSortDir("DESC"); setPage(1); };

  const resetFilters = () => {
    setQ(""); setIsland(""); setYear(""); setComplete(""); setKeepOrDump("");
    setExpiredOnly(false);
    clearSort();
    setPageSize(25);
  };

  const formatDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString();
  };

  // add new
  const onNew = () => {
    setDraft({ ...emptyDraft, island: island || "", year: year || "" });
    setShowNew(true);
  };
  const saveNew = async () => {
    if (!draft.work_order.trim()) { alert("Work Order is required."); return; }
    try {
      await axios.post(`${API_URL}/api/core-boxes`, draft);
      setShowNew(false); setDraft(emptyDraft);
      setToastTimed("✅ Added", null, null);
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to add.");
    }
  };

  // edit row
  const startEdit = (r) => {
    setEditingId(r.id);
    setEditDraft({
      work_order: r.work_order || "",
      project: r.project || "",
      engineer: r.engineer || "",
      report_submission_date: r.report_submission_date || "",
      storage_expiry_date: r.storage_expiry_date || "",
      complete: r.complete || "",
      keep_or_dump: r.keep_or_dump || "",
      island: r.island || "",
      year: r.year || ""
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(emptyDraft); };
  const saveEdit = async (id) => {
    try {
      await axios.put(`${API_URL}/api/core-boxes/${id}`, editDraft);
      setEditingId(null);
      setToastTimed("✅ Saved changes", null, null);
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save changes.");
    }
  };

  // delete / bulk delete
  const confirmDelete = (id) => setConfirming(id);
  const doDelete = async (id) => {
    setConfirming(null);
    try {
      const res = await axios.delete(`${API_URL}/api/core-boxes/${id}`);
      const changeId = res.data?.change_id;
      setToastTimed("🗑️ Removed — undo?", "Undo", changeId ? () => restoreChange(changeId) : null);
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to remove.");
    }
  };
  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected item(s)?\nOnly records marked "Dump" will be removed.`)) return;
    try {
      let lastChangeId = null;
      for (const id of selected) {
        const res = await axios.delete(`${API_URL}/api/core-boxes/${id}`);
        lastChangeId = res.data?.change_id || lastChangeId;
      }
      setSelected(new Set());
      setToastTimed("🗑️ Removed — undo?", "Undo", lastChangeId ? () => restoreChange(lastChangeId) : null);
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Bulk delete failed.");
    }
  };

  // dump & remove
  const dumpAndRemove = async (r) => {
    const ok = window.confirm(`Mark "${r.work_order}" as Dump and remove from list?`);
    if (!ok) return;
    try {
      await axios.put(`${API_URL}/api/core-boxes/${r.id}`, { keep_or_dump: "Dump" });
      const res = await axios.delete(`${API_URL}/api/core-boxes/${r.id}`);
      const changeId = res.data?.change_id;
      setToastTimed("🗑️ Dumped & removed — undo?", "Undo", () => restoreChange(changeId));
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to dump & remove.");
    }
  };

  // undo via restore
  const restoreChange = async (changeId) => {
    try {
      await axios.post(`${API_URL}/api/core-boxes/restore`, { change_id: changeId });
      setToastTimed("↩️ Restored", null, null);
      fetchRows(); if (historyOpen) fetchChanges();
    } catch (e) {
      alert(e.response?.data?.error || "Undo failed.");
    }
  };

  function setToastTimed(text, actionText, onAction) {
    setToast({ text, actionText, onAction });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }

  // selection
  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };
  const toggleRow = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  // small inline input
  const EditableCell = ({ value, onChange, type="text", placeholder }) => (
    <input
      className="cbi-input cbi-input-inline"
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
    />
  );

  // export
  const exportCSV = () => {
    const header = [
      "year","island","work_order","project","engineer",
      "report_submission_date","storage_expiry_date","complete","keep_or_dump","status"
    ];
    const lines = rows.map(r => {
      const expired = r.storage_expiry_date && new Date(r.storage_expiry_date) < new Date();
      const status = expired ? "Expired" : "Active";
      const vals = [
        r.year||"", r.island||"", r.work_order||"", r.project||"", r.engineer||"",
        r.report_submission_date||"", r.storage_expiry_date||"", r.complete||"", r.keep_or_dump||"", status
      ];
      return vals.map(x => `"${String(x).replace(/"/g,'""')}"`).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `core-boxes_page${page}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`cbi-wrap ${historyOpen ? "cbi-drawer-open" : ""}`}>
      {/* Top bar */}
      <div className="cbi-topbar">
        <div className="cbi-filters">
          <input
            ref={searchRef}
            className="cbi-input"
            placeholder="Search (WO / Project / Engineer)…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            title="Find records (Ctrl/Cmd+F)"
          />

          <select className="cbi-select" value={island} onChange={(e) => { setIsland(e.target.value); setPage(1); }}>
            <option value="">Island: All</option>
            {islands.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="cbi-select" value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}>
            <option value="">Year: All</option>
            {years.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>

          <select className="cbi-select" value={complete} onChange={(e) => { setComplete(e.target.value); setPage(1); }}>
            <option value="">Complete: All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>

          <select className="cbi-select" value={keepOrDump} onChange={(e) => { setKeepOrDump(e.target.value); setPage(1); }}>
            <option value="">Disposition: All</option>
            <option value="Keep">Keep</option>
            <option value="Dump">Dump</option>
            <option value="Save">Save</option>
          </select>

          <label className="cbi-checkbox">
            <input
              type="checkbox"
              checked={expiredOnly}
              onChange={(e) => { setExpiredOnly(e.target.checked); setPage(1); }}
            />
            <span>Expired only</span>
          </label>

          <button className="cbi-btn cbi-btn--ghost" onClick={resetFilters}>Reset</button>
        </div>

        <div className="cbi-meta">
          <button className="cbi-btn" onClick={() => setHistoryOpen(v => !v)}>
            {historyOpen ? "Hide History" : "Show History"}
          </button>
          <button className="cbi-btn" onClick={onNew} title="New (Ctrl/Cmd+N)">+ New</button>
          <button className="cbi-btn cbi-btn--danger" onClick={bulkDelete} disabled={!selected.size}>
            Delete Selected {selected.size ? `(${selected.size})` : ""}
          </button>

          <button className="cbi-btn" onClick={exportCSV} title="Export CSV (Ctrl/Cmd+S)">Export</button>

          <span className="cbi-count">{loading ? "Loading…" : `${count} results`}</span>
          <select
            className="cbi-select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {pageSizes.map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
        </div>
      </div>

      {/* Inline create */}
      {showNew && (
        <div className="cbi-newrow">
          <input className="cbi-input" placeholder="Work Order *" value={draft.work_order} onChange={e=>setDraft({...draft, work_order:e.target.value})}/>
          <input className="cbi-input" placeholder="Project" value={draft.project} onChange={e=>setDraft({...draft, project:e.target.value})}/>
          <input className="cbi-input" placeholder="Engineer" value={draft.engineer} onChange={e=>setDraft({...draft, engineer:e.target.value})}/>
          <input className="cbi-input" type="date" title="Submission (optional)" value={draft.report_submission_date} onChange={e=>setDraft({...draft, report_submission_date:e.target.value})}/>
          <input className="cbi-input" type="date" title="Expiry (preferred)" value={draft.storage_expiry_date} onChange={e=>setDraft({...draft, storage_expiry_date:e.target.value})}/>
          <select className="cbi-select" value={draft.complete} onChange={e=>setDraft({...draft, complete:e.target.value})}>
            <option value="">Complete?</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
          <select className="cbi-select" value={draft.keep_or_dump} onChange={e=>setDraft({...draft, keep_or_dump:e.target.value})}>
            <option value="">Disposition</option>
            <option value="Keep">Keep</option>
            <option value="Dump">Dump</option>
            <option value="Save">Save</option>
          </select>
          <input className="cbi-input" placeholder="Island" value={draft.island} onChange={e=>setDraft({...draft, island:e.target.value})}/>
          <input className="cbi-input" placeholder="Year" value={draft.year} onChange={e=>setDraft({...draft, year:e.target.value})}/>
          <button className="cbi-btn" onClick={saveNew}>Save</button>
          <button className="cbi-btn cbi-btn--ghost" onClick={()=>{setShowNew(false);setDraft(emptyDraft);}}>Cancel</button>
        </div>
      )}

      {/* Errors (non-blocking) */}
      {!!error && <div className="cbi-inline-error">{error}</div>}

      {/* Table */}
      <div className="cbi-table-wrap">
        <table className="cbi-table">
          <thead>
            <tr>
              <th className="cbi-th" aria-label="Select all">
                <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} />
              </th>
              <th onClick={() => toggleSort("year")} className="cbi-th">Year {sortBy === "year" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("island")} className="cbi-th">Island {sortBy === "island" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("work_order")} className="cbi-th">W.O. {sortBy === "work_order" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("project")} className="cbi-th">Project {sortBy === "project" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("engineer")} className="cbi-th">Engineer {sortBy === "engineer" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("report_submission_date")} className="cbi-th">Submitted {sortBy === "report_submission_date" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th onClick={() => toggleSort("storage_expiry_date")} className="cbi-th">Expiry {sortBy === "storage_expiry_date" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
              <th className="cbi-th">Complete</th>
              <th className="cbi-th">Disposition</th>
              <th className="cbi-th">Status</th>
              <th className="cbi-th">
                <button className="cbi-btn cbi-btn--ghost" onClick={clearSort} title="Clear sorting">Clear</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const expired = r.storage_expiry_date && new Date(r.storage_expiry_date) < new Date();
              const isEdit = editingId === r.id;

              return (
                <tr key={r.id} className={isEdit ? "cbi-editing" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                      aria-label={`Select row for ${r.work_order || "WO"}`}
                    />
                  </td>

                  {/* Year */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.year}
                        onChange={(v)=>setEditDraft({...editDraft, year: v})}
                        placeholder="Year"
                      />
                    ) : r.year}
                  </td>

                  {/* Island */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.island}
                        onChange={(v)=>setEditDraft({...editDraft, island: v})}
                        placeholder="Island"
                      />
                    ) : r.island}
                  </td>

                  {/* WO */}
                  <td className="cbi-mono" title={r.work_order}>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.work_order}
                        onChange={(v)=>setEditDraft({...editDraft, work_order: v})}
                        placeholder="WO"
                      />
                    ) : r.work_order}
                  </td>

                  {/* Project */}
                  <td title={r.project}>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.project}
                        onChange={(v)=>setEditDraft({...editDraft, project: v})}
                        placeholder="Project"
                      />
                    ) : r.project}
                  </td>

                  {/* Engineer */}
                  <td title={r.engineer}>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.engineer}
                        onChange={(v)=>setEditDraft({...editDraft, engineer: v})}
                        placeholder="Engineer"
                      />
                    ) : r.engineer}
                  </td>

                  {/* Submitted */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        type="date"
                        value={editDraft.report_submission_date}
                        onChange={(v)=>setEditDraft({...editDraft, report_submission_date: v})}
                      />
                    ) : formatDate(r.report_submission_date)}
                  </td>

                  {/* Expiry */}
                  <td className={expired ? "cbi-expired" : ""}>
                    {isEdit ? (
                      <EditableCell
                        type="date"
                        value={editDraft.storage_expiry_date}
                        onChange={(v)=>setEditDraft({...editDraft, storage_expiry_date: v})}
                      />
                    ) : formatDate(r.storage_expiry_date)}
                  </td>

                  {/* Complete */}
                  <td>
                    {isEdit ? (
                      <select
                        className="cbi-select cbi-select-inline"
                        value={editDraft.complete || ""}
                        onChange={(e)=>setEditDraft({...editDraft, complete: e.target.value})}
                      >
                        <option value="">—</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : r.complete}
                  </td>

                  {/* Disposition */}
                  <td>
                    {isEdit ? (
                      <select
                        className="cbi-select cbi-select-inline"
                        value={editDraft.keep_or_dump || ""}
                        onChange={(e)=>setEditDraft({...editDraft, keep_or_dump: e.target.value})}
                      >
                        <option value="">—</option>
                        <option value="Keep">Keep</option>
                        <option value="Dump">Dump</option>
                        <option value="Save">Save</option>
                      </select>
                    ) : r.keep_or_dump}
                  </td>

                  {/* Status */}
                  <td>
                    {expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="ok">Active</Badge>}
                  </td>

                  {/* Actions */}
                  <td className="cbi-actions">
                    {isEdit ? (
                      <>
                        <IconBtn title="Save" onClick={() => saveEdit(r.id)}>💾</IconBtn>
                        <IconBtn title="Cancel" onClick={cancelEdit}>✖</IconBtn>
                      </>
                    ) : (
                      <>
                        <IconBtn title="Edit" onClick={() => startEdit(r)}>✎</IconBtn>
                        <IconBtn title="Mark Dumped & Remove" onClick={() => dumpAndRemove(r)}>🧹</IconBtn>
                        <IconBtn title="Delete" onClick={() => confirmDelete(r.id)} danger>🗑</IconBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!loading && rows.length === 0) && (
              <tr>
                <td colSpan="12" className="cbi-empty">No results.</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan="12" className="cbi-loading">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="cbi-pager">
        <button className="cbi-btn" onClick={() => setPage(1)} disabled={page === 1}>⏮</button>
        <button className="cbi-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>◀</button>
        <span className="cbi-page">{page} / {totalPages}</span>
        <button className="cbi-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>▶</button>
        <button className="cbi-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>⏭</button>
      </div>

      {/* Backdrop for history drawer */}
      {historyOpen && <div className="cbi-backdrop" onClick={() => setHistoryOpen(false)} />}

      {/* Confirm delete modal */}
      {confirming && (
        <div className="cbi-modal">
          <div className="cbi-modal-card">
            <div className="cbi-modal-title">Confirm removal</div>
            <div className="cbi-modal-body">
              This will remove the record from the live list. A copy is kept in history and can be restored.
              <div className="cbi-modal-note">Tip: Only items marked “Dump” are removable by policy.</div>
            </div>
            <div className="cbi-modal-actions">
              <button className="cbi-btn cbi-btn--ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="cbi-btn cbi-btn--danger" onClick={() => doDelete(confirming)}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="cbi-toast">
          <span>{toast.text}</span>
          {toast.actionText && toast.onAction && (
            <button className="cbi-btn" onClick={toast.onAction}>{toast.actionText}</button>
          )}
        </div>
      )}

      {/* History drawer */}
      {historyOpen && (
        <div className="cbi-history">
          <div className="cbi-history-head">
            <div className="cbi-history-title">Change History</div>
            <div className="cbi-history-actions">
              <button className="cbi-btn cbi-btn--ghost" onClick={fetchChanges} disabled={changesLoading}>
                {changesLoading ? "Loading…" : "Refresh"}
              </button>
              <button className="cbi-btn" onClick={() => setHistoryOpen(false)}>Close</button>
            </div>
          </div>
          <div className="cbi-history-list">
            {changes.length === 0 && <div className="cbi-empty">No changes recorded.</div>}
            {changes.map((c) => (
              <div className="cbi-history-item" key={c.id}>
                <div className="cbi-history-meta">
                  <span className="cbi-mono">{c.ts?.replace("T"," ").slice(0,19)}</span>
                  <Badge tone={c.action === "delete" ? "danger" : "neutral"}>{c.action}</Badge>
                  <span>WO:</span>
                  <span className="cbi-mono">{c.work_order || "(unknown)"}</span>
                  {c.user && <span>by {c.user}</span>}
                </div>
                {c.action === "delete" && (
                  <button className="cbi-btn" onClick={() => restoreChange(c.id)}>Restore</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
