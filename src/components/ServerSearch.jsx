// src/pages/ServerSearch.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  FaSearch,
  FaRegClock,
  FaRedo,
  FaDownload,
  FaCopy,
  FaFolderOpen,
  FaFolderPlus,
  FaSortUp,
  FaSortDown,
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/ServerSearch.css";

const DEFAULT_LIMIT = 1000; // no paging; fetch up to this many results

export default function ServerSearch() {
  const [query, setQuery] = useState("");
  const [ext, setExt] = useState("");
  const [extOptions, setExtOptions] = useState([{ ext: "", count: 0 }]);

  const [kind, setKind] = useState("files"); // 'files' | 'folders' | 'both'
  const [areas, setAreas] = useState([]);    // [{area, count}]
  const [area, setArea] = useState("");      // selected top-level

  // sorting (header-driven)
  const [sortBy, setSortBy] = useState("mtime");      // 'mtime' | 'name' | 'ext' | 'area' | 'kind'
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc'

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");

  const base = useMemo(() => (API_URL || "").replace(/\/$/, ""), []);

  // Fetch ext and area options
  useEffect(() => {
    (async () => {
      try {
        const [{ data: exts }, { data: ars }] = await Promise.all([
          axios.get(`${base}/api/server-search/exts`),
          axios.get(`${base}/api/server-search/areas`),
        ]);
        if (exts?.ok) setExtOptions([{ ext: "", count: 0 }, ...exts.exts.filter(Boolean)]);
        if (ars?.ok) setAreas(ars.areas || []);
      } catch {
        /* ignore */
      }
    })();
  }, [base]);

  const runSearch = async (params) => {
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const { data } = await axios.post(`${base}/api/server-search/search`, params);
      if (data.ok) {
        setResults(data.items || []);
        setLastQuery(params.query?.trim() || "");
      } else {
        setError(data.error || "Search failed");
      }
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Request failed");
    }
    setLoading(false);
  };

  const buildParams = (qValue) => ({
    query: (qValue || "").trim(),
    ext: kind === "folders" ? "" : ext, // ext applies to files only
    kind,
    area: area || "",
    sort_by: sortBy,
    order: sortOrder,
    limit: DEFAULT_LIMIT,
    offset: 0,
  });

  const handleSearch = (e, forceRetry = false) => {
    e?.preventDefault?.();
    if (!query.trim() && !forceRetry) return;
    runSearch(buildParams(query));
  };

  // Rerun when ext/kind/area/sort changes (if we already searched)
  useEffect(() => {
    if (!lastQuery && !query.trim()) return;
    const q = lastQuery || query.trim();
    runSearch(buildParams(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext, kind, area, sortBy, sortOrder]);

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

  const searchWithin = (folderPath) => {
    setQuery(folderPath);
    setLastQuery(folderPath);
    runSearch(buildParams(folderPath));
  };

  // Clickable header sort toggler
  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder(key === "name" ? "asc" : "desc");
    }
  };

  const SortArrow = ({ col }) => {
    if (sortBy !== col) return null;
    return sortOrder === "asc" ? <FaSortUp className="sort-arrow" /> : <FaSortDown className="sort-arrow" />;
  };

  return (
    <div className="serversearch">
      <form className="serversearch-form" onSubmit={handleSearch}>
        <div className="serversearch-inputs">
          <input
            type="text"
            className="serversearch-box"
            placeholder="Enter filename, folder, or keyword…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Kind */}
          <select
            className="serversearch-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            title="Search kind"
          >
            <option value="files">Files</option>
            <option value="folders">Folders</option>
            <option value="both">Files & Folders</option>
          </select>

          {/* Area (top-level under \\...\\fs\\) */}
          <select
            className="serversearch-select"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            title="Top-level folder"
          >
            <option value="">All Areas</option>
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {a.area} ({a.count})
              </option>
            ))}
          </select>

          {/* Ext (files only) */}
          <select
            className="serversearch-select"
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            title="Filter by file type"
            disabled={kind === "folders"}
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

          {/* Search button */}
          <button
            type="submit"
            className="serversearch-btn"
            disabled={loading}
            title="Search"
          >
            {loading ? "Searching…" : <><FaSearch />&nbsp;Search</>}
          </button>
        </div>
      </form>

      {error && <div className="serversearch-error">⚠️ {error}</div>}
      {copyFeedback && <div className="serversearch-toast">{copyFeedback}</div>}

      {loading ? (
        <div className="serversearch-loading">Scanning database…</div>
      ) : results.length > 0 ? (
        <div className="serversearch-content">
          <div className="serversearch-tablewrap">
            <table className="serversearch-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="serversearch-thbtn"
                      onClick={() => toggleSort("name")}
                      aria-label={`Sort by Name ${sortBy === "name" && sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Name <SortArrow col="name" />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="serversearch-thbtn"
                      onClick={() => toggleSort("kind")}
                      aria-label={`Sort by Kind ${sortBy === "kind" && sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Kind <SortArrow col="kind" />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="serversearch-thbtn"
                      onClick={() => toggleSort("area")}
                      aria-label={`Sort by Area ${sortBy === "area" && sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Area <SortArrow col="area" />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="serversearch-thbtn"
                      onClick={() => toggleSort("ext")}
                      aria-label={`Sort by Type ${sortBy === "ext" && sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Type <SortArrow col="ext" />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="serversearch-thbtn"
                      onClick={() => toggleSort("mtime")}
                      aria-label={`Sort by Modified ${sortBy === "mtime" && sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                      Modified <SortArrow col="mtime" />
                    </button>
                  </th>
                </tr>
              </thead>

              <tbody>
                {results.map((r, i) => (
                  <tr key={`${r.path}-${i}`}>
                    {/* NAME + PATH + INLINE ICONS */}
                    <td title={r.path} className="serversearch-fn">
                      <div className="serversearch-fn-title">{r.name}</div>

                      <div className="serversearch-path-row">
                        <span className="serversearch-path-sub">{r.path}</span>

                        <div className="serversearch-inline-icons">
                          <button
                            type="button"
                            className="serversearch-iconbtn"
                            onClick={() => copyPath(r.path)}
                            title="Copy path"
                            aria-label={`Copy path for ${r.name}`}
                          >
                            <FaCopy />
                          </button>

                          {r.kind !== "folder" ? (
                            <button
                              type="button"
                              className="serversearch-iconbtn"
                              onClick={() => downloadViaServer(r.path)}
                              title="Download"
                              aria-label={`Download ${r.name}`}
                            >
                              <FaDownload />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="serversearch-iconbtn"
                              onClick={() => searchWithin(r.path)}
                              title="Search within"
                              aria-label={`Search within ${r.name}`}
                            >
                              <FaFolderPlus />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* KIND */}
                    <td>
                      {r.kind === "folder" ? (
                        <span className="serversearch-badge folder">
                          <FaFolderOpen /> Folder
                        </span>
                      ) : (
                        <span className="serversearch-badge file">File</span>
                      )}
                    </td>

                    {/* AREA */}
                    <td>{r.area || "—"}</td>

                    {/* EXT / TYPE */}
                    <td>{r.ext || (r.kind === "folder" ? "—" : "-")}</td>

                    {/* MODIFIED */}
                    <td>
                      <FaRegClock className="clock" /> {r.modified || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="serversearch-summary">
            Showing {results.length} result{results.length !== 1 ? "s" : ""} for “{lastQuery}”
          </div>
        </div>
      ) : !loading ? (
        <div className="serversearch-empty">
          {error ? "Try again." : "No results yet — search above."}
          {error && (
            <button className="serversearch-retry" onClick={(e) => handleSearch(e, true)}>
              <FaRedo /> Retry
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
