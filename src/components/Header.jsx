import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaPlus,
  FaBell,
  FaChevronDown,
  FaSignOutAlt,
  FaSignInAlt,
  FaCopy,
  FaCheckCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaCog,
  FaHome,
  FaBars,
  FaTimes,
  FaSearch,           // NEW
  FaCommentDots,      // NEW
  FaPaperPlane,       // NEW
  FaStar,             // NEW
  FaRegStar           // NEW
} from "react-icons/fa";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom"; // NEW
import "../styles/Header.css";
import axios from "axios";
import API_URL from "../config";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import homepageCards from "./HomePageCards";

function initialsFromEmailOrName(email, name) {
  if (name && typeof name === "string") {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (!email) return "??";
  const handle = email.split("@")[0] || "";
  const chunks = handle.replace(/[._-]+/g, " ").split(" ");
  if (chunks.length >= 2) return (chunks[0][0] + chunks[1][0]).toUpperCase();
  return handle.slice(0, 2).toUpperCase();
}

export default function Header() {
  const isAuthed = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const location = useLocation();
  const navigate = useNavigate(); // NEW

  const userEmail =
    accounts?.[0]?.username ||
    accounts?.[0]?.idTokenClaims?.preferred_username ||
    "";
  const displayName =
    accounts?.[0]?.idTokenClaims?.name ||
    accounts?.[0]?.idTokenClaims?.given_name ||
    "";
  const userInitials = initialsFromEmailOrName(userEmail, displayName);

  const [apiHealthy, setApiHealthy] = useState("unknown");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [subnavOpen, setSubnavOpen] = useState(null);

  // NEW: header search + feedback state
  const [searchText, setSearchText] = useState(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("search") || "";
    } catch { return ""; }
  });
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  const headerRef = useRef(null);
  const searchDebounceRef = useRef(null); // debounce timer

  useEffect(() => {
    if (userEmail) {
      axios.defaults.headers.common["X-User"] = userEmail;
    } else {
      delete axios.defaults.headers.common["X-User"];
    }
  }, [userEmail]);

  const ENV =
    (import.meta && import.meta.env && import.meta.env.VITE_APP_ENV) ||
    process.env.NODE_ENV ||
    "development";

  const pingApi = async () => {
    try {
      await axios.get(`${API_URL}/api/core-boxes/_debug`, { timeout: 4000 });
      setApiHealthy("ok");
    } catch {
      setApiHealthy("down");
    }
  };

  useEffect(() => {
    pingApi();
    const interval = setInterval(pingApi, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setOpenDropdown(null);
    setSubnavOpen(null); // close bottom menus on route change
  }, [location.pathname]);

  useEffect(() => {
    const onSidebarChanged = (e) => {
      const isOpen = !!e?.detail?.open;
      setSidebarOpen(isOpen);
    };
    window.addEventListener("geolabs:sidebarChanged", onSidebarChanged);
    return () => window.removeEventListener("geolabs:sidebarChanged", onSidebarChanged);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        setOpenDropdown(null);
        setSubnavOpen(null); // NEW: close bottom-row menus when clicking outside
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpenDropdown(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSignIn = async () => {
    try {
      await instance.loginPopup({ scopes: ["User.Read"], prompt: "select_account" });
    } catch (error) {
      console.error("Login failed:", error);
    }
  };
  const handleSignOut = async () => {
    try {
      await instance.logoutPopup({ account: accounts[0] });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(userEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const apiStatusPill = useMemo(() => {
    if (apiHealthy === "ok") {
      return (
        <div className="header-status-pill header-api-ok">
          <FaCheckCircle />
          <span>Online</span>
        </div>
      );
    }
    if (apiHealthy === "down") {
      return (
        <div className="header-status-pill header-api-error">
          <FaExclamationTriangle />
          <span>Offline</span>
        </div>
      );
    }
    return (
      <div className="header-status-pill">
        <span>Checking…</span>
      </div>
    );
  }, [apiHealthy]);

  const toggleSidebar = () => {
    window.dispatchEvent(new CustomEvent("geolabs:toggleSidebar", { detail: "toggle" }));
    setSidebarOpen((prev) => !prev);
  };

  // Build bottom-row items from homepageCards
  const tabs = useMemo(() => {
    const src = Array.isArray(homepageCards) ? homepageCards : [];
    const primary = src.filter((c) => c?.header?.asTab);
    const list = primary.length ? primary : src; // fallback: all cards
    return list
      .filter((c) => c && ((c.subpages && c.subpages.length) || c.path)) // must have menu or direct path
      .sort((a, b) => (a.header?.order ?? 0) - (b.header?.order ?? 0));
  }, []);

  const activeTab = useMemo(() => {
    const path = location.pathname || "/";
    const hit =
      tabs.find((card) =>
        (card.subpages || []).some((sp) => path === sp.path || path.startsWith(sp.path + "/"))
      ) || null;
    if (hit) return hit;
    if (path === "/" && tabs.length) return null; // dashboard selected
    return null;
  }, [location.pathname, tabs]);

  // Keep header input in sync with URL ?search
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      setSearchText(params.get("search") || "");
    } catch {}
  }, [location.search]);

  // Clear debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // NEW: update URL while typing (debounced)
  const onHeaderSearchChange = (e) => {
    const q = e.target.value;
    setSearchText(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      navigate(q ? `/?search=${encodeURIComponent(q)}` : "/");
    }, 250);
  };

  // NEW: also allow Enter for immediate go
  const onHeaderSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      const q = (searchText || "").trim();
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      navigate(q ? `/?search=${encodeURIComponent(q)}` : "/");
      setOpenDropdown(null);
    }
  };

  // NEW: send feedback
  const sendFeedback = async () => {
    if (!feedbackText.trim() && feedbackRating === 0) return;
    setFeedbackSending(true);
    setFeedbackError("");
    try {
      await axios.post(`${API_URL}/api/feedback`, {
        message: feedbackText.trim(),
        rating: feedbackRating,
        email: userEmail || null,
        path: location.pathname,
        ts: new Date().toISOString()
      });
      setFeedbackSent(true);
      setFeedbackText("");
      setFeedbackRating(0);
      setTimeout(() => {
        setFeedbackSent(false);
        setOpenDropdown(null);
      }, 1500);
    } catch (err) {
      // fallback: open mailto
      const subject = `Geolabs feedback (${feedbackRating}/5)`;
      const body = `From: ${displayName || userEmail || "Anonymous"}\nPath: ${location.pathname}\nRating: ${feedbackRating}/5\n\n${feedbackText}`;
      try {
        window.location.href = `mailto:tyamashita@geolabs-software.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        setOpenDropdown(null);
      } catch {
          setFeedbackError("Could not send. Please email tyamashita@geolabs-software.com.");
        }
    } finally {
      setFeedbackSending(false);
    }
  };

  return (
    <header className="header" ref={headerRef}>
      <div className="header-top">
        {/* LEFT: brand */}
        <div className="header-left">
          <Link to="/" className="header-brand header-no-wrap" title="Geolabs, Inc.">
            <img src="/geolabs.png" alt="Geolabs" className="header-logo" />
            <span className="header-brand-name">Geolabs, Inc.</span>
          </Link>
        </div>

        {/* NEW: CENTER — header search */}
        <div className="header-center">
          <div className="header-searchbar">
            <FaSearch className="header-searchbar-icon" />
            <input
              className="header-searchbar-input"
              type="search"
              placeholder="Search tools, documents, and features…"
              value={searchText}
              onChange={onHeaderSearchChange}
              onKeyDown={onHeaderSearchKeyDown}
              onFocus={() => {
                // ensure results show live even when not on home
                const q = (searchText || "").trim();
                if (location.pathname !== "/") {
                  navigate(q ? `/?search=${encodeURIComponent(q)}` : "/");
                }
              }}
              aria-label="Search"
            />
          </div>
        </div>

        {/* RIGHT: env + api status + actions/profile */}
        <div className="header-right">
          <div className="header-status">
            <div className="header-status-pill header-env"><span>{ENV}</span></div>
            {apiStatusPill}
          </div>

          <div className="header-actions">
            {/* New */}
            <div className="header-profile-menu">
              <button
                className="header-action-btn"
                onClick={() => setOpenDropdown(openDropdown === "new" ? null : "new")}
                aria-expanded={openDropdown === "new"}
                aria-haspopup="menu"
                title="Create"
              >
                <FaPlus />
              </button>
              {openDropdown === "new" && (
                <div className="header-dropdown-menu">
                  <Link to="/db-admin" className="header-dropdown-item">
                    <FaPlus /><span>Upload Documents</span>
                  </Link>
                  <Link to="/s3-admin" className="header-dropdown-item">
                    <FaPlus /><span>Upload to S3</span>
                  </Link>
                  <Link to="/core-box-inventory" className="header-dropdown-item">
                    <FaPlus /><span>Add Core Box</span>
                  </Link>
                </div>
              )}
            </div>

            {/* Notifications */}
            <div className="header-profile-menu">
              <button
                className="header-action-btn"
                onClick={() => setOpenDropdown(openDropdown === "notifications" ? null : "notifications")}
                aria-expanded={openDropdown === "notifications"}
                aria-haspopup="menu"
                title="Notifications"
              >
                <FaBell />
                <span className="header-notification-badge" />
              </button>
              {openDropdown === "notifications" && (
                <div className="header-dropdown-menu">
                  <div className="header-dropdown-header">
                    <div className="header-dropdown-user-name">Notifications</div>
                    <div className="header-dropdown-user-email">No new alerts</div>
                  </div>
                  <div className="header-dropdown-item">
                    <FaCheckCircle /><span>All caught up</span>
                  </div>
                </div>
              )}
            </div>

            {/* NEW: Feedback */}
            <div className="header-profile-menu">
              <button
                className="header-action-btn"
                onClick={() => setOpenDropdown(openDropdown === "feedback" ? null : "feedback")}
                aria-expanded={openDropdown === "feedback"}
                aria-haspopup="dialog"
                title="Send feedback"
              >
                <FaCommentDots />
              </button>
              {openDropdown === "feedback" && (
                <div className="header-dropdown-menu header-feedback-menu" role="dialog" aria-label="Feedback form">
                  <div className="header-dropdown-header header-feedback-header">
                    <div className="header-dropdown-user-name">Send feedback</div>
                    <div className="header-dropdown-user-email">{displayName || userEmail || "Anonymous"}</div>
                  </div>
                  <div className="header-feedback-stars" aria-label={`Rating: ${feedbackRating} out of 5`}>
                    {[1,2,3,4,5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`header-star ${feedbackRating >= n ? "on" : ""}`}
                        onClick={() => setFeedbackRating(n)}
                        aria-label={`${n} star${n>1?"s":""}`}
                      >
                        {feedbackRating >= n ? <FaStar /> : <FaRegStar />}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="header-feedback-textarea"
                    rows={4}
                    placeholder="What’s working well? What could be better?"
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                  />
                  {feedbackError && <div className="header-feedback-error">{feedbackError}</div>}
                  {feedbackSent && <div className="header-feedback-success">Thanks for the feedback!</div>}
                  <div className="header-feedback-actions">
                    <button
                      className="header-feedback-btn"
                      onClick={sendFeedback}
                      disabled={feedbackSending || (!feedbackText.trim() && feedbackRating === 0)}
                    >
                      <FaPaperPlane />
                      {feedbackSending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Profile */}
            <div className="header-profile-menu">
              <button
                className="header-profile-trigger"
                onClick={() => setOpenDropdown(openDropdown === "profile" ? null : "profile")}
                aria-expanded={openDropdown === "profile"}
                aria-haspopup="menu"
                title="Profile"
              >
                <div className="header-profile-avatar">{userInitials}</div>
                <FaChevronDown className="header-profile-chevron" />
              </button>

              {openDropdown === "profile" && (
                <div className="header-dropdown-menu">
                  {isAuthed ? (
                    <>
                      <div className="header-dropdown-header">
                        <div className="header-dropdown-user-name">{displayName || userEmail}</div>
                        <div className="header-dropdown-user-email">{userEmail}</div>
                      </div>

                      <button className="header-dropdown-item" onClick={copyEmail}>
                        <FaCopy /><span>Copy Email</span>
                        {copied && <span className="header-copy-feedback">Copied!</span>}
                      </button>

                      <Link to="/admin" className="header-dropdown-item">
                        <FaCog /><span>Admin Settings</span>
                      </Link>

                      <a
                        href="https://myaccount.microsoft.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="header-dropdown-item"
                      >
                        <FaExternalLinkAlt /><span>Microsoft Account</span>
                      </a>

                      <div className="header-dropdown-divider" />

                      <button className="header-dropdown-item header-danger" onClick={handleSignOut}>
                        <FaSignOutAlt /><span>Sign Out</span>
                      </button>
                    </>
                  ) : (
                    <button className="header-dropdown-item" onClick={handleSignIn}>
                      <FaSignInAlt /><span>Sign In with Microsoft</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row — Home + nav groups */}
      <div className="header-bottom">
        <nav className="header-subnav" aria-label="Primary">
          {/* Dashboard link first */}
          <div className="header-subnav-item">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `header-subnav-link ${isActive ? "header-active" : ""}`
              }
              title="Home"
            >
              <FaHome size={12} />
              <span>Home</span>
            </NavLink>
          </div>

          {/* Group titles as triggers with caret; clicking text or caret opens menu */}
          {tabs.map((card) => {
            const hasMenu = (card.subpages || []).length > 0;
            const label = card.tabLabel || card.label;
            const tabIcon = card?.icon ? React.cloneElement(card.icon, { size: 12 }) : null;

            if (!hasMenu && card.path) {
              // simple link if no subpages
              return (
                <div key={card.label} className="header-subnav-item">
                  <NavLink
                    to={card.path}
                    className={({ isActive }) =>
                      `header-subnav-link ${isActive ? "header-active" : ""}`
                    }
                    title={card.description || label}
                  >
                    {tabIcon}
                    <span>{label}</span>
                  </NavLink>
                </div>
              );
            }

            const isCardActive = (card.subpages || []).some(
              (sp) => location.pathname === sp.path || location.pathname.startsWith(sp.path + "/")
            );
            const isOpen = subnavOpen === card.label;

            return (
              <div key={card.label} className="header-subnav-item">
                <button
                  className={`header-subnav-link header-subnav-trigger ${isCardActive ? "header-active" : ""}`}
                  onClick={() => setSubnavOpen(isOpen ? null : card.label)}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} options for ${label}`}
                >
                  {tabIcon}
                  <span>{label}</span>
                  <FaChevronDown className={`header-subnav-caret-icon ${isOpen ? "open" : ""}`} size={10} />
                </button>

                {isOpen && (
                  <div className="header-subnav-menu" role="menu">
                    {(card.subpages || []).map((sp) => {
                      const spIcon = sp?.icon ? React.cloneElement(sp.icon, { size: 12 }) : null;
                      return (
                        <NavLink
                          key={sp.path}
                          to={sp.path}
                          className="header-dropdown-item"
                          title={sp.description || sp.name}
                          onClick={() => setSubnavOpen(null)}
                          role="menuitem"
                        >
                          {spIcon}
                          <span>{sp.name}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
