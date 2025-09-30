import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import API_URL from '../config';
import '../styles/OCRLookup.css';
import {
  FiRotateCcw, FiUpload, FiCopy, FiDownload, FiSearch, FiArrowUp, FiArrowDown,
  FiZoomIn, FiZoomOut, FiRotateCw, FiSettings, FiX, FiEye, FiEyeOff, FiFilePlus, FiLayers
} from 'react-icons/fi';
import { FaPaperclip, FaImage, FaWrench } from 'react-icons/fa';

/* -------------------------------------------------------
   OCR Lookup – Enhanced for Eng Workflows
   ------------------------------------------------------- */

export default function OCRLookUp() {
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [extractedWOs, setExtractedWOs] = useState([]);
  const [editedWOs, setEditedWOs] = useState([]);
  const [projectMatches, setProjectMatches] = useState([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Sorting / filters
  const [sortBy, setSortBy] = useState('original');
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('');
  const [showNotFound, setShowNotFound] = useState(false);

  // Normalization controls
  const [normalizeLetters, setNormalizeLetters] = useState(true);
  const [smartFixes, setSmartFixes] = useState(true);
  const [forceUpper, setForceUpper] = useState(true);
  const [stripSpaces, setStripSpaces] = useState(true);

  // Image tools
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [showImagePanel, setShowImagePanel] = useState(true);

  // UI
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [columns, setColumns] = useState({
    project_wo: true, pr: true, client: true, project: true, date: true
  });
  const [groupBy, setGroupBy] = useState('none'); // none | client | pr
  const [toast, setToast] = useState('');

  // ---------- Helpers ----------
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1600);
  };

  const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

  const parseBullets = (text) =>
    text
      .split('\n')
      .map(line => line.replace(/^[-•–*]\s*/, '').trim())
      .filter(Boolean);

  const simpleValidate = (wo) => {
    // Non-blocking hints: alnum + dashes + parens, ~3–30 chars
    if (!wo) return 'empty';
    const ok = /^[A-Za-z0-9()\-_/]{3,30}$/.test(wo);
    return ok ? '' : 'suspicious';
  };

  const normalizeLetterSuffix = (wo) => {
    // e.g. 8292-05B -> 8292-05(B) or 8292B -> 8292(B)
    if (/[A-Za-z]$/.test(wo)) {
      const base = wo.slice(0, -1);
      const letter = wo.slice(-1).toUpperCase();
      return `${base}(${letter})`;
    }
    return wo;
  };

  const smartOCRFixes = (wo) => {
    // Heuristics: O↔0 and I↔1 swaps in numeric contexts, trim doubles, normalize dashes
    let s = wo;
    if (stripSpaces) s = s.replace(/\s+/g, '');
    s = s.replace(/[–—]/g, '-'); // em/en to dash
    if (smartFixes) {
      // Only swap where it makes sense: letters inside mostly digits or adjacent to digits
      s = s
        .replace(/(?<=\d)O(?=\d)|(?<=\d)O(?![A-Za-z])/g, '0')
        .replace(/(?<=\d)I(?=\d)|(?<=\d)I(?![A-Za-z])/g, '1')
        .replace(/(?<=\d)l(?=\d)|(?<=\d)l(?![A-Za-z])/g, '1')
        .replace(/(?<=\d)B(?=\d)/g, '8');
      // collapse duplicate separators
      s = s.replace(/[-_/]{2,}/g, '-');
    }
    if (forceUpper) s = s.toUpperCase();
    if (normalizeLetters) s = normalizeLetterSuffix(s);
    return s;
  };

  const normalizeWO = (wo) => smartOCRFixes(wo);

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
    setZoom(1);
    setRotate(0);
  };

  const onInputChange = (e) => handleFileChange(e.target.files[0]);

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
      showToast('Extraction complete');
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

  const rerunLookup = () => {
    fetchProjects(editedWOs);
    showToast('Re-running lookup…');
  };

  // ---------- Sorting / Filtering / Grouping ----------
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

    if (showNotFound) rows = rows.filter(r => (r.project_wo || '').toLowerCase() === 'not found');

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

    // Grouping (visual only)
    if (groupBy !== 'none') {
      const key = groupBy === 'client' ? 'client' : 'pr';
      const groups = new Map();
      for (const r of rows) {
        const k = r[key] || '(none)';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      // Flatten with group headers
      const flattened = [];
      for (const [k, arr] of groups.entries()) {
        flattened.push({ __group: true, label: `${groupBy.toUpperCase()}: ${k}`, count: arr.length });
        flattened.push(...arr);
      }
      return flattened;
    }

    return rows;
  }, [projectMatches, filter, showNotFound, sortBy, sortDir, groupBy]);

  const foundCount = useMemo(
    () => projectMatches.filter(m => (m.project_wo || '').toLowerCase() !== 'not found').length,
    [projectMatches]
  );

  // ---------- Bulk actions ----------
  const copyExtracted = async () => {
    const text = extractedWOs.join('\n');
    await navigator.clipboard.writeText(text);
    showToast('Extracted WOs copied');
  };

  const copyMatches = async () => {
    const rows = sortedFilteredMatches.filter(r => !r.__group);
    const lines = rows
      .map(m => `${m.project_wo || 'Not Found'}\t${m.client || ''}\t${m.project || ''}\t${m.pr || ''}\t${m.date || ''}`);
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast('Matches copied (TSV)');
  };

  const copyJSON = async () => {
    const rows = sortedFilteredMatches.filter(r => !r.__group);
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    showToast('Matches copied (JSON)');
  };

  const downloadCSV = () => {
    const rows = sortedFilteredMatches.filter(r => !r.__group);
    const header = ['input_wo', 'project_wo', 'client', 'project', 'pr', 'date'];
    const data = rows.map(m => ([
      m.work_order || '',
      m.project_wo || '',
      m.client || '',
      m.project || '',
      m.pr || '',
      m.date || ''
    ]));
    const csv = [header, ...data]
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
  const clearAllWOs = () => setEditedWOs([]);
  const resetToExtracted = () => setEditedWOs(extractedWOs.map(normalizeWO));

  const applyBulk = () => {
    const lines = parseBullets(bulkText);
    if (!lines.length) {
      setShowBulkModal(false);
      return;
    }
    const merged = dedupe([...editedWOs, ...lines.map(normalizeWO)]);
    setEditedWOs(merged);
    setShowBulkModal(false);
    setBulkText('');
    showToast('Bulk WOs added');
  };

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e) => {
      // Ignore if typing in inputs/modals
      const tag = (e.target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (isTyping) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault(); handleUpload();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault(); rerunLookup();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault(); copyJSON();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault(); copyMatches();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); downloadCSV();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault(); setShowBulkModal(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUpload, rerunLookup, copyMatches, copyJSON]);

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
    setZoom(1);
    setRotate(0);
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
              title="Upload & Extract (Ctrl/Cmd+U)"
            >
              <FiUpload className="ocr-mr4" /> Upload & Extract
            </button>
            <button className="ocr-btn" onClick={resetAll} title="Reset">
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
          <div className="ocr-toolbar ocr-sticky">
            <div className="ocr-left-tools">
              <button className="ocr-btn" onClick={resetAll} title="New Image">
                <FiRotateCcw className="ocr-mr4" />New Image
              </button>
              <button className="ocr-btn" onClick={rerunLookup} title="Re-run Lookup (Ctrl/Cmd+R)">
                <FaWrench className="ocr-mr4" />Re-run Lookup
              </button>

              <div className="ocr-toggle-chip">
                <input
                  id="norm-letter"
                  type="checkbox"
                  checked={normalizeLetters}
                  onChange={() => {
                    setNormalizeLetters(v => !v);
                    setEditedWOs(prev => prev.map(p => normalizeWO(p)));
                  }}
                />
                <label htmlFor="norm-letter">Suffix → (A)</label>
              </div>

              <div className="ocr-toggle-chip">
                <input
                  id="smart-fixes"
                  type="checkbox"
                  checked={smartFixes}
                  onChange={() => {
                    setSmartFixes(v => !v);
                    setEditedWOs(prev => prev.map(p => normalizeWO(p)));
                  }}
                />
                <label htmlFor="smart-fixes">Smart OCR Fixes</label>
              </div>

              <div className="ocr-toggle-chip">
                <input
                  id="force-upper"
                  type="checkbox"
                  checked={forceUpper}
                  onChange={() => {
                    setForceUpper(v => !v);
                    setEditedWOs(prev => prev.map(p => normalizeWO(p)));
                  }}
                />
                <label htmlFor="force-upper">UPPERCASE</label>
              </div>

              <div className="ocr-toggle-chip">
                <input
                  id="strip-space"
                  type="checkbox"
                  checked={stripSpaces}
                  onChange={() => {
                    setStripSpaces(v => !v);
                    setEditedWOs(prev => prev.map(p => normalizeWO(p)));
                  }}
                />
                <label htmlFor="strip-space">Strip spaces</label>
              </div>
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
              <div className="ocr-group">
                <FiLayers />
                <select value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Group rows">
                  <option value="none">No Group</option>
                  <option value="client">Group by Client</option>
                  <option value="pr">Group by PR</option>
                </select>
              </div>
            </div>

            <div className="ocr-right-tools">
              <div className="ocr-colvis">
                <FiSettings />
                <div className="ocr-colvis-menu">
                  {Object.keys(columns).map(k => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={columns[k]}
                        onChange={() => setColumns(prev => ({...prev, [k]: !prev[k]}))}
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </div>

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

              <button className="ocr-btn" onClick={() => setShowBulkModal(true)} title="Bulk paste (Ctrl/Cmd+B)">
                <FiFilePlus className="ocr-mr4" />Bulk Add
              </button>
              <button className="ocr-btn" onClick={copyExtracted} title="Copy extracted WOs">
                <FiCopy className="ocr-mr4" />Copy WOs
              </button>
              <button className="ocr-btn" onClick={copyMatches} title="Copy matches (TSV)">
                <FiCopy className="ocr-mr4" />Copy Matches
              </button>
              <button className="ocr-btn" onClick={copyJSON} title="Copy JSON (Ctrl/Cmd+J)">
                <FiCopy className="ocr-mr4" />JSON
              </button>
              <button className="ocr-btn" onClick={downloadCSV} title="Download CSV (Ctrl/Cmd+S)">
                <FiDownload className="ocr-mr4" />CSV
              </button>
            </div>
          </div>

          {/* Editable WO + image panel */}
          <div className="ocr-flex">
            {showImagePanel && imagePreview && (
              <div className="ocr-image-panel">
                <div className="ocr-image-tools">
                  <button className="ocr-iconbtn" onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))} title="Zoom In"><FiZoomIn /></button>
                  <button className="ocr-iconbtn" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} title="Zoom Out"><FiZoomOut /></button>
                  <button className="ocr-iconbtn" onClick={() => setRotate(r => (r + 90) % 360)} title="Rotate"><FiRotateCw /></button>
                  <button className="ocr-iconbtn" onClick={() => { setZoom(1); setRotate(0); }} title="Reset"><FiRotateCcw /></button>
                  <button className="ocr-iconbtn" onClick={() => setShowImagePanel(false)} title="Hide image"><FiEyeOff /></button>
                </div>
                <div className="ocr-image-viewport">
                  <img
                    src={imagePreview}
                    alt="source"
                    style={{ transform: `scale(${zoom}) rotate(${rotate}deg)` }}
                  />
                </div>
              </div>
            )}

            {!showImagePanel && imagePreview && (
              <button className="ocr-btn ocr-image-reveal" onClick={() => setShowImagePanel(true)} title="Show image">
                <FiEye className="ocr-mr4" />Show Image
              </button>
            )}

            <div className="ocr-wo-editor ocr-flex-grow">
              <div className="ocr-section-title ocr-imp ocr-row-between">
                <span>Extracted / Edited Work Orders</span>
                <span className="ocr-row-gap">
                  <button className="ocr-btn ocr-add" onClick={addManualWO}><span>+ Add WO</span></button>
                  <button className="ocr-btn" onClick={resetToExtracted} title="Reset to extracted">Reset</button>
                  <button className="ocr-btn" onClick={clearAllWOs} title="Clear all">Clear</button>
                </span>
              </div>

              <div className="ocr-wo-grid">
                {editedWOs.map((wo, i) => {
                  const hint = simpleValidate(wo);
                  return (
                    <div className={`ocr-wo-chip ${hint === 'suspicious' ? 'ocr-chip-warn' : ''}`} key={`wo-${i}`} title={hint === 'suspicious' ? 'Unusual format – check OCR' : ''}>
                      <input
                        value={wo}
                        onChange={(e) => applyEditToIndex(i, e.target.value)}
                        className="ocr-wo-input"
                        placeholder="Enter WO…"
                      />
                      <button className="ocr-chip-del" onClick={() => removeWO(i)} aria-label="remove">✕</button>
                    </div>
                  );
                })}
                <button className="ocr-btn ocr-add" onClick={addManualWO}><span>+ Add WO</span></button>
              </div>
            </div>
          </div>

          {/* Matches */}
          <div className="ocr-matches">
            <div className="ocr-section-title ocr-imp">Matches</div>
            <div className="ocr-match-list">
              {sortedFilteredMatches.map((m, idx) => {
                if (m.__group) {
                  return (
                    <div key={`g-${idx}`} className="ocr-group-header">
                      <span>{m.label}</span>
                      <span className="ocr-badge">{m.count}</span>
                    </div>
                  );
                }
                const notFound = (m.project_wo || '').toLowerCase() === 'not found';
                return (
                  <div className={`ocr-match-row ${notFound ? 'ocr-nf' : ''}`} key={`m-${idx}`}>
                    {columns.project_wo && (
                      <div className="ocr-col ocr-wo">
                        <div className="ocr-k">Matched WO</div>
                        <div className={`ocr-v ${notFound ? 'ocr-warn' : ''}`}>{m.project_wo || '—'}</div>
                      </div>
                    )}
                    {columns.pr && (
                      <div className="ocr-col ocr-pr">
                        <div className="ocr-k">PR</div>
                        <div className="ocr-v">{m.pr || '—'}</div>
                      </div>
                    )}
                    {columns.client && (
                      <div className="ocr-col ocr-client">
                        <div className="ocr-k">Client</div>
                        <div className="ocr-v">{m.client || '—'}</div>
                      </div>
                    )}
                    {columns.project && (
                      <div className="ocr-col ocr-project">
                        <div className="ocr-k">Project</div>
                        <div className="ocr-v">{m.project || '—'}</div>
                      </div>
                    )}
                    {columns.date && (
                      <div className="ocr-col ocr-date">
                        <div className="ocr-k">Date</div>
                        <div className="ocr-v">{m.date || '—'}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!sortedFilteredMatches.filter(r => !r.__group).length && (
                <div className="ocr-empty">No results. Adjust filters or try Re-run Lookup.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Bulk add modal */}
      {showBulkModal && (
        <div className="ocr-modal">
          <div className="ocr-modal-card">
            <div className="ocr-modal-head">
              <div className="ocr-modal-title"><FiFilePlus /> Bulk Add Work Orders</div>
              <button className="ocr-iconbtn" onClick={() => setShowBulkModal(false)} aria-label="Close"><FiX /></button>
            </div>
            <div className="ocr-modal-body">
              <p className="ocr-subtle">Paste multiple WOs (one per line). We’ll apply your normalization options automatically.</p>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder="e.g.\n8292-05B\n1130 A\nWO-7781O"
              />
            </div>
            <div className="ocr-modal-foot">
              <button className="ocr-btn" onClick={() => setShowBulkModal(false)}>Cancel</button>
              <button className="ocr-btn ocr-primary" onClick={applyBulk}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {!!toast && <div className="ocr-toast">{toast}</div>}
    </div>
  );
}
