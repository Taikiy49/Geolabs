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
} from "react-icons/fa";

const homepageCards = [
  // AI
  {
    label: "Ask AI",
    tag: "AI",
    updated: "2025-09-14", // +2 days
    icon: <FaRobot size={24} />,
    description: "Ask natural language questions and get sourced answers.", // short (mobile)
    descriptionLong:
      "Ask natural language questions and get sourced answers with citations, inline previews, and exportable summaries for quick sharing.", // long (desktop)
    path: "/ask-ai",
  },

  // Reports & Analytics
  {
    label: "Reports",
    tag: "Analytics",
    updated: "2025-09-13", // +1 day
    icon: <FaFileAlt size={24} />,
    description: "Browse compiled geotechnical reports and dashboards.",
    descriptionLong:
      "Browse compiled geotechnical reports, slice dashboards by client/project/date, and jump into related files with one click.",
    path: "/reports",
  },
  {
    label: "Reports Binder",
    tag: "Analytics",
    updated: "2025-09-14", // +2 days
    icon: <FaTable size={24} />,
    description:
      "Filter and edit OCR rows (WO, initials, billing, dates) and export CSV.",
    descriptionLong:
      "Filter and edit OCR rows (WO, initials, billing, dates), validate against rules, track changes, and export curated CSVs for billing.",
    path: "/reports-binder",
  },

  // Projects & Files
  {
    label: "OCR Work Orders",
    tag: "Ops",
    updated: "2025-09-13", // +1 day
    icon: <FaSearch size={24} />,
    description: "Find WOs and project data from scanned and handwritten docs.",
    descriptionLong:
      "Find work orders and project data from scanned and handwritten documents using OCR, fuzzy matching, and quick copy for PR tracking.",
    path: "/ocr-lookup",
  },
  {
    label: "Core Inventory",
    tag: "Ops",
    updated: "2025-09-14", // +2 days
    icon: <FaBoxOpen size={24} />,
    description: "Track core boxes by status, location, and age with filters.",
    descriptionLong:
      "Track core boxes by status, location, and age with filters, alerts for aged cores, and CSV exports for warehouse operations.",
    path: "/core-box-inventory",
  },

  // People & Access
  {
    label: "People Directory",
    tag: "Admin",
    updated: "2025-09-13", // +1 day
    icon: <FaEnvelopeOpenText size={24} />,
    description: "Company directory + Outlook contacts with quick copy/CSV.",
    descriptionLong:
      "Company directory synced with Outlook contacts; quick copy of emails/phones, CSV export, and smart search by team/location/role.",
    path: "/contacts",
  },

  // S3 + IT
  {
    label: "S3 Bucket",
    tag: "IT",
    updated: "2025-09-14", // +2 days
    icon: <FaShieldAlt size={24} />,
    description: "View and manage S3 bucket contents.",
    descriptionLong:
      "View and manage S3 bucket contents: browse, search keys or PDF contents, preview, presigned links, move/rename, and delete files.",
    path: "/s3-bucket",
  },
  {
    label: "IT Operations",
    tag: "IT",
    updated: "2025-09-13", // +1 day
    icon: <FaShieldAlt size={24} />,
    description: "Onboarding, offboarding, support requests, and FAQs.",
    descriptionLong:
      "Onboarding/offboarding checklists, support request intake, asset tracking, and FAQs for common IT workflows and policies.",
    path: "/it-operations",
  },
  {
    label: "Server Search",
    tag: "IT",
    updated: "2025-09-14", // +2 days
    icon: <FaFolderOpen size={24} />,
    description: "Search internal file servers by name, type, size, and date.",
    descriptionLong:
      "Search internal file servers by name, type, size, and date; preview files, copy paths, and export results for audits and clean-up.",
    path: "/server-search"
  },
];

export default homepageCards;
