// DBAdmin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import '../styles/DBAdmin.css';
import API_URL from '../config';
import {
  FaSyncAlt, FaTrashAlt, FaUpload, FaDownload, FaSearch, FaTimes, FaFilePdf,
  FaCheckCircle, FaExclamationTriangle, FaList, FaCube, FaPlay, FaStop
} from 'react-icons/fa';

export default function DBAdmin() {
  // ---------- Core state ----------
  const [queue, setQueue] = useState([]); // {file, name, size, progress, status: 'ready'|'uploading'|'done'|'error'|'canceled', error?, controller?}
  const [mode, setMode] = useState('new'); // UI: 'new' | 'append'
  const [generalMode, setGeneralMode] = useState(false); // backend mode: 'general' or default
  const [rawTitle, setRawTitle] = useState('');
  const [dbName, setDbName] = useState('');
  const [existingDbs, setExistingDbs] = useState([]);
  const [dbSearch, setDbSearch] = useState('');
  const [dbSelected, setDbSelected] = useState({}); // bulk select {name: true}
  const [expandedDbs, setExpandedDbs] = useState({});
  const [dbFiles, setDbFiles] = useState({});
  const [dbStructure, setDbStructure] = useState(null);
  const [showSchemaPopup, setShowSchemaPopup] = useState(false);

  const [uploadHistory, setUploadHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState('');

  const [statusLine, setStatusLine] = useState('');
  const [steps, setSteps] = useState([]);
  const [activePdfUrl, setActivePdfUrl] = useState('');
  const [s3PdfUrls, setS3PdfUrls] = useState({});

  const dropRef = useRef(null);
  const runningRef = useRef(false);

  // ---------- Helpers ----------
  const slugDb = (s) =>
    s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const formatDbName = (filename) =>
    filename.replace(/\.db$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ---------- Fetchers ----------
  const fetchDbs = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/list-dbs`);
      setExistingDbs(res.data.dbs || []);
    } catch (e) {
      console.error('❌ Failed to fetch DB list:', e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/upload-history`);
      setUploadHistory(res.data || []);
    } catch (e) {
      console.error('❌ Failed to load upload history:', e);
    }
  };

  const fetchS3PdfUrls = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/s3-db-pdfs`);
      const map = {};
      for (const { Key, url } of (res.data.files || [])) map[Key] = url;
      setS3PdfUrls(map);
    } catch (e) {
      console.error('❌ Failed to load S3 signed URLs:', e);
    }
  };

  useEffect(() => {
    fetchDbs();
    fetchHistory();
    fetchS3PdfUrls();
  }, []);

  // ---------- Derived ----------
  const filteredDbs = useMemo(() => {
    const t = dbSearch.trim().toLowerCase();
    if (!t) return existingDbs.filter(d => !['chat_history.db', 'reports.db', 'pr_data.db', 'users.db'].includes(d));
    return existingDbs.filter(d =>
      !['chat_history.db', 'reports.db', 'pr_data.db', 'users.db'].includes(d) &&
      d.toLowerCase().includes(t)
    );
  }, [existingDbs, dbSearch]);

  const groupedHistory = useMemo(() => {
    const list = uploadHistory.filter(h => {
      if (!historySearch) return true;
      const t = historySearch.toLowerCase();
      return `${h.user} ${h.file} ${h.db}`.toLowerCase().includes(t);
    });
    const out = [];
    let cur = [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const prev = list[i - 1];
      const sameDb = !prev || entry.db === prev.db;
      const within10 = !prev || (new Date(entry.time) - new Date(prev.time)) / 60000 <= 10;
      if (i === 0 || (sameDb && within10)) cur.push(entry);
      else { out.push(cur); cur = [entry]; }
    }
    if (cur.length) out.push(cur);
    return out;
  }, [uploadHistory, historySearch]);

  // ---------- Queue ops ----------
  const addFiles = (files) => {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    setQueue(prev => {
      const existingNames = new Set(prev.map(q => q.name));
      const add = pdfs
        .filter(f => !existingNames.has(f.name))
        .map(f => ({
          file: f,
          name: f.name,
          size: f.size,
          progress: 0,
          status: 'ready',
          error: '',
          controller: null
        }));
      return [...prev, ...add];
    });
  };

  const removeFromQueue = (name) => {
    setQueue(prev => prev.filter(q => q.name !== name));
  };

  const clearQueue = () => setQueue([]);

  const cancelItem = (name) => {
    setQueue(prev => prev.map(q => {
      if (q.name === name && q.controller) {
        try { q.controller.abort(); } catch {}
      }
      return q.name === name ? { ...q, status: 'canceled', error: 'Canceled by user' } : q;
    }));
  };

  // ---------- Drag & Drop ----------
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e) => {
      prevent(e);
      addFiles(e.dataTransfer.files || []);
    };
    ['dragenter','dragover','dragleave','drop'].forEach(ev => el.addEventListener(ev, prevent));
    el.addEventListener('drop', onDrop);
    return () => {
      ['dragenter','dragover','dragleave','drop'].forEach(ev => el && el.removeEventListener(ev, prevent));
      el && el.removeEventListener('drop', onDrop);
    };
  }, []);

  // ---------- DB list actions ----------
  const toggleDbFiles = async (db) => {
    const isOpen = !!expandedDbs[db];
    if (!isOpen && !dbFiles[db]) {
      try {
        const res = await axios.post(`${API_URL}/api/list-files`, { db_name: db });
        setDbFiles(prev => ({ ...prev, [db]: res.data.files || [] }));
      } catch (e) {
        console.error('❌ list-files error', e);
        setDbFiles(prev => ({ ...prev, [db]: [] }));
      }
    }
    setExpandedDbs(prev => ({ ...prev, [db]: !isOpen }));
  };

  const openSchema = async (db) => {
    try {
      const res = await axios.post(`${API_URL}/api/inspect-db`, { db_name: db });
      setDbStructure({ db, ...res.data });
      setShowSchemaPopup(true);
    } catch (e) {
      console.error('❌ inspect-db error', e);
      setDbStructure(null);
    }
  };

  const exportSchemaJSON = async (db) => {
    try {
      const res = await axios.post(`${API_URL}/api/inspect-db`, { db_name: db });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${db.replace('.db','')}_schema.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('❌ export schema error', e);
      alert('Failed to export schema.');
    }
  };

  const deleteDb = async (db) => {
    const confirmText = prompt(`Type DELETE ${db} to confirm deletion:`);
    if (confirmText !== `DELETE ${db}`) return alert('❌ Confirmation does not match.');
    try {
      const res = await axios.post(`${API_URL}/api/delete-db`, {
        db_name: db,
        confirmation_text: confirmText,
      });
      alert(res.data.message || 'Deleted.');
      setExistingDbs(prev => prev.filter(d => d !== db));
      setDbSelected(prev => {
        const n = { ...prev }; delete n[db]; return n;
      });
    } catch (e) {
      alert(e.response?.data?.error || '❌ Failed to delete.');
    }
  };

  const bulkDelete = async () => {
    const names = Object.keys(dbSelected).filter(k => dbSelected[k]);
    if (!names.length) return;
    if (!window.confirm(`Delete ${names.length} database(s)? This cannot be undone.`)) return;
    for (const db of names) {
      await deleteDb(db);
    }
  };

  // ---------- Upload run (sequential) ----------
  const runUpload = async () => {
    if (runningRef.current) return;
    if (queue.length === 0) return setStatusLine('❌ Queue is empty.');
    if (!dbName) return setStatusLine('❌ Please enter/select a DB.');

    setSteps([]);
    setStatusLine('Starting upload…');
    runningRef.current = true;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status !== 'ready' && item.status !== 'error' && item.status !== 'canceled') continue;

      const controller = new AbortController();
      setQueue(prev => prev.map(q => q.name === item.name ? { ...q, status: 'uploading', progress: 0, controller } : q));

      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('db_name', dbName);
      // UI 'mode' only controls new/append selection; backend "general" controls embedding path
      formData.append('mode', generalMode ? 'general' : 'default');
      formData.append('user', 'admin');

      try {
        const res = await axios.post(`${API_URL}/api/process-file`, formData, {
          signal: controller.signal,
          onUploadProgress: (evt) => {
            const p = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0;
            setQueue(prev => prev.map(q => q.name === item.name ? { ...q, progress: p } : q));
            setStatusLine(`Uploading ${item.name}… ${p}%`);
          }
        });
        const stepLines = res.data?.steps || [];
        if (stepLines.length) setSteps(prev => [...prev, ...stepLines]);
        setQueue(prev => prev.map(q => q.name === item.name ? { ...q, status: 'done', progress: 100, controller: null } : q));
      } catch (e) {
        if (controller.signal.aborted) {
          setQueue(prev => prev.map(q => q.name === item.name ? { ...q, status: 'canceled', error: 'Canceled', controller: null } : q));
        } else {
          setQueue(prev => prev.map(q => q.name === item.name ? { ...q, status: 'error', error: 'Upload failed', controller: null } : q));
        }
      }
    }

    setStatusLine('✅ Finished queue.');
    runningRef.current = false;
    fetchDbs();
    fetchHistory();
  };

  const stopAll = () => {
    setQueue(prev => prev.map(q => {
      if (q.controller) {
        try { q.controller.abort(); } catch {}
      }
      return { ...q, controller: null, status: q.status === 'uploading' ? 'canceled' : q.status };
    }));
    setStatusLine('⏹️ Stopped.');
    runningRef.current = false;
  };

  // ---------- UI binding ----------
  useEffect(() => {
    if (mode === 'new') {
      const slug = slugDb(rawTitle);
      setDbName(slug ? `${slug}.db` : '');
    }
  }, [rawTitle, mode]);

  return (
    <div className="dba-wrap">
      {/* Top: uploader + controls */}
      <div className="dba-top">
        {/* Drop zone + queue */}
        <div className="dba-drop" ref={dropRef} onClick={() => document.getElementById('dbaFile').click()}>
          <input
            id="dbaFile"
            type="file"
            accept=".pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="dba-drop-head">
            <FaUpload className="mini" /> <span className="strong">Add PDFs</span>
            <span className="muted"> (click or drag & drop)</span>
          </div>

          {queue.length === 0 ? (
            <div className="dba-drop-empty">
              <FaFilePdf className="big" />
              <div className="muted">No files in queue</div>
            </div>
          ) : (
            <div className="dba-queue">
              {queue.map(item => (
                <div key={item.name} className={`dba-qrow ${item.status}`}>
                  <div className="dba-qname" title={item.name}>
                    <FaFilePdf className="mini" />
                    <span className="ellipsis">{item.name}</span>
                    <span className="muted size">({(item.size/1024/1024).toFixed(2)} MB)</span>
                  </div>
                  <div className="dba-qprog">
                    <div className="bar"><div className="fill" style={{ width: `${item.progress || 0}%` }} /></div>
                    <div className="muted">{item.status === 'ready' ? 'Ready' : item.status}</div>
                  </div>
                  <div className="dba-qactions">
                    {item.status === 'uploading' && (
                      <button className="btn danger" onClick={() => cancelItem(item.name)} title="Cancel">
                        <FaTimes />
                      </button>
                    )}
                    {(item.status === 'ready' || item.status === 'error' || item.status === 'canceled') && (
                      <button className="btn ghost" onClick={() => setQueue(prev => prev.map(q => q.name === item.name ? { ...q, status: 'ready', progress: 0 } : q))} title="Retry next run">
                        <FaPlay />
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => removeFromQueue(item.name)} title="Remove">
                      <FaTrashAlt />
                    </button>
                  </div>
                </div>
              ))}
              <div className="dba-qbar">
                <span>{queue.length} in queue</span>
                <div className="sp" />
                <button className="btn ghost" onClick={clearQueue}><FaTimes /> <span>Clear</span></button>
                <button className="btn" onClick={runUpload} title="Start"><FaPlay /> <span>Run</span></button>
                <button className="btn ghost" onClick={stopAll} title="Stop"><FaStop /> <span>Stop</span></button>
              </div>
            </div>
          )}
        </div>

        {/* Right controls */}
        <div className="dba-controls">
          <div className="dba-mode">
            <label className={`radio ${mode === 'new' ? 'on' : ''}`}>
              <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
              New DB
            </label>
            <label className={`radio ${mode === 'append' ? 'on' : ''}`}>
              <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} />
              Append
            </label>
            <label className="chk">
              <input type="checkbox" checked={generalMode} onChange={(e) => setGeneralMode(e.target.checked)} />
              General mode
            </label>
          </div>

          {mode === 'new' ? (
            <>
              <div className="lbl">Title</div>
              <input
                className="input"
                placeholder="e.g. Employee Handbook"
                value={rawTitle}
                onChange={(e) => setRawTitle(e.target.value)}
              />
              <div className="lbl">DB File</div>
              <input className="input" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="generated_name.db" />
              <div className="hint"><FaExclamationTriangle className="mini" /> only letters, numbers, underscores</div>
            </>
          ) : (
            <>
              <div className="lbl">Select DB</div>
              <select className="select" value={dbName} onChange={(e) => setDbName(e.target.value)}>
                <option value="">-- choose --</option>
                {filteredDbs.map((db) => (
                  <option key={db} value={db}>{formatDbName(db)}</option>
                ))}
              </select>
            </>
          )}

          <div className="dba-status">
            {statusLine ? <span className="ok"><FaCheckCircle className="mini" /> {statusLine}</span> : <span className="muted">Status</span>}
          </div>

          {!!steps.length && (
            <div className="dba-steps">
              <div className="steps-head"><FaList className="mini" /> Steps</div>
              <ul>
                {steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: history + DBs */}
      <div className="dba-bottom">
        {/* History */}
        <div className="dba-panel">
          <div className="panel-head">
            <div className="title"><FaCube className="mini" /> Upload History</div>
            <div className="panel-actions">
              <div className="inline">
                <FaSearch className="mini" />
                <input className="input" placeholder="Search…" value={historySearch} onChange={(e)=>setHistorySearch(e.target.value)} />
              </div>
              <button className="btn ghost" onClick={fetchHistory}><FaSyncAlt /><span>Refresh</span></button>
            </div>
          </div>
          <ul className="hist-list">
            {groupedHistory.map((group, idx) => (
              <li key={idx} className="hist-group">
                <div className="hist-head">
                  <strong>{group[0].user}</strong> → <span className="db">{formatDbName(group[0].db)}</span> · {group.length} file(s)
                </div>
                <ul className="hist-sub">
                  {group.map((g, j) => (
                    <li key={j}><em>{g.file}</em> <span className="muted">{new Date(g.time).toLocaleString()}</span></li>
                  ))}
                </ul>
              </li>
            ))}
            {groupedHistory.length === 0 && <li className="empty">No history.</li>}
          </ul>
        </div>

        {/* DBs */}
        <div className="dba-panel">
          <div className="panel-head">
            <div className="title"><FaCube className="mini" /> Databases</div>
            <div className="panel-actions">
              <div className="inline">
                <FaSearch className="mini" />
                <input className="input" placeholder="Filter DBs…" value={dbSearch} onChange={(e)=>setDbSearch(e.target.value)} />
              </div>
              <button className="btn ghost" onClick={fetchDbs}><FaSyncAlt /><span>Refresh</span></button>
              <button className="btn danger" onClick={bulkDelete} disabled={!Object.values(dbSelected).some(Boolean)}><FaTrashAlt /><span>Bulk Delete</span></button>
            </div>
          </div>

          <div className="db-list">
            {filteredDbs.map(db => {
              const expanded = !!expandedDbs[db];
              const files = dbFiles[db] || [];
              const checked = !!dbSelected[db];
              return (
                <div key={db} className="db-item">
                  <div className="db-row">
                    <input type="checkbox" checked={checked} onChange={(e)=>setDbSelected(prev => ({...prev, [db]: e.target.checked}))} />
                    <span className="db-name" onClick={() => toggleDbFiles(db)}>
                      {formatDbName(db)} {expanded ? '▲' : '▼'}
                    </span>
                    <div className="sp" />
                    <button className="btn ghost" onClick={() => openSchema(db)}>[Schema]</button>
                    <button className="btn ghost" onClick={() => exportSchemaJSON(db)} title="Export schema JSON"><FaDownload /></button>
                    <button className="btn danger" onClick={() => deleteDb(db)}><FaTrashAlt /><span>Delete</span></button>
                  </div>
                  {expanded && (
                    <div className="db-files">
                      {files.length === 0 && <div className="muted">No file list or failed to load.</div>}
                      {files.map((file, i) => (
                        <div key={i} className="db-file">
                          <span
                            className="file-link"
                            onClick={() => {
                              const key = `${db}/${file}`;
                              const url = s3PdfUrls[key];
                              if (url) setActivePdfUrl(url);
                              else alert('❌ Signed URL not found for this file.');
                            }}
                          >
                            {file}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredDbs.length === 0 && <div className="empty">No databases.</div>}
          </div>
        </div>
      </div>

      {/* Schema popup */}
      {showSchemaPopup && dbStructure && (
        <div className="dba-pop" onClick={()=>setShowSchemaPopup(false)}>
          <div className="dba-pop-inner" onClick={(e)=>e.stopPropagation()}>
            <button className="pop-close" onClick={()=>setShowSchemaPopup(false)}>✕</button>
            <div className="pop-title">📊 {formatDbName(dbStructure.db)}</div>
            {Object.entries(dbStructure).map(([table, info]) =>
              table === 'db' ? null : (
                <div key={table} className="schema-block">
                  <div className="schema-name">{table}</div>
                  <div className="schema-rows">
                    <div>Columns: {info.columns.join(', ')}</div>
                    <div>Sample rows:</div>
                    <ul>
                      {info.sample_rows.map((row, i) => (
                        <li key={i}>{JSON.stringify(row.map(cell =>
                          typeof cell === 'string' && cell.length > 50 ? cell.slice(0,50) + '…' : cell
                        ))}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* PDF preview */}
      {activePdfUrl && (
        <div className="dba-pop" onClick={()=>setActivePdfUrl('')}>
          <div className="dba-pop-inner pdf" onClick={(e)=>e.stopPropagation()}>
            <button className="pop-close" onClick={()=>setActivePdfUrl('')}>✕</button>
            <iframe src={activePdfUrl} title="PDF" width="100%" height="100%" style={{ border: 'none' }} />
          </div>
        </div>
      )}
    </div>
  );
}
