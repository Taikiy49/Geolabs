// src/pages/S3Bucket.jsx (XS compact, token-only)
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import API_URL from "../../config";
import "./S3Bucket.css";

// If you use MSAL elsewhere, pass the email via window or replace this with useMsal()
const USER_EMAIL =
  (window.__USER_EMAIL__ ||
    (window.__MSAL_ACCOUNT__ && window.__MSAL_ACCOUNT__.username)) ?? "guest";

const MAX_PARALLEL_UPLOADS = 3;

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

export default function S3Bucket() {
  // Tabs: browse | upload | search
  const [tab, setTab] = useState("browse");

  // Listing state
  const [files, setFiles] = useState([]); // [{Key, Size, LastModified, url, name, folder, ext}]
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");

  // Filters/sort/paging/selection
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [ext, setExt] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name|folder|ext
  const [sortDir, setSortDir] = useState("ASC");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(new Set());

  // Preview
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMeta, setPreviewMeta] = useState({ name: "", ext: "" });

  // Upload
  const [prefix, setPrefix] = useState("");
  const [queue, setQueue] = useState([]); // [{file, progress, status, key?}]
  const inflight = useRef(0);
  const nextIndex = useRef(0);

  // History drawer (optional; keep if backend exposes /api/upload-history)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  const toast = (msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  };

  // Search (two modes)
  const [searchTab, setSearchTab] = useState("key"); // key | content
  const [searchQ, setSearchQ] = useState("");
  const [searchLimit, setSearchLimit] = useState(50);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState([]); // [{file, s3_key, url, preview?}]

  // Fetch all files (auto-paging)
  const fetchFiles = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const all = [];
      let token = null;
      do {
        const res = await axios.get(`${API_URL}/api/s3/files`, {
          params: { limit: 1000, presign: 1, token },
        });
        const listRaw = res.data?.files || [];
        const pageItems = listRaw
          .map((f) => {
            const key = f.Key || f.key || "";
            if (!key || key.endsWith("/")) return null; // skip "folders"
            const e = extOf(key);
            const name = key.split("/").pop() || "Unnamed";
            const fldr = folderOf(key);
            return {
              ...f,
              Key: key,
              url: f.url, // presigned (since presign=1)
              name,
              folder: fldr,
              ext: e,
            };
          })
          .filter(Boolean);

        all.push(...pageItems);
        token = res.data?.next_token || null;
      } while (token);

      setFiles(all);
      setSelected(new Set());
      setPage(1);
    } catch (e) {
      console.error(e);
      setListError("Failed to fetch files.");
      setFiles([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Optional history drawer
  const fetchHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await axios.get(`${API_URL}/api/upload-history`);
      setHistory(res.data || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { if (historyOpen) fetchHistory(); }, [historyOpen, fetchHistory]);

  // Viewer computed
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
          (f.name || "").toLowerCase().includes(needle) ||
          (f.Key || "").toLowerCase().includes(needle) ||
          (f.folder || "").toLowerCase().includes(needle)
      );
    }
    if (folder) out = out.filter((f) => f.folder === folder);
    if (ext) out = out.filter((f) => f.ext === ext);
    return out;
  }, [files, q, folder, ext]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const cmp = (a, b, field) => (a[field] || "").localeCompare(b[field] || "");
    arr.sort((a, b) => {
      const res =
        sortBy === "folder"
          ? cmp(a, b, "folder")
          : sortBy === "ext"
          ? cmp(a, b, "ext")
          : cmp(a, b, "name");
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

  // Upload queue worker
  useEffect(() => {
    const run = async () => {
      while (inflight.current < MAX_PARALLEL_UPLOADS && nextIndex.current < queue.length) {
        const i = nextIndex.current++;
        const item = queue[i];
        if (!item || item.status !== "queued") continue;
        inflight.current++;
        uploadOne(i, item).finally(() => {
          inflight.current--;
          setQueue((q) => q.slice()); // trigger rerun
        });
      }
    };
    run();
  }, [queue]);

  const enqueueFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    setQueue((q) => [
      ...q,
      ...pdfs.map((f) => ({ file: f, progress: 0, status: "queued" })),
    ]);
  };

  const uploadOne = async (idx, item) => {
    setQueue((q) => {
      const n = q.slice();
      n[idx] = { ...item, status: "uploading" };
      return n;
    });

    const form = new FormData();
    form.append("file", item.file);
    form.append("prefix", prefix || "");
    form.append("user", USER_EMAIL);

    try {
      const res = await axios.post(`${API_URL}/api/s3/upload`, form, {
        headers: { "X-User": USER_EMAIL },
        onUploadProgress: (e) => {
          const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
          setQueue((q) => {
            const n = q.slice();
            n[idx] = { ...n[idx], progress: pct };
            return n;
          });
        },
      });
      const { key } = res.data || {};
      setQueue((q) => {
        const n = q.slice();
        n[idx] = { ...n[idx], status: "done", key, progress: 100 };
        return n;
      });
      toast("Uploaded");
      fetchFiles();
    } catch (err) {
      console.error(err);
      setQueue((q) => {
        const n = q.slice();
        n[idx] = { ...n[idx], status: "error" };
        return n;
      });
      toast("Upload failed");
    }
  };

  const clearQueueFinished = () => setQueue((q) => q.filter((x) => x.status !== "done"));

  // Per-file actions
  const deleteKey = async (key) => {
    if (!window.confirm(`Delete from S3?\n${key}`)) return;
    try {
      await axios.post(
        `${API_URL}/api/s3/delete`,
        { key },
        { headers: { "X-User": USER_EMAIL } }
      );
      toast("Deleted");
      fetchFiles();
    } catch {
      toast("Delete failed");
    }
  };

  const moveKey = async (key) => {
    const dst = window.prompt("New key (full path within bucket):", key);
    if (!dst || dst === key) return;
    try {
      await axios.post(
        `${API_URL}/api/s3/move`,
        { src_key: key, dst_key: dst },
        { headers: { "X-User": USER_EMAIL } }
      );
      toast("Moved");
      fetchFiles();
    } catch {
      toast("Move failed");
    }
  };

  // Simple client helpers
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
      if (checked) paged.forEach((f) => next.add(f.Key));
      else paged.forEach((f) => next.delete(f.Key));
      return next;
    });
  };
  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied URL");
    } catch {}
  };
  const bulkCopy = async () => {
    const urls = files.filter((f) => selected.has(f.Key)).map((f) => f.url).join("\n");
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      toast("Copied URLs");
    } catch {}
  };
  const bulkOpen = () => {
    const sels = files.filter((f) => selected.has(f.Key)).slice(0, 10);
    sels.forEach((f) => window.open(f.url, "_blank", "noopener,noreferrer"));
  };

  const openPreview = (f) => {
    setPreviewMeta({ name: f.name, ext: f.ext });
    setPreviewUrl(f.url);
  };

  // Searches
  const runKeySearch = useCallback(async () => {
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const res = await axios.get(`${API_URL}/api/s3/search`, {
        params: { q: searchQ || "", limit: searchLimit, presign: 1 },
      });
      const items = (res.data?.files || []).map((f) => ({
        file: f.Key.split("/").pop(),
        s3_key: f.Key,
        url: f.url,
        preview: "",
      }));
      setSearchResults(items);
    } catch (e) {
      setSearchError("Search failed.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQ, searchLimit]);

  const runContentSearch = useCallback(async () => {
    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const res = await axios.get(`${API_URL}/api/s3/content-search`, {
        params: { q: searchQ || "", limit: searchLimit, presign: 1, ext: "pdf" },
      });
      const items = (res.data?.files || []).map((f) => ({
        file: f.Key.split("/").pop(),
        s3_key: f.Key,
        url: f.url,
        preview: f.preview || "",
      }));
      setSearchResults(items);
    } catch (e) {
      setSearchError("Content search failed.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQ, searchLimit]);

  const runSearch = useCallback(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    if (searchTab === "key") return runKeySearch();
    return runContentSearch();
  }, [searchQ, searchTab, runKeySearch, runContentSearch]);

  return (
    <div className="s3b-page">
      {/* Tabs */}
      <div className="s3b-tabs">
        <button className="btn" onClick={() => setTab("browse")} aria-pressed={tab === "browse"}>Browse</button>
        <button className="btn" onClick={() => setTab("upload")} aria-pressed={tab === "upload"}>Upload</button>
        <button className="btn" onClick={() => setTab("search")} aria-pressed={tab === "search"}>Search</button>
        <div className="s3b-tabs-right">
          <button className="btn" onClick={fetchFiles} disabled={loadingList}>{loadingList ? "Loading…" : "Refresh"}</button>
          <button className="btn" onClick={() => setHistoryOpen((v) => !v)}>{historyOpen ? "Hide History" : "Show History"}</button>
        </div>
      </div>

      {/* Upload tab */}
      {tab === "upload" && (
        <div className="s3a-topbar">
          <div className="s3a-left">
            <div className="s3a-row">
              <label className="s3a-label">Subfolder</label>
              <input className="s3a-input" placeholder="optional/prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>

            <div className="s3a-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); enqueueFiles(e.dataTransfer.files); }} onClick={() => document.getElementById("s3a-fileinput").click()}>
              <input id="s3a-fileinput" type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={(e) => enqueueFiles(e.target.files)} />
              {queue.length ? (
                <div className="s3a-queue">
                  {queue.map((q, i) => (
                    <div key={i} className={`s3a-chip ${q.status}`}>
                      <span className="s3a-chip-name">{q.file.name}</span>
                      <span className="s3a-chip-bar"><span className="s3a-chip-fill" style={{ width: `${q.progress || 0}%` }} /></span>
                      <span className="s3a-chip-status">{q.status}</span>
                    </div>
                  ))}
                  <button className="s3a-btn s3a-btn-ghost" onClick={clearQueueFinished} disabled={!queue.some((x) => x.status === "done")}>Clear finished</button>
                </div>
              ) : (
                <span className="s3a-drop-hint">Click or drag & drop <b>.pdf</b> files to upload</span>
              )}
            </div>
          </div>
          <div className="s3a-right" />
        </div>
      )}

      {/* Browse tab */}
      {tab === "browse" && (
        <>
          <div className="s3-viewer-topbar">
            <div className="s3-viewer-filters">
              <div className="s3-viewer-search">
                <span className="s3-viewer-search-icon">🔎</span>
                <input className="s3-viewer-input" placeholder="Search name / key / folder…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </div>

              <select className="s3-viewer-select" value={folder} onChange={(e) => { setFolder(e.target.value); setPage(1); }}>
                <option value="">Folder: All</option>
                {folders.map((f) => (<option key={f} value={f}>{f}</option>))}
              </select>

              <select className="s3-viewer-select" value={ext} onChange={(e) => { setExt(e.target.value); setPage(1); }}>
                <option value="">Type: All</option>
                {extensions.map((e) => (<option key={e} value={e}>{e.toUpperCase()}</option>))}
              </select>

              <button className="s3-viewer-btn" onClick={() => { setQ(""); setFolder(""); setExt(""); setSortBy("name"); setSortDir("ASC"); setPage(1); setPageSize(25); }}>Reset</button>
            </div>

            <div className="s3-viewer-meta">
              <span>{total} files</span>
              <select className="s3-viewer-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50, 100].map((n) => (<option key={n} value={n}>{n}/page</option>))}
              </select>
            </div>
          </div>

          <div className="s3-viewer-actions">
            <label className="s3-viewer-checkrow">
              <input type="checkbox" checked={paged.every((f) => selected.has(f.Key)) && paged.length > 0} onChange={(e) => selectAllOnPage(e.target.checked)} />
              <span>Select page</span>
            </label>
            <button className="s3-viewer-btn" onClick={bulkCopy} disabled={selected.size === 0}>Copy URLs</button>
            <button className="s3-viewer-btn" onClick={bulkOpen} disabled={selected.size === 0}>Open (max 10)</button>
          </div>

          <div className="s3-viewer-table-wrap">
            {loadingList ? (
              <div className="s3-viewer-empty">Loading…</div>
            ) : listError ? (
              <div className="s3-viewer-empty">{listError}</div>
            ) : total === 0 ? (
              <div className="s3-viewer-empty">No files.</div>
            ) : (
              <table className="s3-viewer-table">
                <thead>
                  <tr>
                    <th className="s3-viewer-th s3-viewer-th-check"></th>
                    <th className="s3-viewer-th" onClick={() => { if (sortBy === "name") setSortDir((d) => (d === "ASC" ? "DESC" : "ASC")); else { setSortBy("name"); setSortDir("ASC"); } }}>Name {sortBy === "name" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
                    <th className="s3-viewer-th" onClick={() => { if (sortBy === "folder") setSortDir((d) => (d === "ASC" ? "DESC" : "ASC")); else { setSortBy("folder"); setSortDir("ASC"); } }}>Folder {sortBy === "folder" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
                    <th className="s3-viewer-th" onClick={() => { if (sortBy === "ext") setSortDir((d) => (d === "ASC" ? "DESC" : "ASC")); else { setSortBy("ext"); setSortDir("ASC"); } }}>Type {sortBy === "ext" ? (sortDir === "ASC" ? "▲" : "▼") : ""}</th>
                    <th className="s3-viewer-th s3-viewer-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((f) => (
                    <tr key={f.Key}>
                      <td className="s3-viewer-td-check"><input type="checkbox" checked={selected.has(f.Key)} onChange={() => toggleSelect(f.Key)} /></td>
                      <td title={f.Key}>
                        <div className="s3-viewer-name"><span className="s3-viewer-ic">📁</span><span className="s3-viewer-ellipsis">{f.name}</span></div>
                      </td>
                      <td className="s3-viewer-ellipsis" title={f.folder}>{f.folder}</td>
                      <td className="s3-viewer-type">{f.ext ? f.ext.toUpperCase() : "-"}</td>
                      <td className="s3-viewer-actions-cell">
                        <button className="s3-viewer-iconbtn" title="Preview" onClick={() => openPreview(f)}>👁</button>
                        <a className="s3-viewer-iconbtn" href={f.url} target="_blank" rel="noreferrer" title="Open">↗</a>
                        <a className="s3-viewer-iconbtn" href={f.url} download={f.name} title="Download">⤓</a>
                        <button className="s3-viewer-iconbtn" title="Copy URL" onClick={() => copyUrl(f.url)}>📋</button>
                        <button className="s3-viewer-iconbtn" title="Move/Rename" onClick={() => moveKey(f.Key)}>✎</button>
                        <button className="s3-viewer-iconbtn" title="Delete" onClick={() => deleteKey(f.Key)}>🗑</button>
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
        </>
      )}

      {/* Search tab */}
      {tab === "search" && (
        <div className="s3-search-wrap">
          <div className="s3a-topbar">
            <div className="s3a-row s3a-row-wrap">
              <div className="s3a-segtabs">
                <button className={`s3a-segtab ${searchTab === "key" ? "active" : ""}`} onClick={() => setSearchTab("key")}>File name / key</button>
                <button className={`s3a-segtab ${searchTab === "content" ? "active" : ""}`} onClick={() => setSearchTab("content")}>Inside PDFs</button>
              </div>

              <input className="s3a-input s3a-input-wide" placeholder={searchTab === "key" ? 'Search in key/path (e.g., "Mililani" or "reports/2024")' : 'Search PDF text (e.g., borehole AND basalt)'} value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }} />

              <label className="s3a-label">Limit</label>
              <select className="s3a-select" value={searchLimit} onChange={(e) => setSearchLimit(Number(e.target.value))}>
                {[20, 50, 100, 200].map((n) => (<option key={n} value={n}>{n}</option>))}
              </select>

              <button className="s3a-btn" onClick={runSearch} disabled={searchLoading}>{searchLoading ? "Searching…" : "Search"}</button>
              <button className="s3a-btn s3a-btn-ghost" onClick={() => { setSearchQ(""); setSearchResults([]); setSearchError(""); }}>Clear</button>
            </div>
          </div>

          <div className="s3-viewer-table-wrap">
            {searchLoading ? (
              <div className="s3-viewer-empty">Searching…</div>
            ) : searchError ? (
              <div className="s3-viewer-empty">{searchError}</div>
            ) : searchResults.length === 0 ? (
              <div className="s3-viewer-empty">No results.</div>
            ) : (
              <table className="s3-viewer-table">
                <thead>
                  <tr>
                    <th className="s3-viewer-th">File</th>
                    <th className="s3-viewer-th th-wide">{searchTab === "content" ? "Text preview" : "—"}</th>
                    <th className="s3-viewer-th s3-viewer-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r, i) => (
                    <tr key={`${r.s3_key || r.file}-${i}`}>
                      <td title={r.s3_key || r.file}>
                        <div className="s3-viewer-name"><span className="s3-viewer-ic">📄</span><span className="s3-viewer-ellipsis">{r.file}</span></div>
                        {r.s3_key && (<div className="s3-viewer-sub s3a-mono">{r.s3_key}</div>)}
                      </td>
                      <td>
                        {searchTab === "content" ? (
                          <div className="s3-viewer-snippet" dangerouslySetInnerHTML={{ __html: r.preview || "" }} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="s3-viewer-actions-cell">
                        <a className="s3-viewer-iconbtn" href={r.url} target="_blank" rel="noreferrer" title="Open">↗</a>
                        <button className="s3-viewer-iconbtn" title="Copy URL" onClick={() => copyUrl(r.url)}>📋</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Preview modal */}
      {previewUrl && (
        <div className="s3-viewer-modal" onClick={() => setPreviewUrl(null)}>
          <div className="s3-viewer-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="s3-viewer-modal-header">
              <div className="s3-viewer-title">{previewMeta.name}</div>
              <button className="s3-viewer-iconbtn" onClick={() => setPreviewUrl(null)} title="Close">✖</button>
            </div>
            <div className="s3-viewer-modal-body">
              {previewMeta.ext === "pdf" ? (
                <iframe className="s3-viewer-frame" src={previewUrl} title="Preview" />
              ) : isPreviewableImage(previewMeta.ext) ? (
                <img className="s3-viewer-img" src={previewUrl} alt={previewMeta.name} />
              ) : (
                <div className="s3-viewer-empty">No inline preview. Use Open/Download.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History drawer (optional) */}
      {historyOpen && (
        <>
          <div className="s3a-backdrop" onClick={() => setHistoryOpen(false)} />
          <div className="s3a-history">
            <div className="s3a-history-head">
              <div className="s3a-history-title">Upload History</div>
              <div className="s3a-history-actions">
                <button className="s3a-btn s3a-btn-ghost" onClick={fetchHistory} disabled={historyLoading}>{historyLoading ? "Loading…" : "Refresh"}</button>
                <button className="s3a-btn" onClick={() => setHistoryOpen(false)}>Close</button>
              </div>
            </div>
            <div className="s3a-history-list">
              {history.length === 0 && <div className="s3a-empty">No recent activity.</div>}
              {history.map((h, i) => (
                <div key={i} className="s3a-history-item">
                  <div className="s3a-history-meta">
                    <span className="s3a-mono">{h.time?.replace("T", " ").slice(0, 19)}</span>
                    <span className="s3a-mono">{h.file}</span>
                    <span>by {h.user}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toastMsg && <div className="s3a-toast">{toastMsg}</div>}
    </div>
  );
}

