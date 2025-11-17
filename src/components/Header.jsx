// src/components/Header.jsx
import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { FiLogOut } from "react-icons/fi";
import "../styles/Header.css";

function initialsFrom(email, name) {
  if (name && typeof name === "string") {
    const p = name.split(" ").filter(Boolean);
    if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
    return p[0].slice(0, 2).toUpperCase();
  }
  const handle = (email || "").split("@")[0] || "";
  const chunks = handle.replace(/[._-]+/g, " ").split(" ").filter(Boolean);
  if (chunks.length >= 2) return (chunks[0][0] + chunks[1][0]).toUpperCase();
  return handle.slice(0, 2).toUpperCase() || "??";
}

export default function Header() {
  const isAuthed = useIsAuthenticated();
  const { instance, accounts } = useMsal();
  const location = useLocation();
  const navigate = useNavigate();

  const userEmail =
    accounts?.[0]?.username ||
    accounts?.[0]?.idTokenClaims?.preferred_username ||
    "";

  const displayName =
    accounts?.[0]?.idTokenClaims?.name ||
    accounts?.[0]?.idTokenClaims?.given_name ||
    "";

  const initials = initialsFrom(userEmail, displayName);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "light");
    try { localStorage.setItem("geolabs_theme", "light"); } catch {}
  }, []);

  const [searchText, setSearchText] = useState(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get("search") || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      setSearchText(params.get("search") || "");
    } catch {}
  }, [location.search]);

  const handleSignIn = async () => {
    try {
      await instance.loginPopup({ scopes: ["User.Read"], prompt: "select_account" });
    } catch {}
  };

  const handleSignOut = async () => {
    try {
      await instance.logoutPopup({ account: accounts?.[0] });
    } catch {}
  };

  return (
    <header className="hlite-header" role="banner">
      <div className="hlite-row">

        {/* Left: Brand */}
        <Link to="/" className="hlite-brand" title="Geolabs, Inc.">
          <span className="hlite-name">
            <span className="hlite-name-strong">Geolabs, Inc.</span>
          </span>
        </Link>

        {/* Center: Search */}
        <div className="hlite-searchbar">
          <form
            className="hlite-search-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              const q = (searchText || "").trim();
              navigate(q ? `/?search=${encodeURIComponent(q)}` : "/");
            }}
          >
            <input
              className="hlite-search-input"
              type="search"
              placeholder="Search tools, documents, and features…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              aria-label="Search"
            />
          </form>
        </div>

        {/* Right: Account */}
        <div className="hlite-auth">
          {isAuthed ? (
            <>
              <button
                type="button"
                className="hlite-avatarbtn"
                title={displayName || userEmail || "Account"}
                aria-label="Open Microsoft Account"
                onClick={() =>
                  window.open("https://myaccount.microsoft.com/", "_blank", "noopener,noreferrer")
                }
              >
                <span className="hlite-avatar">{initials}</span>
              </button>

              <button
                type="button"
                className="hlite-iconbtn"
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
              >
                <FiLogOut size={18} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="hlite-btn"
              onClick={handleSignIn}
              title="Sign in with Microsoft"
            >
              Sign in
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
