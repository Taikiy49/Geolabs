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

const LAYOUT_ORDER_KEY = "geolabs_layout_order_v1";
const CARD_SIZES_KEY = "geolabs_card_sizes_v1";

const LINKEDIN_POST_URL =
  "https://www.linkedin.com/posts/geolabs_celebrating-50-years-of-engineering-excellence-activity-7365988140722872320-3Ua8?utm_source=share&utm_medium=member_desktop&rcm=ACoAAD5bZ5gBnaRS5zh8pZj6FBWwJfRKFtKF1gc";
const getLinkedInEmbedSrc = (url) => {
  if (!url) return null;
  const m = url.match(/activity-(\d+)/);
  if (!m) return null;
  const id = m[1];
  return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${id}`;
};

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
        <mark key={index} className="homepage-search-highlight">
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

  const [editMode, setEditMode] = useState(false);
  const [draggingId, setDraggingId] = useState(null);

  const defaultOrder = useMemo(() => homepageCards.map((c) => c.label), []);
  const [layoutOrder, setLayoutOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_ORDER_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
    return defaultOrder;
  });

  const [cardSizes, setCardSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CARD_SIZES_KEY) || "{}");
      return typeof saved === "object" && saved ? saved : {};
    } catch {}
    return {};
  });

  const pageRef = useRef(null);

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

  const [ghLoading, setGhLoading] = useState(true);
  const [ghError, setGhError] = useState("");
  const [repo, setRepo] = useState(null);
  const [commits, setCommits] = useState([]);
  const [pulls, setPulls] = useState([]);
  const [languages, setLanguages] = useState({});
  const [latestRelease, setLatestRelease] = useState(null);

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

  useEffect(() => {
    if (searchQuery) setSearchParams({ search: searchQuery });
    else setSearchParams({});
  }, [searchQuery, setSearchParams]);

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
    const updated = deduplicateByKey([entry, ...recents], (item) => item.path).slice(0, RECENT_MAX);
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

  const orderedCards = useMemo(() => {
    const indexOf = (label) => {
      const idx = layoutOrder.indexOf(label);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    return [...filteredCards].sort((a, b) => indexOf(a.label) - indexOf(b.label));
  }, [filteredCards, layoutOrder]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const items = root.querySelectorAll(".homepage-animate-on-scroll");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("homepage-visible")),
      { threshold: 0.08 }
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [filteredCards]);

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
    e.currentTarget.classList.add("homepage-is-dragging");
  };
  const onCardDragEnd = (e) => {
    e.currentTarget.classList.remove("homepage-is-dragging");
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
          <div className="homepage-loading-spinner" />
          <div className="homepage-loading-text">Loading dashboard…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="homepage" ref={pageRef}>
      <div className="homepage-container homepage-compact">
        {/* Hero */}
        <section className="homepage-hero homepage-compact homepage-visible">
          <div className="homepage-hero-greeting">
            <h1 className="homepage-hero-title">
              {timeOfDay()}, {firstName}
            </h1>
            <p className="homepage-hero-subtitle">
              Your geotechnical data platform — fast, consistent, and organized
            </p>
            <div className="homepage-hero-meta">
              <div className="homepage-hero-meta-item">
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
              <div className="homepage-hero-meta-item">
                <span>Geolabs Team</span>
              </div>
              <div className="homepage-hero-meta-item">
                <FaChartLine />
                <span>Analytics Ready</span>
              </div>
            </div>

            {/* Edit layout controls */}
            <div className="homepage-hero-actions">
              <button
                className={`homepage-btn-edit ${editMode ? "homepage-on" : ""}`}
                onClick={() => setEditMode((v) => !v)}
                title="Reorder and resize cards"
              >
                {editMode ? "Done editing" : "Edit layout"}
              </button>
              {editMode && (
                <button className="homepage-btn-reset" onClick={resetLayout} title="Reset order & sizes">
                  Reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="homepage-kpi-grid homepage-animate-on-scroll homepage-visible">
          <div className="homepage-kpi-card">
            <div className="homepage-kpi-icon">
              <FaFolderOpen />
            </div>
            <div className="homepage-kpi-meta">
              <div className="homepage-kpi-label">Documents Indexed</div>
              <div className="homepage-kpi-value">{demoMetrics.docsIndexed.toLocaleString()}</div>
            </div>
            <div className="homepage-kpi-trend">
              <div className="homepage-kpi-bars">
                {weeklyDocs.map((v, i) => (
                  <span key={i} style={{ height: `${6 + v * 3}px` }} />
                ))}
              </div>
              <div className="homepage-kpi-hint">last 7 days</div>
            </div>
          </div>
          <div className="homepage-kpi-card">
            <div className="homepage-kpi-icon">
              <FaBoxOpen />
            </div>
            <div className="homepage-kpi-meta">
              <div className="homepage-kpi-label">Core Boxes</div>
              <div className="homepage-kpi-value">{demoMetrics.coreBoxes.toLocaleString()}</div>
            </div>
            <div className="homepage-kpi-pill">Inventory</div>
          </div>
          <div className="homepage-kpi-card">
            <div className="homepage-kpi-icon">
              <FaRobot />
            </div>
            <div className="homepage-kpi-meta">
              <div className="homepage-kpi-label">AI Answers (wk)</div>
              <div className="homepage-kpi-value">{demoMetrics.aiAnswersThisWeek}</div>
            </div>
            <div className="homepage-kpi-pill homepage-kpi-pill--glow">↑ healthy</div>
          </div>
          <div className="homepage-kpi-card">
            <div className="homepage-kpi-icon">
              <FaCheckCircle />
            </div>
            <div className="homepage-kpi-meta">
              <div className="homepage-kpi-label">Open Tasks</div>
              <div className="homepage-kpi-value">{demoMetrics.openTasks}</div>
            </div>
            <div className="homepage-kpi-pill homepage-kpi-pill--warn">priority</div>
          </div>
        </section>

        {/* Search */}
        <section className="homepage-search homepage-compact homepage-animate-on-scroll">
          <div className="homepage-search-container-lg">
            <FaSearch className="homepage-search-icon-lg" />
            <input
              type="text"
              className="homepage-search-input-lg"
              placeholder="Search tools, documents, and features…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </section>

        {/* Quick Access */}
        {(favorites.length > 0 || recents.length > 0) && (
          <section className="homepage-quick-access homepage-compact homepage-visible">
            {favorites.length > 0 && (
              <div className="homepage-qa-section">
                <h2 className="homepage-qa-title">
                  <FaStar />
                  Favorites
                </h2>
                <div className="homepage-qa-grid">
                  {favorites.slice(0, 6).map((favorite) => {
                    const metadata = findSubpageByPath(homepageCards, favorite.path);
                    if (!metadata) return null;
                    return (
                      <button
                        key={favorite.path}
                        className="homepage-qa-item"
                        onClick={() => handleNavigation(favorite.path)}
                        title={`${metadata.parent.label} → ${favorite.name}`}
                      >
                        <div className="homepage-qa-icon">{metadata.subpage.icon}</div>
                        <div className="homepage-qa-content">
                          <div className="homepage-qa-name">{favorite.name}</div>
                          <div className="homepage-qa-desc">{metadata.parent.label}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {recents.length > 0 && (
              <div className="homepage-qa-section">
                <h2 className="homepage-qa-title">
                  <FaClock />
                  Recently Used
                </h2>
                <div className="homepage-qa-grid">
                  {recents.slice(0, 6).map((recent) => {
                    const metadata = findSubpageByPath(homepageCards, recent.path);
                    if (!metadata) return null;
                    return (
                      <button
                        key={recent.path}
                        className="homepage-qa-item"
                        onClick={() => handleNavigation(recent.path)}
                        title={`${metadata.parent.label} → ${recent.name}`}
                      >
                        <div className="homepage-qa-icon">{metadata.subpage.icon}</div>
                        <div className="homepage-qa-content">
                          <div className="homepage-qa-name">{recent.name}</div>
                          <div className="homepage-qa-desc">{metadata.parent.label}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Categories */}
        <section className="homepage-categories-grid homepage-compact">
          {orderedCards.map((card, index) => {
            const size = cardSizes[card.label] || "n";
            const sizeClass =
              size === "w" ? "homepage-size-wide" : size === "t" ? "homepage-size-tall" : size === "b" ? "homepage-size-big" : "";
            const editableClass = editMode ? "homepage-editable" : "";

            const go = () => {
              if (editMode) return;
              if (!card.disabled && card.path) handleNavigation(card.path);
            };

            return (
              <article
                key={card.label}
                data-id={card.label}
                className={`homepage-category-card homepage-animate-on-scroll ${sizeClass} ${editableClass} ${
                  card.disabled ? "homepage-disabled" : ""
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
                  <div className="homepage-card-tools">
                    <span className="homepage-drag-handle" title="Drag to reorder">
                      <FaGripLines />
                    </span>
                    <button
                      className="homepage-size-btn"
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

                <div className="homepage-category-header">
                  <div className="homepage-category-icon">{card.icon}</div>
                  <div className="homepage-category-content">
                    <h3 className="homepage-category-title">
                      {highlightText(card.label, searchQuery)}
                      {card.tag && <span className="homepage-category-badge">{card.tag}</span>}
                    </h3>
                    {card.sublabel && (
                      <p className="homepage-category-subtitle">
                        {highlightText(card.sublabel, searchQuery)}
                      </p>
                    )}
                    {card.description && (
                      <p className="homepage-category-description">
                        {highlightText(card.description, searchQuery)}
                      </p>
                    )}
                  </div>
                </div>

                {card.subpages && card.subpages.length > 0 && (
                  <div className="homepage-subpages-grid" onClick={(e) => e.stopPropagation()}>
                    {card.subpages.map((subpage, subIndex) => (
                      <div
                        key={subIndex}
                        className="homepage-subpage-item"
                        onClick={() => handleNavigation(subpage.path, subpage.disabled)}
                        style={{
                          opacity: subpage.disabled ? 0.5 : 1,
                          cursor: subpage.disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <div className="homepage-subpage-header">
                          <div className="homepage-subpage-icon">{subpage.icon}</div>
                          <div className="homepage-subpage-name">
                            {highlightText(subpage.name, searchQuery)}
                          </div>
                        </div>
                        {subpage.description && (
                          <p className="homepage-subpage-description">
                            {highlightText(subpage.description, searchQuery)}
                          </p>
                        )}

                        <button
                          className={`homepage-favorite-btn ${
                            isFavorited(subpage.path) ? "homepage-active" : ""
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

                <div className="homepage-category-updated">{getTimeAgo(card.updated)}</div>
              </article>
            );
          })}
        </section>

        {/* Empty State */}
        {orderedCards.length === 0 && searchQuery && (
          <div className="homepage-empty-state homepage-animate-on-scroll">
            <FaSearch className="homepage-empty-state-icon" />
            <h3 className="homepage-empty-state-title">No results found</h3>
            <p className="homepage-empty-state-description">
              Try adjusting your search terms or browse the available categories above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
