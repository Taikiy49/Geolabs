import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaPlus,
  FaBell,
  FaUserCircle,
  FaChevronDown,
  FaSearch,
  FaSignOutAlt,
  FaSignInAlt,
  FaCopy,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import "../styles/Header.css";
import axios from "axios";
import API_URL from "../config";

import { useMsal, useIsAuthenticated } from "@azure/msal-react";

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
  const navigate = useNavigate();
  const location = useLocation();

  const userEmail =
    accounts?.[0]?.username ||
    accounts?.[0]?.idTokenClaims?.preferred_username ||
    "";
  const displayName =
    accounts?.[0]?.idTokenClaims?.name ||
    accounts?.[0]?.idTokenClaims?.given_name ||
    "";
  const userInitials = initialsFromEmailOrName(userEmail, displayName);

  // Set global header for API so backend can audit who did what
  useEffect(() => {
    if (userEmail) {
      axios.defaults.headers.common["X-User"] = userEmail;
    } else {
      delete axios.defaults.headers.common["X-User"];
    }
  }, [userEmail]);

  // ENV + API health
  const ENV =
    (import.meta && import.meta.env && import.meta.env.VITE_APP_ENV) ||
    process.env.NODE_ENV ||
    "development";

  const [apiHealthy, setApiHealthy] = useState("unknown"); // 'ok' | 'down' | 'unknown'
  const pingApi = async () => {
    try {
      // Lightweight debug endpoint you already have
      await axios.get(`${API_URL}/api/core-boxes/_debug`, { timeout: 4000 });
      setApiHealthy("ok");
    } catch {
      setApiHealthy("down");
    }
  };
  useEffect(() => {
    pingApi();
    const t = setInterval(pingApi, 60000);
    return () => clearInterval(t);
  }, []);

  // Search
  const searchRef = useRef(null);
  const [q, setQ] = useState("");
  const doSearch = () => {
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  // Menus
  const [openMenu, setOpenMenu] = useState(null); // 'profile' | 'new' | 'notif' | null
  const closeMenus = () => setOpenMenu(null);

  // Close menus on route change
  useEffect(() => {
    closeMenus();
  }, [location.pathname]);

  // Close on outside click
  const rootRef = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) closeMenus();
    }
    function onEsc(e) {
      if (e.key === "Escape") closeMenus();
      // Keyboard shortcut: focus search on "/"
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Quick nav: g o (OCR), g c (Core Boxes)
      if (e.key.toLowerCase() === "o" && (e.target.tagName || "").toLowerCase() !== "input" && e.ctrlKey) {
        navigate("/ocr");
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [navigate]);

  // Copy email toast
  const [copied, setCopied] = useState(false);
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(userEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  };

  const onSignIn = async () => {
    try {
      await instance.loginPopup({
        scopes: ["User.Read"],
        prompt: "select_account"
      });
    } catch (error) {
      console.error("Login failed:", error);
    }
  };
  
  const onSignOut = async () => {
    try {
      await instance.logoutPopup({
        account: accounts[0]
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const apiBadge = useMemo(() => {
    if (apiHealthy === "ok") return <span className="hdr-pill ok"><FaCheckCircle /> API</span>;
    if (apiHealthy === "down") return <span className="hdr-pill danger"><FaExclamationTriangle /> API</span>;
    return <span className="hdr-pill neutral">API</span>;
  }, [apiHealthy]);

  return (
    <header className="hdr" ref={rootRef}>
      {/* Left: Logo + Title */}
      <Link to="/" className="hdr-left" aria-label="Go to dashboard">
        <img src="/geolabs.png" alt="Geolabs logo" className="hdr-logo" />
        <span className="hdr-title">Geolabs, Inc.</span>
      </Link>

      {/* Right: Status + Actions + Profile */}
      <div className="hdr-right">
        <div className="hdr-right-pills">
          <span className="hdr-pill env" title={`Environment: ${ENV}`}>{String(ENV).toUpperCase()}</span>
          {apiBadge}
        </div>

        {/* New menu */}
        <div className="hdr-menu">
          <button
            className="hdr-iconbtn"
            title="New"
            onClick={() => setOpenMenu((m) => (m === "new" ? null : "new"))}
            type="button"
          >
            <FaPlus />
          </button>
          
        </div>

        {/* Notifications */}
        <div className="hdr-menu">
          <button
            className="hdr-iconbtn"
            title="Notifications"
            onClick={() => setOpenMenu((m) => (m === "notif" ? null : "notif"))}
            type="button"
          >
            <FaBell />
            {/* example badge; wire to real count later */}
            <span className="hdr-dot" aria-hidden="true" />
          </button>
          {openMenu === "notif" && (
            <div className="hdr-dropdown hdr-dropdown-wide">
              <div className="hdr-dd-empty">No new notifications.</div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="hdr-menu profile">
          <button
            className="hdr-profilebtn"
            onClick={() => setOpenMenu((m) => (m === "profile" ? null : "profile"))}
            aria-haspopup="menu"
            aria-expanded={openMenu === "profile"}
            type="button"
          >
            <div className="hdr-avatar" aria-hidden="true">
              <FaUserCircle className="hdr-avatar-fallback" />
              <span className="hdr-avatar-initials">{userInitials}</span>
            </div>
            <span className="hdr-email" title={userEmail || "Not signed in"}>
              {userEmail || "guest"}
            </span>
            <FaChevronDown className="hdr-caret" />
          </button>

          {openMenu === "profile" && (
            <div className="hdr-dropdown">
              {isAuthed ? (
                <>
                  <div className="hdr-dd-id">
                    <div className="hdr-dd-name" title={displayName || userEmail}>
                      {displayName || userEmail || "Signed in"}
                    </div>
                    <div className="hdr-dd-mail">{userEmail}</div>
                  </div>
                  <button className="hdr-dd-item" onClick={copyEmail}>
                    <FaCopy />
                    Copy email {copied && <span className="hdr-copied">Copied</span>}
                  </button>
                  <a
                    className="hdr-dd-item"
                    href="https://myaccount.microsoft.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Manage Microsoft Account
                  </a>
                  <button className="hdr-dd-item danger" onClick={onSignOut}>
                    <FaSignOutAlt />
                    Sign out
                  </button>
                </>
              ) : (
                <button className="hdr-dd-item" onClick={onSignIn}>
                  <FaSignInAlt />
                  Sign in with Microsoft
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
