import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { FaSearch } from "react-icons/fa";
import "../styles/HomePage.css";

export default function HomePage() {
  const navigate = useNavigate();
  const { accounts } = useMsal();
  const idClaims = accounts?.[0]?.idTokenClaims || {};
  const givenName =
    idClaims?.given_name ||
    (idClaims?.name ? String(idClaims.name).split(" ")[0] : "") ||
    "";

  const now = new Date();
  const greeting =
    now.getHours() < 12 ? "Good morning" :
    now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const niceDate = now.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  // Rotating single tip
  const tips = [
    "Press / to focus search.",
    "Use quotes for exact matches: “WO 8120”.",
    "Shift+Click a link to open in a new tab.",
    "Right-click rows to quick-copy file paths.",
    "Filter first, then export to CSV.",
    "Use OCR Lookup to find handwritten WOs.",
    "Sort by size in Server Search to spot bulky folders.",
  ];
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTipIdx((i) => (i + 1) % tips.length), 5000);
    return () => clearInterval(id);
  }, [tips.length]);

  // Search
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  const goSearch = () => {
    const target = "/server-search" + (q ? `?q=${encodeURIComponent(q)}` : "");
    navigate(target);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") goSearch();
  };

  // Focus search when user presses '/'
  useEffect(() => {
    const onDocKey = (e) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, []);

  return (
    <div className="hp3">
      {/* Top name card */}
      <div className="hp3-welcome">
        <div className="hp3-w-left">
          <div className="hp3-greet">
            {greeting}
            {givenName ? <>, <span className="hp3-name">{givenName}</span></> : null}
          </div>
          <div className="hp3-sub">Your workspace overview</div>
        </div>
        <div className="hp3-w-right">
          <div className="hp3-date">{niceDate}</div>
        </div>
      </div>

      {/* Centered search hero */}
      <section className="hp3-hero">
        <div className="hp3-searchCard">
          <div className="hp3-searchWrap">
            <FaSearch className="hp3-searchIcon" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search files, WOs, reports, people…"
              className="hp3-searchInput"
              aria-label="Search workspace"
            />
            <button className="hp3-searchBtn" onClick={goSearch}>Search</button>
          </div>

          {/* Single small rotating tip */}
          <div className="hp3-tipline" role="status" aria-live="polite">
            {tips[tipIdx]}
          </div>
        </div>
      </section>
    </div>
  );
}
