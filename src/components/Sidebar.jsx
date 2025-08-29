// src/components/Sidebar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FaBars,
  FaTimes,
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
} from "react-icons/fa";
import "../styles/Sidebar.css";

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

export default function Sidebar({ collapsed, setCollapsed }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const path = location.pathname || "/";

  // ---- NAV GROUPS (aligned with HomePage) ----
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
        items: [
          { to: "/ask-ai", icon: FaRobot, label: "Ask Geolabs AI" },
        ],
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
    ],
    []
  );

  // Which groups are active for current path
  const activeGroups = useMemo(() => {
    const active = {};
    navigationGroups.forEach((group) => {
      active[group.id] = group.items.some(
        (item) => item.to === path || (item.to !== "/" && path.startsWith(item.to))
      );
    });
    return active;
  }, [path, navigationGroups]);

  // Initial: open main and any active groups
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const init = {};
    navigationGroups.forEach((group) => {
      init[group.id] = group.id === "main" || !!activeGroups[group.id];
    });
    return init;
  });

  // Only update expanded state when it actually changes (prevents nested update warning)
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(activeGroups)) {
        if (activeGroups[id]) next[id] = true;
      }
      // shallow compare
      const a = Object.keys(prev);
      const b = Object.keys(next);
      if (a.length !== b.length) return next;
      for (const k of a) if (prev[k] !== next[k]) return next;
      return prev;
    });
  }, [activeGroups]);

  // Mobile drawer
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile]);

  const toggleGroup = (id) => {
    if (collapsed) return;
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const NavItem = ({ to, icon: Icon, label }) => (
    <NavLink
      to={to}
      className={({ isActive }) => `sb-link ${isActive ? "active" : ""}`}
      title={collapsed ? label : undefined}
      end={to === "/"}
    >
      <div className="sb-link-inner">
        <Icon className="sb-icon" />
        <span className="sb-text">{label}</span>
      </div>
      <FaCircle className="sb-dot" />
    </NavLink>
  );

  const Group = ({ group }) => {
    const GroupIcon = group.icon || FaDatabase;
    const open = expandedGroups[group.id];

    return (
      <div className="sb-group">
        {group.items.length > 1 ? (
          <button
            className={`sb-group-trigger ${open ? "open" : ""} ${
              activeGroups[group.id] ? "active" : ""
            }`}
            onClick={() => toggleGroup(group.id)}
            aria-expanded={open}
            title={collapsed ? group.label : undefined}
          >
            <GroupIcon className="sb-icon" />
            <span className="sb-text">{group.label}</span>
            {!collapsed && (
              <FaChevronDown className={`sb-chevron ${open ? "rot" : ""}`} />
            )}
          </button>
        ) : (
          <NavItem {...group.items[0]} />
        )}

        {!collapsed && group.items.length > 1 && (
          <div className={`sb-collapse ${open ? "expanded" : "collapsed"}`}>
            {group.items.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
        )}
      </div>
    );
  };

  // MOBILE
  if (isMobile) {
    return (
      <>
        {sidebarOpen && (
          <div
            className="sb-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside className={`sidebar modern ${sidebarOpen ? "open" : ""}`}>
          <button
            className="sb-toggle top"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <FaTimes />
          </button>

          <nav className="sb-nav" role="navigation" aria-label="Main navigation">
            {navigationGroups.map((group) => (
              <Group key={group.id} group={group} />
            ))}
          </nav>

          <div className="sb-footer">
            <span>Geolabs v2.0</span>
          </div>
        </aside>

        {!sidebarOpen && (
          <button
            className="sb-fab"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <FaBars />
          </button>
        )}
      </>
    );
  }

  // DESKTOP
  return (
    <aside className={`sidebar modern ${collapsed ? "collapsed" : ""}`}>
      <button
        className="sb-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? <FaBars /> : <FaTimes />}
      </button>

      <nav className="sb-nav" role="navigation" aria-label="Main navigation">
        {navigationGroups.map((group) => (
          <Group key={group.id} group={group} />
        ))}
      </nav>

      <div className="sb-footer">
        <span>Geolabs v2.0</span>
      </div>
    </aside>
  );
}
