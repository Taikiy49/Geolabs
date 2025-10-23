import React, { useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import "../styles/HomePage.css";

export default function HomePage() {
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

  // Rotating single tip (kept)
  const tips = [
    "Press / to focus search (on pages that support it).",
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

  return (
    <div className="hp3">
      <section className="hp3-hero">
        <div className="hp3-card">
          <div className="hp3-greet">
            {greeting}
            {givenName ? <>, <span className="hp3-name">{givenName}</span></> : null}
          </div>

          {/* Updated subline */}
          <div className="hp3-sub">Welcome back — here are a few quick tips.</div>

          <div className="hp3-date">{niceDate}</div>

          {/* Rotating tip kept, centered */}
          <div className="hp3-tipline" role="status" aria-live="polite">
            {tips[tipIdx]}
          </div>
        </div>
      </section>
    </div>
  );
}
