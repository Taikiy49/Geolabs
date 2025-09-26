// src/components/Reports.jsx
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import API_URL from "../../config";
import { FaSearch, FaFilePdf, FaLink, FaFolderOpen } from "react-icons/fa";
import "./Reports.css";

export default function Reports() {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [projects, setProjects] = useState([]);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/reports/projects`);
      setProjects(r.data.projects || []);
    } catch {
      setProjects([]);
    }
  }, []);

  const search = useCallback(
    async (reset = false) => {
      if (reset) {
        setPage(1);
      }
      setLoading(true);
      try {
        const r = await axios.get(`${API_URL}/api/reports/search`, {
          params: { q, project, page, page_size: pageSize },
        });
        setResults(r.data.results || []);
        setTotal(r.data.total || 0);
        setPages(r.data.pages || 1);
      } catch {
        setResults([]);
        setTotal(0);
        setPages(1);
      } finally {
        setLoading(false);
      }
    },
    [q, project, page, pageSize]
  );

  const openDetail = async (id) => {
    setDetailLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/reports/${id}`);
      setDetail(r.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    search();
  }, [search]);

  const reset = () => {
    setQ("");
    setProject("");
    setPage(1);
  };

  return (
    <div className="reports-wrap">
      <header className="reports-header">
        <div className="reports-title-row">
          <h1 className="reports-title">
            <FaFolderOpen /> Reports
          </h1>
        </div>

        <div className="reports-controls">
          <div className="r-group" title="Optionally narrow to a path prefix">
            <label>Scope (prefix)</label>
            <input
              placeholder="e.g. 2024/ClientA/"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="r-group">
            <label>Project</label>
            <select
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setPage(1);
              }}
              className="form-select"
              style={{ minWidth: 160 }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.project} value={p.project}>
                  {p.project} ({p.count})
                </option>
              ))}
            </select>
          </div>

          <div className="r-group">
            <label>Results per page</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="form-select"
              style={{ width: 90 }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}/pg
                </option>
              ))}
            </select>
          </div>

          <button className="btn btn-secondary" onClick={search} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
          <button className="btn btn-ghost" onClick={reset} disabled={loading}>
            Reset
          </button>
        </div>
      </header>

      <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginBottom: ".5rem" }}>
        {loading
          ? "Loading..."
          : `${total} result${total === 1 ? "" : "s"} • Page ${page}/${pages}`}
      </div>

      {!loading && results.length === 0 && (
        <div style={{ padding: "1rem", border: "1px solid var(--border-color)" }}>No results.</div>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: ".5rem" }}>
        {results.map((r) => (
          <li
            key={r.id}
            style={{
              border: "1px solid var(--border-color)",
              padding: ".6rem .75rem",
              borderRadius: "6px",
              background: "var(--bg-card)",
            }}
          >
            <div
              style={{ fontWeight: 700, cursor: "pointer" }}
              onClick={() => openDetail(r.id)}
              title="Open details"
            >
              {r.title || r.filename}
            </div>
            <div style={{ fontSize: ".7rem", color: "var(--text-muted)", marginBottom: ".35rem" }}>
              {r.project || "—"} {r.date ? `• ${r.date}` : ""} {r.s3_key ? "• S3" : ""}
            </div>
            <div
              style={{ fontSize: ".75rem", lineHeight: 1.3 }}
              dangerouslySetInnerHTML={{ __html: r.snippet }}
            />
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <div style={{ display: "flex", gap: ".4rem", justifyContent: "center", marginTop: ".9rem" }}>
          <button
            className="btn btn-secondary"
            disabled={page === 1}
            onClick={() => setPage(1)}
          >
            «
          </button>
          <button
            className="btn btn-secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹
          </button>
          <div style={{ padding: ".3rem .6rem", fontSize: ".75rem" }}>
            {page}/{pages}
          </div>
          <button
            className="btn btn-secondary"
            disabled={page === pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            ›
          </button>
          <button
            className="btn btn-secondary"
            disabled={page === pages}
            onClick={() => setPage(pages)}
          >
            »
          </button>
        </div>
      )}

      {detail && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 4000,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              width: "min(860px, 95vw)",
              maxHeight: "85vh",
              padding: "1rem",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem" }}>
              <h3 style={{ margin: 0 }}>{detail.title || detail.filename}</h3>
              <button className="btn btn-secondary" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <div style={{ fontSize: ".7rem", color: "var(--text-muted)", margin: ".25rem 0 .75rem" }}>
              {detail.project || "—"} {detail.date ? `• ${detail.date}` : ""}{" "}
              {detail.s3_key ? `• ${detail.s3_key}` : ""}
            </div>
            {detailLoading ? (
              <div>Loading...</div>
            ) : (
              <>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: ".7rem",
                    lineHeight: 1.35,
                    background: "var(--bg-card-2)",
                    padding: ".75rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  {detail.text}
                </pre>
                {detail.s3_key && (
                  <S3LinkButton s3Key={detail.s3_key} filename={detail.filename} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function S3LinkButton({ s3Key, filename }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const getUrl = async () => {
    if (url) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/reports/file-url`, { params: { key: s3Key } });
      setUrl(r.data.url);
    } catch {
      setUrl("");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ marginTop: ".75rem", display: "flex", gap: ".5rem" }}>
      <button className="btn btn-secondary" onClick={getUrl} disabled={loading}>
        {loading ? "Signing..." : url ? "Refresh Link" : "Get File Link"}
      </button>
      {url && (
        <>
          <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
            Open PDF
          </a>
          <a className="btn btn-ghost" href={url} download={filename}>
            Download
          </a>
        </>
      )}
    </div>
  );
}
