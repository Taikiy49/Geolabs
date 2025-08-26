// src/components/HomePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import '../styles/HomePage.css';
import homepageCards from './HomePageCards';
import { useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { FaStar, FaRegStar, FaClock, FaExternalLinkAlt } from 'react-icons/fa';

const FAV_KEY = 'hp_favorites_v1';
const RECENT_KEY = 'hp_recents_v1';
const RECENT_MAX = 8;

const norm = (s = '') => s.toLowerCase();

const matchAny = (term, ...fields) => {
  const t = norm(term);
  if (!t) return true;
  return fields.some((f) => norm(f || '').includes(t));
};

const highlight = (text, term) => {
  if (!term) return text;
  const safe = String(text ?? '');
  try {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    const parts = safe.split(re);
    return parts.map((p, i) =>
      re.test(p) ? (
        <mark key={i} className="homepage-mark">
          {p}
        </mark>
      ) : (
        <span key={i}>{p}</span>
      )
    );
  } catch {
    return safe;
  }
};

const findSubByPath = (cards, path) => {
  for (const c of cards) {
    for (const s of c.subpages || []) {
      if (s.path === path) return { parent: c, sub: s };
    }
  }
  return null;
};

const dedupeKeepOrder = (arr, keyFn) => {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  } 
  return out;
};

const HomePage = () => {
  const navigate = useNavigate();
  const { accounts } = useMsal();
  const fullName = accounts[0]?.name || 'User';
  const userName = fullName.split(' ')[0];

  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [recents, setRecents] = useState([]);

  useEffect(() => {
    try {
      setFavorites(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
      setRecents(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
    } catch {
      setFavorites([]);
      setRecents([]);
    }
  }, []);

  const saveFavorites = (next) => {
    setFavorites(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
  };

  const saveRecents = (next) => {
    setRecents(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  };

  const isFavorited = (path) => favorites.some((f) => f.path === path);

  const toggleFavorite = (path) => {
    const meta = findSubByPath(homepageCards, path);
    if (!meta) return;
    const entry = { path, name: meta.sub.name, parent: meta.parent.label };
    if (isFavorited(path)) {
      const next = favorites.filter((f) => f.path !== path);
      saveFavorites(next);
    } else {
      const next = dedupeKeepOrder([entry, ...favorites], (x) => x.path);
      saveFavorites(next);
    }
  };

  const handleNavigate = (path, disabled) => {
    if (!path || disabled) return;
    navigate(path);
  };

  const recordRecent = (path) => {
    const meta = findSubByPath(homepageCards, path);
    if (!meta) return;
    const entry = { path, name: meta.sub.name, parent: meta.parent.label, ts: Date.now() };
    const next = dedupeKeepOrder([entry, ...recents], (x) => x.path).slice(0, RECENT_MAX);
    saveRecents(next);
  };

  const handleSubClick = (path, disabled) => {
    if (!path || disabled) return;
    recordRecent(path);
    navigate(path);
  };

  const getDaysAgo = (dateStr) => {
    if (!dateStr) return 'Updated recently';
    const lastUpdated = new Date(dateStr);
    if (Number.isNaN(lastUpdated.getTime())) return 'Updated recently';
    const diff = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
    return diff === 0 ? 'Updated today' : `Updated ${diff} day${diff === 1 ? '' : 's'} ago`;
  };

  // Filter cards & subpages by search
  const filtered = useMemo(() => {
    const term = search.trim();
    return homepageCards
      .map((c) => {
        const subFiltered = (c.subpages || []).filter((s) =>
          matchAny(term, c.label, c.sublabel, c.description, s.name, s.description)
        );
        const cardMatches = matchAny(term, c.label, c.sublabel, c.description);
        if (cardMatches || subFiltered.length) {
          return { ...c, subpages: subFiltered.length || !term ? c.subpages : [] };
        }
        return null;
      })
      .filter(Boolean);
  }, [search]);

  const resultsCount = useMemo(() => {
    let n = 0;
    for (const c of filtered) {
      n += (c.subpages || []).length || 1;
    }
    return n;
  }, [filtered]);

  const today = new Date();

  return (
    <div className="homepage-container">
      <div className="homepage-top">
        <div className="homepage-greeting-card">
          <div className="homepage-greeting-left">
            <h1>Welcome back, {userName}</h1>
            <p>Let’s make today productive.</p>
          </div>
          <div className="homepage-greeting-right">
            <span>{today.toLocaleDateString()}</span>
            <span>{today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        <div className="homepage-header">
          <div className="homepage-search-wrap">
            <input
              className="homepage-search"
              placeholder="Search tools and pages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div> 
        </div>
      </div>

      {/* Quick Access: Favorites */}
      {(favorites.length > 0 || recents.length > 0) && (
        <div className="homepage-quick">
          {favorites.length > 0 && (
            <div className="homepage-quick-section">
              <div className="homepage-quick-title">Favorites</div>
              <div className="homepage-chips">
                {favorites.map((f) => {
                  const meta = findSubByPath(homepageCards, f.path);
                  const icon = meta?.sub?.icon ?? <FaExternalLinkAlt size={10} />;
                  return (
                    <button
                      key={f.path}
                      className="homepage-chip"
                      onClick={() => handleSubClick(f.path)}
                      title={`${f.parent} → ${f.name}`}
                    >
                      <span className="homepage-chip-icon">{icon}</span>
                      <span className="homepage-chip-text">{f.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recents.length > 0 && (
            <div className="homepage-quick-section">
              <div className="homepage-quick-title">
                <FaClock className="homepage-inline-icon" /> Recent
              </div>
              <div className="homepage-chips">
                {recents.map((r) => {
                  const meta = findSubByPath(homepageCards, r.path);
                  const icon = meta?.sub?.icon ?? <FaExternalLinkAlt size={10} />;
                  return (
                    <button
                      key={r.path}
                      className="homepage-chip"
                      onClick={() => handleSubClick(r.path)}
                      title={`${r.parent} → ${r.name}`}
                    >
                      <span className="homepage-chip-icon">{icon}</span>
                      <span className="homepage-chip-text">{r.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main categories */}
      {/* Cards grid: render all filtered cards */}
<div className="homepage-list">
  {filtered.map((item, idx) => (
    <div
      key={idx}
      className={`homepage-row ${item.disabled ? 'homepage-row-disabled' : ''}`}
      style={{ cursor: item.disabled ? 'not-allowed' : 'pointer', opacity: item.disabled ? 0.5 : 1 }}
      onClick={() => handleNavigate(item.path, item.disabled)}
    >
      <div className="homepage-row-left">
        <div className="homepage-row-header">
          <div className="homepage-icon">{item.icon}</div>
          <div>
            <div className="homepage-title">
              {highlight(item.label, search)}{' '}
              {item.tag && <span className="homepage-badge">{item.tag}</span>}
            </div>
            <div className="homepage-sublabel">{highlight(item.sublabel, search)}</div>
          </div>
        </div>

        <div className="homepage-description">{highlight(item.description, search)}</div>
        <div className="homepage-updated">
          {item.updated ? getDaysAgo(item.updated) : 'Updated recently'}
        </div>

        {item.subpages?.length > 0 && (
          <div className="homepage-subpages" onClick={(e) => e.stopPropagation()}>
            {item.subpages.map((sub, i) => (
              <div key={i} className="homepage-subpage-link">
                <div
                  className="homepage-subpage-link-header"
                  onClick={() => handleSubClick(sub.path)}
                  title={sub.name}
                >
                  <div className="subpage-icon">{sub.icon}</div>
                  <div className="subpage-info">{highlight(sub.name, search)}</div>
                </div>
                <div className="subpage-description">{highlight(sub.description, search)}</div>
                <button
                  className="homepage-pin"
                  onClick={() => toggleFavorite(sub.path)}
                  title={isFavorited(sub.path) ? 'Unpin' : 'Pin'}
                >
                  {isFavorited(sub.path) ? <FaStar /> : <FaRegStar />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  ))}
</div>

    </div>
  );
};

export default HomePage;
