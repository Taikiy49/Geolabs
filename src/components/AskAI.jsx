// src/components/AskAI.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import { useMsal } from "@azure/msal-react";
import {
  FaPaperPlane,
  FaDatabase,
  FaGlobe,
  FaBolt,
  FaSync,
  FaTimes,
  FaCopy,
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/AskAI.css";

function titleCaseDb(db = "") {
  return db
    .replace(/\.db$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AskAI({ selectedDB, setSelectedDB }) {
  const { accounts } = useMsal();
  const userEmail = accounts[0]?.username || "guest";

  // Data
  const [availableDBs, setAvailableDBs] = useState([]);
  const [history, setHistory] = useState([]);
  const [faqList, setFaqList] = useState([]);

  // Chat state
  const [conversation, setConversation] = useState([]);
  const [query, setQuery] = useState("");
  const [useWeb, setUseWeb] = useState(false);
  const [useCache, setUseCache] = useState(true);
  const [loading, setLoading] = useState(false);

  // UI state
  const [showAllFaqs, setShowAllFaqs] = useState(false);

  // Refs
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const ctrlRef = useRef(null);

  // Simple FAQ map
  const faqMap = useMemo(
    () => ({
      "employee_handbook.db": [
        "What is the company's PTO policy?",
        "How do I request sick leave?",
        "Where can I find the employee benefits information?",
        "What is the dress code?",
        "How do I submit my timesheet?",
        "What are the working hours and break policies?",
        "How do I report a workplace issue or concern?",
        "What are the company’s policies on overtime pay?",
        "What holidays does the company observe?",
        "Where can I find the employee code of conduct?",
        "How do I change my health insurance plan?",
      ],
      "esop.db": [
        "What is the ESOP plan?",
        "Who is eligible for the ESOP?",
        "When do ESOP shares vest?",
        "How is the ESOP payout calculated?",
        "Can I cash out my ESOP early?",
        "What happens to my ESOP when I leave the company?",
        "Where can I read more about the ESOP rules?",
      ],
      "401k.db": [
        "What is a 401(k) plan?",
        "When can I start contributing to my 401(k)?",
        "What is the company match for 401(k)?",
        "How do I change my 401(k) contribution amount?",
        "What investment options are available?",
        "When can I withdraw from my 401(k)?",
        "What happens to my 401(k) if I leave the company?",
      ],
    }),
    []
  );

  // Load DB list
  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/list-dbs`);
        const filtered = (res.data.dbs || []).filter(
          (db) =>
            ![
              "chat_history.db",
              "reports.db",
              "user_roles.db",
              "pr_data.db",
              "users.db",
            ].includes(db)
        );
        setAvailableDBs(filtered);
      } catch {
        setAvailableDBs([]);
      }
    };
    load();
  }, []);

  // FAQ by DB
  useEffect(() => {
    setFaqList(faqMap[selectedDB] || []);
  }, [selectedDB, faqMap]);

  // Load history when DB changes
  useEffect(() => {
    if (!selectedDB) return;
    setConversation([]);
    axios
      .get(`${API_URL}/api/chat_history`, {
        params: { user: userEmail, db: selectedDB },
      })
      .then((res) => {
        const raw = res.data || [];
        const pairs = raw.map((row) => ({
          question: row.question,
          answer: row.answer,
        }));
        setHistory(pairs);
      })
      .catch(() => setHistory([]));
  }, [selectedDB, userEmail]);

  // External event to load a pair into the chat (optional)
  useEffect(() => {
    const handleLoad = (e) => {
      const { question, answer } = e.detail || {};
      if (!question || !answer) return;
      setConversation([
        { role: "user", text: question },
        { role: "assistant", text: answer },
      ]);
    };
    window.addEventListener("loadChatHistory", handleLoad);
    return () => window.removeEventListener("loadChatHistory", handleLoad);
  }, []);

  // Auto-scroll on conversation update
  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [conversation]);

  // Shortcut: Cmd/Ctrl+K focuses input
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ask = async (inputQuery, { forceNoCache = false } = {}) => {
    setLoading(true);
    setConversation([
      { role: "user", text: inputQuery },
      { role: "assistant", text: "", loading: true },
    ]);
    try {
      ctrlRef.current = new AbortController();
      const res = await axios.post(
        `${API_URL}/api/question`,
        {
          query: inputQuery,
          user: userEmail,
          use_cache: forceNoCache ? false : useCache,
          use_web: useWeb,
          db: selectedDB,
        },
        { signal: ctrlRef.current.signal }
      );

      setConversation((prev) => {
        const up = [...prev];
        up[up.length - 1] = {
          role: "assistant",
          text: res.data?.answer || "",
        };
        return up;
      });

      const histRes = await axios.get(`${API_URL}/api/chat_history`, {
        params: { user: userEmail, db: selectedDB },
      });
      const pairs = (histRes.data || []).map((row) => ({
        question: row.question,
        answer: row.answer,
      }));
      setHistory(pairs);
    } catch (err) {
      const canceled =
        axios.isCancel?.(err) ||
        err?.name === "CanceledError" ||
        String(err?.message || "").includes("canceled");
      setConversation((prev) => {
        const up = [...prev];
        up[up.length - 1] = {
          role: "assistant",
          text: canceled ? "⏹️ Stopped." : "❌ Error: Failed to get a response.",
        };
        return up;
      });
    } finally {
      setLoading(false);
      ctrlRef.current = null;
    }
  };

  const stop = () => {
    try {
      ctrlRef.current?.abort();
    } catch {}
  };

  const regenerate = () => {
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    if (lastUser?.text) ask(lastUser.text, { forceNoCache: true });
  };

  const handleSubmit = (e, optionalQuery) => {
    e.preventDefault();
    const inputQuery = optionalQuery || query;
    if (!selectedDB) return;
    if (!inputQuery.trim()) return;
    setQuery("");
    ask(inputQuery);
  };

  const handleHistoryClick = (index) => {
    const item = history[index];
    if (!item) return;
    setConversation([
      { role: "user", text: item.question },
      { role: "assistant", text: item.answer },
    ]);
  };

  const deleteHistoryItem = async (index) => {
    const item = history[index];
    if (!item) return;
    try {
      await axios.delete(`${API_URL}/api/delete-history`, {
        data: { user: userEmail, db: selectedDB, question: item.question },
      });
      setHistory((prev) => prev.filter((_, i) => i !== index));
    } catch {
      alert("Failed to delete.");
    }
  };

  const copyText = async (t) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch {}
  };

  return (
    <div className="cc-container">
      <div className="cc-main">
        <div className="cc-topbar">
          <div className="cc-db-header">
            <FaDatabase className="cc-db-icon" />
            <select
              className="cc-db-select"
              value={selectedDB}
              onChange={(e) => setSelectedDB(e.target.value)}
              title="Choose a database"
            >
              <option value="">Select a DB</option>
              {availableDBs.map((db) => (
                <option key={db} value={db}>
                  {titleCaseDb(db)}
                </option>
              ))}
            </select>

            <div className="cc-toggles">
              <div
                className={`cc-icon-toggle ${useWeb ? "active" : ""}`}
                onClick={() => setUseWeb((v) => !v)}
                title="Allow general web knowledge"
              >
                <FaGlobe className="cc-icon-symbol" />
                <div className="cc-icon-label">Web</div>
              </div>
              <div
                className={`cc-icon-toggle ${useCache ? "active" : ""}`}
                onClick={() => setUseCache((v) => !v)}
                title="Use cached answers"
              >
                <FaBolt className="cc-icon-symbol" />
                <div className="cc-icon-label">Cache</div>
              </div>
            </div>
          </div>
        </div>

        <div className="cc-results-wrapper">
          {/* Chat Panel */}
          <div className="cc-chat-panel">
            {/* FAQ */}
            <div className="cc-faq-list">
              {(showAllFaqs ? faqList : faqList.slice(0, 4)).map((faq) => (
                <button
                  key={faq}
                  className="cc-faq-button"
                  onClick={(e) => handleSubmit(e, faq)}
                  title={faq}
                >
                  {faq}
                </button>
              ))}
              {faqList.length > 6 && (
                <button
                  className="cc-faq-button cc-faq-toggle"
                  onClick={() => setShowAllFaqs((v) => !v)}
                >
                  {showAllFaqs ? "Show Less ▲" : "Show More ▼"}
                </button>
              )} 
            </div> 
            {/* Chat scroll */}
            <div className="cc-chat-scroll" ref={chatScrollRef}>
              {conversation.map((item, i) => {
                if (item.role === "user") {
                  const answer = conversation[i + 1];
                  return (
                    <div key={`u-${i}`} className="cc-pair">
                      <div className="cc-user-bubble">
                        <ReactMarkdown>{item.text}</ReactMarkdown>
                      </div>
                      {answer && answer.role === "assistant" && (
                        <div className="cc-bot-bubble">
                          {answer.loading ? (
                            <span className="cc-loading-text">Thinking...</span>
                          ) : (
                            <>
                              <button
                                className="cc-mini-btn cc-mini-btn-right"
                                onClick={() => copyText(answer.text)}
                                title="Copy answer"
                              >
                                <FaCopy />
                              </button>
                              <ReactMarkdown
                                components={{
                                  a({ node, ...props }) {
                                    return (
                                      <a
                                        {...props}
                                        target="_blank"
                                        rel="noreferrer"
                                      />
                                    );
                                  },
                                  code({ inline, className, children, ...props }) {
                                    if (inline) {
                                      return (
                                        <code className="cc-code" {...props}>
                                          {children}
                                        </code>
                                      );
                                    }
                                    const text = String(children || "");
                                    return (
                                      <div className="cc-codeblock">
                                        <button
                                          className="cc-mini-btn cc-mini-btn-right"
                                          onClick={() => copyText(text)}
                                          title="Copy code"
                                        >
                                          <FaCopy />
                                        </button>
                                        <pre className="cc-pre">
                                          <code className={className} {...props}>
                                            {text}
                                          </code>
                                        </pre>
                                      </div>
                                    );
                                  },
                                }}
                              >
                                {answer.text}
                              </ReactMarkdown>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>

            {/* Composer */}
            <div className="cc-search-bar-bottom">
              <form
                onSubmit={handleSubmit}
                className="cc-composer"
                autoComplete="off"
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  className="cc-search-input cc-textarea"
                  placeholder={`Ask something from ${
                    selectedDB ? titleCaseDb(selectedDB) : "a database"
                  }…`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                {loading ? (
                  <button
                    type="button"
                    className="cc-search-button"
                    onClick={stop}
                    title="Stop"
                  >
                    <FaTimes />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="cc-search-button cc-alt"
                      onClick={regenerate}
                      title="Regenerate (no cache)"
                      disabled={
                        !conversation.some((m) => m.role === "user") || loading
                      }
                    >
                      <FaSync />
                    </button>
                    <button
                      type="submit"
                      className="cc-search-button"
                      disabled={loading}
                      title="Send"
                    >
                      <FaPaperPlane />
                    </button>
                  </>
                )}
              </form>
            </div>
          </div>

          {/* History Panel */}
          <div className="cc-history-panel">
            {history.map((item, index) => (
              <div
                key={index}
                className="cc-history-item"
                title={item.question}
                onClick={() => handleHistoryClick(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (window.confirm("Delete this entry from history?")) {
                    deleteHistoryItem(index);
                  }
                }}
              >
                {item.question}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
