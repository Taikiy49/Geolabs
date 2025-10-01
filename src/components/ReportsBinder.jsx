// src/components/ReportsBinder.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import API_URL from "../config";
import "../styles/ReportsBinder.css";

const PAGE_SIZES = [10, 25, 50, 100];

function IconBtn({ title, onClick, children, danger, disabled }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rb-iconbtn ${danger ? "danger" : ""}`}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}

const emptyDraft = {
  pdf_file: "",
  date: "",
  work_order: "",
  engineer_initials: "",
  billing: "",
  date_sent: "",
  page_label: "",
};

export default function ReportsBinder() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);

  // filters (match Flask params)
  const [q, setQ] = useState("");
  const [wo, setWo] = useState("");
  const [eng, setEng] = useState("");
  const [billingOnly, setBillingOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // sorting & paging (match server: sort_by, sort_dir)
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("DESC");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // create / edit / selection / toast / confirm
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);

  const [selected, setSelected] = useState(new Set());
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const [confirming, setConfirming] = useState(null);
  const [toast, setToast] = useState(null); // { text, actionText, onAction }
  const toastTimer = useRef(null);

  // UX bits
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null); // { ok, db_exists, db_path } or error msg

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(count / pageSize)),
    [count, pageSize]
  );

  // Health check once (uses GET /api/reports-binder/_health)
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/reports-binder/_health`);
        setHealth(res.data);
      } catch (e) {
        setHealth({ ok: false, error: "Health check failed" });
      }
    })();
  }, []);

  // Lock body scroll when confirming
  useEffect(() => {
    const lock = Boolean(confirming);
    const prev = document.body.style.overflow;
    document.body.style.overflow = lock ? "hidden" : prev || "";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [confirming]);

  // ESC shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (confirming) setConfirming(null);
        else if (editingId != null) {
          setEditingId(null);
          setEditDraft(emptyDraft);
        } else if (showNew) {
          setShowNew(false);
          setDraft(emptyDraft);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, editingId, showNew]);

  // Load rows from Flask (GET /api/reports-binder)
  const fetchRows = async () => {
    const params = {
      q: q || undefined,
      wo: wo || undefined,
      eng: eng || undefined,
      billing_only: billingOnly ? "1" : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      page_size: pageSize,
    };
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/reports-binder`, { params });
      setRows(res.data.rows || []);
      setCount(res.data.total || 0);
      setSelected(new Set());
    } catch (e) {
      console.error("Failed to fetch reports", e);
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, wo, eng, billingOnly, dateFrom, dateTo, sortBy, sortDir, page, pageSize]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(col);
      setSortDir("ASC");
    }
    setPage(1);
  };

  const resetFilters = () => {
    setQ("");
    setWo("");
    setEng("");
    setBillingOnly(false);
    setDateFrom("");
    setDateTo("");
    setSortBy("date");
    setSortDir("DESC");
    setPage(1);
    setPageSize(25);
  };

  const formatDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString();
  };

  // New row
  const onNew = () => {
    setDraft({ ...emptyDraft });
    setShowNew(true);
  };
  const saveNew = async () => {
    if (!draft.work_order.trim()) {
      alert("Work Order is required.");
      return;
    }
    try {
      await axios.post(`${API_URL}/api/reports-binder`, draft);
      setShowNew(false);
      setDraft(emptyDraft);
      setToastTimed("Added", null, null);
      fetchRows();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to add.");
    }
  };

  // Edit
  const startEdit = (r) => {
    setEditingId(r.id);
    setEditDraft({
      pdf_file: r.pdf_file || "",
      date: r.date || "",
      work_order: r.work_order || "",
      engineer_initials: r.engineer_initials || "",
      billing: r.billing || "",
      date_sent: r.date_sent || "",
      page_label: r.page_label || "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft);
  };
  const saveEdit = async (id) => {
    try {
      await axios.put(`${API_URL}/api/reports-binder/${id}`, editDraft);
      setEditingId(null);
      setToastTimed("Saved changes", null, null);
      fetchRows();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save changes.");
    }
  };

  // Delete
  const confirmDelete = (id) => setConfirming(id);
  const doDelete = async (id) => {
    setConfirming(null);
    try {
      await axios.delete(`${API_URL}/api/reports-binder/${id}`);
      setToastTimed("Removed", null, null);
      fetchRows();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to remove.");
    }
  };

  // Bulk delete
  const bulkDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected row(s)?`)) return;
    try {
      await axios.post(`${API_URL}/api/reports-binder/bulk-delete`, {
        ids: Array.from(selected),
      });
      setSelected(new Set());
      setToastTimed("Removed selected", null, null);
      fetchRows();
    } catch (e) {
      alert(e.response?.data?.error || "Bulk delete failed.");
    }
  };

  // CSV export (client-side)
  const toCSV = (list) => {
    const cols = [
      { key: "date", label: "Date" },
      { key: "work_order", label: "Work Order" },
      { key: "engineer_initials", label: "Initials" },
      { key: "billing", label: "Billing" },
      { key: "date_sent", label: "Date Sent" },
    ];
    const escape = (v) =>
      `"${String(v ?? "").replaceAll('"', '""').replace(/\r?\n/g, " ")}"`;
    const header = cols.map((c) => escape(c.label)).join(",");
    const lines = list
      .map((r) => cols.map((c) => escape(r[c.key])).join(","))
      .join("\n");
    return `${header}\n${lines}`;
  };
  const exportCSV = () => {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports_binder_page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // selection
  const toggleSelectAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const toggleRow = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  function setToastTimed(text, actionText, onAction) {
    setToast({ text, actionText, onAction });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  const EditableCell = ({ value, onChange, type = "text", placeholder }) => (
    <input
      className="rb-input rb-input-inline"
      type={type}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancelEdit();
      }}
    />
  );

  return (
    <div className="rb-wrap">
      <div className="rb-topbar">
        <div className="rb-filters">
          <input
            className="rb-input"
            placeholder="Search (WO / Initials / Billing / PDF)…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <input
            className="rb-input"
            placeholder="WO (exact/prefix)…"
            value={wo}
            onChange={(e) => {
              setWo(e.target.value);
              setPage(1);
            }}
          />
          <input
            className="rb-input"
            placeholder="Initials (e.g. GS:AT)…"
            value={eng}
            onChange={(e) => {
              setEng(e.target.value.toUpperCase());
              setPage(1);
            }}
          />
          <label className="rb-checkbox">
            <input
              type="checkbox"
              checked={billingOnly}
              onChange={(e) => {
                setBillingOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span>Has billing</span>
          </label>
          <input
            className="rb-input"
            type="date"
            title="Date from"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
          <input
            className="rb-input"
            type="date"
            title="Date to"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
          <button className="rb-btn rb-btn-ghost" onClick={resetFilters}>
            Reset
          </button>
        </div>

        <div className="rb-meta">
          <button className="rb-btn" onClick={onNew}>+ New</button>
          <button
            className="rb-btn"
            onClick={bulkDelete}
            disabled={!selected.size}
          >
            Delete
          </button>
          <button
            className="rb-btn"
            onClick={exportCSV}
            disabled={!rows.length}
          >
            Export
          </button>

          <span className="rb-hint">{loading ? "Loading…" : `${count} results`}</span>
          <select
            className="rb-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}/page</option>
            ))}
          </select>
        </div>
      </div>

      {/* health banner */}
      {health && health.ok === false && (
        <div className="rb-health rb-health-bad">
          DB unavailable {health.db_path ? `(${health.db_path})` : ""}. Check the server.
        </div>
      )}
      {health && health.ok && health.db_exists === false && (
        <div className="rb-health rb-health-warn">
          Database not found. The API will create it on first insert.
        </div>
      )}

      {/* New row inline */}
      {showNew && (
        <div className="rb-newrow">
          <input
            className="rb-input"
            placeholder="PDF file"
            value={draft.pdf_file}
            onChange={(e) => setDraft({ ...draft, pdf_file: e.target.value })}
          />
          <input
            className="rb-input"
            type="date"
            title="Date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <input
            className="rb-input"
            placeholder="Work Order *"
            value={draft.work_order}
            onChange={(e) =>
              setDraft({ ...draft, work_order: e.target.value.toUpperCase() })
            }
          />
          <input
            className="rb-input"
            placeholder="Initials (GS:AT:TT)"
            value={draft.engineer_initials}
            onChange={(e) =>
              setDraft({
                ...draft,
                engineer_initials: e.target.value.toUpperCase(),
              })
            }
          />
          <input
            className="rb-input"
            placeholder="Billing (5-6 digits)"
            value={draft.billing}
            onChange={(e) =>
              setDraft({
                ...draft,
                billing: e.target.value.replace(/[^0-9]/g, ""),
              })
            }
          />
          <input
            className="rb-input"
            type="date"
            title="Date Sent"
            value={draft.date_sent}
            onChange={(e) => setDraft({ ...draft, date_sent: e.target.value })}
          />
          <input
            className="rb-input"
            placeholder="Page Label"
            value={draft.page_label}
            onChange={(e) => setDraft({ ...draft, page_label: e.target.value })}
          />
          <button className="rb-btn" onClick={saveNew}>Save</button>
          <button
            className="rb-btn rb-btn-ghost"
            onClick={() => {
              setShowNew(false);
              setDraft(emptyDraft);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="rb-table-wrap">
        <table className="rb-table">
          <thead>
            <tr>
              <th className="rb-th">
                <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} />
              </th>
  
              <th className="rb-th" onClick={() => toggleSort("work_order")}>
                W.O. {sortBy === "work_order" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
              </th>
              <th className="rb-th" onClick={() => toggleSort("engineer_initials")}>
                Initials {sortBy === "engineer_initials" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
              </th>
              <th className="rb-th" onClick={() => toggleSort("billing")}>
                Billing {sortBy === "billing" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
              </th>
              <th className="rb-th" onClick={() => toggleSort("date_sent")}>
                Date Sent {sortBy === "date_sent" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
              </th>
              <th className="rb-th">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const isEdit = editingId === r.id;
              return (
                <tr key={r.id} className={isEdit ? "rb-editing" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                    />
                  </td>
                  {/* Work Order */}
                  <td className="rb-mono">
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.work_order}
                        onChange={(v) =>
                          setEditDraft({ ...editDraft, work_order: v.toUpperCase() })
                        }
                        placeholder="WO"
                      />
                    ) : (
                      r.work_order
                    )}
                  </td>

                  {/* Initials */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.engineer_initials}
                        onChange={(v) =>
                          setEditDraft({
                            ...editDraft,
                            engineer_initials: v.toUpperCase(),
                          })
                        }
                        placeholder="GS:AT:TT"
                      />
                    ) : (
                      r.engineer_initials
                    )}
                  </td>

                  {/* Billing */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        value={editDraft.billing}
                        onChange={(v) =>
                          setEditDraft({
                            ...editDraft,
                            billing: v.replace(/[^0-9]/g, ""),
                          })
                        }
                        placeholder="12345"
                      />
                    ) : (
                      r.billing
                    )}
                  </td>

                  {/* Date Sent */}
                  <td>
                    {isEdit ? (
                      <EditableCell
                        type="date"
                        value={editDraft.date_sent}
                        onChange={(v) => setEditDraft({ ...editDraft, date_sent: v })}
                      />
                    ) : (
                      formatDate(r.date_sent)
                    )}
                  </td>

                  {/* Actions */}
                  <td className="rb-actions">
                    {isEdit ? (
                      <>
                        <IconBtn title="Save" onClick={() => saveEdit(r.id)}>💾</IconBtn>
                        <IconBtn title="Cancel" onClick={cancelEdit}>✖</IconBtn>
                      </>
                    ) : (
                      <>
                        <IconBtn title="Edit" onClick={() => startEdit(r)}>✎</IconBtn>
                        <IconBtn title="Delete" onClick={() => confirmDelete(r.id)} danger>🗑</IconBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td colSpan="7" className="rb-empty">
                  {loading ? "Loading…" : "No results."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rb-pager">
        <button className="rb-btn" onClick={() => setPage(1)} disabled={page === 1}>
          ⏮
        </button>
        <button
          className="rb-btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          ◀
        </button>
        <span className="rb-page">
          {page} / {totalPages}
        </span>
        <button
          className="rb-btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          ▶
        </button>
        <button
          className="rb-btn"
          onClick={() => setPage(totalPages)}
          disabled={page === totalPages}
        >
          ⏭
        </button>
      </div>

      {/* Confirm delete modal */}
      {confirming && (
        <div className="rb-modal">
          <div className="rb-modal-card">
            <div className="rb-modal-title">Confirm removal</div>
            <div className="rb-modal-body">
              This will remove the record from the binder list.
            </div>
            <div className="rb-modal-actions">
              <button className="rb-btn rb-btn-ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button className="rb-btn danger" onClick={() => doDelete(confirming)}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="rb-toast">
          <span>{toast.text}</span>
          {toast.actionText && toast.onAction && (
            <button className="rb-btn" onClick={toast.onAction}>
              {toast.actionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
