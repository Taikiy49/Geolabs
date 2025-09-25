import React, { useState, useMemo, useEffect, useCallback } from "react";
import { FaUserPlus, FaUserSlash, FaCogs, FaTicketAlt } from "react-icons/fa";
import OnboardedAccounts from "./OnboardedAccounts";
import TerminatedAccounts from "./TerminatedAccounts";
import ITTickets from "./ITTickets";
import "./ITOperations.css";

const TAB_KEYS = ["onboarded", "terminated", "tickets"];

const getInitialTab = () => {
  const params = new URLSearchParams(window.location.search);
  const q = (params.get("tab") || "").toLowerCase();
  if (TAB_KEYS.includes(q)) return q;
  const saved = localStorage.getItem("ops.tab");
  if (TAB_KEYS.includes(saved)) return saved;
  return "onboarded";
};

export default function ITOperations() {
  const [tab, setTab] = useState(getInitialTab);
  const [counts, setCounts] = useState({ onboarded: 0, terminated: 0, tickets: 0 });

  // keep URL & localStorage in sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ""}`;
    window.history.replaceState(null, "", next);
    localStorage.setItem("ops.tab", tab);
  }, [tab]);

  // children send counts up for badges
  const handleCounts = useCallback((key, value) => {
    setCounts(prev => ({ ...prev, [key]: value }));
  }, []);

  const tabs = useMemo(
    () => [
      { key: "onboarded",  label: "Onboarded Accounts",  icon: <FaUserPlus />,  count: counts.onboarded },
      { key: "terminated", label: "Terminated Accounts", icon: <FaUserSlash />, count: counts.terminated },
      { key: "tickets",    label: "IT Tickets",          icon: <FaTicketAlt />, count: counts.tickets },
    ],
    [counts]
  );

  return (
    <div className="ops-wrap">
      <header className="ops-header">
        <div className="ops-header-left">
          <h1 className="ops-title">
            <FaCogs className="ops-title-icon" />
            IT Operations
          </h1>
          <p className="ops-subtitle">Manage onboarding, offboarding, and tickets in one place.</p>
        </div>

        <nav className="ops-tabs" role="tablist" aria-label="IT Operations Tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`ops-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="ops-tab-icn">{t.icon}</span>
              <span className="ops-tab-label">{t.label}</span>
              <span className="ops-tab-badge" aria-label={`${t.count} items`}>{t.count}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="ops-main">
        {tab === "onboarded" && <OnboardedAccounts onCount={(n) => handleCounts("onboarded", n)} />}
        {tab === "terminated" && <TerminatedAccounts onCount={(n) => handleCounts("terminated", n)} />}
        {tab === "tickets" && <ITTickets onCount={(n) => handleCounts("tickets", n)} />}
      </main>
    </div>
  );
}
