import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import {
  FaHome,
  FaRobot,
  FaChartBar,
  FaTools,
  FaUserShield,
  FaServer,
  FaShieldAlt,
} from "react-icons/fa";
import homepageCards from "../components/HomePageCards";
import "../styles/HomePage.css";

const FILTERS = [
  { key: "All", tag: "all", Icon: FaHome },
  { key: "AI", tag: "ai", Icon: FaRobot },
  { key: "Analytics", tag: "analytics", Icon: FaChartBar },
  { key: "Ops", tag: "ops", Icon: FaTools },
  { key: "Admin", tag: "admin", Icon: FaUserShield },
  { key: "IT", tag: "it", Icon: FaServer },
  { key: "Security", tag: "security", Icon: FaShieldAlt },
];

const norm = (s = "") => String(s).trim().toLowerCase();

function useMedia(query) {
  const [matches, setMatches] = useState(
    typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { accounts } = useMsal();
  const idClaims = accounts?.[0]?.idTokenClaims || {};
  const givenName =
    idClaims?.given_name ||
    (idClaims?.name ? String(idClaims.name).split(" ")[0] : "") ||
    "";

  const [activeTag, setActiveTag] = useState("All");
  const [sortMode] = useState("recent");

  const filteredSorted = useMemo(() => {
    const tag = norm(activeTag);
    let items =
      tag === "all"
        ? homepageCards
        : homepageCards.filter((c) => norm(c.tag) === tag);
    return [...items].sort(
      (a, b) =>
        (b.updated ? new Date(b.updated).getTime() : 0) -
        (a.updated ? new Date(a.updated).getTime() : 0)
    );
  }, [activeTag]);

  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
      ? "Good afternoon"
      : "Good evening";
  const niceDate = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const isWide = useMedia("(min-width: 1200px)");

  return (
    <div className="hp">
      <div className="hp-shell">
        {/* LEFT RAIL */}
        <aside className="hp-rail">
          <div className="hp-filter-icons">
            {FILTERS.map(({ key, tag, Icon }) => {
              const isActive = norm(activeTag) === tag;
              return (
                <button
                  key={key}
                  type="button"
                  className={`hp-chip-icon ${isActive ? "is-active" : ""}`}
                  data-tag={tag}
                  onClick={() => setActiveTag(key)}
                  title={key}
                >
                  <Icon />
                </button>
              );
            })}
          </div>
        </aside>

        {/* MAIN */}
        <section className="hp-main">
          <div className="hp-welcome">
            <div className="hp-welcome-left">
              <div className="hp-welcome-greet">
                {greeting}
                {givenName && (
                  <>
                    , <span className="hp-welcome-name">{givenName}</span>
                  </>
                )}
              </div>
              <div className="hp-welcome-sub">
                Here’s your workspace — filter with the icons.
              </div>
            </div>
            <div className="hp-welcome-right">
              <div className="hp-welcome-date">{niceDate}</div>
            </div>
          </div>

          <div className="hp-grid">
            {filteredSorted.map((card) => {
              const go = () => card.path && navigate(card.path);
              const tagLC = norm(card.tag);
              const desc =
                isWide && card.descriptionLong
                  ? card.descriptionLong
                  : card.description;
              const TagIcon =
                FILTERS.find((f) => f.tag === tagLC)?.Icon || FaRobot;
              return (
                <button
                  key={card.label}
                  className="hp-card is-clickable"
                  data-tag={tagLC}
                  onClick={go}
                >
                  <div className="hp-title-row">
                    <span className="hp-title">{card.label}</span>
                    <span className="hp-title-spacer" />
                    <span className="hp-tagchip">
                      <TagIcon size={14} />
                      {card.tag}
                    </span>
                  </div>
                  {desc && <p className="hp-desc">{desc}</p>}
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
