import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import {
  FaSyncAlt,
  FaCloudDownloadAlt,
  FaPhone,
  FaBuilding,
  FaUserTie,
  FaFilter,
} from "react-icons/fa";
import "../styles/Contacts.css";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 200; // Graph page size
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

// Scopes
const SCOPES_DIR = ["User.Read", "User.ReadBasic.All", "User.Read.All", "Directory.Read.All"];
const SCOPES_ME = ["User.Read", "Contacts.Read"];

// Geolabs-only allowlist / keywords
const ALLOWED_EMAIL_DOMAINS = ["geolabs.net", "geolabs-software.com"];
const COMPANY_KEYWORDS = ["geolabs"];

// ---- helpers ----
function useGraphToken(scopes) {
  const { instance, accounts } = useMsal();
  const account = accounts?.[0];

  const getToken = async () => {
    const request = { scopes, account };
    try {
      const res = await instance.acquireTokenSilent(request);
      return res.accessToken;
    } catch {
      const res = await instance.acquireTokenPopup(request);
      return res.accessToken;
    }
  };

  return getToken;
}

function normalizeDirUser(u) {
  return {
    id: u.id,
    name: u.displayName || "",
    email: u.mail || u.userPrincipalName || "",
    mobile: u.mobilePhone || "",
    business: (u.businessPhones || [])[0] || "",
    title: u.jobTitle || "",
    department: u.department || "",
    office: u.officeLocation || "",
    company: u.companyName || "",
    source: "Directory",
  };
}

function normalizeMeContact(c) {
  const primaryEmail =
    (c.emailAddresses && c.emailAddresses[0] && c.emailAddresses[0].address) || "";
  return {
    id: c.id,
    source: "My Contacts",
    name: c.displayName || "",
    email: primaryEmail,
    mobile: c.mobilePhone || "",
    business: (c.businessPhones || [])[0] || "",
    title: c.jobTitle || "",
    department: c.department || "",
    office: c.officeLocation || "",
    company: c.companyName || "",
  };
}

function toCSV(rows, cols) {
  const csvEscape = (v) =>
    `"${String(v ?? "").replaceAll('"', '""').replace(/\r?\n/g, " ")}"`;
  const header = cols.map((c) => csvEscape(c.label)).join(",");
  const lines = rows
    .map((r) => cols.map((c) => csvEscape(r[c.key])).join(","))
    .join("\n");
  return `${header}\n${lines}`;
}

/** Geolabs-only filter */
function isGeolabsRow(row) {
  if (!row) return false;
  const email = (row.email || "").toLowerCase();
  const company = (row.company || "").toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() : "";
  if (domain && ALLOWED_EMAIL_DOMAINS.includes(domain)) return true;
  if (COMPANY_KEYWORDS.some((k) => company.includes(k))) return true;
  return false;
}

export default function Contacts() {
  const getTokenDir = useGraphToken(SCOPES_DIR);
  const getTokenMe = useGraphToken(SCOPES_ME);

  const [source, setSource] = useState("Directory"); // Directory | My Contacts | Both
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [dirContacts, setDirContacts] = useState([]);
  const [meContacts, setMeContacts] = useState([]);

  const nextLinkDirRef = useRef(null);
  const nextLinkMeRef = useRef(null);

  const [page, setPage] = useState(DEFAULT_PAGE);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const [visibleCols, setVisibleCols] = useState({
    name: true,
    email: true,
    mobile: true,
    business: true,
    title: true,
    department: true,
    office: true,
  });

  const COLUMNS = [
    { key: "name", label: "Name", sortable: true },
    { key: "email", label: "Email", sortable: true },
    { key: "mobile", label: "Mobile", sortable: true },
    { key: "business", label: "Business", sortable: true },
    { key: "title", label: "Title", sortable: true },
    { key: "department", label: "Department", sortable: true },
    { key: "office", label: "Office", sortable: true },
  ];

  const toggleCol = (k) => setVisibleCols((v) => ({ ...v, [k]: !v[k] }));
  const resetPaging = () => setPage(DEFAULT_PAGE);

  const fetchDirectory = async (reset = false) => {
    setLoading(true);
    try {
      const token = await getTokenDir();
      const url =
        reset || !nextLinkDirRef.current
          ? `${GRAPH}/users?$select=id,displayName,mail,userPrincipalName,mobilePhone,businessPhones,jobTitle,department,officeLocation,companyName&$filter=userType eq 'Member'&$top=${PAGE_SIZE}`
          : nextLinkDirRef.current;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Graph /users ${res.status}`);
      const data = await res.json();
      const normalized = (data.value || []).map(normalizeDirUser);

      setDirContacts((prev) => (reset ? normalized : [...prev, ...normalized]));
      nextLinkDirRef.current = data["@odata.nextLink"] || null;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMeContacts = async (reset = false) => {
    setLoading(true);
    try {
      const token = await getTokenMe();
      const url =
        reset || !nextLinkMeRef.current
          ? `${GRAPH}/me/contacts?$select=id,displayName,companyName,jobTitle,businessPhones,mobilePhone,homePhones,emailAddresses,officeLocation&$top=${PAGE_SIZE}`
          : nextLinkMeRef.current;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Graph /me/contacts ${res.status}`);
      const data = await res.json();
      const normalized = (data.value || []).map(normalizeMeContact);

      setMeContacts((prev) => (reset ? normalized : [...prev, ...normalized]));
      nextLinkMeRef.current = data["@odata.nextLink"] || null;
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Initial load for current source
  useEffect(() => {
    resetPaging();
    if (source === "Directory") {
      fetchDirectory(true);
    } else if (source === "My Contacts") {
      fetchMeContacts(true);
    } else {
      nextLinkDirRef.current = null;
      nextLinkMeRef.current = null;
      Promise.all([fetchDirectory(true), fetchMeContacts(true)]).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Merge view (Both)
  const allRows = useMemo(() => {
    if (source === "Directory") return dirContacts;
    if (source === "My Contacts") return meContacts;
    const map = new Map();
    for (const r of meContacts) {
      const key = (r.email || r.name).toLowerCase();
      map.set(key, r);
    }
    for (const r of dirContacts) {
      const key = (r.email || r.name).toLowerCase();
      map.set(key, r); // Directory precedence
    }
    return [...map.values()];
  }, [source, dirContacts, meContacts]);

  // Geolabs-only + text search
  const filtered = useMemo(() => {
    const base = allRows.filter(isGeolabsRow);
    const t = search.trim().toLowerCase();
    if (!t) return base;
    return base.filter((r) =>
      [r.name, r.email, r.mobile, r.business, r.title, r.department, r.office, r.company, r.source]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t))
    );
  }, [search, allRows]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const va = String(a[sortBy] ?? "").toLowerCase();
      const vb = String(b[sortBy] ?? "").toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sortBy, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const onSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
    resetPaging();
  };

  const exportCSV = () => {
    const cols = COLUMNS.filter((c) => visibleCols[c.key]);
    const csv = toCSV(sorted, cols);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_${source.replace(/\s+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canLoadMoreDir = source !== "My Contacts" && !!nextLinkDirRef.current;
  const canLoadMoreMe = source !== "Directory" && !!nextLinkMeRef.current;

  return (
    <div className="contacts-wrap">
      <div className="contacts-topbar">
        <div className="contacts-left">
          <div className="contacts-heading">Contacts</div>

          <select
            className="contacts-select"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            title="Data source"
          >
            <option>Directory</option>
            <option>My Contacts</option>
            <option>Both</option>
          </select>

          <div className="contacts-controls">
            <button
              className="contacts-btn"
              onClick={() => {
                if (source === "Directory") fetchDirectory(true);
                else if (source === "My Contacts") fetchMeContacts(true);
                else {
                  nextLinkDirRef.current = null;
                  nextLinkMeRef.current = null;
                  Promise.all([fetchDirectory(true), fetchMeContacts(true)]).catch(() => {});
                }
              }}
              title="Refresh"
              disabled={loading}
            >
              <FaSyncAlt />
              <span>Refresh</span>
            </button>

            <button className="contacts-btn" onClick={exportCSV} title="Export CSV">
              <FaCloudDownloadAlt />
              <span>Export</span>
            </button>
          </div>
        </div>

        <div className="contacts-right">
          <input
            className="contacts-input"
            placeholder="Search name, email, phone, title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPaging();
            }}
          />

          <div className="contacts-colmenu" tabIndex={0}>
            <FaFilter className="contacts-colicon" />
            <div className="contacts-colpanel">
              {COLUMNS.map((c) => (
                <label key={c.key} className="contacts-colrow">
                  <input
                    type="checkbox"
                    checked={!!visibleCols[c.key]}
                    onChange={() => toggleCol(c.key)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="contacts-meta">
        <span>{total} results</span>
        <div className="contacts-loadmore">
          {canLoadMoreDir && (
            <button
              className="contacts-btn ghost"
              onClick={() => fetchDirectory(false)}
              disabled={loading}
              title="Load more directory"
            >
              Load more directory
            </button>
          )}
          {canLoadMoreMe && (
            <button
              className="contacts-btn ghost"
              onClick={() => fetchMeContacts(false)}
              disabled={loading}
              title="Load more personal contacts"
            >
              Load more personal
            </button>
          )}
        </div>
      </div>

      <div className="contacts-tablewrap">
        <table className="contacts-table">
          <thead>
            <tr>
              {COLUMNS.filter((c) => visibleCols[c.key]).map((c) => (
                <th
                  key={c.key}
                  onClick={c.sortable ? () => onSort(c.key) : undefined}
                  className={`contacts-th ${c.sortable ? "sortable" : ""} contacts-col-${c.key}`}
                >
                  {c.label}
                  {sortBy === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {pageRows.map((r) => (
              <tr key={`${r.source || "Directory"}-${r.id}`}>
                {visibleCols.name && (
                  <td className="contacts-col-name">
                    <div className="contacts-namecell">
                      <FaUserTie className="contacts-miniicon" />
                      <span title={r.name}>{r.name}</span>
                    </div>
                  </td>
                )}

                {visibleCols.email && (
                  <td className="contacts-col-email contacts-mono" title={r.email}>
                    {r.email}
                  </td>
                )}

                {visibleCols.mobile && (
                  <td className="contacts-col-mobile">
                    <div className="contacts-flex">
                      <FaPhone className="contacts-miniicon" />
                      <span className="contacts-nowrap" title={r.mobile}>
                        {r.mobile}
                      </span>
                    </div>
                  </td>
                )}

                {visibleCols.business && (
                  <td className="contacts-col-business">
                    <div className="contacts-flex">
                      <FaPhone className="contacts-miniicon" />
                      <span className="contacts-nowrap" title={r.business}>
                        {r.business}
                      </span>
                    </div>
                  </td>
                )}

                {visibleCols.title && (
                  <td className="contacts-col-title" title={r.title}>
                    {r.title}
                  </td>
                )}

                {visibleCols.department && (
                  <td className="contacts-col-department" title={r.department}>
                    {r.department}
                  </td>
                )}

                {visibleCols.office && (
                  <td className="contacts-col-office">
                    <div className="contacts-flex">
                      <FaBuilding className="contacts-miniicon" />
                      <span title={r.office}>{r.office}</span>
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {pageRows.length === 0 && (
              <tr>
                <td className="contacts-empty" colSpan={COLUMNS.length + 1}>
                  {loading ? "Loading…" : "No results."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="contacts-pager">
        <button className="contacts-btn" onClick={() => setPage(1)} disabled={page === 1}>
          ⏮
        </button>
        <button
          className="contacts-btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          ◀
        </button>
        <span className="contacts-page">
          {page} / {totalPages}
        </span>
        <button
          className="contacts-btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          ▶
        </button>
        <button
          className="contacts-btn"
          onClick={() => setPage(totalPages)}
          disabled={page === totalPages}
        >
          ⏭
        </button>

        <select
          className="contacts-select right"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
