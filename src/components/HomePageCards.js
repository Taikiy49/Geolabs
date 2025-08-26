import {
  FaDatabase,
  FaComments,
  FaTable,
  FaUpload,
  FaFolderOpen,
  FaSearch,
  FaFileAlt,
  FaCloudUploadAlt,
  FaEnvelopeOpenText,
  FaCogs
} from 'react-icons/fa';

const homepageCards = [
  // 0 — Document Databases (category)
  {
    label: 'Document Databases',
    sublabel: 'Docs & AI Assistant',
    tag: 'AI',
    updated: '2025-08-10',
    icon: <FaDatabase size={40} />,
    description:
      'Access Geolabs’ internal knowledge base. Ask questions with AI, browse structured DBs, and manage indexing with role-based access.',
    subpages: [
      {
        name: 'Ask AI',
        icon: <FaComments />,
        path: '/ask-ai',
        description:
          'Chat with an AI assistant trained on internal docs. Get concise, citation-ready answers.',
      },
      {
        name: 'DB Viewer',
        icon: <FaTable />,
        path: '/db-viewer',
        description:
          'Explore database contents quickly for audits, onboarding, or policy reviews.',
      },
      {
        name: 'DB Editor',
        icon: <FaUpload />,
        path: '/db-admin',
        description:
          'Upload PDFs, auto-extract & embed content, and manage indexes (authorized users).',
      },
    ],
  },

  // 1 — Project Finder (category)
  {
    label: 'Project Finder',
    sublabel: 'Geotechnical Reports',
    tag: 'New',
    updated: '2025-08-12',
    icon: <FaFolderOpen size={40} />,
    description:
      'Search and retrieve geotechnical reports with OCR-enhanced lookup, S3 browsing, and instant PDF viewing.',
    subpages: [
      {
        name: 'OCR Lookup',
        icon: <FaSearch />,
        path: '/ocr-lookup',
        description:
          'Extract work orders and project info from scanned/handwritten documents.',
      },
      {
        name: 'S3 Viewer',
        icon: <FaFileAlt />,
        path: '/s3-viewer',
        description:
          'Browse thousands of reports stored on S3. Quick preview and metadata at a glance.',
      },
      {
        name: 'S3 Editor',
        icon: <FaCloudUploadAlt />,
        path: '/s3-admin',
        description:
          'Upload and organize S3 report archives directly in your browser (permissions required).',
      },
      {
        name: 'Core Box Inventory',
        icon: <FaCogs />,
        path: '/core-box-inventory',
        description:
          'Track physical core boxes: filters, aging, and status (expired/active).',
      },
    ],
  },  
 {
  label: 'Reports Binder',
  sublabel: 'OCR Log & Edits',
  tag: 'Data',
  updated: '2025-08-13',
  icon: <FaTable size={40} />,
  description:
    'Browse & edit rows extracted from PDFs (reports_binder.db). Filter by WO, initials, billing, dates; export CSV.',
  path: '/reports-binder',
  disabled: false,
},
{
    label: 'Reports',
    sublabel: 'Geotechnical Reports',
    tag: 'Reports',
    updated: '2025-08-13',
    icon: <FaCogs size={40} />,
    description:
      'Manage user roles, monitor activity, and configure system settings. Owners/Admins only.',
    path: '/reports',
    disabled: false,
  },

  // 2 — Admin (rendered by your “Admin Section” block)
  {
    label: 'Admin',
    sublabel: 'System Management',
    tag: 'Admin',
    updated: '2025-08-13',
    icon: <FaCogs size={40} />,
    description:
      'Manage user roles, monitor activity, and configure system settings. Owners/Admins only.',
    path: '/admin',
    disabled: false,
  },

  // 3 — Contacts (rendered by your “Contact Section” block)
  {
    label: 'Contacts',
    sublabel: 'People & Teams',
    tag: 'Directory',
    updated: '2025-08-11',
    icon: <FaEnvelopeOpenText size={40} />,
    description:
      'Company directory + your Outlook contacts: search, copy phones/emails, export CSV.',
    path: '/contacts',
    disabled: false,
  },
];

export default homepageCards;
