import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import API_URL from "../config";
import "../styles/S3Admin.css";

// If you use MSAL elsewhere, pass the email via window or replace this with useMsal()
const USER_EMAIL =
  (window.__USER_EMAIL__ ||
    (window.__MSAL_ACCOUNT__ && window.__MSAL_ACCOUNT__.username)) ??
  "guest";

const MAX_PARALLEL_UPLOADS = 3;

export default function S3Admin() {
  // Listing & filters
  const [files, setFiles] = useState([]); // [{Key, Size, LastModified, url}]
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name"); // name|time|size
  const [sortDir, setSortDir] = useState("asc"); // asc|desc
  const [expanded, setExpanded] = useState({});  // {bucketPrefix: bool}
  const [loadingList, setLoadingList] = useState(false);

  // DBs & indexing
  const [dbs, setDbs] = useState([]);
  const [selectedDb, setSelectedDb] = useState("");
  const [indexMode, setIndexMode] = useState("chunks"); // chunks|general
  const [indexAfterUpload, setIndexAfterUpload] = useState(true);

  // Upload queue
  const [queue, setQueue] = useState([]); // [{file, progress, status, key?}]
  const [prefix, setPrefix] = useState(""); // optional subfolder under selectedDb
  const inflight = useRef(0);
  const nextIndex = useRef(0);

  // Preview & history
  const [previewUrl, setPreviewUrl] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Bulk selection
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  // ======= Fetchers =======
  const fetchFiles = async () => {
    setLoadingList(true);
    try {
      const res = await axios.get(`${API_URL}/api/s3/files`);
      setFiles(res.data.files || []);
    } catch (e) {
      console.error("Failed to list S3 files", e);
      setFiles([]);
    } finally {
      setLoadingList(false);
      setSelectedKeys(new Set());
    }
  };

  const fetchDbs = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/list-dbs`);
      setDbs(res.data.dbs || []);
      if (!selectedDb && res.data.dbs?.length) setSelectedDb(res.data.dbs[0]);
    } catch (e) {
      setDbs([]);
    }
  };

  const fetchHistory = async () => {
    try {
      setHistoryLoading(true);
      const res = await axios.get(`${API_URL}/api/upload-history`);
      setHistory(res.data || []);
    } catch (e) {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchDbs();
  }, []);

  useEffect(() => {
    if (historyOpen) fetchHistory();
  }, [historyOpen]);

  // ======= Helpers =======
  const groupByPrefix = useMemo(() => {
    const out = {};
    for (const f of files) {
      const [bucket, ...rest] = f.Key.split("/");
      const top = bucket || "(root)";
      if (!out[top]) out[top] = [];
      out[top].push(f);
    }
    return out;
  }, [files]);

  const filteredAndSorted = (arr) => {
    const q = search.trim().toLowerCase();
    let r = q
      ? arr.filter((f) => f.Key.toLowerCase().includes(q))
      : arr.slice();

    r.sort((a, b) => {
      const A = a.Key.split("/").slice(1).join("/") || a.Key;
      const B = b.Key.split("/").slice(1).join("/") || b.Key;
      if (sortBy === "name") {
        return sortDir === "asc" ? A.localeCompare(B) : B.localeCompare(A);
      } else if (sortBy === "time") {
        const tA = new Date(a.LastModified).getTime();
        const tB = new Date(b.LastModified).getTime();
        return sortDir === "asc" ? tA - tB : tB - tA;
      } else {
        const sA = a.Size ?? 0;
        const sB = b.Size ?? 0;
        return sortDir === "asc" ? sA - sB : sB - sA;
      }
    });
    return r;
  };

  const toggleExpanded = (bucket) =>
    setExpanded((d) => ({ ...d, [bucket]: !d[bucket] }));

  const prettySize = (n) => {
    if (!Number.isFinite(n)) return "-";
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
    };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied link");
    } catch {
      toast("Failed to copy");
    }
  };

  // ======= Toast =======
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  const toast = (msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3000);
  };

  // ======= Upload flow (queue + parallelism) =======
  const enqueueFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (!pdfs.length) return;
    setQueue((q) => [
      ...q,
      ...pdfs.map((f) => ({ file: f, progress: 0, status: "queued" })),
    ]);
  };

  useEffect(() => {
    // simple worker: run up to MAX_PARALLEL_UPLOADS at once
    const run = async () => {
      while (inflight.current < MAX_PARALLEL_UPLOADS && nextIndex.current < queue.length) {
        const i = nextIndex.current++;
        const item = queue[i];
        if (!item || item.status !== "queued") continue;
        inflight.current++;
        uploadOne(i, item).finally(() => {
          inflight.current--;
          // trigger re-run
          setQueue((q) => q.slice());
        });
      }
    };
    run();
  }, [queue]); // changes retrigger run loop

  const uploadOne = async (idx, item) => {
    setQueue((q) => {
      const n = q.slice();
      n[idx] = { ...item, status: "uploading" };
      return n;
    });

    if (!selectedDb) {
      setQueue((q) => {
        const n = q.slice();
        n[idx] = { ...item, status: "error" };
        return n;
      });
      toast("Pick a target DB first");
      return;
    }

    const form = new FormData();
    form.append("file", item.file);
    form.append("db_name", selectedDb);
    form.append("prefix", prefix || "");
    form.append("index", indexAfterUpload ? "1" : "0");
    form.append("mode", indexMode);
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

      const { key, url } = res.data || {};
      setQueue((q) => {
        const n = q.slice();
        n[idx] = { ...n[idx], status: "done", key, progress: 100 };
        return n;
      });
      toast("Uploaded");
      // Refresh list on success
      fetchFiles();
    } catch (e) {
      setQueue((q) => {
        const n = q.slice();
        n[idx] = { ...n[idx], status: "error" };
        return n;
      });
      toast("Upload failed");
    }
  };

  const clearQueueFinished = () =>
    setQueue((q) => q.filter((x) => x.status !== "done"));

  // ======= Per-file actions =======
  const reindexKey = async (key) => {
    try {
      await axios.post(
        `${API_URL}/api/s3/reindex`,
        { key, db_name: selectedDb || key.split("/")[0], mode: indexMode },
        { headers: { "X-User": USER_EMAIL } }
      );
      toast("Indexed");
    } catch {
      toast("Indexing failed");
    }
  };

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
    const base = key.split("/").slice(0, 1)[0];
    const current = key.split("/").slice(1).join("/");
    const next = window.prompt(
      `Rename/move within the same bucket prefix:\n${base}/[YOUR_NEW_PATH]`,
      current
    );
    if (!next || next === current) return;
    const dst = `${base}/${next}`.replace(/\/+/g, "/");
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

  // Bulk
  const toggleKey = (key) => {
    const n = new Set(selectedKeys);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setSelectedKeys(n);
  };
  const bulkDelete = async () => {
    if (!selectedKeys.size) return;
    if (!window.confirm(`Delete ${selectedKeys.size} item(s) from S3?`)) return;
    try {
      await axios.post(
        `${API_URL}/api/s3/delete`,
        { keys: Array.from(selectedKeys) },
        { headers: { "X-User": USER_EMAIL } }
      );
      setSelectedKeys(new Set());
      toast("Deleted");
      fetchFiles();
    } catch {
      toast("Bulk delete failed");
    }
  };
  const bulkIndex = async () => {
    if (!selectedKeys.size) return;
    const baseDb = selectedDb || Array.from(selectedKeys)[0]?.split("/")?.[0];
    try {
      await axios.post(
        `${API_URL}/api/s3/reindex-batch`,
        {
          keys: Array.from(selectedKeys),
          db_name: baseDb,
          mode: indexMode,
        },
        { headers: { "X-User": USER_EMAIL } }
      );
      toast("Indexed batch");
    } catch {
      toast("Batch indexing failed");
    }
  };

  // ======= UI =======
  return (
    <div className={`s3a-wrap ${historyOpen ? "drawer-open" : ""}`}>
      {/* Topbar */}
      <div className="s3a-topbar">
        <div className="s3a-left">
          <div className="s3a-row">
            <label className="s3a-label">Target DB</label>
            <select
              className="s3a-select"
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
            >
              {dbs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <label className="s3a-label">Subfolder</label>
            <input
              className="s3a-input"
              placeholder="optional/prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />

            <label className="s3a-label">Index Mode</label>
            <select
              className="s3a-select"
              value={indexMode}
              onChange={(e) => setIndexMode(e.target.value)}
              title="chunks = per-file chunks, general = general_chunks table"
            >
              <option value="chunks">chunks</option>
              <option value="general">general</option>
            </select>

            <label className="s3a-check">
              <input
                type="checkbox"
                checked={indexAfterUpload}
                onChange={(e) => setIndexAfterUpload(e.target.checked)}
              />
              <span>Index after upload</span>
            </label>
          </div>

          <div
            className="s3a-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              enqueueFiles(e.dataTransfer.files);
            }}
            onClick={() => document.getElementById("s3a-fileinput").click()}
          >
            <input
              id="s3a-fileinput"
              type="file"
              accept=".pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => enqueueFiles(e.target.files)}
            />
            {queue.length ? (
              <div className="s3a-queue">
                {queue.map((q, i) => (
                  <div key={i} className={`s3a-chip ${q.status}`}>
                    <span className="s3a-chip-name">{q.file.name}</span>
                    <span className="s3a-chip-bar">
                      <span
                        className="s3a-chip-fill"
                        style={{ width: `${q.progress || 0}%` }}
                      />
                    </span>
                    <span className="s3a-chip-status">{q.status}</span>
                  </div>
                ))}
                <button
                  className="s3a-btn s3a-btn-ghost"
                  onClick={clearQueueFinished}
                  disabled={!queue.some((x) => x.status === "done")}
                >
                  Clear finished
                </button>
              </div>
            ) : (
              <span className="s3a-drop-hint">
                Click or drag & drop <b>.pdf</b> files to upload
              </span>
            )}
          </div>
        </div>

        <div className="s3a-right">
          <input
            className="s3a-input"
            placeholder="Search filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="s3a-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="name">Name</option>
            <option value="time">Modified</option>
            <option value="size">Size</option>
          </select>
          <select
            className="s3a-select"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
          >
            <option value="asc">↑</option>
            <option value="desc">↓</option>
          </select>

          <button
            className="s3a-btn"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? "Hide History" : "Show History"}
          </button>
          <button className="s3a-btn" onClick={fetchFiles} disabled={loadingList}>
            {loadingList ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="s3a-bulkbar">
        <span>{selectedKeys.size} selected</span>
        <button className="s3a-btn" onClick={bulkIndex} disabled={!selectedKeys.size}>
          Index selected
        </button>
        <button
          className="s3a-btn danger"
          onClick={bulkDelete}
          disabled={!selectedKeys.size}
        >
          Delete selected
        </button>
      </div>

      {/* File List */}
      <div className="s3a-list">
        {Object.keys(groupByPrefix).length === 0 && (
          <div className="s3a-empty">{loadingList ? "Loading…" : "No files."}</div>
        )}

        {Object.entries(groupByPrefix).map(([bucket, arr]) => {
          const rows = filteredAndSorted(arr);
          const open = !!expanded[bucket];
          return (
            <div key={bucket} className="s3a-bucket">
              <div className="s3a-bucket-head" onClick={() => toggleExpanded(bucket)}>
                <span className="s3a-caret">{open ? "▼" : "▶"}</span>
                <span className="s3a-bucket-name">{bucket}</span>
                <span className="s3a-bucket-count">{rows.length} files</span>
              </div>

              {open && (
                <table className="s3a-table">
                  <colgroup>
                    <col className="s3a-col-check" />
                    <col className="s3a-col-name" />
                    <col className="s3a-col-size" />
                    <col className="s3a-col-time" />
                    <col className="s3a-col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th />
                      <th>File</th>
                      <th>Size</th>
                      <th>Modified</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => {
                      const rel = f.Key.split("/").slice(1).join("/") || f.Key;
                      const checked = selectedKeys.has(f.Key);
                      return (
                        <tr key={f.Key}>
                          <td className="s3a-check-td">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleKey(f.Key)}
                            />
                          </td>
                          <td title={f.Key}>
                            <button
                              className="s3a-link"
                              onClick={() => setPreviewUrl(f.url)}
                            >
                              {rel}
                            </button>
                          </td>
                          <td>{prettySize(f.Size)}</td>
                          <td>
                            {f.LastModified
                              ? new Date(f.LastModified).toLocaleString()
                              : ""}
                          </td>
                          <td className="s3a-actions">
                            <button className="s3a-icon" title="Preview" onClick={() => setPreviewUrl(f.url)}>👁️</button>
                            <button className="s3a-icon" title="Copy Link" onClick={() => copyToClipboard(f.url)}>🔗</button>
                            <button className="s3a-icon" title="Index" onClick={() => reindexKey(f.Key)}>🧠</button>
                            <button className="s3a-icon" title="Move/Rename" onClick={() => moveKey(f.Key)}>✎</button>
                            <button className="s3a-icon danger" title="Delete" onClick={() => deleteKey(f.Key)}>🗑</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview Drawer */}
      {previewUrl && (
        <>
          <div className="s3a-backdrop" onClick={() => setPreviewUrl("")} />
          <div className="s3a-preview">
            <div className="s3a-preview-head">
              <span>Preview</span>
              <button className="s3a-btn" onClick={() => setPreviewUrl("")}>
                Close
              </button>
            </div>
            <iframe title="PDF" src={previewUrl} className="s3a-iframe" />
          </div>
        </>
      )}

      {/* History Drawer */}
      {historyOpen && (
        <>
          <div className="s3a-backdrop" onClick={() => setHistoryOpen(false)} />
          <div className="s3a-history">
            <div className="s3a-history-head">
              <div className="s3a-history-title">Upload & Index History</div>
              <div className="s3a-history-actions">
                <button
                  className="s3a-btn s3a-btn-ghost"
                  onClick={fetchHistory}
                  disabled={historyLoading}
                >
                  {historyLoading ? "Loading…" : "Refresh"}
                </button>
                <button className="s3a-btn" onClick={() => setHistoryOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="s3a-history-list">
              {history.length === 0 && (
                <div className="s3a-empty">No recent activity.</div>
              )}
              {history.map((h, i) => (
                <div key={i} className="s3a-history-item">
                  <div className="s3a-history-meta">
                    <span className="s3a-mono">
                      {h.time?.replace("T", " ").slice(0, 19)}
                    </span>
                    <span className="s3a-pill">{h.db}</span>
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
