import React, { useState, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FaChevronDown,
  FaChevronRight,
  FaRobot,
  FaChartBar,
  FaTools,
  FaUserShield,
  FaServer,
  FaShieldAlt,
  FaHome,
  FaDatabase,
  FaFolderOpen,
  FaBoxOpen,
  FaSearch,
  FaFileAlt,
  FaEnvelopeOpenText,
} from "react-icons/fa";
import "../styles/Sidebar.css";

const SECTIONS = [
  {
    key: "home",
    title: "Home",
    items: [{ label: "Overview", to: "/", icon: FaHome }],
  },
  {
    key: "ai",
    title: "AI",
    items: [{ label: "Ask AI", to: "/ask-ai", icon: FaRobot }],
  },
  {
    key: "analytics",
    title: "Analytics",
    items: [{ label: "Reports", to: "/reports", icon: FaFileAlt }],
  },
  {
    key: "ops",
    title: "Ops",
    collapsible: true,
    items: [
      { label: "File Audit", to: "/file-audit", icon: FaDatabase },
      { label: "OCR Work Orders", to: "/ocr-lookup", icon: FaSearch },
      { label: "Core Inventory", to: "/core-box-inventory", icon: FaBoxOpen },
      { label: "Reports Binder", to: "/reports-binder", icon: FaChartBar },
    ],
  },
  {
    key: "people",
    title: "People",
    items: [{ label: "Directory", to: "/contacts", icon: FaEnvelopeOpenText }],
  },
  {
    key: "it",
    title: "IT",
    collapsible: true,
    items: [
      { label: "S3 Bucket", to: "/s3-bucket", icon: FaShieldAlt },
      { label: "Server Search", to: "/server-search", icon: FaFolderOpen },
      { label: "IT Operations", to: "/it-operations", icon: FaUserShield },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();

  const defaultOpen = useMemo(() => {
    const open = {};
    SECTIONS.forEach((sec) => {
      if (!sec.collapsible) return;
      open[sec.key] = sec.items.some((i) => location.pathname.startsWith(i.to));
    });
    return open;
  }, [location.pathname]);

  const [open, setOpen] = useState(defaultOpen);
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <aside className="sb">
      <div className="sb-inner">
        {/* NOTE: org/logo header removed per your request */}

        <nav className="sb-nav" aria-label="Primary">
          {SECTIONS.map((sec) => (
            <div className="sb-sec" key={sec.key}>
              <div className="sb-sec-title">
                {sec.title}
                {sec.collapsible && (
                  <button
                    className="sb-collapse"
                    onClick={() => toggle(sec.key)}
                    aria-expanded={!!open[sec.key]}
                    aria-controls={`sb-sec-${sec.key}`}
                    title={open[sec.key] ? "Collapse" : "Expand"}
                  >
                    {open[sec.key] ? <FaChevronDown /> : <FaChevronRight />}
                  </button>
                )}
              </div>

              <ul
                id={`sb-sec-${sec.key}`}
                className={`sb-list ${sec.collapsible ? (open[sec.key] ? "is-open" : "is-closed") : ""}`}
              >
                {sec.items.map((item) => {
                  const Icon = item.icon || FaTools;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          "sb-link" + (isActive ? " is-active" : "")
                        }
                      >
                        <Icon className="sb-ico" />
                        <span className="sb-label">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <a
            className="sb-foot-link"
            href="https://intranet/"
            target="_blank"
            rel="noreferrer"
          >
            <FaServer className="sb-ico" />
            Intranet
          </a>
          <a
            className="sb-foot-link"
            href="mailto:it@geolabs.com"
            rel="noreferrer"
          >
            <FaShieldAlt className="sb-ico" />
            IT Support
          </a>
        </div>
      </div>
    </aside>
  );
}
