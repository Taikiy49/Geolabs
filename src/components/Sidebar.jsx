import React, { useEffect, useState, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
} from "react-icons/fa";
import "../styles/Sidebar.css";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

export default function Sidebar({ collapsed, setCollapsed, variant = "sb--slate" }) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  const path = location.pathname || "/";

  const docChildren = ["/ask-ai", "/db-viewer", "/db-admin"];
  const projChildren = ["/s3-viewer", "/s3-admin", "/ocr-lookup", "/core-box-inventory"];

  const parentActive = useMemo(
    () => ({
      doc: docChildren.some((p) => path.startsWith(p)),
      proj: projChildren.some((p) => path.startsWith(p)),
    }),
    [path]
  );

  const [dropdowns, setDropdowns] = useState({ doc: true, proj: true });
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-sidebar",
      collapsed ? "collapsed" : "expanded"
    );
  }, [collapsed]);
  // Keep groups open if a child route is active
  useEffect(() => {
    setDropdowns((d) => ({
      doc: parentActive.doc || d.doc,
      proj: parentActive.proj || d.proj,
    }));
  }, [parentActive.doc, parentActive.proj]);

  const toggleDropdown = (key) =>
    setDropdowns((d) => ({ ...d, [key]: !d[key] }));

  const Item = ({ to, icon: Icon, label }) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `sidebar-link ${isActive ? "active" : ""}`
      }
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
      title={label}
    >
      <Icon className="sidebar-link-icon" />
      {!collapsed && <span className="sidebar-text">{label}</span>}
    </NavLink>
  );

  if (isMobile) return null;

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""} ${variant}`}>
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
        title={collapsed ? "Open sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <FaBars /> : <FaTimes />}
      </button>

      {/* Home */}
      {!collapsed && <Item to="/" icon={FaHome} label="Home" key="home" />}

      {/* Document Databases */}
      <button
        className={`sidebar-link ${parentActive.doc ? "active-parent" : ""}`}
        onClick={() => toggleDropdown("doc")}
        aria-expanded={dropdowns.doc}
        aria-controls="doc-group"
        title="Document Databases"
      >
        <FaDatabase className="sidebar-link-icon" />
        {!collapsed && <span className="sidebar-text">Document Databases</span>}
        {!collapsed && (
          <FaChevronDown
            className={`sidebar-link-chevron ${dropdowns.doc ? "rotate" : ""}`}
          />
        )}
      </button>
      {dropdowns.doc && !collapsed && (
        <div className="sidebar-dropdown" id="doc-group">
          <Item to="/ask-ai" icon={FaRobot} label="Ask AI" />
          <Item to="/db-viewer" icon={FaTable} label="DB Viewer" />
          <Item to="/db-admin" icon={FaCogs} label="DB Editor" />
        </div>
      )}

      {/* Project Finder */}
      <button
        className={`sidebar-link ${parentActive.proj ? "active-parent" : ""}`}
        onClick={() => toggleDropdown("proj")}
        aria-expanded={dropdowns.proj}
        aria-controls="proj-group"
        title="Project Finder"
      >
        <FaFolderOpen className="sidebar-link-icon" />
        {!collapsed && <span className="sidebar-text">Project Finder</span>}
        {!collapsed && (
          <FaChevronDown
            className={`sidebar-link-chevron ${dropdowns.proj ? "rotate" : ""}`}
          />
        )}
      </button>
      {dropdowns.proj && !collapsed && (
        <div className="sidebar-dropdown" id="proj-group">
          <Item to="/s3-viewer" icon={FaCloud} label="S3 Viewer" />
          <Item to="/s3-admin" icon={FaCloudUploadAlt} label="S3 Editor" />
          <Item to="/ocr-lookup" icon={FaSearch} label="OCR Lookup" />
          <Item to="/core-box-inventory" icon={FaBoxOpen} label="Core Box Inventory" />
        </div>
      )}
      <Item to="/reports" icon={FaUserShield} label="Reports" key="reports" />
      
      {/* Admin */}
      
      <Item to="/admin" icon={FaUserShield} label="Admin" key="admin" />

      {/* Contacts */}
      <Item to="/contacts" icon={FaAddressBook} label="Contacts" key="contacts" />
    </aside>
  );
}
