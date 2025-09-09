import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaPlus,
  FaBell,
  FaChevronDown,
  FaSearch,
  FaSignOutAlt,
  FaSignInAlt,
  FaCopy,
  FaCheckCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaCog,
  FaHome,
  FaBars,
  FaTimes
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

  const [apiHealthy, setApiHealthy] = useState("unknown");
  const [searchQuery, setSearchQuery] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const headerRef = useRef(null);
  const searchRef = useRef(null);

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
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpenDropdown(null);
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const ae = document.activeElement;
        if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
        event.preventDefault();
        searchRef.current?.focus();
      }
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

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/?search=${encodeURIComponent(searchQuery.trim())}`);
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

  return (
    <header className="header" ref={headerRef}>
      {/* LEFT: hamburger + brand + dashboard */}
      <div className="header-left">
        <button
          className={`header-menu-btn ${sidebarOpen ? "header-is-open" : ""}`}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          aria-pressed={sidebarOpen}
          aria-controls="geolabs-sidebar"
          title={sidebarOpen ? "Close menu" : "Open menu"}
        >
          {sidebarOpen ? <FaTimes /> : <FaBars />}
        </button>

        <Link to="/" className="header-brand header-no-wrap" title="Geolabs, Inc.">
          <img src="/geolabs_logo.jpg" alt="Geolabs" className="header-logo" />
          <span className="header-title header-no-wrap">Geolabs,&nbsp;Inc.</span>
        </Link>

        <nav className="header-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `header-nav-link ${isActive ? "header-active" : ""}`}
            title="Dashboard"
          >
            <FaHome />
            <span>Dashboard</span>
          </NavLink>
        </nav>
      </div>

      {/* CENTER: search */}
      <div className="header-center">
        <form className="header-search" onSubmit={handleSearch}>
          <input
            ref={searchRef}
            type="text"
            className="header-search-input"
            placeholder="Search… ( / )"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search"
          />
          <FaSearch className="header-search-icon" aria-hidden />
        </form>
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
    </header>
  );
}
