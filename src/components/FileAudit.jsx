// src/pages/FileAudit.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import "../styles/FileAudit.css";

const API = (import.meta?.env?.VITE_API_BASE || "").replace(/\/+$/, "");
const STATUS_OPTIONS = ["NEW", "IN PROGRESS", "ON HOLD", "DONE", "ARCHIVED"];
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500];

function useDebounced(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API}${p}`;
}

export default function FileAudit() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]); // default 50
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    file_folder: "",
    location: "",
    engr: "",
    status: "NEW",
    notes: "",
  });

  const [importBusy, setImportBusy] = useState(false);
  const importRef = useRef(null);
  const mainRef = useRef(null);

  const canLoadMore = useMemo(() => rows.length < total, [rows.length, total]);

  async function fetchRows({ append = false } = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (dq) params.set("q", dq);
      if (status) params.set("status", status);

      const url = apiUrl(`/api/file-audit?${params.toString()}`);
      const res = await fetch(url);
      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {}
      if (!res.ok) throw new Error(data?.error || `Failed to load (${res.status})`);

      setTotal(data.total || 0);
      const items = data.items || [];
      setRows((prev) => (append ? [...prev, ...items] : items));
    } catch (e) {
      if (!append) {
        setRows([]);
        setTotal(0);
      }
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Load on filters/page changes
  useEffect(() => {
    // whenever q/status/pageSize changes, reset to page 1
    setPage(1);
  }, [dq, status, pageSize]);

  useEffect(() => {
    fetchRows({ append: page > 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, status, page, pageSize]);

  // Infinite scroll handler
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    function onScroll() {
      if (busy || !canLoadMore) return;
      const threshold = 3 * 24; // ~72px using small rows (pure px avoided elsewhere)
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      if (nearBottom) {
        setPage((p) => p + 1);
      }
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [busy, canLoadMore]);

  async function updateRow(id, patch) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, _saving: true } : r)));
    try {
      const url = apiUrl(`/api/file-audit/${id}`);
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Update failed");
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...data, _saving: false } : r)));
    } catch (e) {
      setError(String(e.message || e));
      fetchRows(); // revert to server truth
    }
  }

  async function deleteRow(id) {
    const ok = window.confirm("Delete this record?");
    if (!ok) return;
    try {
      const url = apiUrl(`/api/file-audit/${id}`);
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      // Reload page 1 to avoid empty tail glitches
      setPage(1);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function addRow(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const url = apiUrl(`/api/file-audit`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Create failed");
      setAdding(false);
      setForm({ file_folder: "", location: "", engr: "", status: "NEW", notes: "" });
      setPage(1); // refresh from top
    } catch (e2) {
      setError(String(e2.message || e2));
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file) {
    if (!file) return;
    setImportBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = apiUrl(`/api/file-audit/import`);
      const res = await fetch(url, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setPage(1);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function addDemoRow() {
    const fakeEvent = { preventDefault() {} };
    setForm({
      file_folder: "" + Math.floor(Math.random() * 100000),
      location: "",
      engr: "",
      status: "NEW",
      notes: "",
    });
    await addRow(fakeEvent);
  }

  return (
    <div className="fa-wrap">
      {/* Sticky toolbar — full width, no side padding */}
      <header className="fa-header">
        <div className="fa-actions">
          <input
            className="fa-search"
            placeholder="Search file folder, location, engr…"
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
          />
          <select
            className="fa-filter"
            value={status}
            onChange={(e) => { setStatus(e.target.value); }}
            title="Filter by status"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <label className="fa-label">Rows:</label>
          <select
            className="fa-filter"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            title="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <button className="fa-btn" onClick={() => setAdding(true)}>+ Add</button>
          <button className="fa-btn" type="button" onClick={addDemoRow}>+ Demo Row</button>
          <a className="fa-btn" href={apiUrl("/api/file-audit/export")} target="_blank" rel="noreferrer">Export CSV</a>

          <label className={`fa-btn fa-upload-btn${importBusy ? " is-busy" : ""}`}>
            {importBusy ? "Importing…" : "Import CSV"}
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              className="fa-upload-input"
              onChange={(e) => importCsv(e.target.files?.[0])}
              disabled={importBusy}
            />
          </label>
        </div>
      </header>

      {/* Scrollable main area (infinite scroll) */}
      <main className="fa-main" ref={mainRef}>
        {error && <div className="fa-error">{error}</div>}

        <div className="fa-table">
          <div className="fa-thead">
            <div>FILE FOLDER</div>
            <div>LOCATION</div>
            <div>ENGR</div>
            <div>STATUS</div>
            <div>LAST UPDATED</div>
            <div>NOTES</div>
            <div></div>
          </div>

          <div className="fa-tbody">
            {busy && rows.length === 0 && <div className="fa-empty">Loading…</div>}
            {!busy && rows.length === 0 && <div className="fa-empty">No records</div>}

            {rows.map((r) => (
              <div key={r.id} className={`fa-row ${r._saving ? "is-saving" : ""}`}>
                <div title={r.file_folder}>{r.file_folder}</div>
                <div title={r.location}>{r.location}</div>
                <div title={r.engr}>{r.engr}</div>
                <div>
                  <select
                    className="fa-status"
                    data-status={r.status || "NEW"}
                    value={r.status || "NEW"}
                    onChange={(e) => updateRow(r.id, { status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>{r.last_updated ? new Date(r.last_updated).toLocaleString() : ""}</div>
                <div>
                  <input
                    className="fa-notes"
                    defaultValue={r.notes || ""}
                    placeholder="Add note…"
                    onBlur={(e) => e.target.value !== (r.notes || "") && updateRow(r.id, { notes: e.target.value })}
                  />
                </div>
                <div>
                  <button className="fa-link danger" onClick={() => deleteRow(r.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="fa-footer">
          <span>Loaded {rows.length} / {total}</span>
          <div className="fa-pages">
            <button
              className="fa-btn"
              onClick={() => setPage((p) => p + 1)}
              disabled={!canLoadMore || busy}
              title="Load more"
            >
              {busy ? "Loading…" : (canLoadMore ? "Load more" : "All loaded")}
            </button>
          </div>
        </footer>
      </main>

      {adding && (
        <div className="fa-modal" role="dialog" aria-modal="true">
          <div className="fa-card">
            <div className="fa-card-head">
              <div className="fa-card-title">Add Record</div>
              <button className="fa-link" onClick={() => setAdding(false)}>Close</button>
            </div>
            <form onSubmit={addRow} className="fa-form">
              <label>
                File Folder
                <input
                  value={form.file_folder}
                  onChange={(e) => setForm((f) => ({ ...f, file_folder: e.target.value }))}
                  required
                />
              </label>
              <label>
                Location
                <input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </label>
              <label>
                ENGR
                <input
                  value={form.engr}
                  onChange={(e) => setForm((f) => ({ ...f, engr: e.target.value }))}
                />
              </label>
              <label>
                Status
                <select
                  className="fa-status"
                  data-status={form.status}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="fa-notes-area">
                Notes
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <div className="fa-form-actions">
                <button type="button" className="fa-link" onClick={() => setAdding(false)}>Cancel</button>
                <button className="fa-btn" type="submit">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
