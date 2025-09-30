// RagCore.jsx
import React, { useMemo, useState } from "react";
import "../styles/RagCore.css";

const API = "/api/rag";
const MAX_MULTI = 5;

export default function RagCore() {
  const [db, setDb] = useState("reports.db");

  const [query, setQuery] = useState("");
  const [k, setK] = useState(12);
  const [minWO, setMinWO] = useState("");
  const [maxWO, setMaxWO] = useState("");

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);

  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState("extractive"); // or "generative"
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [snippets, setSnippets] = useState([]);

  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const woPayload = useMemo(() => {
    const payload = {};
    if (String(minWO).trim() !== "") payload.min_wo = Number(minWO);
    if (String(maxWO).trim() !== "") payload.max_wo = Number(maxWO);
    return payload;
  }, [minWO, maxWO]);

  async function fetchStats() {
    setError("");
    try {
      const r = await fetch(`${API}/stats?db=${encodeURIComponent(db)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setStats(j);
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleSelect(file) {
    setSelectedFiles((prev) => {
      if (prev.includes(file)) return prev.filter((f) => f !== file);
      if (prev.length >= MAX_MULTI) return prev; // cap
      return [...prev, file];
    });
  }

  function clearSelection() {
    setSelectedFiles([]);
  }

  async function doSearch() {
    setError(""); setSearching(true); setResults([]); clearSelection();
    try {
      const body = {
        query, k, db,
        ...woPayload,
      };
      // NOTE: backend also supports a file whitelist; not used here on initial search
      const r = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setResults(j.results || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }

  async function askSingle(file) {
    setError(""); setAnswer(""); setSnippets([]); setAnswering(true);
    try {
      const body = {
        question: question || query || `What are the key findings?`,
        k: Math.max(10, k),
        db,
        files: [file],
        mode,
        ...woPayload,
      };
      const r = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setAnswer(j.answer || "");
      setSnippets(j.snippets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setAnswering(false);
    }
  }

  async function askMulti() {
    if (selectedFiles.length === 0) return;
    setError(""); setAnswer(""); setSnippets([]); setAnswering(true);
    try {
      const body = {
        question: question || query || "Compare the key points across these files.",
        k: Math.max(12, k),
        db,
        files: selectedFiles.slice(0, MAX_MULTI),
        mode,
        ...woPayload,
      };
      const r = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setAnswer(j.answer || "");
      setSnippets(j.snippets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setAnswering(false);
    }
  }

  // Unique files present in the result set (for quick “Select All Top 3 Files” etc.)
  const uniqueFiles = useMemo(() => {
    const seen = new Set();
    const order = [];
    for (const r of results) {
      if (!seen.has(r.file)) {
        seen.add(r.file); order.push(r.file);
      }
    }
    return order;
  }, [results]);

  return (
    <div className="rag-wrap">
      <header className="rag-header">
        <h1>RAG Console</h1>
        <div className="rag-row rag-row-wrap">
          <label>DB</label>
          <input value={db} onChange={(e) => setDb(e.target.value)} placeholder="reports.db" />
          <button className="rag-btn ghost" onClick={fetchStats}>Stats</button>
          {stats && (
            <div className="rag-chip">
              {stats.db} · {stats.files ?? "?"} files · {stats.chunks ?? "?"} chunks · {stats.embedded_chunks ?? "?"} embedded
            </div>
          )}
        </div>
      </header>

      {error && <div className="rag-error">⚠️ {error}</div>}

      <section className="rag-panel">
        <h2>Search</h2>
        <div className="rag-row rag-row-wrap">
          <input
            className="rag-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Try: "file:Wahiawa" or "recommendations for Wahiawa"'
          />
          <div className="rag-k">
            <span>k</span>
            <input type="number" min="1" max="50" value={k} onChange={(e) => setK(Number(e.target.value))} />
          </div>
          <div className="rag-wo">
            <span>WO</span>
            <input
              type="number"
              placeholder="min"
              value={minWO}
              onChange={(e) => setMinWO(e.target.value)}
            />
            <span>–</span>
            <input
              type="number"
              placeholder="max"
              value={maxWO}
              onChange={(e) => setMaxWO(e.target.value)}
            />
          </div>
          <button className="rag-btn primary" onClick={doSearch} disabled={searching || !query}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {uniqueFiles.length > 0 && (
          <div className="rag-row rag-selectbar">
            <div className="rag-select-info">
              {selectedFiles.length > 0 ? (
                <>
                  <strong>{selectedFiles.length}</strong> selected (max {MAX_MULTI})
                  <button className="rag-btn tiny ghost" onClick={clearSelection}>Clear</button>
                </>
              ) : (
                <>Select files to ask across (optional)</>
              )}
            </div>
            <div className="rag-mode">
              <label className={mode === "extractive" ? "active" : ""}>
                <input type="radio" name="mode" value="extractive" checked={mode === "extractive"} onChange={() => setMode("extractive")} />
                Extractive
              </label>
              <label className={mode === "generative" ? "active" : ""}>
                <input type="radio" name="mode" value="generative" checked={mode === "generative"} onChange={() => setMode("generative")} />
                Generative
              </label>
            </div>
            <button
              className="rag-btn primary"
              onClick={askMulti}
              disabled={answering || selectedFiles.length === 0}
              title="Ask across selected files (round-robin snippets)"
            >
              {answering ? "Asking…" : `Ask across ${selectedFiles.length || 0} file(s)`}
            </button>
          </div>
        )}

        <div className="rag-results-box">
          <div className="rag-results">
            {results.map((r, i) => (
              <div className="rag-card" key={`${r.file}-${r.chunk_id}-${i}`}>
                <div className="rag-card-head">
                  <div className="rag-file">
                    <input
                      type="checkbox"
                      className="rag-check"
                      checked={selectedFiles.includes(r.file)}
                      onChange={() => toggleSelect(r.file)}
                      title="Select this file for multi-file ask"
                    />
                    <span title={r.file}>{r.file}</span>
                  </div>
                  <div className="rag-score">score: {typeof r.score === "number" ? r.score.toFixed(3) : "-"}</div>
                </div>
                <div className="rag-chunk">chunk #{r.chunk_id}</div>
                <p className="rag-snippet">{r.text}</p>
                <div className="rag-card-actions">
                  <button className="rag-btn tiny" onClick={() => askSingle(r.file)} disabled={answering}>
                    Ask this file
                  </button>
                </div>
              </div>
            ))}
            {!searching && results.length === 0 && (
              <div className="rag-empty">No results yet — try a search.</div>
            )}
          </div>
        </div>
      </section>

      <section className="rag-panel">
        <h2>Ask (Answer)</h2>
        <div className="rag-row rag-row-wrap">
          <input
            className="rag-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question (leave blank to use search text)"
          />
          <div className="rag-mode inline">
            <label className={mode === "extractive" ? "active" : ""}>
              <input type="radio" name="mode2" value="extractive" checked={mode === "extractive"} onChange={() => setMode("extractive")} />
              Extractive
            </label>
            <label className={mode === "generative" ? "active" : ""}>
              <input type="radio" name="mode2" value="generative" checked={mode === "generative"} onChange={() => setMode("generative")} />
              Generative
            </label>
          </div>
        </div>

        {answer && (
          <div className="rag-answer">
            <div className="rag-answer-title">Answer</div>
            <div className="rag-answer-body">{answer}</div>
          </div>
        )}

        {snippets?.length > 0 && (
          <>
            <div className="rag-subtitle">Context snippets</div>
            <div className="rag-results">
              {snippets.map((s, i) => (
                <div className="rag-card" key={`snip-${i}`}>
                  <div className="rag-card-head">
                    <div className="rag-file"><span title={s.file}>{s.file}</span></div>
                    {typeof s.score === "number" && <div className="rag-score">score: {s.score.toFixed(3)}</div>}
                  </div>
                  <div className="rag-chunk">chunk #{s.chunk_id}</div>
                  <p className="rag-snippet">{s.text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
