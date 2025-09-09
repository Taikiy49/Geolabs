import React, { useEffect, useMemo, useRef, useState } from "react";
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
} from "react-icons/fa";
import API_URL from "../config";
import "../styles/AskAI.css";

function formatDatabaseName(dbName = "") {
  return dbName
    .replace(/\.db$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AskAI({ selectedDB, setSelectedDB }) {
  const { accounts } = useMsal();
  const userEmail = accounts[0]?.username || "guest";

  // Core state
  const [availableDBs, setAvailableDBs] = useState([]);
  const [history, setHistory] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Settings
  const [useWeb, setUseWeb] = useState(false);
  const [useCache, setUseCache] = useState(true);

  // UI state
  const [showAllFaqs, setShowAllFaqs] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");

  // Refs
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

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

  // Load available databases
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
  }, [selectedDB, setSelectedDB]);

  // Load chat history when database changes
  useEffect(() => {
    if (!selectedDB) return;

    setConversation([]);

    const loadHistory = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/chat_history`, {
          params: { user: userEmail, db: selectedDB },
        });
        const historyData = response.data || [];
        const formattedHistory = historyData.map((item) => ({
          question: item.question,
          answer: item.answer,
        }));
        setHistory(formattedHistory);
      } catch (error) {
        console.error("Failed to load history:", error);
        setHistory([]);
      }
    };

    loadHistory();
  }, [selectedDB, userEmail]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [conversation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const askQuestion = async (questionText, options = {}) => {
    if (!selectedDB) {
      alert("Please select a database first.");
      return;
    }

    if (!questionText.trim()) return;

    setLoading(true);
    setConversation([
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

      const historyResponse = await axios.get(`${API_URL}/api/chat_history`, {
        params: { user: userEmail, db: selectedDB },
      });
      const historyData = historyResponse.data || [];
      const formattedHistory = historyData.map((item) => ({
        question: item.question,
        answer: item.answer,
      }));
      setHistory(formattedHistory);
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
    }
  };

  const handleSubmit = (event, customQuery) => {
    event.preventDefault();
    const questionText = customQuery || query;
    if (!questionText.trim()) return;

    setQuery("");
    askQuestion(questionText);
  };

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

  const loadHistoryItem = (index) => {
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

    if (!window.confirm("Delete this conversation from history?")) return;

    try {
      await axios.delete(`${API_URL}/api/delete-history`, {
        data: { user: userEmail, db: selectedDB, question: item.question },
      });
      setHistory((prev) => prev.filter((_, i) => i !== index));
    } catch (error) {
      console.error("Failed to delete history item:", error);
      alert("Failed to delete history item.");
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(""), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <div className="ask-ai-chat">
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
              value={selectedDB}
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

        <div className="ask-ai-settings">
          <button
            className={`ask-ai-setting-toggle ${
              useWeb ? "ask-ai-active" : ""
            }`}
            onClick={() => setUseWeb(!useWeb)}
            title="Enable web knowledge"
          >
            <FaGlobe className="ask-ai-setting-icon" />
            <span className="ask-ai-setting-label">Web</span>
          </button>

          <button
            className={`ask-ai-setting-toggle ${
              useCache ? "ask-ai-active" : ""
            }`}
            onClick={() => setUseCache(!useCache)}
            title="Use cached responses"
          >
            <FaBolt className="ask-ai-setting-icon" />
            <span className="ask-ai-setting-label">Cache</span>
          </button>
        </div>
      </div>

      <div className="ask-ai-main">
        {/* Chat Panel */}
        <div className="ask-ai-chat-panel">
          {/* FAQ Section */}
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
                    {selectedDB
                      ? formatDatabaseName(selectedDB)
                      : "your documents"}
                    . I can help you find information, explain policies, and
                    answer questions.
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

                        {assistantMessage &&
                          assistantMessage.role === "assistant" && (
                            <div className="ask-ai-assistant-message">
                              <div className="ask-ai-message-actions">
                                <button
                                  className="ask-ai-message-action-btn"
                                  onClick={() =>
                                    copyToClipboard(assistantMessage.text)
                                  }
                                  title="Copy response"
                                >
                                  <FaCopy />
                                </button>
                              </div>

                              {assistantMessage.loading ? (
                                <div className="ask-ai-loading-message">
                                  <FaRobot />
                                  <span>Thinking</span>
                                  <div className="ask-ai-loading-dots">
                                    <div className="ask-ai-loading-dot"></div>
                                    <div className="ask-ai-loading-dot"></div>
                                    <div className="ask-ai-loading-dot"></div>
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
                                      code: ({
                                        inline,
                                        className,
                                        children,
                                        ...props
                                      }) => {
                                        if (inline) {
                                          return (
                                            <code {...props}>{children}</code>
                                          );
                                        }

                                        const text = String(children || "");
                                        const language =
                                          className?.replace(
                                            "language-",
                                            ""
                                          ) || "";

                                        return (
                                          <div>
                                            <div className="ask-ai-code-block-header">
                                              <span className="ask-ai-code-language">
                                                {language || "code"}
                                              </span>
                                              <button
                                                className="ask-ai-message-action-btn"
                                                onClick={() =>
                                                  copyToClipboard(text)
                                                }
                                                title="Copy code"
                                              >
                                                <FaCopy />
                                              </button>
                                            </div>
                                            <pre>
                                              <code
                                                className={className}
                                                {...props}
                                              >
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

            {/* Input Area */}
            <div className="ask-ai-input-area">
              <div className="ask-ai-input-container">
                <form onSubmit={handleSubmit} className="ask-ai-input-form">
                  <div className="ask-ai-input-wrapper">
                    <textarea
                      ref={inputRef}
                      className="ask-ai-chat-input"
                      placeholder={`Ask about ${
                        selectedDB
                          ? formatDatabaseName(selectedDB)
                          : "your documents"
                      }...`}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      rows={1}
                      disabled={!selectedDB}
                    />

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
                            disabled={
                              !conversation.some((msg) => msg.role === "user") ||
                              loading
                            }
                          >
                            <FaSync />
                          </button>
                          <button
                            type="submit"
                            className="ask-ai-input-action-btn ask-ai-primary"
                            disabled={!selectedDB || loading || !query.trim()}
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

        {/* History Panel */}
        <div className="ask-ai-history-panel">
          <div className="ask-ai-history-header">
            <h3 className="ask-ai-history-title">Chat History</h3>
            <p className="ask-ai-history-subtitle">
              {selectedDB ? formatDatabaseName(selectedDB) : "Select a database"}
            </p>
          </div>

          <div className="ask-ai-history-list">
            {history.length === 0 ? (
              <div className="ask-ai-empty-history">
                <p>No chat history yet.</p>
                <p>Start a conversation to see it here.</p>
              </div>
            ) : (
              history.map((item, index) => (
                <div
                  key={index}
                  className="ask-ai-history-item"
                  onClick={() => loadHistoryItem(index)}
                  title="Click to load conversation"
                >
                  <div className="ask-ai-history-question">{item.question}</div>
                  <div className="ask-ai-history-preview">
                    {item.answer.slice(0, 100)}
                    {item.answer.length > 100 ? "..." : ""}
                  </div>

                  <div className="ask-ai-history-actions">
                    <button
                      className="ask-ai-history-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteHistoryItem(index);
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
