// src/pages/ServerSearch.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  FaSearch,
  FaRegClock,
  FaRedo,
  FaDownload,
  FaCopy,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/ServerSearch.css";

export default function ServerSearch() {
  const [query, setQuery] = useState("");
  const [ext, setExt] = useState("");
  const [extOptions, setExtOptions] = useState([{ ext: "", count: 0 }]);

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const base = useMemo(() => (API_URL || "").replace(/\/$/, ""), []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${base}/api/server-search/exts`);
        if (data?.ok) {
          setExtOptions([{ ext: "", count: 0 }, ...data.exts.filter(Boolean)]);
        }
      } catch {/* ignore */}
    })();
  }, [base]);

  const runSearch = async (qValue, extValue, pageNum, perPage) => {
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const { data } = await axios.post(`${base}/api/server-search/search`, {
        query: qValue.trim(),
        ext: extValue,
        limit: perPage,
        offset: (pageNum - 1) * perPage,
      });

      if (data.ok) {
        setResults(data.items || []);
        setLastQuery(qValue.trim());
      } else {
        setError(data.error || "Search failed");
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Request failed");
    }
    setLoading(false);
  };

  const handleSearch = (e, forceRetry = false) => {
    e?.preventDefault?.();
    if (!query.trim() && !forceRetry) return;
    setPage(1);
    runSearch(query, ext, 1, pageSize);
  };

  useEffect(() => {
    if (!lastQuery) return;
    runSearch(lastQuery, ext, page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (!lastQuery && !query.trim()) return;
    const q = lastQuery || query.trim();
    setPage(1);
    runSearch(q, ext, 1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  useEffect(() => {
    if (!lastQuery) return;
    setPage(1);
    runSearch(lastQuery, ext, 1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext]);

  const downloadViaServer = (path) => {
    const url = `${base}/api/server-search/download?path=${encodeURIComponent(path)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyPath = async (path) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopyFeedback("Path copied");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = path;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        setCopyFeedback("Path copied");
        document.body.removeChild(ta);
      } catch {
        setCopyFeedback("Copy failed");
      }
    }
    setTimeout(() => setCopyFeedback(""), 1200);
  };

  const canPrev = page > 1 && !loading;
  const canNext = results.length === pageSize && !loading;

  return (
    <div className="serversearch">
      <form className="serversearch-form" onSubmit={handleSearch}>
        <div className="serversearch-inputs">
          <input
            type="text"
            className="serversearch-box"
            placeholder="Enter filename or keyword…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <select
            className="serversearch-select"
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            title="Filter by file type"
          >
            <option value="">All Types</option>
            {extOptions
              .filter((x) => x.ext && x.ext !== "(none)")
              .slice(0, 40)
              .map((o) => (
                <option key={o.ext} value={o.ext}>
                  {o.ext.toUpperCase()}
                </option>
              ))}
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
            <option value="txt">TXT</option>
          </select>

          <select
            className="serversearch-select serversearch-pagesize"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            title="Results per page"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="serversearch-btn"
            disabled={loading}
            title="Search"
          >
            {loading ? "Searching…" : <FaSearch />}
          </button>
        </div>
      </form>

      {error && <div className="serversearch-error">⚠️ {error}</div>}
      {copyFeedback && <div className="serversearch-toast">{copyFeedback}</div>}

      {loading ? (
        <div className="serversearch-loading">Scanning database…</div>
      ) : results.length > 0 ? (
        <>
          <table className="serversearch-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Modified</th>
                <th className="serversearch-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.path}-${i}`}>
                  <td title={r.path} className="serversearch-fn">
                    {r.name}
                    <div className="serversearch-path-sub">{r.path}</div>
                  </td>
                  <td>{r.ext || "-"}</td>
                  <td>
                    <FaRegClock className="clock" /> {r.modified || "—"}
                  </td>
                  <td className="serversearch-actions">
                    <button
                      type="button"
                      className="serversearch-link"
                      onClick={() => copyPath(r.path)}
                      title="Copy UNC path"
                    >
                      <FaCopy /> Copy Path
                    </button>
                    <button
                      type="button"
                      className="serversearch-link"
                      onClick={() => downloadViaServer(r.path)}
                      title="Download via server"
                    >
                      <FaDownload /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pager */}
          <div className="serversearch-pager">
            <button
              className="serversearch-link"
              onClick={() => canPrev && setPage((p) => Math.max(1, p - 1))}
              disabled={!canPrev}
              type="button"
            >
              <FaChevronLeft /> Prev
            </button>
            <div className="serversearch-pageinfo">
              Page <strong>{page}</strong>
            </div>
            <button
              className="serversearch-link"
              onClick={() => canNext && setPage((p) => p + 1)}
              disabled={!canNext}
              type="button"
            >
              Next <FaChevronRight />
            </button>
          </div>

          <div className="serversearch-summary">
            Showing {results.length} result{results.length !== 1 ? "s" : ""} for “{lastQuery}”
          </div>
        </>
      ) : !loading ? (
        <div className="serversearch-empty">
          {error ? "Try again." : "No results yet — search above."}
          {error && (
            <button
              className="serversearch-retry"
              onClick={(e) => handleSearch(e, true)}
            >
              <FaRedo /> Retry
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
