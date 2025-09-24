import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import { useMsal } from "@azure/msal-react";
import {
  FaPaperPlane,
  FaGlobe,
  FaBolt,
  FaSync,
  FaTimes,
  FaCopy,
  FaRobot,
  FaTrash,
  FaStar,
  FaRegStar,
  FaDownload,
  FaUndo,
  FaSearch,
  FaEdit,
  FaHistory,
  FaPlusCircle,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/AskAI.css";

/* ---------------------------
   Small helpers
---------------------------- */
function formatDatabaseName(dbName = "") {
  return dbName
    .replace(/\.db$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/* ---------------------------
   Component
---------------------------- */
export default function AskAI({ selectedDB, setSelectedDB }) {
  const { accounts } = useMsal();
  const userEmail = accounts?.[0]?.username || "guest";

  // Core state
  const [availableDBs, setAvailableDBs] = useState([]);
  const [history, setHistory] = useState([]); // [{question, answer, pinned?}]
  const [conversation, setConversation] = useState([]); // [{role:'user'|'assistant', text, loading?}]
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Settings
  const [useWeb, setUseWeb] = useState(false);
  const [useCache, setUseCache] = useState(true);

  // UI
  const [copyFeedback, setCopyFeedback] = useState("");
  const [showAllFaqs, setShowAllFaqs] = useState(false);
  const [editingLast, setEditingLast] = useState(false);
  const [lastUserEdit, setLastUserEdit] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");

  // Resizable history panel
  const [historyW, setHistoryW] = useState(320);
  const resizingRef = useRef(false);
  const containerRef = useRef(null);

  // Refs
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Scroll-to-bottom affordance
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // FAQ questions by database
  const faqQuestions = useMemo(
    () => ({
      "employee_handbook.db": [
        "What is the company's PTO policy?",
        "How do I request sick leave?",
        "Where can I find employee benefits information?",
        "What is the dress code policy?",
        "How do I submit my timesheet?",
        "What are the working hours and break policies?",
        "How do I report a workplace issue?",
        "What are the overtime pay policies?",
        "What holidays does the company observe?",
        "Where is the employee code of conduct?",
        "How do I change my health insurance plan?",
      ],
      esop: [
        "What is the ESOP plan?",
        "Who is eligible for the ESOP?",
        "When do ESOP shares vest?",
        "How is the ESOP payout calculated?",
        "Can I cash out my ESOP early?",
        "What happens to my ESOP when I leave?",
        "Where can I read more about ESOP rules?",
      ],
      "401k.db": [
        "What is a 401(k) plan?",
        "When can I start contributing?",
        "What is the company match?",
        "How do I change my contribution amount?",
        "What investment options are available?",
        "When can I withdraw from my 401(k)?",
        "What happens if I leave the company?",
      ],
    }),
    []
  );

  const currentFaqs = faqQuestions[selectedDB] || [];

  /* ---------------------------
     Load Databases
  ---------------------------- */
  useEffect(() => {
    const loadDatabases = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/list-dbs`);
        const filtered = (response.data.dbs || []).filter(
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
        if (!selectedDB && filtered.length > 0) {
          setSelectedDB(filtered[0]);
        }
      } catch (error) {
        console.error("Failed to load databases:", error);
        setAvailableDBs([]);
      }
    };
    loadDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------
     Load History on DB change
  ---------------------------- */
  useEffect(() => {
    if (!selectedDB) return;
    setConversation([]);
    setEditingLast(false);
    setLastUserEdit("");

    const loadHistory = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/chat_history`, {
          params: { user: userEmail, db: selectedDB },
        });
        // Support pinned flag if backend ever adds it (defaults false)
        const historyData = (response.data || []).map((item) => ({
          question: item.question,
          answer: item.answer,
          pinned: !!item.pinned,
        }));
        setHistory(historyData);
      } catch (error) {
        console.error("Failed to load history:", error);
        setHistory([]);
      }
    };
    loadHistory();
  }, [selectedDB, userEmail]);

  /* ---------------------------
     Autoscroll chat
  ---------------------------- */
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;

    // Only autoscroll if user is near the bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [conversation]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      setShowScrollToBottom(!atBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  /* ---------------------------
     Keyboard shortcuts
  ---------------------------- */
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Focus input
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      // New chat
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        clearChat();
      }
      // Export
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        exportConversation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ---------------------------
     Ask a question
  ---------------------------- */
  const askQuestion = async (questionText, options = {}) => {
    if (!selectedDB) {
      alert("Please select a database first.");
      return;
    }
    if (!questionText.trim()) return;

    setLoading(true);
    setConversation((prev) => [
      ...prev,
      { role: "user", text: questionText },
      { role: "assistant", text: "", loading: true },
    ]);

    try {
      abortControllerRef.current = new AbortController();

      const response = await axios.post(
        `${API_URL}/api/question`,
        {
          query: questionText,
          user: userEmail,
          use_cache: options.forceNoCache ? false : useCache,
          use_web: useWeb,
          db: selectedDB,
        },
        { signal: abortControllerRef.current.signal }
      );

      setConversation((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          text: response.data?.answer || "No response received.",
        };
        return updated;
      });

      // Refresh history
      const historyResponse = await axios.get(`${API_URL}/api/chat_history`, {
        params: { user: userEmail, db: selectedDB },
      });
      const historyData = (historyResponse.data || []).map((item) => ({
        question: item.question,
        answer: item.answer,
        pinned: !!item.pinned,
      }));
      setHistory(historyData);
    } catch (error) {
      const isCanceled =
        axios.isCancel?.(error) || error?.name === "CanceledError";

      setConversation((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          text: isCanceled
            ? "⏹️ Request stopped."
            : "❌ Failed to get response. Please try again.",
        };
        return updated;
      });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      setEditingLast(false);
      setLastUserEdit("");
    }
  };

  const handleSubmit = (event, customQuery) => {
    event.preventDefault();
    const questionText = customQuery ?? query;
    if (!questionText.trim()) return;
    setQuery("");
    askQuestion(questionText);
  };

  /* ---------------------------
     Controls
  ---------------------------- */
  const stopRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const regenerateResponse = () => {
    const lastUserMessage = [...conversation]
      .reverse()
      .find((msg) => msg.role === "user");
    if (lastUserMessage?.text) {
      askQuestion(lastUserMessage.text, { forceNoCache: true });
    }
  };

  const editLastUser = () => {
    const lastUserMessage = [...conversation]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMessage) return;
    setEditingLast(true);
    setLastUserEdit(lastUserMessage.text);
    inputRef.current?.focus();
  };

  const applyLastUserEdit = () => {
    if (!lastUserEdit.trim()) return;
    // Trim conversation to before last user message
    let idx = -1;
    for (let i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      setConversation(conversation.slice(0, idx));
      askQuestion(lastUserEdit, { forceNoCache: true });
      setEditingLast(false);
      setLastUserEdit("");
    }
  };

  const clearChat = () => {
    setConversation([]);
    setEditingLast(false);
    setLastUserEdit("");
  };

  const exportConversation = () => {
    if (conversation.length === 0) return;
    const lines = conversation.map((m) =>
      m.role === "user"
        ? `### 🙋 ${formatDatabaseName(selectedDB)} — You\n\n${m.text}\n`
        : `### 🤖 Assistant\n\n${m.text}\n`
    );
    const md = `# ${formatDatabaseName(selectedDB)} – Chat Export\n\n${new Date().toLocaleString()}\n\n---\n\n${lines.join(
      "\n"
    )}`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat_${formatDatabaseName(selectedDB)}_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(""), 1800);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  /* ---------------------------
     History helpers
  ---------------------------- */
  const filteredHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.question.toLowerCase().includes(q) ||
        h.answer.toLowerCase().includes(q)
    );
  }, [history, historyFilter]);

  const loadHistoryItem = (index) => {
    const item = filteredHistory[index];
    if (!item) return;
    setConversation([
      { role: "user", text: item.question },
      { role: "assistant", text: item.answer },
    ]);
    scrollToBottom();
  };

  const deleteHistoryItem = async (absoluteIndex) => {
    // absoluteIndex is index in filteredHistory; map back to original
    const item = filteredHistory[absoluteIndex];
    if (!item) return;
    if (!window.confirm("Delete this conversation from history?")) return;
    try {
      await axios.delete(`${API_URL}/api/delete-history`, {
        data: { user: userEmail, db: selectedDB, question: item.question },
      });
      setHistory((prev) =>
        prev.filter((h) => !(h.question === item.question && h.answer === item.answer))
      );
    } catch (error) {
      console.error("Failed to delete history item:", error);
      alert("Failed to delete history item.");
    }
  };

  const togglePinHistoryItem = (absoluteIndex) => {
    const item = filteredHistory[absoluteIndex];
    if (!item) return;
    setHistory((prev) =>
      prev.map((h) =>
        h.question === item.question && h.answer === item.answer
          ? { ...h, pinned: !h.pinned }
          : h
      )
    );
    // Optionally sync to backend later when the API supports it
  };

  /* ---------------------------
     Input autogrow
  ---------------------------- */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [query, editingLast, lastUserEdit]);

  /* ---------------------------
     Resizable History Panel
  ---------------------------- */
  const onMouseDown = (e) => {
    e.preventDefault();
    resizingRef.current = true;
  };
  const onMouseMove = useCallback(
    (e) => {
      if (!resizingRef.current || !containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const rightEdge = bounds.right;
      const newWidth = clamp(rightEdge - e.clientX, 240, 560);
      setHistoryW(newWidth);
    },
    [setHistoryW]
  );
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
    <div className="ask-ai-chat" ref={containerRef}>
      {/* Header */}
      <div className="ask-ai-header">
        <div className="ask-ai-header-left">
          <h1 className="ask-ai-title">
            <FaRobot className="ask-ai-title-icon" />
            AI Assistant
          </h1>

          <div className="ask-ai-database-selector">
            <select
              className="ask-ai-database-select"
              value={selectedDB || ""}
              onChange={(e) => setSelectedDB(e.target.value)}
            >
              <option value="">Select Database</option>
              {availableDBs.map((db) => (
                <option key={db} value={db}>
                  {formatDatabaseName(db)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ask-ai-controls-right">
          <div className="ask-ai-settings">
            <button
              className={`ask-ai-setting-toggle ${useWeb ? "ask-ai-active" : ""}`}
              onClick={() => setUseWeb(!useWeb)}
              title="Enable web knowledge"
            >
              <FaGlobe className="ask-ai-setting-icon" />
              <span className="ask-ai-setting-label">Web</span>
            </button>

            <button
              className={`ask-ai-setting-toggle ${useCache ? "ask-ai-active" : ""}`}
              onClick={() => setUseCache(!useCache)}
              title="Use cached responses"
            >
              <FaBolt className="ask-ai-setting-icon" />
              <span className="ask-ai-setting-label">Cache</span>
            </button>
          </div>

          <div className="ask-ai-utility-buttons">
            <button
              className="ask-ai-utility-btn"
              onClick={clearChat}
              title="New chat (Ctrl/Cmd + N)"
            >
              <FaPlusCircle />
            </button>
            <button
              className="ask-ai-utility-btn"
              onClick={exportConversation}
              title="Export chat as Markdown (Ctrl/Cmd + E)"
            >
              <FaDownload />
            </button>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="ask-ai-statusbar">
        <div className="ask-ai-status-item">
          <span className="ask-ai-dot" />
          {selectedDB ? formatDatabaseName(selectedDB) : "No database selected"}
        </div>
        <div className="ask-ai-status-item">
          <FaGlobe />
          <span>{useWeb ? "Web: On" : "Web: Off"}</span>
        </div>
        <div className="ask-ai-status-item">
          <FaBolt />
          <span>{useCache ? "Cache: On" : "Cache: Off"}</span>
        </div>
      </div>

      <div className="ask-ai-main">
        {/* Chat Panel */}
        <div className="ask-ai-chat-panel">
          {/* FAQ / Quick chips */}
          {currentFaqs.length > 0 && (
            <div className="ask-ai-faq">
              <h3 className="ask-ai-faq-title">
                <FaStar />
                &nbsp;Suggested Questions
              </h3>
              <div className="ask-ai-faq-grid">
                {(showAllFaqs ? currentFaqs : currentFaqs.slice(0, 6)).map(
                  (faq, index) => (
                    <button
                      key={index}
                      className="ask-ai-faq-button"
                      onClick={(e) => handleSubmit(e, faq)}
                      title={faq}
                    >
                      {faq}
                    </button>
                  )
                )}
                {currentFaqs.length > 6 && (
                  <button
                    className="ask-ai-faq-button ask-ai-faq-toggle"
                    onClick={() => setShowAllFaqs(!showAllFaqs)}
                  >
                    {showAllFaqs
                      ? "Show Less ▲"
                      : `Show ${currentFaqs.length - 6} More ▼`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="ask-ai-chat-area">
            <div className="ask-ai-chat-messages" ref={chatScrollRef}>
              {conversation.length === 0 ? (
                <div className="ask-ai-empty-chat">
                  <FaRobot className="ask-ai-empty-icon" />
                  <h2 className="ask-ai-empty-title">Ready to Help</h2>
                  <p className="ask-ai-empty-description">
                    Ask me anything about{" "}
                    {selectedDB ? formatDatabaseName(selectedDB) : "your documents"}.
                    I can help you find information, explain policies, and answer questions.
                  </p>
                </div>
              ) : (
                conversation.map((message, index) => {
                  if (message.role === "user") {
                    const assistantMessage = conversation[index + 1];
                    return (
                      <div key={`pair-${index}`} className="ask-ai-message-pair">
                        <div className="ask-ai-user-message">
                          <ReactMarkdown>{message.text}</ReactMarkdown>
                        </div>

                        {assistantMessage && assistantMessage.role === "assistant" && (
                          <div className="ask-ai-assistant-message">
                            <div className="ask-ai-message-actions">
                              <button
                                className="ask-ai-message-action-btn"
                                onClick={() => copyToClipboard(assistantMessage.text)}
                                title="Copy response"
                              >
                                <FaCopy />
                              </button>
                              <button
                                className="ask-ai-message-action-btn"
                                onClick={regenerateResponse}
                                title="Regenerate last response"
                                disabled={loading}
                              >
                                <FaSync />
                              </button>
                              <button
                                className="ask-ai-message-action-btn"
                                onClick={editLastUser}
                                title="Edit your last question"
                                disabled={loading}
                              >
                                <FaEdit />
                              </button>
                            </div>

                            {assistantMessage.loading ? (
                              <div className="ask-ai-loading-message">
                                <FaRobot />
                                <span>Thinking</span>
                                <div className="ask-ai-loading-dots">
                                  <div className="ask-ai-loading-dot" />
                                  <div className="ask-ai-loading-dot" />
                                  <div className="ask-ai-loading-dot" />
                                </div>
                              </div>
                            ) : (
                              <div className="ask-ai-message-content">
                                <ReactMarkdown
                                  components={{
                                    a: ({ node, children, ...props }) => (
                                      <a
                                        {...props}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={props.href || "Link"}
                                      >
                                        {children}
                                      </a>
                                    ),
                                    code: ({ inline, className, children, ...props }) => {
                                      if (inline) {
                                        return <code {...props}>{children}</code>;
                                      }
                                      const text = String(children || "");
                                      const language =
                                        className?.replace("language-", "") || "";
                                      return (
                                        <div>
                                          <div className="ask-ai-code-block-header">
                                            <span className="ask-ai-code-language">
                                              {language || "code"}
                                            </span>
                                            <button
                                              className="ask-ai-message-action-btn"
                                              onClick={() => copyToClipboard(text)}
                                              title="Copy code"
                                            >
                                              <FaCopy />
                                            </button>
                                          </div>
                                          <pre>
                                            <code className={className} {...props}>
                                              {children}
                                            </code>
                                          </pre>
                                        </div>
                                      );
                                    },
                                  }}
                                >
                                  {assistantMessage.text}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                  return null;
                })
              )}
            </div>

            {/* Scroll-to-bottom */}
            {showScrollToBottom && (
              <button
                className="ask-ai-scroll-bottom"
                onClick={scrollToBottom}
                title="Scroll to bottom"
              >
                <FaChevronDownUI />
              </button>
            )}

            {/* Input Area */}
            <div className="ask-ai-input-area">
              <div className="ask-ai-input-container">
                <form onSubmit={(e) => handleSubmit(e)} className="ask-ai-input-form">
                  <div className="ask-ai-input-wrapper">
                    {!editingLast ? (
                      <textarea
                        ref={inputRef}
                        className="ask-ai-chat-input"
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
                        rows={1}
                        disabled={!selectedDB || loading}
                      />
                    ) : (
                      <div className="ask-ai-edit-last">
                        <textarea
                          ref={inputRef}
                          className="ask-ai-chat-input ask-ai-edit-input"
                          placeholder="Edit your last question…"
                          value={lastUserEdit}
                          onChange={(e) => setLastUserEdit(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              applyLastUserEdit();
                            }
                          }}
                          rows={1}
                          disabled={loading}
                        />
                        <div className="ask-ai-edit-actions">
                          <button
                            type="button"
                            className="ask-ai-edit-btn"
                            onClick={() => {
                              setEditingLast(false);
                              setLastUserEdit("");
                            }}
                            title="Cancel edit"
                          >
                            <FaUndo />
                          </button>
                          <button
                            type="button"
                            className="ask-ai-edit-btn ask-ai-primary"
                            onClick={applyLastUserEdit}
                            title="Apply edit & resend"
                            disabled={!lastUserEdit.trim() || loading}
                          >
                            <FaPaperPlane />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="ask-ai-input-actions">
                      {loading ? (
                        <button
                          type="button"
                          className="ask-ai-input-action-btn"
                          onClick={stopRequest}
                          title="Stop generation"
                        >
                          <FaTimes />
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ask-ai-input-action-btn"
                            onClick={regenerateResponse}
                            title="Regenerate last response"
                            disabled={!conversation.some((m) => m.role === "user")}
                          >
                            <FaSync />
                          </button>
                          <button
                            type="submit"
                            className="ask-ai-input-action-btn ask-ai-primary"
                            disabled={!selectedDB || !query.trim()}
                            title="Send message"
                          >
                            <FaPaperPlane />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </form>

                {copyFeedback && (
                  <div className="ask-ai-copy-feedback">{copyFeedback}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="ask-ai-resize-handle"
          onMouseDown={onMouseDown}
          title="Drag to resize history"
        >
          <span />
        </div>

        {/* History Panel */}
        <div className="ask-ai-history-panel" style={{ width: historyW }}>
          <div className="ask-ai-history-header">
            <div className="ask-ai-history-header-title">
              <FaHistory />
              <div>
                <h3 className="ask-ai-history-title">Chat History</h3>
                <p className="ask-ai-history-subtitle">
                  {selectedDB ? formatDatabaseName(selectedDB) : "Select a database"}
                </p>
              </div>
            </div>
            <div className="ask-ai-history-search">
              <FaSearch />
              <input
                type="search"
                placeholder="Search history…"
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="ask-ai-history-list">
            {filteredHistory.length === 0 ? (
              <div className="ask-ai-empty-history">
                <p>No chat history yet.</p>
                <p>Start a conversation to see it here.</p>
              </div>
            ) : (
              filteredHistory
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                .map((item, idx) => (
                  <div
                    key={`${item.question}-${idx}`}
                    className="ask-ai-history-item"
                    onClick={() => loadHistoryItem(idx)}
                    title="Click to load conversation"
                  >
                    <div className="ask-ai-history-question">{item.question}</div>
                    <div className="ask-ai-history-preview">
                      {item.answer.slice(0, 120)}
                      {item.answer.length > 120 ? "…" : ""}
                    </div>

                    <div className="ask-ai-history-actions">
                      <button
                        className="ask-ai-history-pin-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinHistoryItem(idx);
                        }}
                        title={item.pinned ? "Unpin" : "Pin"}
                      >
                        {item.pinned ? <FaStar /> : <FaRegStar />}
                      </button>
                      <button
                        className="ask-ai-history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteHistoryItem(idx);
                        }}
                        title="Delete from history"
                      >
                        <FaTrash />
                      </button>
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

/* A tiny icon component to keep the button centered */
function FaChevronDownUI() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 10l5 5 5-5H7z"></path>
    </svg>
  );
}
