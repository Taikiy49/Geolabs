import React, { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import homepageCards from "../components/HomePageCards";
import "../styles/HomePage.css";

const TAGS = ["All", "AI", "Analytics", "Ops", "Data", "Admin", "IT"];

// Resizer constraints
const MIN_WIDTH = 200;  // <-- sidebar can't go smaller than this
const MAX_WIDTH = 560;  // optional cap

export default function HomePage() {
  const navigate = useNavigate();
  const [activeTag, setActiveTag] = useState("All");
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "az"

  // === NEW: sidebar width + drag state ===
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

  // Filter + sort for the grid (unchanged)
  const filteredSorted = useMemo(() => {
    let items = homepageCards;
    if (activeTag !== "All") {
      items = items.filter(
        (c) => (c.tag || "").toLowerCase() === activeTag.toLowerCase()
      );
    }
    if (sortMode === "az") {
      return [...items].sort((a, b) => a.label.localeCompare(b.label));
    }
    return [...items].sort((a, b) => {
      const da = a.updated ? new Date(a.updated).getTime() : 0;
      const db = b.updated ? new Date(b.updated).getTime() : 0;
      return db - da;
    });
  }, [activeTag, sortMode]);

  const onKeyActivate = (e, fn) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className={`hp ${dragging ? "is-dragging" : ""}`}>
      {/* IMPORTANT: we add a middle 6px resizer column; your CSS grid stays intact */}
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
              {TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`hp-chip-btn ${activeTag === t ? "is-active" : ""}`}
                  onClick={() => setActiveTag(t)}
                  aria-pressed={activeTag === t}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* Sort */}
          <section className="hp-rail-section">
            <h3 className="hp-rail-title">Sort</h3>
            <select
              className="hp-sort-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              aria-label="Sort"
            >
              <option value="recent">Recently Updated</option>
              <option value="az">A–Z</option>
            </select>
          </section>

          {/* Quick Links */}
          <section className="hp-rail-section">
            <h3 className="hp-rail-title">Quick Links</h3>
            <div className="hp-ql">
              <button
                type="button"
                className="hp-ql-item"
                onClick={() => navigate("/ask-ai")}
              >
                Ask Geolabs AI
              </button>
              <button
                type="button"
                className="hp-ql-item"
                onClick={() => navigate("/reports")}
              >
                Reports
              </button>
              <button
                type="button"
                className="hp-ql-item"
                onClick={() => navigate("/ocr-lookup")}
              >
                OCR Work Orders
              </button>
              <button
                type="button"
                className="hp-ql-item"
                onClick={() => navigate("/s3-bucket")}
              >
                S3 Bucket
              </button>
            </div>
          </section>

          {/* Status */}
          <section className="hp-rail-section">
            <h3 className="hp-rail-title">Status</h3>
            <div className="hp-status">
              <div className="hp-status-row">
                <span className="hp-dot ok" aria-hidden />
                <span>AI Service</span>
                <span className="hp-status-pill">OK</span>
              </div>
              <div className="hp-status-row">
                <span className="hp-dot" aria-hidden />
                <span>Indexer</span>
                <span className="hp-status-pill">Idle</span>
              </div>
              <div className="hp-status-row">
                <span className="hp-dot ok" aria-hidden />
                <span>Storage</span>
                <span className="hp-status-pill">Healthy</span>
              </div>
              <div className="hp-meter" aria-label="Storage usage">
                <span style={{ width: "48%" }} />
              </div>
            </div>
          </section>
        </aside>

        {/* RESIZER (new middle column) */}
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
              const tag = (card.tag || "").toLowerCase();

              return (
                <button
                  key={card.label}
                  type="button"
                  className={`hp-card ${card.path ? "is-clickable" : ""}`}
                  onClick={go}
                  onKeyDown={(e) => card.path && onKeyActivate(e, go)}
                  aria-label={`Open ${card.label}`}
                  data-tag={tag}
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

                      {card.description && (
                        <p className="hp-desc">{card.description}</p>
                      )}
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
