// src/components/Reports.jsx
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  FaSearch,
  FaFilePdf,
  FaTimes,
  FaExternalLinkAlt,
  FaEye,
  FaBookOpen,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa";
import "./Reports.css";

// Use relative API so CRA proxy keeps requests same-origin
const API = "/api/reports";

const cleanTitle = (s = "") =>
  (s.split("/").pop() || s).replace(/\.(pdf|txt|docx?|xlsx?|pptx?|json|csv)$/i, "");

export default function Reports() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [projects, setProjects] = useState([]);
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // modal / iframe (PDF)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [viewerUrl, setViewerUrl] = useState(""); // presigned + #page= & zoom=
  const [pdfError, setPdfError] = useState("");

  // MULTI-PEEK: track open keys and per-key peek data
  // openKeys: Set of s3_keys that are currently expanded
  const [openKeys, setOpenKeys] = useState(() => new Set());
  /**
   * peekMap[key] = {
   *   status: 'idle'|'loading'|'ok'|'error',
   *   windows: string[],       // HTML per window (already highlighted)
   *   totalHits: number,       // total occurrences of all terms
   *   totalWindows: number,    // total windows available (merged)
   *   nextOffset: number|null, // next window offset for pagination
   *   err?: string
   * }
   */
  const [peekMap, setPeekMap] = useState({});

  // Lock background scroll while modal is open
  useEffect(() => {
    document.body.classList.toggle("reports-modal-open", modalOpen);
    return () => document.body.classList.remove("reports-modal-open");
  }, [modalOpen]);

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/projects`);
        setProjects(data.projects || []);
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  // Search
  const search = useCallback(async () => {
    if (!q.trim()) {
      setResults([]);
      setPages(1);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/search`, {
        params: { q, project, page, page_size: 99999 },
      });
      const rows = (data.results || []).map((r) => ({
        ...r,
        displayName: cleanTitle(r.filename || r.s3_key || ""),
      }));
      setResults(rows);
      setPages(data.pages || 1);
      setTotal(data.total || rows.length || 0);
      // reset peeks when result set changes
      setOpenKeys(new Set());
      setPeekMap({});
    } catch {
      setResults([]);
      setPages(1);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, project, page]);

  const onEnter = (e) => e.key === "Enter" && search();

  // Helper: get presigned URL for an S3 key
  const getPresignedUrl = async (s3Key) => {
    const { data } = await axios.get(`${API}/file-url`, { params: { key: s3Key } });
    if (!data?.url) throw new Error("No URL returned");
    return data.url;
  };

  // Open inline using a presigned S3 URL (direct, fast)
  const openInline = async (s3Key, title) => {
    setPdfError("");
    setModalTitle(cleanTitle(title || s3Key));
    setModalOpen(true);
    setViewerUrl("");

    try {
      const presigned = await getPresignedUrl(s3Key);

      // Use browser PDF viewer options; page-fit avoids “zoomed in”
      const frag = `#page=1&zoom=page-fit${
        q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ""
      }`;

      setViewerUrl(`${presigned}${frag}`);
    } catch {
      setPdfError("Failed to open PDF.");
      setViewerUrl("");
    }
  };

  // Open presigned in a new tab
  const openInNewTab = async (s3Key) => {
    try {
      const presigned = await getPresignedUrl(s3Key);
      window.open(presigned, "_blank", "noopener,noreferrer");
    } catch {
      alert("Failed to open in a new tab.");
    }
  };

  // Fetch peek windows (paged)
  const fetchPeek = async (s3Key, opts = {}) => {
    const state = peekMap[s3Key] || {};
    const limit = 3; // always load 3 at a time
    const offset = opts.offset ?? state.nextOffset ?? 0;

    // mark loading
    setPeekMap((m) => ({
      ...m,
      [s3Key]: {
        ...state,
        status: "loading",
      },
    }));

    try {
      const { data } = await axios.get(`${API}/peek`, {
        params: { key: s3Key, q, offset, limit },
      });

      const windows = data?.windows || [];
      const merged = (state.windows || []).concat(windows);
      const totalHits = data?.total_hits ?? state.totalHits ?? 0;
      const totalWindows = data?.total_windows ?? state.totalWindows ?? merged.length;
      const nextOffset =
        typeof data?.next_offset === "number" ? data.next_offset : null;

      setPeekMap((m) => ({
        ...m,
        [s3Key]: {
          status: "ok",
          windows: merged,
          totalHits,
          totalWindows,
          nextOffset,
        },
      }));
    } catch (e) {
      setPeekMap((m) => ({
        ...m,
        [s3Key]: {
          status: "error",
          windows: state.windows || [],
          totalHits: state.totalHits ?? 0,
          totalWindows: state.totalWindows ?? 0,
          nextOffset: state.nextOffset ?? 0,
          err: "Failed to load preview.",
        },
      }));
    }
  };

  // Toggle a peek open/closed (MULTI)
  const togglePeek = async (s3Key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(s3Key)) next.delete(s3Key);
      else next.add(s3Key);
      return next;
    });

    const entry = peekMap[s3Key];
    if (!entry || (entry.status !== "ok" && entry.status !== "loading")) {
      // first open -> fetch first 3
      fetchPeek(s3Key, { offset: 0 });
    }
  };

  const loadMorePeek = (s3Key) => {
    const entry = peekMap[s3Key];
    if (!entry || entry.status === "loading") return;
    if (entry.nextOffset == null) return;
    fetchPeek(s3Key, { offset: entry.nextOffset });
  };

  const closeModal = () => {
    setModalOpen(false);
    setViewerUrl("");
    setPdfError("");
  };

  return (
    <div className="reports-container">
      {/* Controls */}
      <div className="reports-controls">
        <div className="reports-controls-left">
          <div className="reports-input-wrap">
            <input
              className="reports-input"
              value={q}
              placeholder="Search reports…"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              onKeyDown={onEnter}
              spellCheck={false}
            />
          </div>

          <select
            className="reports-select"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.project || "(none)"} value={p.project}>
                {(p.project || "(none)")} ({p.count})
              </option>
            ))}
          </select>
        </div>

        <div className="reports-controls-right">
          <button className="reports-btn reports-primary" type="button" onClick={search}>
            <FaSearch style={{ marginRight: 6 }} />
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      {loading && <div className="reports-loading">Searching…</div>}
      {!loading && results.length === 0 && q.trim() && (
        <div className="reports-empty">No results.</div>
      )}

      {/* Total count */}
      {!loading && results.length > 0 && (
        <div className="reports-meta">
          <span className="reports-total">
            {total.toLocaleString()} results • Page {page} of {pages}
          </span>
        </div>
      )}

      {/* Scrollable list wrapper */}
      <div className="reports-results">
        <div className="reports-grid" role="list">
          {results.map((r) => {
            const entry = peekMap[r.s3_key];
            const isOpen = openKeys.has(r.s3_key);
            const totalHits = entry?.totalHits ?? null;
            const canLoadMore = entry?.nextOffset != null;

            return (
              <div key={r.s3_key} className="reports-card" role="listitem">
                <div className="reports-row">
                  <div className="reports-left" title={r.displayName}>
                    <FaFilePdf className="reports-icon" aria-hidden="true" />
                    <div className="reports-title-col">
                      <div className="reports-title-line">{r.displayName}</div>
                    </div>
                  </div>

                  <div className="reports-actions-row">
                    <button
                      className="reports-btn"
                      type="button"
                      onClick={() => togglePeek(r.s3_key)}
                      title="Peek text (no PDF)"
                      aria-label="Peek text"
                    >
                      <FaBookOpen style={{ marginRight: 6 }} />
                      Peek
                      {isOpen ? (
                        <FaChevronUp style={{ marginLeft: 6 }} />
                      ) : (
                        <FaChevronDown style={{ marginLeft: 6 }} />
                      )}
                    </button>

                    <button
                      className="reports-icon-btn"
                      type="button"
                      onClick={() => openInline(r.s3_key, r.displayName)}
                      title="View inline"
                      aria-label="View inline"
                    >
                      <FaEye aria-hidden="true" />
                    </button>
                    <button
                      className="reports-icon-btn"
                      type="button"
                      onClick={() => openInNewTab(r.s3_key)}
                      title="Open"
                      aria-label="Open"
                    >
                      <FaExternalLinkAlt aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Collapsible multi-peek area */}
                {isOpen && (
                  <div className="reports-peek">
                    {/* Header row with total match count (if known) */}
                    <div className="reports-peek-header">
                      <span className="reports-peek-title text-xs">
                        {r.displayName} — Peek
                      </span>
                      {totalHits !== null && (
                        <span className="reports-badge" title="Total matches">
                          {totalHits} matches
                        </span>
                      )}
                    </div>

                    {/* Body: windows list (scrollable) */}
                    <div className="reports-peek-body text-xs">
                      {!entry || entry.status === "loading" ? (
                        <div className="reports-peek-loading">Loading preview…</div>
                      ) : entry.status === "error" ? (
                        <div className="reports-peek-error">{entry.err}</div>
                      ) : (entry.windows || []).length === 0 ? (
                        <div className="reports-peek-empty">No matches found in text.</div>
                      ) : (
                        <ol className="reports-peek-list">
                          {(entry.windows || []).map((w, idx) => (
                            <li key={idx} className="reports-peek-item">
                              <div
                                className="reports-peek-html"
                                dangerouslySetInnerHTML={{ __html: w }}
                              />
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>

                    {/* Footer: load more if available */}
                    <div className="reports-peek-footer">
                      <button
                        className="reports-btn"
                        type="button"
                        disabled={!canLoadMore || entry?.status === "loading"}
                        onClick={() => loadMorePeek(r.s3_key)}
                        title="Load 3 more windows"
                      >
                        Load more
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pager */}
      {pages > 1 && (
        <div className="reports-pager">
          <button
            className="reports-btn"
            type="button"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span className="reports-page-indicator">
            {page}/{pages}
          </span>
          <button
            className="reports-btn"
            type="button"
            disabled={page === pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            Next
          </button>
        </div>
      )}

      {/* Modal viewer (full-viewport) */}
      {modalOpen && (
        <div className="reports-modal" onClick={closeModal}>
          <div className="reports-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="reports-modal-close"
              onClick={closeModal}
              aria-label="Close"
              type="button"
              title="Close"
            >
              <FaTimes />
            </button>

            <div className="reports-modal-bar">
              <div className="reports-title" title={modalTitle}>
                {modalTitle}
              </div>
            </div>

            <div className="reports-pdf-wrap">
              {pdfError && (
                <div className="reports-pdf-error" style={{ whiteSpace: "pre-wrap" }}>
                  {pdfError}
                </div>
              )}

              {!pdfError && viewerUrl && (
                <iframe className="reports-pdf-iframe" src={viewerUrl} title={modalTitle} />
              )}

              {!pdfError && !viewerUrl && (
                <div className="reports-pdf-loading">Loading PDF…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
