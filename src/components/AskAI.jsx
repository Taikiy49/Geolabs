import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import { useMsal } from "@azure/msal-react";
import { FaPaperPlane, FaGlobe, FaBolt, FaTimes, FaCopy, FaTrash, FaRegStar, FaStar, FaDownload, FaUndo, FaSearch } from "react-icons/fa";
import API_URL from "../config";
import "../styles/AskAI.css";

function formatDatabaseName(dbName = "") {
  return dbName.replace(/\.db$/i, "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function AskAI({ selectedDB, setSelectedDB }) {
  const { accounts } = useMsal();
  const userEmail = accounts?.[0]?.username || "guest";

  const [availableDBs, setAvailableDBs] = useState([]);
  const [history, setHistory] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const [useWeb, setUseWeb] = useState(false);
  const [useCache, setUseCache] = useState(true);

  const [copyFeedback, setCopyFeedback] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");

  const [historyW, setHistoryW] = useState(300);
  const resizingRef = useRef(false);
  const containerRef = useRef(null);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    const loadDatabases = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/list-dbs`);
        setAvailableDBs(Array.isArray(data.dbs) ? data.dbs : []);
        if (!selectedDB && data.dbs?.length) setSelectedDB(data.dbs[0]);
      } catch {
        setAvailableDBs([]);
      }
    };
    loadDatabases();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!selectedDB) return;
    setConversation([]);
    const loadHistory = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/chat_history`, {
          params: { user: userEmail, db: selectedDB },
        });
        setHistory((data || []).map(i => ({ question: i.question, answer: i.answer, pinned: !!i.pinned })));
      } catch {
        setHistory([]);
      }
    };
    loadHistory();
  }, [selectedDB, userEmail]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [conversation.length]);

  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return history;
    return history.filter(h => h.question.toLowerCase().includes(q) || h.answer.toLowerCase().includes(q));
  }, [history, historyFilter]);

  const askQuestion = async (questionText, opts = {}) => {
    if (!selectedDB || !questionText.trim()) return;
    setLoading(true);
    setConversation(prev => [...prev, { role: "user", text: questionText }, { role: "assistant", text: "", loading: true }]);

    try {
      abortControllerRef.current = new AbortController();
      const { data } = await axios.post(
        `${API_URL}/api/question`,
        { query: questionText, user: userEmail, use_cache: opts.forceNoCache ? false : useCache, use_web: useWeb, db: selectedDB },
        { signal: abortControllerRef.current.signal }
      );

      setConversation(prev => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", text: data?.answer || "No response." };
        return u;
      });

      const hres = await axios.get(`${API_URL}/api/chat_history`, { params: { user: userEmail, db: selectedDB } });
      setHistory((hres.data || []).map(i => ({ question: i.question, answer: i.answer, pinned: !!i.pinned })));
    } catch (err) {
      const canceled = axios.isCancel?.(err) || err?.name === "CanceledError";
      setConversation(prev => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", text: canceled ? "Stopped." : "Failed. Try again." };
        return u;
      });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = (e, custom) => {
    e.preventDefault();
    const q = (custom ?? query).trim();
    if (!q) return;
    setQuery("");
    askQuestion(q);
  };

  const stopRequest = () => abortControllerRef.current?.abort();
  const regenerate = () => {
    const lastUser = [...conversation].reverse().find(m => m.role === "user");
    lastUser?.text && askQuestion(lastUser.text, { forceNoCache: true });
  };

  const copyToClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopyFeedback("Copied"); setTimeout(() => setCopyFeedback(""), 1200); } catch {}
  };

  const loadHistoryItem = (idx) => {
    const item = filteredHistory[idx];
    if (!item) return;
    setConversation([{ role: "user", text: item.question }, { role: "assistant", text: item.answer }]);
  };

  const deleteHistoryItem = async (idx) => {
    const item = filteredHistory[idx];
    if (!item) return;
    if (!window.confirm("Delete this entry?")) return;
    try {
      await axios.delete(`${API_URL}/api/delete-history`, {
        data: { user: userEmail, db: selectedDB, question: item.question },
      });
      setHistory(prev => prev.filter(h => !(h.question === item.question && h.answer === item.answer)));
    } catch {}
  };

  // resize history
  const onMouseDown = (e) => { e.preventDefault(); resizingRef.current = true; };
  const onMouseMove = useCallback((e) => {
    if (!resizingRef.current || !containerRef.current) return;
    const right = containerRef.current.getBoundingClientRect().right;
    setHistoryW(clamp(right - e.clientX, 240, 520));
  }, []);
  const onMouseUp = () => { resizingRef.current = false; };
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove]);

  return (
    <div className="askai" ref={containerRef}>
      {/* compact header — only DB select on the left */}
      <header className="askai-h">
        <div className="askai-hl">
          <select
            className="askai-db"
            value={selectedDB || ""}
            onChange={(e) => setSelectedDB(e.target.value)}
            aria-label="Database"
          >
            <option value="">Select database…</option>
            {availableDBs.map((db) => (
              <option key={db} value={db}>{formatDatabaseName(db)}</option>
            ))}
          </select>
        </div>

        <div className="askai-hr">
          <button className={`askai-toggle ${useWeb ? "on" : ""}`} onClick={() => setUseWeb(!useWeb)} title="Web">
            <FaGlobe />
          </button>
          <button className={`askai-toggle ${useCache ? "on" : ""}`} onClick={() => setUseCache(!useCache)} title="Cache">
            <FaBolt />
          </button>
          <button className="askai-icon" onClick={() => setConversation([])} title="New">
            <FaUndo />
          </button>
          <button
            className="askai-icon"
            onClick={() => {
              if (conversation.length === 0) return;
              const lines = conversation.map(m =>
                (m.role === "user" ? "### You\n\n" : "### Assistant\n\n") + (m.text || "") + "\n"
              );
              const md = `# ${formatDatabaseName(selectedDB || "Chat")} – Export\n\n${new Date().toLocaleString()}\n\n---\n\n${lines.join("\n")}`;
              const blob = new Blob([md], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `chat_${Date.now()}.md`; a.click();
              URL.revokeObjectURL(url);
            }}
            title="Export"
          >
            <FaDownload />
          </button>
        </div>
      </header>

      <div className="askai-main">
        {/* chat */}
        <section className="askai-chat">
          <div className="askai-msgs" ref={chatScrollRef}>
            {conversation.length === 0 ? (
              <div className="askai-empty"><p>Ask about {selectedDB ? formatDatabaseName(selectedDB) : "your data"}…</p></div>
            ) : (
              conversation.map((m, i) => (
                <div key={i} className={m.role === "user" ? "msg msg-u" : "msg msg-a"}>
                  {m.role === "assistant" && !m.loading && (
                    <div className="msg-actions">
                      <button className="askai-icon" onClick={() => copyToClipboard(m.text)} title="Copy"><FaCopy /></button>
                      <button className="askai-icon" onClick={regenerate} title="Regenerate" disabled={loading}><FaBolt /></button>
                    </div>
                  )}
                  {m.loading ? <div className="askai-thinking"><span>Thinking…</span></div> : <ReactMarkdown>{m.text}</ReactMarkdown>}
                </div>
              ))
            )}
          </div>

          <form className="askai-input" onSubmit={(e) => handleSubmit(e)}>
            <textarea
              ref={inputRef}
              rows={1}
              className="askai-text"
              placeholder={selectedDB ? `Ask about ${formatDatabaseName(selectedDB)}…` : "Pick a database to ask…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
              disabled={!selectedDB || loading}
            />
            {loading ? (
              <button type="button" className="askai-send stop" onClick={stopRequest} title="Stop"><FaTimes /></button>
            ) : (
              <button type="submit" className="askai-send" disabled={!selectedDB || !query.trim()} title="Send"><FaPaperPlane /></button>
            )}
            {copyFeedback && <div className="askai-toast">{copyFeedback}</div>}
          </form>
        </section>

        {/* handle */}
        <div className="askai-handle" onMouseDown={onMouseDown} title="Drag" aria-label="Resize history" />

        {/* history */}
        <aside className="askai-history" style={{ width: historyW }}>
          <div className="askai-h-row">
            <div className="askai-search">
              <FaSearch aria-hidden="true" />
              <input
                type="search"
                placeholder="Search…"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="askai-h-list">
            {filteredHistory.length === 0 ? (
              <div className="askai-empty-h">No history</div>
            ) : (
              filteredHistory
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                .map((item, idx) => (
                  <div key={idx} className="h-item" onClick={() => loadHistoryItem(idx)}>
                    <div className="h-q">{item.question}</div>
                    <div className="h-a">{item.answer.slice(0, 110)}{item.answer.length > 110 ? "…" : ""}</div>
                    <div className="h-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="askai-icon" title={item.pinned ? "Unpin" : "Pin"} onClick={() => {
                        setHistory(prev => prev.map(h => h.question === item.question && h.answer === item.answer ? { ...h, pinned: !h.pinned } : h));
                      }}>
                        {item.pinned ? <FaStar /> : <FaRegStar />}
                      </button>
                      <button className="askai-icon danger" title="Delete" onClick={() => deleteHistoryItem(idx)}><FaTrash /></button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
