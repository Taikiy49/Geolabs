// src/components/Reports.jsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
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
  FaPlus,
} from "react-icons/fa";
import "./Reports.css";

// Use relative API so CRA proxy keeps requests same-origin
const API = "/api/reports";

const cleanTitle = (s = "") =>
  (s.split("/").pop() || s).replace(/\.(pdf|txt|docx?|xlsx?|pptx?|json|csv)$/i, "");

// numeric coercion helper (handles "12" -> 12, ignores NaN)
const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// SQLite FTS-safe phrase quoting: wrap in "..." and double any inner quotes.
const quotePhrase = (p) => `"${String(p).trim().replace(/"/g, '""')}"`;

// Build a query string from an array of phrases with a boolean operator
const buildQuery = (arr, op = "AND") =>
  arr && arr.length ? arr.map(quotePhrase).join(` ${op} `) : "";

// UI helpers
const stripTxt = (s = "") => String(s).replace(/\.txt$/i, "");
const truncate = (s = "", n = 50) => (s.length > n ? s.slice(0, n) + "…" : s);

export default function Reports() {
  // Phrase builder state
  const [termInput, setTermInput] = useState("");
  const [terms, setTerms] = useState([]); // array of phrases
  const [logicOp, setLogicOp] = useState("AND"); // "AND" | "OR"

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
  const [openKeys, setOpenKeys] = useState(() => new Set());
  /**
   * peekMap[key] = { status, windows: string[], totalHits, totalWindows, nextOffset, err? }
   */
  const [peekMap, setPeekMap] = useState({});

  // Build the final FTS query; include pending input automatically, using logicOp
  const qBuilt = useMemo(() => {
    const pending = termInput.trim();
    const all = pending ? [...terms, pending] : terms;
    return buildQuery(all, logicOp);
  }, [terms, termInput, logicOp]);

  // compute match count for a row (prefer API hits; fallback to peek totals)
  const getMatches = useCallback(
    (r, peek = peekMap) => {
      const api =
        num(r.hits) ??
        num(r.match_count) ??
        num(r.matches) ??
        num(r.score) ??
        num(r.rank);
      if (api !== null) return api;

      const pk = peek?.[r.s3Key];
      if (pk && num(pk.totalHits) !== null) return num(pk.totalHits);

      return 0;
    },
    [peekMap]
  );

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

  // ---------- define search FIRST (so addTerm can call it) ----------
  const search = useCallback(
    async (overrideQ) => {
      const qToUse = (overrideQ ?? qBuilt).trim();
      if (!qToUse) {
        setResults([]);
        setPages(1);
        setTotal(0);
        return;
      }
      setLoading(true);
      try {
        const { data } = await axios.get(`${API}/search`, {
          params: { q: qToUse, project, page, page_size: 99999 },
        });

        // Normalize each row to always include both s3_key and s3Key
        const rows = (data.results || []).map((r) => {
          const s3Key = r.s3_key || r.key || r.s3Key || "";
          return {
            ...r,
            s3_key: s3Key, // compatibility
            s3Key,         // camelCase for UI
            displayName: cleanTitle(r.filename || s3Key || ""),
          };
        });

        // order by most matches (numeric)
        rows.sort((a, b) => getMatches(b) - getMatches(a));

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
    },
    [qBuilt, project, page, getMatches]
  );

  // Add a phrase (from termInput) to terms and IMMEDIATELY run search
  const addTerm = useCallback(() => {
    const t = termInput.trim();
    if (!t) return;

    if (!terms.includes(t)) {
      const next = [...terms, t];
      setTerms(next);
      setPage(1);
      const qNext = buildQuery(next, logicOp);
      search(qNext);
    } else {
      setPage(1);
      search(buildQuery(terms, logicOp));
    }

    setTermInput("");
  }, [termInput, terms, logicOp, search]);

  // Remove a phrase
  const removeTerm = useCallback(
    (t) => {
      const next = terms.filter((x) => x !== t);
      setTerms(next);
      setPage(1);
      const qNext = buildQuery(next, logicOp);
      if (qNext) search(qNext);
      else {
        setResults([]);
        setPages(1);
        setTotal(0);
      }
    },
    [terms, logicOp, search]
  );

  // When the logic operator changes, re-run the current search if we have terms
  useEffect(() => {
    if (terms.length > 0 || termInput.trim()) {
      search(buildQuery(terms.concat(termInput.trim() ? [termInput.trim()] : []), logicOp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicOp]);

  // Re-rank when peek totals arrive
  useEffect(() => {
    if (!results?.length) return;
    setResults((prev) => {
      const arr = [...prev];
      arr.sort((a, b) => getMatches(b, peekMap) - getMatches(a, peekMap));
      return arr;
    });
  }, [peekMap, getMatches, results?.length]);

  // Enter in the phrase input: add the phrase (and search)
  const onPhraseKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTerm();
    }
  };

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
      const frag = `#page=1&zoom=page-fit${
        qBuilt.trim() ? `&search=${encodeURIComponent(qBuilt.trim())}` : ""
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
    if (!s3Key) {
      setPeekMap((m) => ({
        ...m,
        __missing__: {
          status: "error",
          windows: [],
          totalHits: 0,
          totalWindows: 0,
          nextOffset: 0,
          err: "Preview unavailable: missing file key.",
        },
      }));
      return;
    }

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
        params: { key: s3Key, q: qBuilt, offset, limit },
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

  // Pretty preview of the boolean query for the meta bar
  const prettyQuery = useMemo(() => {
    const pending = termInput.trim();
    const all = pending ? [...terms, pending] : terms;
    if (!all.length) return "";
    return all.map((t) => `“${t}”`).join(` ${logicOp} `);
  }, [terms, termInput, logicOp]);

  return (
    <div className="reports-container">
      {/* Sticky controls */}
      <div className="reports-controls">
        {/* LEFT: phrase builder */}
        <div className="controls-left">
          <div className="term-row">
            <input
              className="reports-input"
              value={termInput}
              placeholder='Type a word or phrase…'
              onChange={(e) => setTermInput(e.target.value)}
              onKeyDown={onPhraseKeyDown}
              spellCheck={false}
            />

            {/* Logic segmented control */}
            <div className="logic-toggle" role="group" aria-label="Match operator">
              <button
                type="button"
                className={`logic-chip ${logicOp === "AND" ? "active logic-and" : ""}`}
                onClick={() => setLogicOp("AND")}
                title="Match all phrases (AND)"
                aria-pressed={logicOp === "AND"}
              >
                AND
              </button>
              <button
                type="button"
                className={`logic-chip ${logicOp === "OR" ? "active logic-or" : ""}`}
                onClick={() => setLogicOp("OR")}
                title="Match any phrase (OR)"
                aria-pressed={logicOp === "OR"}
              >
                OR
              </button>
            </div>

            {/* Add button reflects the selected operator */}
            <button
              className={`reports-btn add-btn ${logicOp === "AND" ? "add-and" : "add-or"}`}
              type="button"
              onClick={addTerm}
              title={`Add phrase (${logicOp})`}
              aria-label={`Add phrase with ${logicOp}`}
            >
              <FaPlus style={{ marginRight: 4 }} /> Add ({logicOp})
            </button>
          </div>

          {terms.length > 0 && (
            <div className="chip-row">
              {terms.map((t) => (
                <span key={t} className={`chip ${logicOp === "AND" ? "chip-and" : "chip-or"}`} title={t}>
                  <span className="chip-label">{t}</span>
                  <button
                    type="button"
                    className="chip-x"
                    onClick={() => removeTerm(t)}
                    aria-label={`Remove ${t}`}
                    title="Remove phrase"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: project filter + search (search to the right of All Projects) */}
        <div className="controls-right">
          <select
            className="reports-select"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
            title={stripTxt(project)}
          >
            <option value="">All Projects</option>
            {projects.map((p) => {
              const raw = p.project || "(none)";
              const full = stripTxt(raw);
              const shown = truncate(full, 50);
              return (
                <option key={raw} value={raw} title={full}>
                  {shown} ({p.count})
                </option>
              );
            })}
          </select>

          <button
            className="reports-btn reports-primary"
            type="button"
            onClick={() => search()}
            disabled={!qBuilt.trim()}
            title={qBuilt || "No phrases yet"}
          >
            <FaSearch style={{ marginRight: 6 }} />
            Search
          </button>
        </div>
      </div>

      {/* Meta row: left=Query / right=Totals */}
      {(prettyQuery || (!loading && results.length > 0)) && (
        <div className="reports-meta-bar">
          <div className="reports-meta-left">
            {prettyQuery ? (
              <>
                <span className="reports-meta-label">Query:</span>{" "}
                <span className="reports-meta-query">{prettyQuery}</span>
                {project && (
                  <>
                    <span className="reports-meta-sep">•</span>
                    <span className="reports-meta-label">Project:</span>{" "}
                    <span className="reports-meta-project" title={stripTxt(project)}>
                      {truncate(stripTxt(project), 50)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="reports-meta-placeholder">&nbsp;</span>
            )}
          </div>

          <div className="reports-meta-right">
            {!loading && results.length > 0 && (
              <span className="reports-total">
                {total.toLocaleString()} results
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {loading && <div className="reports-loading">Searching…</div>}
      {!loading && results.length === 0 && qBuilt.trim() && (
        <div className="reports-empty">No results.</div>
      )}

      {/* Results list */}
      <div className="reports-results">
        <div className="reports-grid" role="list">
          {results.map((r) => {
            const entry = peekMap[r.s3Key];
            const isOpen = openKeys.has(r.s3Key);
            const totalHits = entry?.totalHits ?? null;
            const canLoadMore = entry?.nextOffset != null;

            const fullTitle = r.displayName;
            const shortTitle = truncate(fullTitle, 50);

            return (
              <div key={r.s3Key} className="reports-card" role="listitem">
                <div className="reports-row">
                  <div className="reports-left" title={fullTitle}>
                    <FaFilePdf className="reports-icon" aria-hidden="true" />
                    <div className="reports-title-col">
                      <div className="reports-title-line" title={fullTitle}>
                        {shortTitle}
                      </div>
                    </div>
                  </div>

                  <div className="reports-actions-row">
                    <button
                      className="reports-btn"
                      type="button"
                      onClick={() => togglePeek(r.s3Key)}
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
                      onClick={() => openInline(r.s3Key, r.displayName)}
                      title="View inline"
                      aria-label="View inline"
                    >
                      <FaEye aria-hidden="true" />
                    </button>
                    <button
                      className="reports-icon-btn"
                      type="button"
                      onClick={() => openInNewTab(r.s3Key)}
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
                    <div className="reports-peek-header">
                      <span className="reports-peek-title"> {shortTitle} — Peek</span>
                      {totalHits !== null && (
                        <span className="reports-badge" title="Total matches">
                          {totalHits} matches
                        </span>
                      )}
                    </div>

                    <div className="reports-peek-body">
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

                    <div className="reports-peek-footer">
                      <button
                        className="reports-btn"
                        type="button"
                        disabled={!canLoadMore || entry?.status === "loading"}
                        onClick={() => loadMorePeek(r.s3Key)}
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

      
      {/* Modal viewer */}
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
