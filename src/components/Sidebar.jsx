import React, { useEffect, useState, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FaBars,
  FaTimes,
  FaChevronDown,
  FaRobot,
  FaDatabase,
  FaCogs,
  FaTable,
  FaFolderOpen,
  FaCloudUploadAlt,
  FaCloud,
  FaSearch,
  FaHome,
  FaUserShield,
  FaAddressBook,
  FaBoxOpen,
  FaFileAlt,
  FaChartBar,
} from "react-icons/fa";
import "../styles/Sidebar.css";

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);
  
  return isMobile;
}

export default function Sidebar({ collapsed, setCollapsed }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const path = location.pathname || "/";

  // Navigation groups
  const navigationGroups = [
    {
      id: "main",
      label: "Main",
      items: [
        { to: "/", icon: FaHome, label: "Dashboard" }
      ]
    },
    {
      id: "documents",
      label: "Document Intelligence",
      items: [
        { to: "/ask-ai", icon: FaRobot, label: "AI Assistant" },
        { to: "/db-viewer", icon: FaTable, label: "Database Viewer" },
        { to: "/db-admin", icon: FaCogs, label: "Database Admin" }
      ]
    },
    {
      id: "projects",
      label: "Project Management",
      items: [
        { to: "/s3-viewer", icon: FaCloud, label: "S3 Browser" },
        { to: "/s3-admin", icon: FaCloudUploadAlt, label: "S3 Management" },
        { to: "/ocr-lookup", icon: FaSearch, label: "OCR Lookup" },
        { to: "/core-box-inventory", icon: FaBoxOpen, label: "Core Inventory" }
      ]
    },
    {
      id: "reports",
      label: "Reports & Analytics",
      items: [
        { to: "/reports", icon: FaFileAlt, label: "Reports" },
        { to: "/reports-binder", icon: FaChartBar, label: "Reports Binder" }
      ]
    },
    {
      id: "admin",
      label: "Administration",
      items: [
        { to: "/admin", icon: FaUserShield, label: "User Management" },
        { to: "/contacts", icon: FaAddressBook, label: "Contacts" }
      ]
    }
  ];

  // Track which groups have active items
  const activeGroups = useMemo(() => {
    const active = {};
    navigationGroups.forEach(group => {
      active[group.id] = group.items.some(item => 
        item.to === path || (item.to !== "/" && path.startsWith(item.to))
      );
    });
    return active;
  }, [path, navigationGroups]);

  // Manage dropdown states
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    navigationGroups.forEach(group => {
      initial[group.id] = activeGroups[group.id] || group.id === "main";
    });
    return initial;
  });

  // Auto-expand groups with active items
  useEffect(() => {
    setExpandedGroups(prev => {
      const updated = { ...prev };
      Object.keys(activeGroups).forEach(groupId => {
        if (activeGroups[groupId]) {
          updated[groupId] = true;
        }
      });
      return updated;
    });
  }, [activeGroups]);

  // Update CSS custom property for layout
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-sidebar",
      collapsed ? "collapsed" : "expanded"
    );
  }, [collapsed]);

  // Close mobile sidebar on route change
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  const toggleGroup = (groupId) => {
    if (collapsed) return;
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const handleLinkClick = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  // Mobile backdrop
  const renderBackdrop = () => {
    if (!isMobile || !sidebarOpen) return null;
    return (
      <div 
        className="sidebar-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
    );
  };

  // Navigation item component
  const NavItem = ({ to, icon: Icon, label, onClick }) => (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
      onClick={onClick || handleLinkClick}
      title={collapsed ? label : undefined}
    >
      <Icon className="nav-icon" />
      <span className="nav-text">{label}</span>
    </NavLink>
  );

  if (isMobile) {
    return (
      <>
        {renderBackdrop()}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <FaTimes />
          </button>
          
          <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
            {navigationGroups.map(group => (
              <div key={group.id} className="nav-group">
                {group.items.length > 1 ? (
                  <>
                    <button
                      className={`nav-group-trigger ${activeGroups[group.id] ? "active" : ""}`}
                      onClick={() => toggleGroup(group.id)}
                      aria-expanded={expandedGroups[group.id]}
                    >
                      <FaDatabase className="nav-icon" />
                      <span className="nav-text">{group.label}</span>
                      <FaChevronDown className={`nav-chevron ${expandedGroups[group.id] ? "expanded" : ""}`} />
                    </button>
                    <div className={`nav-dropdown ${expandedGroups[group.id] ? "expanded" : "collapsed"}`}>
                      {group.items.map(item => (
                        <NavItem key={item.to} {...item} />
                      ))}
                    </div>
                  </>
                ) : (
                  group.items.map(item => (
                    <NavItem key={item.to} {...item} />
                  ))
                )}
              </div>
            ))}
          </nav>
          
          <div className="sidebar-footer">
            <div className="sidebar-footer-content">
              <FaCogs />
              <span>Geolabs v2.0</span>
            </div>
          </div>
        </aside>
      </>
    );
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <FaBars /> : <FaTimes />}
      </button>

      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {navigationGroups.map(group => (
          <div key={group.id} className="nav-group">
            {group.items.length > 1 ? (
              <>
                <button
                  className={`nav-group-trigger ${activeGroups[group.id] ? "active" : ""}`}
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={expandedGroups[group.id]}
                  title={collapsed ? group.label : undefined}
                >
                  <FaDatabase className="nav-icon" />
                  <span className="nav-text">{group.label}</span>
                  {!collapsed && (
                    <FaChevronDown className={`nav-chevron ${expandedGroups[group.id] ? "expanded" : ""}`} />
                  )}
                </button>
                {!collapsed && (
                  <div className={`nav-dropdown ${expandedGroups[group.id] ? "expanded" : "collapsed"}`}>
                    {group.items.map(item => (
                      <NavItem key={item.to} {...item} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              group.items.map(item => (
                <NavItem key={item.to} {...item} />
              ))
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-content">
          <FaCogs />
          <span>Geolabs v2.0</span>
        </div>
      </div>
    </aside>
  );
}