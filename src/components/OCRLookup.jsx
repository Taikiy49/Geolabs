import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import API_URL from '../config';
import '../styles/OCRLookup.css';
import {
  FiRotateCcw, FiUpload, FiCopy, FiDownload, FiSearch, FiArrowUp, FiArrowDown
} from 'react-icons/fi';
import { FaPaperclip, FaImage, FaWrench } from 'react-icons/fa';

export default function OCRLookUp() {
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [extractedWOs, setExtractedWOs] = useState([]);
  const [editedWOs, setEditedWOs] = useState([]);
  const [projectMatches, setProjectMatches] = useState([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [sortBy, setSortBy] = useState('original');
  const [sortDir, setSortDir] = useState('asc'); // asc | desc
  const [filter, setFilter] = useState('');
  const [showNotFound, setShowNotFound] = useState(false);
  const [normalizeLetters, setNormalizeLetters] = useState(true);

  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  // ---------- Helpers ----------
  const normalizeWO = (wo) => {
    if (!normalizeLetters) return wo;
    // e.g. 8292-05B -> 8292-05(B), or 8292B -> 8292(B)
    if (/[A-Za-z]$/.test(wo)) {
      const base = wo.slice(0, -1);
      const letter = wo.slice(-1).toUpperCase();
      return `${base}(${letter})`;
    }
    return wo;
  };

  const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

  const parseBullets = (text) =>
    text
      .split('\n')
      .map(line => line.replace(/^[-•–*]\s*/, '').trim())
      .filter(Boolean);

  const applyEditToIndex = (idx, value) => {
    setEditedWOs(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  // ---------- Upload / Paste / Drop ----------
  const handleFileChange = (file) => {
    if (!file) return;
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
    setExtractedWOs([]);
    setEditedWOs([]);
    setProjectMatches([]);
    setStep(1);
    setError('');
  };

  const onInputChange = (e) => handleFileChange(e.target.files[0]);

  // drag & drop
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e) => {
      prevent(e);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) handleFileChange(file);
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt =>
      el.addEventListener(evt, prevent)
    );
    el.addEventListener('drop', onDrop);
    return () => {
      ['dragenter','dragover','dragleave','drop'].forEach(evt =>
        el.removeEventListener(evt, prevent)
      );
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  // paste image from clipboard
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
      if (item) {
        const file = item.getAsFile();
        if (file) handleFileChange(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // ---------- API: OCR ----------
  const handleUpload = async () => {
    if (!image) return;
    const formData = new FormData();
    formData.append('image', image);
    setLoading(true);
    setError('');

    try {
      const res = await axios.post(`${API_URL}/api/ocr-upload`, formData);
      let rawOutput = res.data.recognized_work_orders;

      let workOrders = [];
      if (typeof rawOutput === 'string') {
        workOrders = parseBullets(rawOutput);
      } else if (Array.isArray(rawOutput)) {
        workOrders = rawOutput;
      }

      workOrders = dedupe(workOrders);
      if (!workOrders.length) {
        setError('⚠️ No work orders found. Try another image.');
        setLoading(false);
        return;
      }

      setExtractedWOs(workOrders);
      const normalized = workOrders.map(normalizeWO);
      setEditedWOs(normalized);
      setStep(2);
    } catch (err) {
      console.error('❌ Upload failed:', err);
      setError('Upload or extraction failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---------- API: Lookup ----------
  const fetchProjects = async (woList) => {
    if (!woList.length) {
      setProjectMatches([]);
      return;
    }
    try {
      const res = await axios.post(
        `${API_URL}/api/lookup-work-orders`,
        JSON.stringify({ work_orders: woList }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      setProjectMatches(res.data.matches || []);
    } catch (err) {
      console.error('❌ Failed to fetch projects:', err);
    }
  };

  useEffect(() => {
    if (step >= 2) fetchProjects(editedWOs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedWOs, step]);

  const rerunLookup = () => fetchProjects(editedWOs);

  // ---------- Sorting / Filtering ----------
  const sortedFilteredMatches = useMemo(() => {
    let rows = [...projectMatches];

    const f = filter.trim().toLowerCase();
    if (f) {
      rows = rows.filter(r =>
        [r.work_order, r.project_wo, r.client, r.project, r.pr, r.date]
          .map(v => (v || '').toString().toLowerCase())
          .some(s => s.includes(f))
      );
    }

    if (showNotFound) {
      rows = rows.filter(r => (r.project_wo || '').toLowerCase() === 'not found');
    }

    const val = (r, key) => {
      if (key === 'original') return 0;
      if (key === 'work_order') return r.project_wo || '';
      return (r[key] || '');
    };

    if (sortBy !== 'original') {
      rows.sort((a, b) => {
        const av = val(a, sortBy);
        const bv = val(b, sortBy);
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [projectMatches, filter, showNotFound, sortBy, sortDir]);

  const foundCount = useMemo(
    () => projectMatches.filter(m => (m.project_wo || '').toLowerCase() !== 'not found').length,
    [projectMatches]
  );

  // ---------- Bulk actions ----------
  const copyExtracted = async () => {
    const text = extractedWOs.join('\n');
    await navigator.clipboard.writeText(text);
    alert('Copied extracted work orders to clipboard.');
  };

  const copyMatches = async () => {
    const lines = sortedFilteredMatches
      .map(m => `${m.project_wo || 'Not Found'}\t${m.client || ''}\t${m.project || ''}\t${m.pr || ''}\t${m.date || ''}`);
    await navigator.clipboard.writeText(lines.join('\n'));
    alert('Copied matches to clipboard (tab-separated).');
  };

  const downloadCSV = () => {
    const header = ['input_wo', 'project_wo', 'client', 'project', 'pr', 'date'];
    const rows = sortedFilteredMatches.map(m => ([
      m.work_order || '',
      m.project_wo || '',
      m.client || '',
      m.project || '',
      m.pr || '',
      m.date || ''
    ]));
    const csv = [header, ...rows]
      .map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'work_order_matches.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const addManualWO = () => setEditedWOs(prev => [...prev, '']);
  const removeWO = (idx) => setEditedWOs(prev => prev.filter((_, i) => i !== idx));

  const resetAll = () => {
    setStep(1);
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview('');
    setExtractedWOs([]);
    setEditedWOs([]);
    setProjectMatches([]);
    setError('');
    setFilter('');
  };

  return (
    <div className="ocr-wrap">
      {/* STEP 1: upload */}
      {step === 1 && (
        <div className="ocr-center">
          <div className="ocr-title ocr-imp">Work Order Recognition</div>
          <div className="ocr-subtle">Paste (Ctrl/Cmd+V), drag & drop, or choose an image.</div>

          <div className="ocr-drop" ref={dropRef} onClick={() => fileInputRef.current?.click()}>
            <div className="ocr-drop-inner">
              <FaImage className="ocr-drop-icn" />
              <div>Drop image here or click to select</div>
              <div className="ocr-hint">Accepted: PNG / JPG / GIF</div>
            </div>
            <input
              ref={fileInputRef}
              id="ocr-upload"
              type="file"
              accept="image/*"
              onChange={onInputChange}
              className="ocr-hidden-input"
            />
          </div>

          {image && (
            <div className="ocr-file-row">
              <FaPaperclip className="ocr-clip" />
              <span className="ocr-filename">{image.name}</span>
              {!!imagePreview && <img className="ocr-thumb" src={imagePreview} alt="preview" />}
            </div>
          )}

          <div className="ocr-btn-row">
            <button
              className={`ocr-btn ${!image ? 'ocr-disabled' : 'ocr-primary'}`}
              onClick={handleUpload}
              disabled={!image}
            >
              <FiUpload className="ocr-mr4" /> Upload & Extract
            </button>
            <button className="ocr-btn" onClick={resetAll}>
              <FiRotateCcw className="ocr-mr4" /> Reset
            </button>
          </div>

          {loading && (
            <div className="ocr-spinner">
              Processing<span className="ocr-d1">.</span><span className="ocr-d2">.</span><span className="ocr-d3">.</span>
            </div>
          )}
          {error && <div className="ocr-error">{error}</div>}
        </div>
      )}

      {/* STEP 2: results & editing */}
      {step >= 2 && (
        <>
          <div className="ocr-toolbar">
            <div className="ocr-left-tools">
              <button className="ocr-btn" onClick={resetAll}><FiRotateCcw className="ocr-mr4" />New Image</button>
              <button className="ocr-btn" onClick={rerunLookup}><FaWrench className="ocr-mr4" />Re-run Lookup</button>
              <label className="ocr-lbl">
                <input
                  type="checkbox"
                  checked={normalizeLetters}
                  onChange={() => {
                    setNormalizeLetters(v => !v);
                    setEditedWOs(prev => prev.map(p => normalizeWO(p)));
                  }}
                />
                Normalize letters → (A)
              </label>
            </div>

            <div className="ocr-mid-tools">
              <div className="ocr-count-badge">
                <span className="ocr-imp">Found:</span> {foundCount} / {projectMatches.length}
              </div>
              <div className="ocr-search-box">
                <FiSearch className="ocr-mr4" />
                <input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder="Filter client, project, PR, date…"
                />
              </div>
              <label className="ocr-lbl">
                <input type="checkbox" checked={showNotFound} onChange={() => setShowNotFound(v => !v)} />
                Show not found only
              </label>
            </div>

            <div className="ocr-right-tools">
              <div className="ocr-sort-group">
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="original">Original</option>
                  <option value="date">Date</option>
                  <option value="work_order">Work Order</option>
                  <option value="pr">PR</option>
                  <option value="client">Client</option>
                  <option value="project">Project</option>
                </select>
                <button className="ocr-btn" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))} title="Toggle sort order">
                  {sortDir === 'asc' ? <FiArrowUp /> : <FiArrowDown />}
                </button>
              </div>
              <button className="ocr-btn" onClick={copyExtracted}><FiCopy className="ocr-mr4" />Copy WOs</button>
              <button className="ocr-btn" onClick={copyMatches}><FiCopy className="ocr-mr4" />Copy Matches</button>
              <button className="ocr-btn" onClick={downloadCSV}><FiDownload className="ocr-mr4" />CSV</button>
            </div>
          </div>

          {/* Editable WO list */}
          <div className="ocr-wo-editor">
            <div className="ocr-section-title ocr-imp">Extracted / Edited Work Orders</div>
            <div className="ocr-wo-grid">
              {editedWOs.map((wo, i) => (
                <div className="ocr-wo-chip" key={`wo-${i}`}>
                  <input
                    value={wo}
                    onChange={(e) => applyEditToIndex(i, e.target.value)}
                    className="ocr-wo-input"
                    placeholder="Enter WO…"
                  />
                  <button className="ocr-chip-del" onClick={() => removeWO(i)}>✕</button>
                </div>
              ))}
              <button className="ocr-btn ocr-add" onClick={addManualWO}>+ Add WO</button>
            </div>
          </div>

          {/* Matches */}
          <div className="ocr-matches">
            <div className="ocr-section-title ocr-imp">Matches</div>
            <div className="ocr-match-list">
              {sortedFilteredMatches.map((m, idx) => {
                const notFound = (m.project_wo || '').toLowerCase() === 'not found';
                return (
                  <div className={`ocr-match-row ${notFound ? 'ocr-nf' : ''}`} key={`m-${idx}`}>
                    <div className="ocr-col ocr-wo">
                      <div className="ocr-k">Matched WO</div>
                      <div className={`ocr-v ${notFound ? 'ocr-warn' : ''}`}>{m.project_wo || '—'}</div>
                    </div>
                    <div className="ocr-col ocr-pr">
                      <div className="ocr-k">PR</div>
                      <div className="ocr-v">{m.pr || '—'}</div>
                    </div>
                    <div className="ocr-col ocr-client">
                      <div className="ocr-k">Client</div>
                      <div className="ocr-v">{m.client || '—'}</div>
                    </div>
                    <div className="ocr-col ocr-project">
                      <div className="ocr-k">Project</div>
                      <div className="ocr-v">{m.project || '—'}</div>
                    </div>
                    <div className="ocr-col ocr-date">
                      <div className="ocr-k">Date</div>
                      <div className="ocr-v">{m.date || '—'}</div>
                    </div>
                  </div>
                );
              })}
              {!sortedFilteredMatches.length && (
                <div className="ocr-empty">No results. Adjust filters or try Re-run Lookup.</div>
              )} 
            </div>
          </div>
        </>
      )}
    </div>
  );
}
