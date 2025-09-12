// src/components/HomePageCards.jsx
import {
  FaRobot,
  FaDatabase,
  FaCogs,
  FaTable,
  FaFolderOpen,
  FaSearch,
  FaFileAlt,
  FaCloudUploadAlt,
  FaBoxOpen,
  FaEnvelopeOpenText,
  FaShieldAlt,
  FaUserCheck,
  FaUserTimes,
  FaTicketAlt,
  FaQuestionCircle
} from "react-icons/fa";

/**
 * Grouping logic:
 * 1) AI & Knowledge — Ask + explore knowledge
 * 2) Data & Indexing — DB explorer + ingest/index
 * 3) Projects & Files — OCR, S3, Core inventory
 * 4) Reports & Analytics — reports & binder
 * 5) People & Admin — directory + admin console
 *
 * Notes:
 * - Kept all routes unchanged
 * - Names avoid “chatbot”; “Ask Geolabs AI” reads professional
 * - Consistent, concise descriptions and tags
 */

const homepageCards = [
  // 1 — AI & Knowledge
  {
    label: "AI & Knowledge",
    sublabel: "Ask, compare, cite",
    tag: "AI",
    updated: "2025-08-13",
    icon: <FaRobot size={24} />,
    description:
      "Ask questions across your documents and data. Get concise, sourced answers for faster research.",
    subpages: [
      {
        name: "Ask Geolabs AI",
        icon: <FaRobot />,
        path: "/ask-ai",
        description:
          "Query internal docs with AI and get citation-ready responses."
      }
    ]
  },

  // 2 — Data & Indexing
  {
    label: "Data & Indexing",
    sublabel: "Explore & manage datasets",
    tag: "Data",
    updated: "2025-08-13",
    icon: <FaDatabase size={24} />,
    description:
      "Browse database contents for audits and onboarding. Manage ingestion and indexing of new documents.",
    subpages: [
      {
        name: "Database Explorer",
        icon: <FaTable />,
        path: "/db-viewer",
        description:
          "Inspect tables and files quickly with filters and previews."
      },
      {
        name: "Index Manager",
        icon: <FaCogs />,
        path: "/db-admin",
        description:
          "Upload PDFs, extract text, and refresh embeddings (authorized)."
      }
    ]
  },

  // 3 — Projects & Files
  {
    label: "Projects & Files",
    sublabel: "Search, browse, upload",
    tag: "Ops",
    updated: "2025-08-13",
    icon: <FaFolderOpen size={24} />,
    description:
      "Find work orders via OCR, browse S3 repositories, and maintain core inventory.",
    subpages: [
      {
        name: "OCR Lookup",
        icon: <FaSearch />,
        path: "/ocr-lookup",
        description:
          "Pull work orders and project data from scanned and handwritten docs."
      },
      {
        name: "S3 Browser",
        icon: <FaFileAlt />,
        path: "/s3-viewer",
        description:
          "Preview and open files stored in S3 with metadata at a glance."
      },
      {
        name: "S3 Uploader",
        icon: <FaCloudUploadAlt />,
        path: "/s3-admin",
        description:
          "Upload and organize report archives in S3 (permissions required)."
      },
      {
        name: "Core Inventory",
        icon: <FaBoxOpen />,
        path: "/core-box-inventory",
        description:
          "Track core boxes by status, location, and age with quick filters."
      }
    ]
  },

  // 4 — Reports & Analytics
  {
    label: "Reports & Analytics",
    sublabel: "Review & edit extracted data",
    tag: "Analytics",
    updated: "2025-08-13",
    icon: <FaTable size={24} />,
    description:
      "Work with report tables and extracted rows. Filter, edit, and export data.",
    subpages: [
      {
        name: "Reports",
        icon: <FaFileAlt />,
        path: "/reports",
        description:
          "Access compiled geotechnical reports and dashboards."
      },
      {
        name: "Reports Binder",
        icon: <FaTable />,
        path: "/reports-binder",
        description:
          "Browse & edit rows from OCR (WO, initials, billing, dates) and export CSV."
      },
      {
        name: "Retrieval-Augmented Generation",
        icon: <FaTable />,
        path: "/rag-core",
        description:
          "Browse & edit rows from OCR (WO, initials, billing, dates) and export CSV."
      }
    ]
  },

  // 5 — People & Admin
  {
    label: "People & Admin",
    sublabel: "Directory & controls",
    tag: "Admin",
    updated: "2025-08-13",
    icon: <FaShieldAlt size={24} />,
    description:
      "Look up people and manage access, roles, and configuration.",
    subpages: [
      {
        name: "Directory",
        icon: <FaEnvelopeOpenText />,
        path: "/contacts",
        description:
          "Company directory + Outlook contacts with quick copy and CSV export."
      },
      {
        name: "Admin Console",
        icon: <FaCogs />,
        path: "/admin",
        description:
          "Roles, activity, and system settings (owners/admins only)."
      }
    ]
  },

  // 6 — IT Administration
  {
    label: "IT Administration",
    sublabel: "Onboarding, support & FAQs",
    tag: "IT",
    updated: "2025-09-02",
    icon: <FaShieldAlt size={24} />,
    description:
      "Manage IT tasks for employees: onboarding, offboarding, tickets, and support resources.",
    subpages: [
      {
        name: "Onboarded Accounts",
        icon: <FaUserCheck />,
        path: "/it-onboarded",
        description:
          "View and manage all currently onboarded employee accounts."
      },
      {
        name: "Terminated Accounts",
        icon: <FaUserTimes />,
        path: "/it-terminated",
        description:
          "Review terminated accounts and confirm offboarding steps."
      },
      {
        name: "Ticket Requests",
        icon: <FaTicketAlt />,
        path: "/it-tickets",
        description:
          "Submit and track IT support requests for hardware, software, and access."
      }
    ]
  }
];

export default homepageCards;
