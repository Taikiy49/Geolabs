import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import { useMsal } from "@azure/msal-react";
import {
  FaPaperPlane,
  FaGlobe,
  FaBolt,
  FaTimes,
  FaCopy,
  FaTrash,
  FaRegStar,
  FaStar,
  FaDownload,
  FaUndo,
  FaSearch,
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/AskAI.css";
// Remove common Markdown syntax so previews read cleanly
function stripMarkdown(md = "") {
  return String(md)
    // code fences & their content
    .replace(/```[\s\S]*?```/g, " ")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // images ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // autolinks <http://…> -> http…
    .replace(/<([^ >]+)>/g, "$1")
    // headings #### Title -> Title
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // blockquotes > foo -> foo
    .replace(/^\s{0,3}>\s?/gm, "")
    // lists ("- ", "* ", "+ ", "1. ") -> text
    .replace(/^\s*([-*+]\s+|\d+\.\s+)/gm, "")
    // bold/italic
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // hrules
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
    // stray HTML tags
    .replace(/<\/?[^>]+>/g, " ")
    // collapse whitespace
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function formatDatabaseName(dbName = "") {
  return dbName.replace(/\.db$/i, "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function AskAI({ selectedDB: controlledDB, setSelectedDB: setControlledDB }) {
  const { accounts } = useMsal();
  const userEmail = accounts?.[0]?.username || "guest";

  // ---- Controlled/uncontrolled fallback for selectedDB ----
  const [internalDB, setInternalDB] = useState(controlledDB ?? "");
  const selectedDB = controlledDB ?? internalDB;
  const setDB = useCallback(
    (v) => {
      if (typeof setControlledDB === "function") setControlledDB(v);
      else setInternalDB(v);
    },
    [setControlledDB]
  );

  const [availableDBs, setAvailableDBs] = useState([]);
  const [dbErr, setDbErr] = useState("");

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

  // ---------- Load DB list (robust, with fallback and visible error) ----------
  const loadDatabases = useCallback(async () => {
    const base = (API_URL || "").replace(/\/$/, "");
    const primary = `${base}/api/list-dbs`;
    const fallback = `/api/list-dbs`;

    async function tryUrl(url) {
      const { data } = await axios.get(url);
      if (!Array.isArray(data?.dbs)) throw new Error(`Unexpected payload from ${url}`);
      return data.dbs;
    }

    try {
      const dbs = await tryUrl(primary);
      setAvailableDBs(dbs);
      setDbErr("");
    } catch (e1) {
      console.warn("[AskAI] list-dbs primary failed:", e1?.message);
      try {
        const dbs = await tryUrl(fallback);
        setAvailableDBs(dbs);
        setDbErr(`Primary failed; using fallback (${fallback})`);
      } catch (e2) {
        console.error("[AskAI] list-dbs failed (both):", e2?.message);
        setAvailableDBs([]);
        setDbErr(e2?.message || "Failed to load databases");
      }
    }
  }, []);

  useEffect(() => {
    loadDatabases();
  }, [loadDatabases]);

  // Select first DB once list is available (avoids race with parent)
  useEffect(() => {
    if (!selectedDB && Array.isArray(availableDBs) && availableDBs.length) {
      setDB(availableDBs[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDBs, selectedDB]);

  // ---------- Load chat history whenever DB changes ----------
  useEffect(() => {
    if (!selectedDB) return;
    setConversation([]);
    const loadHistory = async () => {
      try {
        const { data } = await axios.get(`${(API_URL || "").replace(/\/$/, "")}/api/chat_history`, {
          params: { user: userEmail, db: selectedDB },
        });
        setHistory((data || []).map((i) => ({ question: i.question, answer: i.answer, pinned: !!i.pinned })));
      } catch {
        setHistory([]);
      }
    };
    loadHistory();
  }, [selectedDB, userEmail]);

  // ---------- Auto-scroll chat ----------
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [conversation.length]);

  // ---------- History filter ----------
  const filteredHistory = useMemo(() => {
  const q = historyFilter.trim().toLowerCase();
  if (!q) return history;
  return history.filter((h) => {
    const aPlain = stripMarkdown(h.answer).toLowerCase();
    const qPlain = h.question.toLowerCase();
    return qPlain.includes(q) || aPlain.includes(q);
  });
}, [history, historyFilter]);


  // ---------- Ask question flow ----------
  const askQuestion = async (questionText, opts = {}) => {
    if (!selectedDB || !questionText.trim()) return;
    setLoading(true);
    setConversation((prev) => [
      ...prev,
      { role: "user", text: questionText },
      { role: "assistant", text: "", loading: true },
    ]);

    try {
      abortControllerRef.current = new AbortController();
      const { data } = await axios.post(
        `${(API_URL || "").replace(/\/$/, "")}/api/question`,
        {
          query: questionText,
          user: userEmail,
          use_cache: opts.forceNoCache ? false : useCache,
          use_web: useWeb,
          db: selectedDB,
        },
        { signal: abortControllerRef.current.signal }
      );

      setConversation((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", text: data?.answer || "No response." };
        return u;
      });

      const hres = await axios.get(`${(API_URL || "").replace(/\/$/, "")}/api/chat_history`, {
        params: { user: userEmail, db: selectedDB },
      });
      setHistory((hres.data || []).map((i) => ({ question: i.question, answer: i.answer, pinned: !!i.pinned })));
    } catch (err) {
      const canceled = axios.isCancel?.(err) || err?.name === "CanceledError";
      setConversation((prev) => {
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
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    lastUser?.text && askQuestion(lastUser.text, { forceNoCache: true });
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied");
      setTimeout(() => setCopyFeedback(""), 1200);
    } catch {}
  };

  const loadHistoryItem = (idx) => {
    const item = filteredHistory[idx];
    if (!item) return;
    setConversation([
      { role: "user", text: item.question },
      { role: "assistant", text: item.answer },
    ]);
  };

  const deleteHistoryItem = async (idx) => {
    const item = filteredHistory[idx];
    if (!item) return;
    if (!window.confirm("Delete this entry?")) return;
    try {
      await axios.delete(`${(API_URL || "").replace(/\/$/, "")}/api/delete-history`, {
        data: { user: userEmail, db: selectedDB, question: item.question },
      });
      setHistory((prev) =>
        prev.filter((h) => !(h.question === item.question && h.answer === item.answer))
      );
    } catch {}
  };

  // ---------- Resizable history panel ----------
  const onMouseDown = (e) => {
    e.preventDefault();
    resizingRef.current = true;
  };
  const onMouseMove = useCallback((e) => {
    if (!resizingRef.current || !containerRef.current) return;
    const right = containerRef.current.getBoundingClientRect().right;
    setHistoryW(clamp(right - e.clientX, 240, 520));
  }, []);
  const onMouseUp = () => {
    resizingRef.current = false;
  };
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
      {/* Header */}
      <header className="askai-h">
        <div className="askai-hl">
          <select
            className="askai-db"
            value={selectedDB ?? ""}
            onChange={(e) => setDB(e.target.value)}
            aria-label="Database"
          >
            <option value="" disabled>
              Select database…
            </option>
            {(Array.isArray(availableDBs) ? availableDBs : []).map((db) => (
              <option key={db} value={db}>
                {formatDatabaseName(String(db))}
              </option>
            ))}
          </select>

          {/* tiny visible counter; remove when done debugging */}
          <small style={{ marginLeft: 8, color: "var(--text-muted)" }}>
            {Array.isArray(availableDBs) ? availableDBs.length : 0} dbs
            {dbErr ? ` • ${dbErr}` : ""}
          </small>
        </div>

        <div className="askai-hr">
          <button
            className={`askai-toggle ${useWeb ? "on" : ""}`}
            onClick={() => setUseWeb(!useWeb)}
            title="Web"
          >
            <FaGlobe />
          </button>
          <button
            className={`askai-toggle ${useCache ? "on" : ""}`}
            onClick={() => setUseCache(!useCache)}
            title="Cache"
          >
            <FaBolt />
          </button>
          <button className="askai-icon" onClick={() => setConversation([])} title="New">
            <FaUndo />
          </button>
          <button
            className="askai-icon"
            onClick={() => {
              if (conversation.length === 0) return;
              const lines = conversation.map((m) =>
                (m.role === "user" ? "### You\n\n" : "### Assistant\n\n") + (m.text || "") + "\n"
              );
              const md = `# ${formatDatabaseName(selectedDB || "Chat")} – Export\n\n${new Date().toLocaleString()}\n\n---\n\n${lines.join(
                "\n"
              )}`;
              const blob = new Blob([md], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `chat_${Date.now()}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title="Export"
          >
            <FaDownload />
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="askai-main">
        {/* Chat */}
        <section className="askai-chat">
          <div className="askai-msgs" ref={chatScrollRef}>
            {conversation.length === 0 ? (
              <div className="askai-empty">
                <p>Ask about {selectedDB ? formatDatabaseName(selectedDB) : "your data"}…</p>
              </div>
            ) : (
              conversation.map((m, i) => (
                <div key={i} className={m.role === "user" ? "msg msg-u" : "msg msg-a"}>
                  {m.role === "assistant" && !m.loading && (
                    <div className="msg-actions">
                      <button
                        className="askai-icon"
                        onClick={() => copyToClipboard(m.text)}
                        title="Copy"
                      >
                        <FaCopy />
                      </button>
                      <button
                        className="askai-icon"
                        onClick={regenerate}
                        title="Regenerate"
                        disabled={loading}
                      >
                        <FaBolt />
                      </button>
                    </div>
                  )}
                  {m.loading ? (
                    <div className="askai-thinking">
                      <span>Thinking…</span>
                    </div>
                  ) : (
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  )}
                </div>
              ))
            )}
          </div>

          <form className="askai-input" onSubmit={(e) => handleSubmit(e)}>
            <textarea
              ref={inputRef}
              rows={1}
              className="askai-text"
              placeholder={
                selectedDB
                  ? `Ask about ${formatDatabaseName(selectedDB)}…`
                  : "Pick a database to ask…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              disabled={!selectedDB || loading}
            />
            {loading ? (
              <button
                type="button"
                className="askai-send stop"
                onClick={stopRequest}
                title="Stop"
              >
                <FaTimes />
              </button>
            ) : (
              <button
                type="submit"
                className="askai-send"
                disabled={!selectedDB || !query.trim()}
                title="Send"
              >
                <FaPaperPlane />
              </button>
            )}
            {copyFeedback && <div className="askai-toast">{copyFeedback}</div>}
          </form>
        </section>

        {/* Handle */}
        <div
          className="askai-handle"
          onMouseDown={onMouseDown}
          title="Drag"
          aria-label="Resize history"
        />

        {/* History */}
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
                    <div className="h-a">
                      {(() => {
                        const plain = stripMarkdown(item.answer);
                        const preview = plain.slice(0, 110);
                        return preview + (plain.length > 110 ? "…" : "");
                      })()}
                    </div>
                    <div className="h-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="askai-icon"
                        title={item.pinned ? "Unpin" : "Pin"}
                        onClick={() => {
                          setHistory((prev) =>
                            prev.map((h) =>
                              h.question === item.question && h.answer === item.answer
                                ? { ...h, pinned: !h.pinned }
                                : h
                            )
                          );
                        }}
                      >
                        {item.pinned ? <FaStar /> : <FaRegStar />}
                      </button>
                      <button
                        className="askai-icon danger"
                        title="Delete"
                        onClick={() => deleteHistoryItem(idx)}
                      >
                        <FaTrash />
                      </button>
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
