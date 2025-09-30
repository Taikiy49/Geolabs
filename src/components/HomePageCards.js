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
    updated: "2025-09-12",
    icon: <FaRobot size={24} />,
    description: "Ask natural language questions and get sourced answers.",
    path: "/ask-ai",
  },

  // Reports & Analytics
  {
    label: "Reports",
    tag: "Analytics",
    updated: "2025-09-12",
    icon: <FaFileAlt size={24} />,
    description: "Browse compiled geotechnical reports and dashboards.",
    path: "/reports",
  },
  {
    label: "Report Binder",
    tag: "Analytics",
    updated: "2025-09-12",
    icon: <FaTable size={24} />,
    description:
      "Filter and edit OCR rows (WO, initials, billing, dates) and export CSV.",
    path: "/reports-binder",
  },

  // Projects & Files
  {
    label: "OCR Work Orders",
    tag: "Ops",
    updated: "2025-09-12",
    icon: <FaSearch size={24} />,
    description: "Find WOs and project data from scanned and handwritten docs.",
    path: "/ocr-lookup",
  },
  {
    label: "Core Inventory",
    tag: "Ops",
    updated: "2025-09-12",
    icon: <FaBoxOpen size={24} />,
    description: "Track core boxes by status, location, and age with filters.",
    path: "/core-box-inventory",
  },

  // People & Access
  {
    label: "People Directory",
    tag: "Admin",
    updated: "2025-09-12",
    icon: <FaEnvelopeOpenText size={24} />,
    description: "Company directory + Outlook contacts with quick copy/CSV.",
    path: "/contacts",
  },
  // S3 + IT
  {
    label: "S3 Bucket",
    tag: "IT",
    updated: "2025-09-12",
    icon: <FaShieldAlt size={24} />,
    description: "View and manage S3 bucket contents.",
    path: "/s3-bucket",
  },
  {
    label: "IT Operations",
    tag: "IT",
    updated: "2025-09-12",
    icon: <FaShieldAlt size={24} />,
    description: "Onboarding, offboarding, support requests, and FAQs.",
    path: "/it-operations",
  },
];

export default homepageCards;
