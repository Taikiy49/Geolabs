// src/components/S3Viewer.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  FaCloudDownloadAlt,
  FaExternalLinkAlt,
  FaCopy,
  FaSync,
  FaTimes,
  FaFolder,
  FaSearch
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/S3Viewer.css";

const pageSizes = [10, 25, 50, 100];

function extOf(key = "") {
  const name = key.split("/").pop() || "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function folderOf(key = "") {
  const parts = key.split("/");
  return parts.length > 1 ? parts.slice(0, parts.length - 1).join("/") : "(root)";
}
function isPreviewableImage(ext) {
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
}

export default function S3Viewer() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMeta, setPreviewMeta] = useState({ name: "", ext: "" });

  // filters/sort/paging
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [ext, setExt] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name | folder | ext
  const [sortDir, setSortDir] = useState("ASC");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // selection
  const [selected, setSelected] = useState(new Set());
  const [copiedKey, setCopiedKey] = useState("");

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await axios.get(`${API_URL}/api/s3-files`);
      const list = (res.data.files || []).map((f) => {
        const name = (f.Key || "").split("/").pop() || "Unnamed";
        const fldr = folderOf(f.Key || "");
        const e = extOf(f.Key || "");
        return { key: f.Key, url: f.url, name, folder: fldr, ext: e };
      });
      setFiles(list);
      setSelected(new Set());
      setPage(1);
    } catch (e) {
      setError("Failed to fetch files.");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folders = useMemo(() => {
    const s = new Set(files.map((f) => f.folder));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const extensions = useMemo(() => {
    const s = new Set(files.map((f) => f.ext).filter(Boolean));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const filtered = useMemo(() => {
    let out = files;
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter(
        (f) =>
          f.name.toLowerCase().includes(needle) ||
          f.key.toLowerCase().includes(needle) ||
          f.folder.toLowerCase().includes(needle)
      );
    }
    if (folder) out = out.filter((f) => f.folder === folder);
    if (ext) out = out.filter((f) => f.ext === ext);
    return out;
  }, [files, q, folder, ext]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const cmp = (a, b, field) => a[field].localeCompare(b[field]);
    arr.sort((a, b) => {
      const res =
        sortBy === "folder" ? cmp(a, b, "folder") :
        sortBy === "ext"    ? cmp(a, b, "ext")    :
                              cmp(a, b, "name");
      return sortDir === "ASC" ? res : -res;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(field);
      setSortDir("ASC");
    }
    setPage(1);
  };

  const toggleSelect = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllOnPage = (checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) paged.forEach((f) => next.add(f.key));
      else paged.forEach((f) => next.delete(f.key));
      return next;
    });
  };

  const clearAll = () => setSelected(new Set());

  const copyUrl = async (url, key) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1200);
    } catch {}
  };

  const bulkCopy = async () => {
    const urls = files.filter((f) => selected.has(f.key)).map((f) => f.url).join("\n");
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      setCopiedKey("@bulk");
      setTimeout(() => setCopiedKey(""), 1200);
    } catch {}
  };

  const bulkOpen = () => {
    const sels = files.filter((f) => selected.has(f.key)).slice(0, 10); // safety cap
    sels.forEach((f) => window.open(f.url, "_blank", "noopener,noreferrer"));
  };

  const openPreview = (f) => {
    setPreviewMeta({ name: f.name, ext: f.ext });
    setPreviewUrl(f.url);
  };

  const resetFilters = () => {
    setQ("");
    setFolder("");
    setExt("");
    setSortBy("name");
    setSortDir("ASC");
    setPage(1);
    setPageSize(25);
  };

  return (
    <div className="s3-viewer-wrap">
      <div className="s3-viewer-topbar">
        <div className="s3-viewer-filters">
          <div className="s3-viewer-search">
            <FaSearch className="s3-viewer-search-icon" />
            <input
              className="s3-viewer-input"
              placeholder="Search name / key / folder…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="s3-viewer-select"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Folder: All</option>
            {folders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <select
            className="s3-viewer-select"
            value={ext}
            onChange={(e) => {
              setExt(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Type: All</option>
            {extensions.map((e) => (
              <option key={e} value={e}>{e.toUpperCase()}</option>
            ))}
          </select>

          <button className="s3-viewer-btn" onClick={resetFilters}>Reset</button>
        </div>

        <div className="s3-viewer-meta">
          <span>{total} files</span>
          <button className="s3-viewer-btn" onClick={fetchFiles} title="Refresh">
            <FaSync className="s3-viewer-ic" /> Refresh
          </button>
          <select
            className="s3-viewer-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>{n}/page</option>
            ))}
          </select>
        </div>
      </div>

      <div className="s3-viewer-actions">
        <label className="s3-viewer-checkrow">
          <input
            type="checkbox"
            checked={paged.every((f) => selected.has(f.key)) && paged.length > 0}
            onChange={(e) => selectAllOnPage(e.target.checked)}
          />
          <span>Select page</span>
        </label>
        <button className="s3-viewer-btn" onClick={bulkCopy} disabled={selected.size === 0}>
          <FaCopy className="s3-viewer-ic" /> Copy URLs
        </button>
        <button className="s3-viewer-btn" onClick={bulkOpen} disabled={selected.size === 0}>
          <FaExternalLinkAlt className="s3-viewer-ic" /> Open (max 10)
        </button>
        {selected.size > 0 && (
          <button className="s3-viewer-btn s3-viewer-btn-ghost" onClick={clearAll}>
            Clear ({selected.size})
          </button>
        )}
        {copiedKey === "@bulk" && <span className="s3-viewer-copied">Copied!</span>}
      </div>

      <div className="s3-viewer-table-wrap">
        {loading ? (
          <div className="s3-viewer-empty">Loading…</div>
        ) : error ? (
          <div className="s3-viewer-empty">{error}</div>
        ) : total === 0 ? (
          <div className="s3-viewer-empty">No files.</div>
        ) : (
          <table className="s3-viewer-table">
            <thead>
              <tr>
                <th className="s3-viewer-th s3-viewer-th-check"></th>
                <th className="s3-viewer-th" onClick={() => toggleSort("name")}>
                  Name {sortBy === "name" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
                </th>
                <th className="s3-viewer-th" onClick={() => toggleSort("folder")}>
                  Folder {sortBy === "folder" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
                </th>
                <th className="s3-viewer-th" onClick={() => toggleSort("ext")}>
                  Type {sortBy === "ext" ? (sortDir === "ASC" ? "▲" : "▼") : ""}
                </th>
                <th className="s3-viewer-th s3-viewer-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((f) => (
                <tr key={f.key}>
                  <td className="s3-viewer-td-check">
                    <input
                      type="checkbox"
                      checked={selected.has(f.key)}
                      onChange={() => toggleSelect(f.key)}
                    />
                  </td>
                  <td title={f.key}>
                    <div className="s3-viewer-name">
                      <FaFolder className="s3-viewer-ic" />
                      <span className="s3-viewer-ellipsis">{f.name}</span>
                    </div>
                  </td>
                  <td className="s3-viewer-ellipsis" title={f.folder}>{f.folder}</td>
                  <td className="s3-viewer-type">{f.ext ? f.ext.toUpperCase() : "-"}</td>
                  <td className="s3-viewer-actions-cell">
                    <button className="s3-viewer-iconbtn" title="Preview" onClick={() => openPreview(f)}>
                      👁
                    </button>
                    <a className="s3-viewer-iconbtn" href={f.url} target="_blank" rel="noreferrer" title="Open">
                      <FaExternalLinkAlt />
                    </a>
                    <a className="s3-viewer-iconbtn" href={f.url} download={f.name} title="Download">
                      <FaCloudDownloadAlt />
                    </a>
                    <button
                      className="s3-viewer-iconbtn"
                      title="Copy URL"
                      onClick={() => copyUrl(f.url, f.key)}
                    >
                      <FaCopy />
                    </button>
                    {copiedKey === f.key && <span className="s3-viewer-copied-inline">Copied</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="s3-viewer-pager">
        <button className="s3-viewer-btn" onClick={() => setPage(1)} disabled={page === 1}>⏮</button>
        <button className="s3-viewer-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>◀</button>
        <span className="s3-viewer-page">{page} / {totalPages}</span>
        <button className="s3-viewer-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>▶</button>
        <button className="s3-viewer-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>⏭</button>
      </div>

      {previewUrl && (
        <div className="s3-viewer-modal" onClick={() => setPreviewUrl(null)}>
          <div className="s3-viewer-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="s3-viewer-modal-head">
              <div className="s3-viewer-title">{previewMeta.name}</div>
              <button className="s3-viewer-iconbtn" onClick={() => setPreviewUrl(null)} title="Close">
                <FaTimes />
              </button>
            </div>
            <div className="s3-viewer-modal-body">
              {previewMeta.ext === "pdf" ? (
                <iframe className="s3-viewer-frame" src={previewUrl} title="Preview" />
              ) : isPreviewableImage(previewMeta.ext) ? (
                <img className="s3-viewer-img" src={previewUrl} alt={previewMeta.name} />
              ) : (
                <div className="s3-viewer-empty">No inline preview for .{previewMeta.ext}. Use Open/Download.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
