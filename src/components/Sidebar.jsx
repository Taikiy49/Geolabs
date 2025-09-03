// src/components/Sidebar.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FaChevronDown,
  FaRobot,
  FaDatabase,
  FaCogs,
  FaTable,
  FaCloudUploadAlt,
  FaCloud,
  FaSearch,
  FaHome,
  FaUserShield,
  FaAddressBook,
  FaBoxOpen,
  FaFileAlt,
  FaChartBar,
  FaCircle,
  FaUserCheck,
  FaUserTimes,
  FaTicketAlt,
} from "react-icons/fa";
import "../styles/Sidebar.css";

/**
 * Overlay drawer sidebar:
 * - Opens/closes via CustomEvent "geolabs:toggleSidebar"
 *     • { detail: "toggle" }  -> toggles
 *     • { detail: true/false } -> explicit open/close
 * - Slides over content (no layout shift)
 * - Closes on route change, backdrop click, or Esc
 */

export default function Sidebar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // --- Define navigation groups FIRST so hooks below can depend on it safely ---
  const navigationGroups = useMemo(
    () => [
      {
        id: "main",
        label: "Main",
        icon: FaHome,
        items: [{ to: "/", icon: FaHome, label: "Dashboard" }],
      },
      {
        id: "ai",
        label: "AI & Knowledge",
        icon: FaRobot,
        items: [{ to: "/ask-ai", icon: FaRobot, label: "Ask Geolabs AI" }],
      },
      {
        id: "data",
        label: "Data & Indexing",
        icon: FaDatabase,
        items: [
          { to: "/db-viewer", icon: FaTable, label: "Database Explorer" },
          { to: "/db-admin", icon: FaCogs, label: "Index Manager" },
        ],
      },
      {
        id: "projects",
        label: "Projects & Files",
        icon: FaCloud,
        items: [
          { to: "/ocr-lookup", icon: FaSearch, label: "OCR Lookup" },
          { to: "/s3-viewer", icon: FaFileAlt, label: "S3 Browser" },
          { to: "/s3-admin", icon: FaCloudUploadAlt, label: "S3 Uploader" },
          { to: "/core-box-inventory", icon: FaBoxOpen, label: "Core Inventory" },
        ],
      },
      {
        id: "reports",
        label: "Reports & Analytics",
        icon: FaChartBar,
        items: [
          { to: "/reports", icon: FaFileAlt, label: "Reports" },
          { to: "/reports-binder", icon: FaChartBar, label: "Reports Binder" },
        ],
      },
      {
        id: "people",
        label: "People & Admin",
        icon: FaUserShield,
        items: [
          { to: "/contacts", icon: FaAddressBook, label: "Directory" },
          { to: "/admin", icon: FaCogs, label: "Admin Console" },
        ],
      },
      {
        id: "itadmin",
        label: "IT Administration",
        icon: FaUserShield, // change to FaCogs if you want a different feel
        items: [
          { to: "/it-onboarded", icon: FaUserCheck, label: "Onboarded Accounts" },
          { to: "/it-terminated", icon: FaUserTimes, label: "Terminated Accounts" },
          { to: "/it-tickets", icon: FaTicketAlt, label: "Ticket Requests" },
        ],
      },
    ],
    []
  );

  // helper: all groups collapsed
  const collapseAll = useCallback(
    () => Object.fromEntries(navigationGroups.map((g) => [g.id, false])),
    [navigationGroups]
  );

  // expanded state starts collapsed
  const [expanded, setExpanded] = useState(() => collapseAll());

  // listen for header toggle; when opening -> collapse groups
  useEffect(() => {
    const handler = (e) => {
      const d = e?.detail;

      const setNext = (prev) => {
        const nextOpen = typeof d === "boolean" ? d : !prev;
        if (nextOpen) setExpanded(collapseAll()); // always start closed on open
        return nextOpen;
      };

      setOpen((prev) => setNext(prev));
    };

    window.addEventListener("geolabs:toggleSidebar", handler);
    return () => window.removeEventListener("geolabs:toggleSidebar", handler);
  }, [collapseAll]);

  // announce state so Header can morph icon
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("geolabs:sidebarChanged", { detail: { open } }));
  }, [open]);

  // close on route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // close on ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // prevent body scroll when open
  useEffect(() => {
    document.body.classList.toggle("sb-no-scroll", open);
  }, [open]);

  const toggleGroup = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const NavItem = ({ to, icon: Icon, label }) => (
    <NavLink
      to={to}
      className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
      onClick={() => setOpen(false)}
      end={to === "/"}
    >
      <div className="sb-row sb-row--sub">
        <span className="sb-ico">
          <Icon />
        </span>
        <span className="sb-text">{label}</span>
        <FaCircle className="sb-dot" />
      </div>
    </NavLink>
  );

  const Group = ({ group }) => {
    const GroupIcon = group.icon || FaDatabase;
    const isOpen = expanded[group.id];

    return (
      <div className="sb-group">
        <button
          className={`sb-row sb-group-trigger sb-row--group ${isOpen ? "open" : ""}`}
          onClick={() => toggleGroup(group.id)}
          aria-expanded={isOpen}
        >
          <span className="sb-ico">
            <GroupIcon />
          </span>
          <span className="sb-text">{group.label}</span>
          <FaChevronDown className={`sb-chevron ${isOpen ? "rot" : ""}`} />
        </button>

        <div className={`sb-collapse ${isOpen ? "expanded" : "collapsed"}`}>
          {group.items.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop (starts below header) */}
      <div
        className={`sb-backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Overlay Drawer */}
      <aside
        id="geolabs-sidebar"
        className={`sidebar-overlay ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
      >
        <div className="sb-header">
          <div className="sb-title">Navigation</div>
        </div>

        <nav className="sb-nav" role="navigation">
          {navigationGroups.map((group) => (
            <Group key={group.id} group={group} />
          ))}
        </nav>

        <div className="sb-footer">Geolabs v2.0</div>
      </aside>
    </>
  );
}
