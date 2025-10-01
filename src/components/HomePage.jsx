// src/pages/HomePage.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import homepageCards from "../components/HomePageCards";
import "../styles/HomePage.css";

// Visible filter labels (what the user sees)
const TAGS = ["All", "AI", "Analytics", "Ops", "Admin", "IT"];

// Sidebar resizer constraints
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

const norm = (s = "") => String(s).trim().toLowerCase();

// --- NEW: simple media query hook to switch descriptions on wide screens ---
function useMedia(query) {
  const getMatch = () =>
    typeof window !== "undefined" && "matchMedia" in window
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(getMatch);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    if (m.addEventListener) m.addEventListener("change", onChange);
    else m.addListener(onChange); // Safari fallback
    setMatches(m.matches);
    return () => {
      if (m.removeEventListener) m.removeEventListener("change", onChange);
      else m.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

export default function HomePage() {
  const navigate = useNavigate();

  // UI state
  const [activeTag, setActiveTag] = useState("All");
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "az"

  // Sidebar width + dragging
  const [railWidth, setRailWidth] = useState(() => {
    const saved = Number(localStorage.getItem("hp_rail_w"));
    return Number.isFinite(saved) && saved > 0 ? saved : 240;
  });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, w: 240 });

  useEffect(() => {
    localStorage.setItem("hp_rail_w", String(railWidth));
  }, [railWidth]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const dx = e.clientX - dragStart.current.x;
      const raw = dragStart.current.w + dx;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw));
      setRailWidth(clamped);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const beginDrag = (e) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, w: railWidth };
  };

  // Filter + sort
  const filteredSorted = useMemo(() => {
    const tag = norm(activeTag);
    let items =
      tag === "all"
        ? homepageCards
        : homepageCards.filter((c) => norm(c.tag) === tag);

    if (sortMode === "az") {
      return [...items].sort((a, b) => a.label.localeCompare(b.label));
    }
    // default: recent
    return [...items].sort((a, b) => {
      const da = a.updated ? new Date(a.updated).getTime() : 0;
      const db = b.updated ? new Date(b.updated).getTime() : 0;
      return db - da;
    });
  }, [activeTag, sortMode]);

  // a11y helper for activating cards via keyboard
  const onKeyActivate = (e, fn) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  // NEW: decide when to show long descriptions
  const isWide = useMedia("(min-width: 1200px)");

  return (
    <div className={`hp ${dragging ? "is-dragging" : ""}`}>
      {/* Middle 6px resizer column; CSS media query will collapse on mobile */}
      <div
        className="hp-shell"
        style={{ gridTemplateColumns: `${railWidth}px 6px 1fr` }}
      >
        {/* LEFT RAIL */}
        <aside className="hp-rail">
          {/* Filters */}
          <section className="hp-rail-section">
            <h3 className="hp-rail-title">Filters</h3>
            <div className="hp-filter">
              {TAGS.map((t) => {
                const isActive = activeTag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={`hp-chip-btn ${isActive ? "is-active" : ""}`}
                    data-tag={norm(t)} // ← drives accent color
                    onClick={() => setActiveTag(t)}
                    aria-pressed={isActive}
                    aria-label={`Filter by ${t}`}
                    title={`Filter: ${t}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Sort */}
          <section className="hp-rail-section">
            <h3 className="hp-rail-title">Sort</h3>
            <select
              className="hp-sort-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              aria-label="Sort cards"
              title="Sort cards"
            >
              <option value="recent">Recently Updated</option>
              <option value="az">A–Z</option>
            </select>
          </section>

        </aside>

        {/* RESIZER */}
        <div
          className="hp-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={beginDrag}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              setRailWidth((w) => Math.max(MIN_WIDTH, w - 16));
            } else if (e.key === "ArrowRight") {
              setRailWidth((w) => Math.min(MAX_WIDTH, w + 16));
            }
          }}
          title="Drag to resize (Arrow keys work too)"
        />

        {/* RIGHT: MAIN (cards) */}
        <section className="hp-main">
          <div className="hp-grid">
            {filteredSorted.map((card) => {
              const go = () => card.path && navigate(card.path);
              const tagLC = norm(card.tag);
              const desc =
                isWide && card.descriptionLong
                  ? card.descriptionLong
                  : card.description;

              return (
                <button
                  key={card.label}
                  type="button"
                  className={`hp-card ${card.path ? "is-clickable" : ""}`}
                  onClick={go}
                  onKeyDown={(e) => card.path && onKeyActivate(e, go)}
                  aria-label={card.path ? `Open ${card.label}` : card.label}
                  data-tag={tagLC} // ← drives card accent color
                >
                  <div className="hp-head">
                    <div className="hp-chip" aria-hidden>
                      {card.icon}
                    </div>

                    <div className="hp-txt">
                      <div className="hp-title-row">
                        <span className="hp-title">{card.label}</span>
                        {card.tag && <span className="hp-badge">{card.tag}</span>}
                      </div>

                      {desc && <p className="hp-desc">{desc}</p>}
                    </div>
                  </div>

                  <div className="hp-updated">
                    {card.updated ? `Updated ${card.updated}` : "Recently updated"}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
