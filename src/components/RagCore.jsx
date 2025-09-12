// RagCore.jsx
// Minimal UI for your RAG endpoints with optional Work Order range filters.

import React, { useState } from "react";
import "../styles/RagCore.css";

const API_BASE = "/api/rag";

export default function RagCore() {
  const [db, setDb] = useState("reports.db");

  // Search
  const [query, setQuery] = useState("");
  const [k, setK] = useState(10);
  const [minWO, setMinWO] = useState(""); // e.g. "8000"
  const [maxWO, setMaxWO] = useState(""); // e.g. "9000"
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);

  // Ask
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [snippets, setSnippets] = useState([]);

  // Stats + errors
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  function cleanInt(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  async function fetchStats() {
    setError("");
    try {
      const r = await fetch(`${API_BASE}/stats?db=${encodeURIComponent(db)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setStats(j);
    } catch (e) {
      setError(e.message);
    }
  }

  async function doSearch() {
    setError("");
    setSearching(true);
    setResults([]);
    try {
      const body = {
        query,
        k,
        db,
        // pass only when present
        ...(cleanInt(minWO) !== null ? { min_wo: cleanInt(minWO) } : {}),
        ...(cleanInt(maxWO) !== null ? { max_wo: cleanInt(maxWO) } : {}),
      };
      const r = await fetch(`${API_BASE}/search`, {
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

  async function doAsk() {
    setError("");
    setAnswering(true);
    setAnswer("");
    setSnippets([]);
    try {
      const body = {
        question,
        k: Math.max(8, k),
        db,
        ...(cleanInt(minWO) !== null ? { min_wo: cleanInt(minWO) } : {}),
        ...(cleanInt(maxWO) !== null ? { max_wo: cleanInt(maxWO) } : {}),
      };
      const r = await fetch(`${API_BASE}/ask`, {
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

  const woHint =
    minWO || maxWO
      ? `Filtering to WO ${minWO || "…"}–${maxWO || "…"}`
      : "No WO filter (searches all files)";

  return (
    <div className="rag-wrap">
      <header className="rag-header">
        <h1 className="rag-title">RAG Console</h1>
        <div className="rag-row">
          <label className="rag-label">DB</label>
          <input
            className="rag-input"
            value={db}
            onChange={(e) => setDb(e.target.value)}
            placeholder="reports.db"
          />
          <button className="rag-btn rag-btn-ghost" onClick={fetchStats}>
            Stats
          </button>
          {stats && (
            <div className="rag-chip">
              {stats.db}: {stats.files} files · {stats.chunks} chunks ·{" "}
              {stats.embedded_chunks} embedded
            </div>
          )}
        </div>
      </header>

      {error && <div className="rag-error">⚠️ {error}</div>}

      <section className="rag-panel">
        <h2 className="rag-h2">Search</h2>

        <div className="rag-row rag-row-stack">
          <input
            className="rag-input rag-grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. "file:Wahiawa" or "summarize recommendations"'
          />
          <div className="rag-k">
            <span className="rag-k-label">k</span>
            <input
              className="rag-k-input"
              type="number"
              min="1"
              max="50"
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
            />
          </div>
        </div>

        {/* WO Filter Row */}
        <div className="rag-row rag-wo-row">
          <div className="rag-wo-group">
            <label className="rag-label">WO range (optional)</label>
            <div className="rag-wo-inputs">
              <input
                className="rag-input"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="min e.g. 8000"
                value={minWO}
                onChange={(e) => setMinWO(e.target.value)}
              />
              <span className="rag-wo-sep">–</span>
              <input
                className="rag-input"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="max e.g. 9000"
                value={maxWO}
                onChange={(e) => setMaxWO(e.target.value)}
              />
            </div>
            <div className="rag-wo-hint">{woHint}</div>
          </div>

          <button
            className="rag-btn"
            onClick={doSearch}
            disabled={searching || !query}
            title="Run search"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="rag-results">
          {results.map((r, i) => (
            <div className="rag-card" key={`${r.file}-${r.chunk_id}-${i}`}>
              <div className="rag-card-head">
                <div className="rag-file" title={r.file}>
                  {r.file}
                </div>
                <div className="rag-score">
                  score: {typeof r.score === "number" ? r.score.toFixed(3) : "—"}
                </div>
              </div>
              <div className="rag-chunk">chunk #{r.chunk_id}</div>
              <p className="rag-snippet">{r.text}</p>
            </div>
          ))}
          {!searching && results.length === 0 && (
            <div className="rag-empty">No results yet — try a search.</div>
          )}
        </div>
      </section>

      <section className="rag-panel">
        <h2 className="rag-h2">Ask (LLM)</h2>
        <div className="rag-row rag-row-stack">
          <input
            className="rag-input rag-grow"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question grounded in your index…"
          />
          <button
            className="rag-btn"
            onClick={doAsk}
            disabled={answering || !question}
          >
            {answering ? "Asking…" : "Ask"}
          </button>
        </div>

        {answer && (
          <div className="rag-answer">
            <div className="rag-answer-title">Answer</div>
            <div className="rag-answer-body">{answer}</div>
          </div>
        )}

        {snippets?.length > 0 && (
          <div className="rag-panel rag-nested">
            <div className="rag-subtitle">Context snippets</div>
            <div className="rag-results">
              {snippets.map((s, i) => (
                <div className="rag-card" key={`snip-${i}`}>
                  <div className="rag-card-head">
                    <div className="rag-file" title={s.file}>
                      {s.file}
                    </div>
                    {typeof s.score === "number" && (
                      <div className="rag-score">score: {s.score.toFixed(3)}</div>
                    )}
                  </div>
                  <div className="rag-chunk">chunk #{s.chunk_id}</div>
                  <p className="rag-snippet">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
