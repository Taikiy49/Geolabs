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
  // 1 — AI & Insights (Ask + RAG)
  {
    label: "AI & Insights",
    sublabel: "Search, compare, and cite with AI",
    tag: "AI",
    updated: "2025-09-12",
    icon: <FaRobot size={24} />,
    description:
      "Ask questions across your knowledge base and generate citation-ready answers.",
    subpages: [
      {
        name: "Ask Geolabs AI",
        icon: <FaRobot />,
        path: "/ask-ai",
        description: "Ask natural language questions and get sourced answers."
      },
      {
        name: "RAG Workbench",
        icon: <FaQuestionCircle />,
        path: "/rag-core",
        description: "Search, score, and cite snippets for precise responses."
      }
    ]
  },

  // 2 — Reports & Analytics
  {
    label: "Reports & Analytics",
    sublabel: "Dashboards and tabular review",
    tag: "Analytics",
    updated: "2025-09-12",
    icon: <FaTable size={24} />,
    description:
      "Review report tables, refine extracted rows, and export curated data.",
    subpages: [
      {
        name: "Reports",
        icon: <FaFileAlt />,
        path: "/reports",
        description: "Browse compiled geotechnical reports and dashboards."
      },
      {
        name: "Report Binder",
        icon: <FaTable />,
        path: "/reports-binder",
        description:
          "Filter and edit OCR rows (WO, initials, billing, dates) and export CSV."
      }
    ]
  },

  // 3 — Projects & Files
  {
    label: "Projects & Files",
    sublabel: "Search, browse, upload",
    tag: "Ops",
    updated: "2025-09-12",
    icon: <FaFolderOpen size={24} />,
    description:
      "Locate work orders via OCR, browse S3 repositories, and manage core inventory.",
    subpages: [
      {
        name: "OCR Work Orders",
        icon: <FaSearch />,
        path: "/ocr-lookup",
        description: "Find WOs and project data from scanned and handwritten docs."
      },
      {
        name: "File Browser (S3)",
        icon: <FaFileAlt />,
        path: "/s3-viewer",
        description: "Preview and open files in S3 with metadata at a glance."
      },
      {
        name: "Upload to S3",
        icon: <FaCloudUploadAlt />,
        path: "/s3-admin",
        description: "Upload and organize report archives (permissions required)."
      },
      {
        name: "Core Inventory",
        icon: <FaBoxOpen />,
        path: "/core-box-inventory",
        description: "Track core boxes by status, location, and age with filters."
      }
    ]
  },

  // 4 — Data & Indexing
  {
    label: "Data & Indexing",
    sublabel: "Explore datasets and manage indexing",
    tag: "Data",
    updated: "2025-09-12",
    icon: <FaDatabase size={24} />,
    description:
      "Explore database contents for audits and onboarding. Control ingestion and indexing.",
    subpages: [
      {
        name: "Database Explorer",
        icon: <FaTable />,
        path: "/db-viewer",
        description: "Inspect tables and files with filters and quick previews."
      },
      {
        name: "Ingestion & Indexing",
        icon: <FaCogs />,
        path: "/db-admin",
        description: "Upload PDFs, extract text, and refresh embeddings."
      }
    ]
  },

  // 5 — People & Access
  {
    label: "People & Access",
    sublabel: "Directory and access controls",
    tag: "Admin",
    updated: "2025-09-12",
    icon: <FaUserCheck size={24} />,
    description:
      "Look up people and manage roles, permissions, and configuration.",
    subpages: [
      {
        name: "People Directory",
        icon: <FaEnvelopeOpenText />,
        path: "/contacts",
        description: "Company directory + Outlook contacts with quick copy/CSV."
      },
      {
        name: "Access & Roles",
        icon: <FaCogs />,
        path: "/admin",
        description: "Manage roles, activity, and system settings."
      }
    ]
  },

  // 6 — IT Operations
  {
    label: "IT Operations",
    sublabel: "Onboarding, offboarding, tickets",
    tag: "IT",
    updated: "2025-09-12",
    icon: <FaShieldAlt size={24} />,
    description:
      "Handle employee onboarding/offboarding, support requests, and FAQs.",
    subpages: [
      {
        name: "Onboarded Accounts",
        icon: <FaUserCheck />,
        path: "/it-onboarded",
        description: "View and manage all active onboarded accounts."
      },
      {
        name: "Terminated Accounts",
        icon: <FaUserTimes />,
        path: "/it-terminated",
        description: "Review terminated accounts and confirm offboarding steps."
      },
      {
        name: "Support Tickets",
        icon: <FaTicketAlt />,
        path: "/it-tickets",
        description:
          "Submit and track IT support requests for hardware, software, and access."
      }
    ]
  }
];

export default homepageCards;