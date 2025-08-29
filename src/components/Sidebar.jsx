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
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < breakpoint : false);
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

  // Navigation groups
  const navigationGroups = [
    {
      id: "main",
      label: "Main",
      icon: FaHome,
      items: [{ to: "/", icon: FaHome, label: "Dashboard" }],
    },
    {
      id: "documents",
      label: "Document Intelligence",
      icon: FaDatabase,
      items: [
        { to: "/ask-ai", icon: FaRobot, label: "AI Assistant" },
        { to: "/db-viewer", icon: FaTable, label: "Database Viewer" },
        { to: "/db-admin", icon: FaCogs, label: "Database Admin" },
      ],
    },
    {
      id: "projects",
      label: "Project Management",
      icon: FaCloud,
      items: [
        { to: "/s3-viewer", icon: FaCloud, label: "S3 Browser" },
        { to: "/s3-admin", icon: FaCloudUploadAlt, label: "S3 Management" },
        { to: "/ocr-lookup", icon: FaSearch, label: "OCR Lookup" },
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
      id: "admin",
      label: "Administration",
      icon: FaUserShield,
      items: [
        { to: "/admin", icon: FaUserShield, label: "User Management" },
        { to: "/contacts", icon: FaAddressBook, label: "Contacts" },
      ],
    },
  ];

  // Active group detection
  const activeGroups = useMemo(() => {
    const active = {};
    navigationGroups.forEach((g) => {
      active[g.id] = g.items.some((item) => item.to === path || (item.to !== "/" && path.startsWith(item.to)));
    });
    return active;
  }, [path, navigationGroups]);

  // Expanded groups state
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    navigationGroups.forEach((g) => {
      initial[g.id] = g.id === "main" || activeGroups[g.id];
    });
    return initial;
  });

  // Auto-open active group
  useEffect(() => {
    setExpandedGroups((prev) => {
      const updated = { ...prev };
      Object.keys(activeGroups).forEach((id) => {
        if (activeGroups[id]) updated[id] = true;
      });
      return updated;
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
            className={`sb-group-trigger ${open ? "open" : ""} ${activeGroups[group.id] ? "active" : ""}`}
            onClick={() => toggleGroup(group.id)}
            aria-expanded={open}
            title={collapsed ? group.label : undefined}
          >
            <GroupIcon className="sb-icon" />
            <span className="sb-text">{group.label}</span>
            {!collapsed && <FaChevronDown className={`sb-chevron ${open ? "rot" : ""}`} />}
          </button>
        ) : (
          // If only one item, render it directly as a top-level link
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
        {sidebarOpen && <div className="sb-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
        <aside className={`sidebar modern ${sidebarOpen ? "open" : ""}`}>
          <button className="sb-toggle top" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
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

        {/* Small floating button to open drawer (can be placed in Header if preferred) */}
        {!sidebarOpen && (
          <button className="sb-fab" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
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
