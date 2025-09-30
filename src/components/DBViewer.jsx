import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import API_URL from "../config";
import {
  FaDatabase,
  FaSync,
  FaCopy,
  FaExternalLinkAlt,
  FaCloudDownloadAlt,
  FaTimes,
  FaSearch,
  FaTrash,
  FaChevronDown,
  FaTable,
  FaEye,
} from "react-icons/fa";
import "../styles/DBViewer.css";

const PAGE_SIZES = [10, 25, 50, 100];

function getFileExtension(fileName = "") {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

export default function DBViewer() {
  // Core state
  const [databases, setDatabases] = useState([]);
  const [loadingDatabases, setLoadingDatabases] = useState(true);
  const [error, setError] = useState("");

  // Database management
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [expandedDb, setExpandedDb] = useState("");
  const [filesByDatabase, setFilesByDatabase] = useState({});
  const [loadingFiles, setLoadingFiles] = useState(false);

  // S3 integration
  const [s3Urls, setS3Urls] = useState({});

  // File management
  const [fileSearch, setFileSearch] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState("");
  const [fileSortBy, setFileSortBy] = useState("name");
  const [fileSortDirection, setFileSortDirection] = useState("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selection and actions
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [copyFeedback, setCopyFeedback] = useState("");

  // Modals
  const [previewModal, setPreviewModal] = useState({ open: false, url: "", name: "", type: "" });
  const [schemaModal, setSchemaModal] = useState({ open: false, data: null });

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoadingDatabases(true);
        const [dbResponse, s3Response] = await Promise.all([
          axios.get(`${API_URL}/api/list-dbs`),
          axios.get(`${API_URL}/api/s3-db-pdfs`).catch(() => ({ data: { files: [] } })),
        ]);

        const filteredDbs = (dbResponse.data.dbs || []).filter((db) => db !== "chat_history.db");
        setDatabases(filteredDbs);

        // Build S3 URL mapping
        const urlMap = {};
        (s3Response.data.files || []).forEach((file) => {
          urlMap[file.Key] = file.url;
        });
        setS3Urls(urlMap);
      } catch (err) {
        console.error("Failed to load data:", err);
        setError("Failed to load databases. Please try again.");
      } finally {
        setLoadingDatabases(false);
      }
    };

    loadData();
  }, []);

  // Database filtering and sorting
  const processedDatabases = useMemo(() => {
    let filtered = databases;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((db) => db.toLowerCase().includes(query));
    }

    const withMetadata = filtered.map((db) => ({
      name: db,
      fileCount: (filesByDatabase[db] || []).length,
      displayName: db.replace(/\.db$/i, "").replace(/_/g, " "),
    }));

    withMetadata.sort((a, b) => {
      let valueA, valueB;

      if (sortBy === "files") {
        valueA = a.fileCount;
        valueB = b.fileCount;
      } else {
        valueA = a.displayName.toLowerCase();
        valueB = b.displayName.toLowerCase();
      }

      if (valueA < valueB) return sortDirection === "asc" ? -1 : 1;
      if (valueA > valueB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return withMetadata;
  }, [databases, searchQuery, sortBy, sortDirection, filesByDatabase]);

  const toggleDatabaseSort = (field) => {
    if (sortBy === field) {
      setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDirection("asc");
    }
  };

  const refreshDatabases = async () => {
    try {
      setLoadingDatabases(true);
      const response = await axios.get(`${API_URL}/api/list-dbs`);
      const filtered = (response.data.dbs || []).filter((db) => db !== "chat_history.db");
      setDatabases(filtered);
      setError("");
    } catch (err) {
      console.error("Failed to refresh databases:", err);
      setError("Failed to refresh databases.");
    } finally {
      setLoadingDatabases(false);
    }
  };

  const toggleDatabase = async (dbName) => {
    if (expandedDb === dbName) {
      setExpandedDb("");
      setSelectedFiles(new Set());
      return;
    }

    setExpandedDb(dbName);
    setSelectedFiles(new Set());
    setFileSearch("");
    setFileTypeFilter("");
    setFileSortBy("name");
    setFileSortDirection("asc");
    setCurrentPage(1);

    if (!filesByDatabase[dbName]) {
      try {
        setLoadingFiles(true);
        const response = await axios.post(`${API_URL}/api/list-files`, { db_name: dbName });
        setFilesByDatabase((prev) => ({
          ...prev,
          [dbName]: response.data.files || [],
        }));
      } catch (err) {
        console.error("Failed to load files:", err);
        setFilesByDatabase((prev) => ({
          ...prev,
          [dbName]: [],
        }));
      } finally {
        setLoadingFiles(false);
      }
    }
  };

  const inspectDatabase = async (dbName) => {
    try {
      const response = await axios.post(`${API_URL}/api/inspect-db`, { db_name: dbName });
      setSchemaModal({
        open: true,
        data: { database: dbName, ...response.data },
      });
    } catch (err) {
      console.error("Failed to inspect database:", err);
      setSchemaModal({
        open: true,
        data: { database: dbName, error: "Failed to load schema information." },
      });
    }
  };

  const deleteDatabase = async (dbName) => {
    const confirmText = prompt(`Type "DELETE ${dbName}" to confirm deletion:`);
    if (confirmText !== `DELETE ${dbName}`) {
      return;
    }

    try {
      await axios.post(`${API_URL}/api/delete-db`, {
        db_name: dbName,
        confirmation_text: confirmText,
      });

      setDatabases((prev) => prev.filter((db) => db !== dbName));
      setExpandedDb("");
      setFilesByDatabase((prev) => {
        const updated = { ...prev };
        delete updated[dbName];
        return updated;
      });

      alert("Database deleted successfully.");
    } catch (err) {
      console.error("Failed to delete database:", err);
      alert(err.response?.data?.error || "Failed to delete database.");
    }
  };

  // File processing
  const currentFiles = filesByDatabase[expandedDb] || [];
  const fileExtensions = useMemo(() => {
    const extensions = new Set(currentFiles.map(getFileExtension).filter(Boolean));
    return Array.from(extensions).sort();
  }, [currentFiles]);

  const processedFiles = useMemo(() => {
    let filtered = currentFiles.map((fileName) => ({
      name: fileName,
      extension: getFileExtension(fileName),
      s3Key: `${expandedDb}/${fileName}`,
      url: s3Urls[`${expandedDb}/${fileName}`],
    }));

    if (fileSearch.trim()) {
      const query = fileSearch.toLowerCase();
      filtered = filtered.filter((file) => file.name.toLowerCase().includes(query));
    }

    if (fileTypeFilter) {
      filtered = filtered.filter((file) => file.extension === fileTypeFilter);
    }

    filtered.sort((a, b) => {
      let valueA, valueB;

      if (fileSortBy === "extension") {
        valueA = a.extension;
        valueB = b.extension;
      } else {
        valueA = a.name.toLowerCase();
        valueB = b.name.toLowerCase();
      }

      if (valueA < valueB) return fileSortDirection === "asc" ? -1 : 1;
      if (valueA > valueB) return fileSortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [currentFiles, fileSearch, fileTypeFilter, fileSortBy, fileSortDirection, expandedDb, s3Urls]);

  // Pagination
  const totalFiles = processedFiles.length;
  const totalPages = Math.max(1, Math.ceil(totalFiles / pageSize));
  const paginatedFiles = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedFiles.slice(startIndex, startIndex + pageSize);
  }, [processedFiles, currentPage, pageSize]);

  const toggleFileSort = (field) => {
    if (fileSortBy === field) {
      setFileSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setFileSortBy(field);
      setFileSortDirection("asc");
    }
    setCurrentPage(1);
  };

  // File actions
  const getS3Url = (dbName, fileName) => s3Urls[`${dbName}/${fileName}`];

  const copyFileUrl = async (dbName, fileName) => {
    const url = getS3Url(dbName, fileName);
    if (!url) {
      alert("No URL available for this file.");
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback(`${dbName}/${fileName}`);
      setTimeout(() => setCopyFeedback(""), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  const openPreview = (dbName, fileName) => {
    const url = getS3Url(dbName, fileName);
    if (!url) {
      alert("No preview available for this file.");
      return;
    }

    setPreviewModal({
      open: true,
      url,
      name: fileName,
      type: getFileExtension(fileName),
    });
  };

  // Selection management
  const toggleFileSelection = (fileName) => {
    setSelectedFiles((prev) => {
      const updated = new Set(prev);
      if (updated.has(fileName)) {
        updated.delete(fileName);
      } else {
        updated.add(fileName);
      }
      return updated;
    });
  };

  const toggleSelectAll = () => {
    const allSelected = paginatedFiles.every((file) => selectedFiles.has(file.name));

    setSelectedFiles((prev) => {
      const updated = new Set(prev);

      if (allSelected) {
        paginatedFiles.forEach((file) => updated.delete(file.name));
      } else {
        paginatedFiles.forEach((file) => updated.add(file.name));
      }

      return updated;
    });
  };

  const clearSelection = () => setSelectedFiles(new Set());

  const bulkCopyUrls = async () => {
    const urls = Array.from(selectedFiles)
      .map((fileName) => getS3Url(expandedDb, fileName))
      .filter(Boolean)
      .join("\n");

    if (!urls) {
      alert("No URLs available for selected files.");
      return;
    }

    try {
      await navigator.clipboard.writeText(urls);
      setCopyFeedback("@bulk");
      setTimeout(() => setCopyFeedback(""), 2000);
    } catch (err) {
      console.error("Failed to copy URLs:", err);
    }
  };

  const bulkOpenFiles = () => {
    const urls = Array.from(selectedFiles)
      .map((fileName) => getS3Url(expandedDb, fileName))
      .filter(Boolean)
      .slice(0, 10);

    if (urls.length === 0) {
      alert("No URLs available for selected files.");
      return;
    }

    urls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
  };

  const exportFileList = () => {
    const csvData = processedFiles.map((file) => ({
      database: expandedDb,
      filename: file.name,
      extension: file.extension.toUpperCase(),
      url: file.url || "",
    }));

    const headers = ["Database", "Filename", "Type", "URL"];
    const csvContent = [
      headers.join(","),
      ...csvData.map((row) => Object.values(row).map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${expandedDb}_files.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="db-viewer">
      {/* Header */}
      <div className="db-viewer-header">
        <h1 className="db-viewer-title">
          <FaDatabase className="db-viewer-title-icon" />
          Database Viewer
        </h1>

        <div className="db-viewer-controls">
          <div className="db-viewer-search-container">
            <FaSearch className="db-viewer-search-icon" />
            <input
              type="text"
              className="db-viewer-search-input"
              placeholder="Search databases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button className="db-viewer-btn db-viewer-btn-secondary" onClick={refreshDatabases} disabled={loadingDatabases}>
            <FaSync />
            {loadingDatabases ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="db-viewer-main">
        {/* Database List */}
        <div className="db-viewer-db-list-panel">
          <div className="db-viewer-db-list-header">
            <h2 className="db-viewer-db-list-title">Databases</h2>
            <div className="db-viewer-db-list-count">{processedDatabases.length}</div>
          </div>

          <div className="db-viewer-db-list">
            {loadingDatabases ? (
              <div className="db-viewer-loading-container">
                <div className="db-viewer-loading-spinner" />
                <span className="db-viewer-loading-text">Loading databases...</span>
              </div>
            ) : error ? (
              <div className="db-viewer-empty-state">
                <FaDatabase className="db-viewer-empty-state-icon" />
                <h3 className="db-viewer-empty-state-title">Error</h3>
                <p className="db-viewer-empty-state-description">{error}</p>
              </div>
            ) : processedDatabases.length === 0 ? (
              <div className="db-viewer-empty-state">
                <FaDatabase className="db-viewer-empty-state-icon" />
                <h3 className="db-viewer-empty-state-title">No Databases</h3>
                <p className="db-viewer-empty-state-description">No databases found matching your search.</p>
              </div>
            ) : (
              processedDatabases.map((db) => (
                <div key={db.name} className={`db-viewer-db-item ${expandedDb === db.name ? "db-viewer-active" : ""}`}>
                  <div className="db-viewer-db-item-header" onClick={() => toggleDatabase(db.name)}>
                    <div className="db-viewer-db-item-info">
                      <FaDatabase className="db-viewer-db-item-icon" />
                      <div className="db-viewer-db-item-details">
                        <div className="db-viewer-db-item-name">{db.displayName}</div>
                        <div className="db-viewer-db-item-meta">{db.fileCount} files</div>
                      </div>
                    </div>

                    <div className="db-viewer-db-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="db-viewer-db-action-btn" onClick={() => inspectDatabase(db.name)} title="View schema">
                        <FaTable />
                      </button>
                      <button className="db-viewer-db-action-btn db-viewer-danger" onClick={() => deleteDatabase(db.name)} title="Delete database">
                        <FaTrash />
                      </button>
                    </div>

                    <FaChevronDown className={`db-viewer-expand-icon ${expandedDb === db.name ? "db-viewer-expanded" : ""}`} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* File Content Panel */}
        <div className="db-viewer-file-content-panel">
          {expandedDb ? (
            <>
              <div className="db-viewer-file-content-header">
                <h2 className="db-viewer-file-content-title">
                  {expandedDb.replace(/\.db$/i, "").replace(/_/g, " ")}
                </h2>

                <div className="db-viewer-file-content-actions">
                  <div className="db-viewer-filter-group">
                    <div className="db-viewer-search-container">
                      <FaSearch className="db-viewer-search-icon" />
                      <input
                        type="text"
                        className="db-viewer-search-input"
                        placeholder="Search files..."
                        value={fileSearch}
                        onChange={(e) => {
                          setFileSearch(e.target.value);
                          setCurrentPage(1);
                        }}
                      />
                    </div>
                  </div>

                  <div className="db-viewer-filter-group">
                    <select
                      className="db-viewer-filter-select"
                      value={fileTypeFilter}
                      onChange={(e) => {
                        setFileTypeFilter(e.target.value);
                        setCurrentPage(1);
                      }}
                    >
                      <option value="">All Types</option>
                      {fileExtensions.map((ext) => (
                        <option key={ext} value={ext}>
                          {ext.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="db-viewer-filter-group">
                    <select
                      className="db-viewer-filter-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                    >
                      {PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size} per page
                        </option>
                      ))}
                    </select>
                  </div>

                  <button className="db-viewer-btn db-viewer-btn-secondary" onClick={exportFileList}>
                    <FaCloudDownloadAlt />
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Bulk Actions */}
              {selectedFiles.size > 0 && (
                <div className="db-viewer-bulk-actions">
                  <div className="db-viewer-selection-info">
                    {selectedFiles.size} file{selectedFiles.size !== 1 ? "s" : ""} selected
                  </div>

                  <button className="db-viewer-bulk-action-btn" onClick={bulkCopyUrls}>
                    <FaCopy />
                    Copy URLs
                  </button>

                  <button className="db-viewer-bulk-action-btn" onClick={bulkOpenFiles}>
                    <FaExternalLinkAlt />
                    Open Files (max 10)
                  </button>

                  <button className="db-viewer-bulk-action-btn" onClick={clearSelection}>
                    Clear Selection
                  </button>

                  {copyFeedback === "@bulk" && (
                    <span className="db-viewer-copy-feedback">URLs copied!</span>
                  )}
                </div>
              )}

              {/* File Table */}
              <div className="db-viewer-file-table-container">
                {loadingFiles ? (
                  <div className="db-viewer-loading-container">
                    <div className="db-viewer-loading-spinner" />
                    <span className="db-viewer-loading-text">Loading files...</span>
                  </div>
                ) : totalFiles === 0 ? (
                  <div className="db-viewer-empty-state">
                    <FaTable className="db-viewer-empty-state-icon" />
                    <h3 className="db-viewer-empty-state-title">No Files</h3>
                    <p className="db-viewer-empty-state-description">
                      No files found in this database matching your criteria.
                    </p>
                  </div>
                ) : (
                  <table className="db-viewer-file-table">
                    <thead>
                      <tr>
                        <th style={{ width: "40px" }}>
                          <input
                            type="checkbox"
                            className="db-viewer-selection-checkbox"
                            checked={paginatedFiles.length > 0 && paginatedFiles.every((file) => selectedFiles.has(file.name))}
                            onChange={toggleSelectAll}
                            title="Select all on page"
                          />
                        </th>
                        <th
                          className={`db-viewer-sortable ${fileSortBy === "name" ? `db-viewer-sorted-${fileSortDirection}` : ""}`}
                          onClick={() => toggleFileSort("name")}
                        >
                          File Name
                        </th>
                        <th
                          className={`db-viewer-sortable ${fileSortBy === "extension" ? `db-viewer-sorted-${fileSortDirection}` : ""}`}
                          onClick={() => toggleFileSort("extension")}
                        >
                          Type
                        </th>
                        <th style={{ width: "200px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedFiles.map((file) => (
                        <tr key={file.name}>
                          <td>
                            <input
                              type="checkbox"
                              className="db-viewer-selection-checkbox"
                              checked={selectedFiles.has(file.name)}
                              onChange={() => toggleFileSelection(file.name)}
                            />
                          </td>
                          <td>
                            <div className="db-viewer-file-name" title={file.name}>
                              {file.name}
                            </div>
                          </td>
                          <td>{file.extension && <span className="db-viewer-file-type">{file.extension}</span>}</td>
                          <td>
                            <div className="db-viewer-file-actions">
                              <button
                                className="db-viewer-file-action-btn"
                                onClick={() => openPreview(expandedDb, file.name)}
                                title="Preview file"
                              >
                                <FaEye />
                              </button>

                              {file.url && (
                                <>
                                  <a
                                    href={file.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="db-viewer-file-action-btn"
                                    title="Open in new tab"
                                  >
                                    <FaExternalLinkAlt />
                                  </a>

                                  <a
                                    href={file.url}
                                    download={file.name}
                                    className="db-viewer-file-action-btn"
                                    title="Download file"
                                  >
                                    <FaCloudDownloadAlt />
                                  </a>

                                  <button
                                    className="db-viewer-file-action-btn"
                                    onClick={() => copyFileUrl(expandedDb, file.name)}
                                    title="Copy URL"
                                  >
                                    <FaCopy />
                                  </button>

                                  {copyFeedback === `${expandedDb}/${file.name}` && (
                                    <span className="db-viewer-copy-feedback">Copied!</span>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {totalFiles > 0 && (
                <div className="db-viewer-pagination">
                  <button
                    className="db-viewer-pagination-btn"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    title="First page"
                  >
                    ⏮
                  </button>
                  <button
                    className="db-viewer-pagination-btn"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    title="Previous page"
                  >
                    ◀
                  </button>

                  <span className="db-viewer-pagination-info">Page {currentPage} of {totalPages}</span>

                  <button
                    className="db-viewer-pagination-btn"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    title="Next page"
                  >
                    ▶
                  </button>
                  <button
                    className="db-viewer-pagination-btn"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    title="Last page"
                  >
                    ⏭
                  </button>

                  <select
                    className="db-viewer-page-size-select"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size} per page
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div className="db-viewer-empty-state">
              <FaDatabase className="db-viewer-empty-state-icon" />
              <h2 className="db-viewer-empty-state-title">Select a Database</h2>
              <p className="db-viewer-empty-state-description">
                Choose a database from the list to view its contents and manage files.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Schema Modal */}
      {schemaModal.open && (
        <div className="db-viewer-modal-overlay" onClick={() => setSchemaModal({ open: false, data: null })}>
          <div className="db-viewer-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="db-viewer-modal-header">
              <h3 className="db-viewer-modal-title">Database Schema: {schemaModal.data?.database}</h3>
              <button
                className="db-viewer-modal-close-btn"
                onClick={() => setSchemaModal({ open: false, data: null })}
                title="Close"
              >
                <FaTimes />
              </button>
            </div>

            <div className="db-viewer-modal-body">
              {schemaModal.data?.error ? (
                <div className="db-viewer-empty-state">
                  <FaTable className="db-viewer-empty-state-icon" />
                  <h3 className="db-viewer-empty-state-title">Schema Error</h3>
                  <p className="db-viewer-empty-state-description">{schemaModal.data.error}</p>
                </div>
              ) : (
                Object.entries(schemaModal.data || {}).map(([tableName, tableInfo]) => {
                  if (tableName === "database") return null;

                  return (
                    <div key={tableName} className="db-viewer-schema-section">
                      <h4 className="db-viewer-schema-table-name">
                        <FaTable />
                        {tableName}
                      </h4>

                      <div className="db-viewer-schema-columns">
                        <h5 className="db-viewer-schema-columns-title">Columns</h5>
                        <div className="db-viewer-schema-columns-list">
                          {(tableInfo.columns || []).map((column) => (
                            <span key={column} className="db-viewer-schema-column">
                              {column}
                            </span>
                          ))}
                        </div>
                      </div>

                      {tableInfo.sample_rows && tableInfo.sample_rows.length > 0 && (
                        <div className="db-viewer-schema-sample">
                          <h5 className="db-viewer-schema-sample-title">Sample Data</h5>
                          <table className="db-viewer-sample-table">
                            <thead>
                              <tr>
                                {(tableInfo.columns || []).map((column) => (
                                  <th key={column}>{column}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {tableInfo.sample_rows.slice(0, 5).map((row, index) => (
                                <tr key={index}>
                                  {(row || []).map((cell, cellIndex) => (
                                    <td key={cellIndex} title={String(cell)}>
                                      {typeof cell === "string" && cell.length > 50
                                        ? `${cell.slice(0, 50)}...`
                                        : String(cell)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewModal.open && (
        <div className="db-viewer-modal-overlay" onClick={() => setPreviewModal({ open: false, url: "", name: "", type: "" })}>
          <div className="db-viewer-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="db-viewer-modal-header">
              <h3 className="db-viewer-modal-title">{previewModal.name}</h3>
              <button
                className="db-viewer-modal-close-btn"
                onClick={() => setPreviewModal({ open: false, url: "", name: "", type: "" })}
                title="Close preview"
              >
                <FaTimes />
              </button>
            </div>

            <div className="db-viewer-modal-body" style={{ padding: 0 }}>
              {previewModal.type === "pdf" ? (
                <iframe src={previewModal.url} title="File preview" style={{ width: "100%", height: "100%", border: "none" }} />
              ) : ["png", "jpg", "jpeg", "webp", "gif"].includes(previewModal.type) ? (
                <img src={previewModal.url} alt={previewModal.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <div className="db-viewer-empty-state">
                  <FaEye className="db-viewer-empty-state-icon" />
                  <h3 className="db-viewer-empty-state-title">Preview Not Available</h3>
                  <p className="db-viewer-empty-state-description">
                    No preview available for .{previewModal.type} files. Use the download or open button instead.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
