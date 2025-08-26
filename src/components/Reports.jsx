// src/components/Reports.jsx
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import "../styles/Reports.css";
import API_URL from "../config";

export default function Reports() {
  // Resolve base URL: env in dev, prod URL otherwise. Fallback to localhost:5000.
  const BASE = API_URL || "http://localhost:5000";
  const API = `${BASE}/api/reports`;

  // Mode: 'upload' (pick files) or 'folder' (pick a folder)
  const [mode, setMode] = useState("upload");

  // Inputs
  const [uploadFiles, setUploadFiles] = useState([]);
  const [folderFiles, setFolderFiles] = useState([]);

  // Global flags (server uses fixed S3 prefix "reports/")
  const [uploadToS3, setUploadToS3] = useState(true);
  const [replaceIfExists, setReplaceIfExists] = useState(false);

  // UI
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]);
  const [stats, setStats] = useState({ files: 0, pages: 0, chunks: 0 });
  const [files, setFiles] = useState([]);
  const [apiUp, setApiUp] = useState(true);
  const logRef = useRef(null);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const refresh = async () => {
    try {
      const [s1, s2] = await Promise.all([
        axios.get(`${API}/stats`),
        axios.get(`${API}/files`),
      ]);
      setStats(s1.data || { files: 0, pages: 0, chunks: 0 });
      setFiles(s2.data?.files || []);
      setApiUp(true);
    } catch {
      setApiUp(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [steps]);

  // Clear inputs when mode changes
  useEffect(() => {
    setUploadFiles([]);
    setFolderFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSteps([]);

    try {
      const fd = new FormData();

      // Gather files selected by the user
      let selection = [];
      if (mode === "upload") {
        selection = Array.from(uploadFiles || []);
      } else {
        selection = Array.from(folderFiles || []);
      }

      if (!selection.length) {
        setSteps(["⚠️ No PDFs selected."]);
        setBusy(false);
        return;
      }

      // Only PDFs
      const pdfs = selection.filter((f) =>
        (f?.name || "").toLowerCase().endsWith(".pdf")
      );

      if (!pdfs.length) {
        setSteps(["⚠️ No PDF files in the selection."]);
        setBusy(false);
        return;
      }

      pdfs.forEach((f) => fd.append("files", f)); // backend will parse per-file meta from filename
      fd.append("upload_to_s3", String(uploadToS3));
      fd.append("replace_if_exists", String(replaceIfExists));

      const res = await axios.post(`${API}/bulk-index`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSteps(res.data?.steps || ["(no output)"]);
      await refresh();
    } catch (err) {
      setSteps((prev) => [
        ...prev,
        `❌ Error: ${err?.response?.data?.error || err.message}`,
      ]);
      setApiUp(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rep-container">
      <div className="rep-header">
        <h1>Reports Indexer</h1>
        <div className="rep-subtitle">
          <div>
            <strong>Filename format:</strong>{" "}
            <code>####-##(optionalLetter).ProjectName.pdf</code>
          </div>
          <div>
            <strong>Parsed automatically:</strong> Work order = before first{" "}
            <code>.</code>, Project = between first <code>.</code> and{" "}
            <code>.pdf</code>
          </div>
          <div>
            <strong>S3 path:</strong> <code>reports/</code> (fixed on server)
          </div>
        </div>
      </div>

      {!apiUp && (
        <div className="rep-banner warn">
          ⚠️ Couldn’t reach reports API at <code>{BASE}</code>. Check the Flask
          server, CORS/OPTIONS, or your <code>REACT_APP_API_URL</code> setting.
        </div>
      )}

      {/* Stats */}
      <div className="rep-stats">
        <div className="rep-stat">
          <div className="rep-stat-num">{stats.files}</div>
          <div className="rep-stat-label">Files</div>
        </div>
        <div className="rep-stat">
          <div className="rep-stat-num">{stats.pages}</div>
          <div className="rep-stat-label">Pages</div>
        </div>
        <div className="rep-stat">
          <div className="rep-stat-num">{stats.chunks}</div>
          <div className="rep-stat-label">Chunks</div>
        </div>
      </div>

      {/* Global flags */}
      <div className="rep-row rep-flags">
        <label className="rep-checkbox">
          <input
            type="checkbox"
            checked={uploadToS3}
            onChange={(e) => setUploadToS3(e.target.checked)}
          />
          Upload original PDF to S3
        </label>
        <label className="rep-checkbox">
          <input
            type="checkbox"
            checked={replaceIfExists}
            onChange={(e) => setReplaceIfExists(e.target.checked)}
          />
          Replace if already indexed (same hash/S3 key)
        </label>
      </div>

      {/* Mode selector */}
      <div className="rep-form">
        <div className="rep-section-title">Add Reports</div>

        <div className="rep-row">
          <label className="rep-label">Mode</label>
          <select
            className="rep-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="upload">Upload PDFs (one or many)</option>
            <option value="folder">Select Reports Folder</option>
          </select>
        </div>

        {/* Conditionally render inputs */}
        {mode === "upload" ? (
          <div className="rep-row">
            <label className="rep-label">PDFs</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => setUploadFiles(e.target.files || [])}
            />
          </div>
        ) : (
          <div className="rep-row">
            <label className="rep-label">Reports Folder</label>
            <input
              ref={folderInputRef}
              type="file"
              // Folder selection (Chrome/Edge)
              webkitdirectory="true"
              directory="true"
              multiple
              onChange={(e) => setFolderFiles(e.target.files || [])}
            />
            <div className="rep-hint">
              Select a folder; all PDFs inside (and subfolders) will be included.
            </div>
          </div>
        )}

        <div className="rep-actions">
          <button
            className="rep-btn"
            onClick={handleSubmit}
            disabled={busy}
            type="button"
          >
            {busy ? "Processing…" : "Index Selected"}
          </button>
        </div>
      </div>

      {/* Panels */}
      <div className="rep-panels">
        <div className="rep-panel">
          <div className="rep-panel-title">Log</div>
          <div className="rep-log" ref={logRef}>
            {steps.length === 0 ? (
              <div className="rep-muted">No recent actions.</div>
            ) : (
              steps.map((s, i) => (
                <div key={i} className="rep-log-line">
                  {s}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rep-panel">
          <div className="rep-panel-title">Indexed Files</div>
          <div className="rep-filelist">
            {files.length === 0 ? (
              <div className="rep-muted">No files indexed yet.</div>
            ) : (
              files.map((f) => (
                <div key={f.file_id} className="rep-fileitem" title={f.file_name}>
                  <div className="rep-filetitle">{f.file_name}</div>
                  <div className="rep-filemeta">
                    <span>WO: {f.work_order || "—"}</span>
                    <span>Pages: {f.pages}</span>
                    <span>Chunks: {f.chunks}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
