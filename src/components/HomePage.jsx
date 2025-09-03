import React, { useEffect, useMemo, useState, useRef } from "react";
import "../styles/HomePage.css";
import homepageCards from "./HomePageCards";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import {
  FaStar,
  FaRegStar,
  FaClock,
  FaSearch,
  FaCalendarAlt,
  FaChartLine,
  FaFolderOpen,
  FaBoxOpen,
  FaRobot,
  FaCheckCircle,
  FaGripLines,
  FaExpandArrowsAlt,
  FaGithub,
  FaExternalLinkAlt,
  FaCodeBranch,
  FaEye,
  FaTag,
} from "react-icons/fa";

const FAVORITES_KEY = "geolabs_favorites_v2";
const RECENTS_KEY = "geolabs_recents_v2";
const RECENT_MAX = 8;

// Layout + size prefs
const LAYOUT_ORDER_KEY = "geolabs_layout_order_v1"; // array of labels in order
const CARD_SIZES_KEY = "geolabs_card_sizes_v1";     // { [label]: 'n'|'w'|'t'|'b' }

// 🔗 LinkedIn post (live embed)
const LINKEDIN_POST_URL =
  "https://www.linkedin.com/posts/geolabs_celebrating-50-years-of-engineering-excellence-activity-7365988140722872320-3Ua8?utm_source=share&utm_medium=member_desktop&rcm=ACoAAD5bZ5gBnaRS5zh8pZj6FBWwJfRKFtKF1gc";
const getLinkedInEmbedSrc = (url) => {
  if (!url) return null;
  const m = url.match(/activity-(\d+)/);
  if (!m) return null;
  const id = m[1];
  return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${id}`;
};

// 🐙 GitHub repo: owner/repo
const GITHUB_OWNER = "Taikiy49";
const GITHUB_REPO = "Geolabs";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

const normalizeText = (text = "") => text.toLowerCase().trim();
const matchesSearch = (searchTerm, ...fields) => {
  const term = normalizeText(searchTerm);
  if (!term) return true;
  return fields.some((field) => normalizeText(field || "").includes(term));
};
const highlightText = (text, searchTerm) => {
  if (!searchTerm || !text) return text;
  try {
    const regex = new RegExp(
      `(${searchTerm.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`,
      "gi"
    );
    const parts = String(text).split(regex);
    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="search-highlight">
          {part}
        </mark>
      ) : (
        <span key={index}>{part}</span>
      )
    );
  } catch {
    return text;
  }
};
const findSubpageByPath = (cards, path) => {
  for (const card of cards) {
    for (const subpage of card.subpages || []) {
      if (subpage.path === path) {
        return { parent: card, subpage };
      }
    }
  }
  return null;
};
const deduplicateByKey = (array, keyFn) => {
  const seen = new Set();
  return array.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const timeOfDay = () => {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
};
const timeAgo = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
};

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accounts } = useMsal();

  const fullName = accounts?.[0]?.name || "User";
  const firstName = fullName.split(" ")[0];

  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [favorites, setFavorites] = useState([]);
  const [recents, setRecents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit layout
  const [editMode, setEditMode] = useState(false);
  const [draggingId, setDraggingId] = useState(null);

  // default order: labels in homepageCards order
  const defaultOrder = useMemo(() => homepageCards.map((c) => c.label), []);
  const [layoutOrder, setLayoutOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_ORDER_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
    return defaultOrder;
  });

  // per-card sizes
  const [cardSizes, setCardSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CARD_SIZES_KEY) || "{}");
      return typeof saved === "object" && saved ? saved : {};
    } catch {}
    return {};
  });

  const pageRef = useRef(null);

  // Demo metrics (replace with real)
  const demoMetrics = useMemo(
    () => ({
      docsIndexed: 12890,
      coreBoxes: 412,
      aiAnswersThisWeek: 76,
      openTasks: 5,
    }),
    []
  );
  const weeklyDocs = useMemo(() => [8, 12, 10, 14, 9, 15, 13], []);

  // GitHub repo state
  const [ghLoading, setGhLoading] = useState(true);
  const [ghError, setGhError] = useState("");
  const [repo, setRepo] = useState(null);
  const [commits, setCommits] = useState([]);
  const [pulls, setPulls] = useState([]);
  const [languages, setLanguages] = useState({});
  const [latestRelease, setLatestRelease] = useState(null);

  // Load saved data
  useEffect(() => {
    try {
      const savedFavorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      const savedRecents = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
      setFavorites(savedFavorites);
      setRecents(savedRecents);
    } catch {
      setFavorites([]);
      setRecents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update search params
  useEffect(() => {
    if (searchQuery) setSearchParams({ search: searchQuery });
    else setSearchParams({});
  }, [searchQuery, setSearchParams]);

  // Persist layout & sizes
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_ORDER_KEY, JSON.stringify(layoutOrder));
    } catch {}
  }, [layoutOrder]);
  useEffect(() => {
    try {
      localStorage.setItem(CARD_SIZES_KEY, JSON.stringify(cardSizes));
    } catch {}
  }, [cardSizes]);

  // Fetch GitHub repo data
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setGhLoading(true);
        setGhError("");

        const base = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
        const [rRes, cRes, pRes, lRes, relRes] = await Promise.all([
          fetch(base),
          fetch(`${base}/commits?per_page=6`),
          fetch(`${base}/pulls?state=open&per_page=6`),
          fetch(`${base}/languages`),
          fetch(`${base}/releases/latest`), // may 404 if no releases
        ]);

        if (!rRes.ok) throw new Error("Repo not found");
        const repoJson = await rRes.json();
        const commitsJson = cRes.ok ? await cRes.json() : [];
        const pullsJson = pRes.ok ? await pRes.json() : [];
        const langsJson = lRes.ok ? await lRes.json() : {};
        let releaseJson = null;
        if (relRes.ok) {
          try { releaseJson = await relRes.json(); } catch {}
        }

        if (!active) return;
        setRepo(repoJson);
        setCommits(
          (commitsJson || []).map((c) => ({
            sha: c.sha,
            url: c.html_url,
            msg: c.commit?.message?.split("\n")[0] || "(no message)",
            author:
              c.author?.login ||
              c.commit?.author?.name ||
              c.commit?.committer?.name ||
              "unknown",
            date: c.commit?.author?.date || c.commit?.committer?.date,
          }))
        );
        setPulls(
          (pullsJson || []).map((p) => ({
            number: p.number,
            title: p.title,
            url: p.html_url,
            user: p.user?.login,
            date: p.updated_at || p.created_at,
          }))
        );
        setLanguages(langsJson || {});
        setLatestRelease(releaseJson);
      } catch (e) {
        if (!active) return;
        setGhError("Couldn’t load GitHub data.");
      } finally {
        if (active) setGhLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const saveFavorites = (newFavorites) => {
    setFavorites(newFavorites);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
    } catch {}
  };
  const saveRecents = (newRecents) => {
    setRecents(newRecents);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(newRecents));
    } catch {}
  };

  const isFavorited = (path) => favorites.some((fav) => fav.path === path);
  const toggleFavorite = (path) => {
    const metadata = findSubpageByPath(homepageCards, path);
    if (!metadata) return;
    const entry = {
      path,
      name: metadata.subpage.name,
      parent: metadata.parent.label,
      timestamp: Date.now(),
    };
    if (isFavorited(path)) {
      saveFavorites(favorites.filter((fav) => fav.path !== path));
    } else {
      const updated = deduplicateByKey([entry, ...favorites], (item) => item.path);
      saveFavorites(updated);
    }
  };
  const recordRecentVisit = (path) => {
    const metadata = findSubpageByPath(homepageCards, path);
    if (!metadata) return;
    const entry = {
      path,
      name: metadata.subpage.name,
      parent: metadata.parent.label,
      timestamp: Date.now(),
    };
    const updated = deduplicateByKey([entry, ...recents], (item) => item.path).slice(
      0,
      RECENT_MAX
    );
    saveRecents(updated);
  };
  const handleNavigation = (path, disabled = false) => {
    if (!path || disabled) return;
    recordRecentVisit(path);
    navigate(path);
  };
  const getTimeAgo = (dateString) => {
    if (!dateString) return "Recently updated";
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
      if (diffInDays === 0) return "Updated today";
      if (diffInDays === 1) return "Updated yesterday";
      if (diffInDays < 7) return `Updated ${diffInDays} days ago`;
      if (diffInDays < 30) return `Updated ${Math.floor(diffInDays / 7)} weeks ago`;
      return `Updated ${Math.floor(diffInDays / 30)} months ago`;
    } catch {
      return "Recently updated";
    }
  };

  // Filter + search
  const filteredCards = useMemo(() => {
    const term = searchQuery.trim();
    return homepageCards
      .map((card) => {
        const filteredSubpages = (card.subpages || []).filter((subpage) =>
          matchesSearch(
            term,
            card.label,
            card.sublabel,
            card.description,
            subpage.name,
            subpage.description
          )
        );
        const cardMatches = matchesSearch(term, card.label, card.sublabel, card.description);
        if (cardMatches || filteredSubpages.length > 0) {
          return {
            ...card,
            subpages: filteredSubpages.length > 0 || !term ? card.subpages : [],
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [searchQuery]);

  // Apply saved order
  const orderedCards = useMemo(() => {
    const indexOf = (label) => {
      const idx = layoutOrder.indexOf(label);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    return [...filteredCards].sort((a, b) => indexOf(a.label) - indexOf(b.label));
  }, [filteredCards, layoutOrder]);

  // Reveal on scroll
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const items = root.querySelectorAll(".animate-on-scroll");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("visible")),
      { threshold: 0.08 }
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [filteredCards]);

  // Drag helpers
  const reorder = (arr, fromLabel, toLabel) => {
    if (fromLabel === toLabel) return arr;
    const next = [...arr];
    const from = next.indexOf(fromLabel);
    const to = next.indexOf(toLabel);
    if (from === -1 || to === -1) return arr;
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  };
  const onCardDragStart = (label) => (e) => {
    if (!editMode) return;
    setDraggingId(label);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", label);
    e.currentTarget.classList.add("is-dragging");
  };
  const onCardDragEnd = (e) => {
    e.currentTarget.classList.remove("is-dragging");
    setDraggingId(null);
  };
  const onCardDragOver = (overLabel) => (e) => {
    if (!editMode) return;
    e.preventDefault();
    if (!draggingId || draggingId === overLabel) return;
    setLayoutOrder((prev) => reorder(prev, draggingId, overLabel));
  };
  const cycleSize = (label) => {
    setCardSizes((prev) => {
      const cur = prev[label] || "n";
      const next = cur === "n" ? "w" : cur === "w" ? "t" : cur === "t" ? "b" : "n";
      return { ...prev, [label]: next };
    });
  };
  const resetLayout = () => {
    setLayoutOrder(defaultOrder);
    setCardSizes({});
  };

  const currentTime = new Date();
  if (isLoading) {
    return (
      <div className="homepage">
        <div className="homepage-loading">
          <div className="loading-spinner" />
          <div className="loading-text">Loading dashboard…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="homepage" ref={pageRef}>
      <div className="homepage-container compact">
        {/* Hero */}
        <section className="homepage-hero compact visible">
          <div className="hero-greeting">
            <h1 className="hero-title">
              {timeOfDay()}, {firstName}
            </h1>
            <p className="hero-subtitle">
              Your geotechnical data platform — fast, consistent, and organized
            </p>
            <div className="hero-meta">
              <div className="hero-meta-item">
                <FaCalendarAlt />
                <span>
                  {currentTime.toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
              <div className="hero-meta-item">
                <span>Geolabs Team</span>
              </div>
              <div className="hero-meta-item">
                <FaChartLine />
                <span>Analytics Ready</span>
              </div>
            </div>

            {/* Edit layout controls */}
            <div className="hero-actions">
              <button
                className={`btn-edit ${editMode ? "on" : ""}`}
                onClick={() => setEditMode((v) => !v)}
                title="Reorder and resize cards"
              >
                {editMode ? "Done editing" : "Edit layout"}
              </button>
              {editMode && (
                <button className="btn-reset" onClick={resetLayout} title="Reset order & sizes">
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

    

        {/* KPIs */}
        <section className="kpi-grid animate-on-scroll visible">
          <div className="kpi-card">
            <div className="kpi-icon">
              <FaFolderOpen />
            </div>
            <div className="kpi-meta">
              <div className="kpi-label">Documents Indexed</div>
              <div className="kpi-value">{demoMetrics.docsIndexed.toLocaleString()}</div>
            </div>
            <div className="kpi-trend">
              <div className="kpi-bars">
                {weeklyDocs.map((v, i) => (
                  <span key={i} style={{ height: `${6 + v * 3}px` }} />
                ))}
              </div>
              <div className="kpi-hint">last 7 days</div>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <FaBoxOpen />
            </div>
            <div className="kpi-meta">
              <div className="kpi-label">Core Boxes</div>
              <div className="kpi-value">{demoMetrics.coreBoxes.toLocaleString()}</div>
            </div>
            <div className="kpi-pill">Inventory</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <FaRobot />
            </div>
            <div className="kpi-meta">
              <div className="kpi-label">AI Answers (wk)</div>
              <div className="kpi-value">{demoMetrics.aiAnswersThisWeek}</div>
            </div>
            <div className="kpi-pill kpi-pill--glow">↑ healthy</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <FaCheckCircle />
            </div>
            <div className="kpi-meta">
              <div className="kpi-label">Open Tasks</div>
              <div className="kpi-value">{demoMetrics.openTasks}</div>
            </div>
            <div className="kpi-pill kpi-pill--warn">priority</div>
          </div>
        </section>


        {/* Search */}
        <section className="homepage-search compact animate-on-scroll">
          <div className="search-container-lg">
            <FaSearch className="search-icon-lg" />
            <input
              type="text"
              className="search-input-lg"
              placeholder="Search tools, documents, and features…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </section>

    

        {/* Quick Access */}
{(favorites.length > 0 || recents.length > 0) && (
  <section className="quick-access compact visible">
    {favorites.length > 0 && (
      <div className="qa-section">
        <h2 className="qa-title">
          <FaStar />
          Favorites
        </h2>
        <div className="qa-grid">
          {favorites.slice(0, 6).map((favorite) => {
            const metadata = findSubpageByPath(homepageCards, favorite.path);
            if (!metadata) return null;
            return (
              <button
                key={favorite.path}
                className="qa-item"
                onClick={() => handleNavigation(favorite.path)}
                title={`${favorite.parent} → ${favorite.name}`}
              >
                <div className="qa-icon">{metadata.subpage.icon}</div>
                <div className="qa-content">
                  <div className="qa-name">{favorite.name}</div>
                  <div className="qa-desc">{favorite.parent}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    )}

    {recents.length > 0 && (
      <div className="qa-section">
        <h2 className="qa-title">
          <FaClock />
          Recently Used
        </h2>
        <div className="qa-grid">
          {recents.slice(0, 6).map((recent) => {
            const metadata = findSubpageByPath(homepageCards, recent.path);
            if (!metadata) return null;
            return (
              <button
                key={recent.path}
                className="qa-item"
                onClick={() => handleNavigation(recent.path)}
                title={`${recent.parent} → ${recent.name}`}
              >
                <div className="qa-icon">{metadata.subpage.icon}</div>
                <div className="qa-content">
                  <div className="qa-name">{recent.name}</div>
                  <div className="qa-desc">{recent.parent}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    )}
  </section>
)}


        {/* Categories (draggable + resizable in Edit mode) */}
        <section className="categories-grid compact">
          {orderedCards.map((card, index) => {
            const size = cardSizes[card.label] || "n";
            const sizeClass =
              size === "w" ? "size-wide" : size === "t" ? "size-tall" : size === "b" ? "size-big" : "";
            const editableClass = editMode ? "editable" : "";

            const go = () => {
              if (editMode) return;
              if (!card.disabled && card.path) handleNavigation(card.path);
            };

            return (
              <article
                key={card.label}
                data-id={card.label}
                className={`category-card animate-on-scroll ${sizeClass} ${editableClass} ${
                  card.disabled ? "disabled" : ""
                }`}
                style={{
                  animationDelay: `${index * 70}ms`,
                  opacity: card.disabled ? 0.6 : 1,
                  cursor: editMode ? "grab" : card.disabled ? "not-allowed" : "pointer",
                }}
                onClick={go}
                draggable={editMode}
                onDragStart={onCardDragStart(card.label)}
                onDragEnd={onCardDragEnd}
                onDragOver={onCardDragOver(card.label)}
                onDrop={(e) => e.preventDefault()}
              >
                {editMode && (
                  <div className="card-tools">
                    <span className="drag-handle" title="Drag to reorder">
                      <FaGripLines />
                    </span>
                    <button
                      className="size-btn"
                      title="Resize (normal → wide → tall → big)"
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleSize(card.label);
                      }}
                    >
                      <FaExpandArrowsAlt />
                    </button>
                  </div>
                )}

                <div className="category-header">
                  <div className="category-icon">{card.icon}</div>
                  <div className="category-content">
                    <h3 className="category-title">
                      {highlightText(card.label, searchQuery)}
                      {card.tag && <span className="category-badge">{card.tag}</span>}
                    </h3>
                    {card.sublabel && (
                      <p className="category-subtitle">
                        {highlightText(card.sublabel, searchQuery)}
                      </p>
                    )}
                    {card.description && (
                      <p className="category-description">
                        {highlightText(card.description, searchQuery)}
                      </p>
                    )}
                  </div>
                </div>

                {card.subpages && card.subpages.length > 0 && (
                  <div className="subpages-grid" onClick={(e) => e.stopPropagation()}>
                    {card.subpages.map((subpage, subIndex) => (
                      <div
                        key={subIndex}
                        className="subpage-item"
                        onClick={() => handleNavigation(subpage.path, subpage.disabled)}
                        style={{
                          opacity: subpage.disabled ? 0.5 : 1,
                          cursor: subpage.disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <div className="subpage-header">
                          <div className="subpage-icon">{subpage.icon}</div>
                          <div className="subpage-name">
                            {highlightText(subpage.name, searchQuery)}
                          </div>
                        </div>
                        {subpage.description && (
                          <p className="subpage-description">
                            {highlightText(subpage.description, searchQuery)}
                          </p>
                        )}

                        <button
                          className={`favorite-btn ${
                            isFavorited(subpage.path) ? "active" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(subpage.path);
                          }}
                          title={
                            isFavorited(subpage.path)
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                          aria-label={
                            isFavorited(subpage.path)
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                        >
                          {isFavorited(subpage.path) ? <FaStar /> : <FaRegStar />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="category-updated">{getTimeAgo(card.updated)}</div>
              </article>
            );
          })}
        </section>
        

        {/* Empty State */}
        {orderedCards.length === 0 && searchQuery && (
          <div className="empty-state animate-on-scroll">
            <FaSearch className="empty-state-icon" />
            <h3 className="empty-state-title">No results found</h3>
            <p className="empty-state-description">
              Try adjusting your search terms or browse the available categories above.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="homepage-footer animate-on-scroll visible">
        <div className="footer-content">
          <div className="footer-left">
            <div className="footer-brand">
              <img src="/geolabs_logo.jpg" alt="Geolabs" className="footer-logo" />
              <span className="footer-title">Geolabs, Inc.</span>
            </div>
            <p className="footer-description">
              Leading geotechnical engineering solutions since 1975
            </p>
          </div>
          
          <div className="footer-right">
            <div className="footer-links">
              <a href="https://www.geolabs.net" target="_blank" rel="noopener noreferrer" className="footer-link">
                Company Website
              </a>
              <a href="mailto:info@geolabs.net" className="footer-link">
                Contact Us
              </a>
            </div>
            <div className="footer-meta">
              <span>© {currentTime.getFullYear()} Geolabs, Inc.</span>
              <span>All rights reserved</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
