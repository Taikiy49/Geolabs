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
} from "react-icons/fa";

const FAVORITES_KEY = "geolabs_favorites_v2";
const RECENTS_KEY = "geolabs_recents_v2";
const RECENT_MAX = 8;

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
      `(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
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

  const pageRef = useRef(null);

  // Load saved data
  useEffect(() => {
    try {
      const savedFavorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      const savedRecents = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
      setFavorites(savedFavorites);
      setRecents(savedRecents);
    } catch (error) {
      console.error("Error loading saved data:", error);
      setFavorites([]);
      setRecents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update search params when query changes
  useEffect(() => {
    if (searchQuery) {
      setSearchParams({ search: searchQuery });
    } else {
      setSearchParams({});
    }
  }, [searchQuery, setSearchParams]);

  const saveFavorites = (newFavorites) => {
    setFavorites(newFavorites);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error("Error saving favorites:", error);
    }
  };

  const saveRecents = (newRecents) => {
    setRecents(newRecents);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(newRecents));
    } catch (error) {
      console.error("Error saving recents:", error);
    }
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
      const updated = favorites.filter((fav) => fav.path !== path);
      saveFavorites(updated);
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

  // Reveal on scroll (smooth, minimal)
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const items = root.querySelectorAll(".animate-on-scroll");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        });
      },
      { threshold: 0.08 }
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [filteredCards]);

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
              Welcome back, {firstName}
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
              <div className="hero-meta-item"><span>Geolabs Team</span></div>
              <div className="hero-meta-item">
                <FaChartLine />
                <span>Analytics Ready</span>
              </div>
            </div>
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
              <div>
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
              <div>
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

        {/* Categories */}
        <section className="categories-grid compact">
          {filteredCards.map((card, index) => (
            <article
              key={index}
              className={`category-card animate-on-scroll ${card.disabled ? "disabled" : ""}`}
              style={{
                animationDelay: `${index * 70}ms`,
                opacity: card.disabled ? 0.6 : 1,
                cursor: card.disabled ? "not-allowed" : "pointer",
              }}
              onClick={() => !card.disabled && card.path && handleNavigation(card.path)}
            >
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
                        className={`favorite-btn ${isFavorited(subpage.path) ? "active" : ""}`}
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
          ))}
        </section>

        {/* Empty State */}
        {filteredCards.length === 0 && searchQuery && (
          <div className="empty-state animate-on-scroll">
            <FaSearch className="empty-state-icon" />
            <h3 className="empty-state-title">No results found</h3>
            <p className="empty-state-description">
              Try adjusting your search terms or browse the available categories above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
