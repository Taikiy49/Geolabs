import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  FaTicketAlt,
  FaPlus,
  FaSearch,
  FaSync,
  FaEdit,
  FaTrash,
  FaClock,
  FaCheckCircle,
  FaUser,
  FaTimes,
  FaSave,
  FaComment,
  FaDownload,
  FaUserPlus,
  FaLayerGroup,
  FaTag
} from 'react-icons/fa';
import './ITTickets.css';

const TICKET_TYPES = [
  { value: 'hardware', label: 'Hardware Issue' },
  { value: 'software', label: 'Software Issue' },
  { value: 'access', label: 'Access Request' },
  { value: 'network', label: 'Network/WiFi' },
  { value: 'mobile', label: 'Mobile Device' },
  { value: 'data', label: 'Data/Database' },
  { value: 'other', label: 'Other' }
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'var(--color-success)' },
  { value: 'medium', label: 'Medium', color: 'var(--color-warning)' },
  { value: 'high', label: 'High', color: 'var(--color-error)' },
  { value: 'urgent', label: 'Urgent', color: 'var(--color-cyber)' }
];

const STATUSES = [
  { value: 'open', label: 'Open', color: 'var(--color-primary)' },
  { value: 'in_progress', label: 'In Progress', color: 'var(--color-warning)' },
  { value: 'waiting', label: 'Waiting for User', color: 'var(--color-secondary)' },
  { value: 'resolved', label: 'Resolved', color: 'var(--color-success)' },
  { value: 'closed', label: 'Closed', color: 'var(--text-muted)' }
];

const emptyTicket = {
  title: '',
  description: '',
  type: 'hardware',
  priority: 'medium',
  status: 'open',
  tags: [],
  assignee: 'IT Support'
};

// Helpers
const formatDate = (dateString) =>
  new Date(dateString).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

const priorityColor = (val) => PRIORITIES.find(p => p.value === val)?.color || 'var(--text-muted)';
const statusColor = (val) => STATUSES.find(s => s.value === val)?.color || 'var(--text-muted)';

// Simple SLA windows (hours) by priority
const SLA_HOURS = { urgent: 4, high: 8, medium: 24, low: 72 };
const getSlaInfo = (ticket) => {
  const hrs = SLA_HOURS[ticket.priority] ?? 24;
  const created = new Date(ticket.createdAt).getTime();
  const due = created + hrs * 3600 * 1000;
  const now = Date.now();
  const msLeft = due - now;
  return {
    dueAt: due,
    overdue: msLeft < 0,
    dueSoon: msLeft > 0 && msLeft < 2 * 3600 * 1000, // < 2h
    label: new Date(due).toLocaleString()
  };
};

export default function ITTickets() {
  const { accounts } = useMsal();
  const userEmail = accounts?.[0]?.username || 'guest';
  const userName = accounts?.[0]?.name || userEmail.split('@')[0];

  // State
  const [tickets, setTickets] = useState([]);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState(emptyTicket);
  const [selectedTicket, setSelectedTicket] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [myTicketsOnly, setMyTicketsOnly] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Refs
  const searchRef = useRef(null);

  // Mock data
  useEffect(() => {
    const mock = [
      {
        id: 1,
        title: 'Laptop screen flickering',
        description: 'Screen flickers intermittently when opening large files.',
        type: 'hardware',
        priority: 'medium',
        status: 'open',
        requester: userEmail,
        requesterName: userName,
        assignee: 'IT Support',
        createdAt: '2025-01-15T10:30:00Z',
        updatedAt: '2025-01-15T10:30:00Z',
        comments: [],
        tags: ['device', 'display']
      },
      {
        id: 2,
        title: 'Need access to shared drive',
        description: 'Grant access to Engineering shared drive for Project X.',
        type: 'access',
        priority: 'high',
        status: 'in_progress',
        requester: userEmail,
        requesterName: userName,
        assignee: 'John Smith',
        createdAt: '2025-01-14T14:15:00Z',
        updatedAt: '2025-01-15T09:20:00Z',
        comments: [
          { id: 1, author: 'John Smith', text: 'Processing access request.', timestamp: '2025-01-15T09:20:00Z' }
        ],
        tags: ['permissions']
      }
    ];
    setTickets(mock);
  }, [userEmail, userName]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.key === 'n' || e.key === 'N') && (e.metaKey || e.ctrlKey) === false) {
        setShowNewTicket(true);
      }
      if ((e.key === 'r' || e.key === 'R') && (e.metaKey || e.ctrlKey) === false) {
        clearFilters();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derived
  const filteredTickets = useMemo(() => {
    let data = [...tickets];
    const q = searchQuery.trim().toLowerCase();

    if (q) {
      data = data.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.requesterName.toLowerCase().includes(q) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (statusFilter) data = data.filter(t => t.status === statusFilter);
    if (typeFilter) data = data.filter(t => t.type === typeFilter);
    if (priorityFilter) data = data.filter(t => t.priority === priorityFilter);
    if (myTicketsOnly) data = data.filter(t => t.requester === userEmail);

    return data.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [tickets, searchQuery, statusFilter, typeFilter, priorityFilter, myTicketsOnly, userEmail]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const list = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTickets.slice(start, start + pageSize);
  }, [filteredTickets, currentPage, pageSize]);

  // Handlers
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setTypeFilter('');
    setPriorityFilter('');
    setMyTicketsOnly(false);
    setCurrentPage(1);
  };

  const createTicket = () => {
    const t = {
      id: Date.now(),
      ...newTicket,
      requester: userEmail,
      requesterName: userName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: newTicket.comments || []
    };
    setTickets(prev => [t, ...prev]);
    setShowNewTicket(false);
    setNewTicket(emptyTicket);
  };

  const updateTicket = (id, updates) => {
    setTickets(prev => prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t));
    if (selectedTicket?.id === id) {
      setSelectedTicket(prev => prev ? { ...prev, ...updates } : prev);
    }
  };

  const deleteTicket = (id) => {
    if (!window.confirm('Delete this ticket?')) return;
    setTickets(prev => prev.filter(t => t.id !== id));
    if (selectedTicket?.id === id) setSelectedTicket(null);
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const addComment = (id, text, author) => {
    if (!text.trim()) return;
    setTickets(prev => prev.map(t => t.id === id
      ? { ...t, comments: [...t.comments, { id: Date.now(), author, text, timestamp: new Date().toISOString() }], updatedAt: new Date().toISOString() }
      : t
    ));
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectAllOnPage = (checked) => {
    if (!checked) return setSelectedIds(new Set());
    const ids = list.map(t => t.id);
    setSelectedIds(new Set(ids));
  };

  // Bulk actions
  const bulkAssignToMe = () => {
    const ids = Array.from(selectedIds);
    setTickets(prev => prev.map(t => ids.includes(t.id) ? { ...t, assignee: userName, updatedAt: new Date().toISOString() } : t));
    setSelectedIds(new Set());
  };
  const bulkSetStatus = (status) => {
    const ids = Array.from(selectedIds);
    setTickets(prev => prev.map(t => ids.includes(t.id) ? { ...t, status, updatedAt: new Date().toISOString() } : t));
    setSelectedIds(new Set());
  };
  const bulkSetPriority = (priority) => {
    const ids = Array.from(selectedIds);
    setTickets(prev => prev.map(t => ids.includes(t.id) ? { ...t, priority, updatedAt: new Date().toISOString() } : t));
    setSelectedIds(new Set());
  };
  const bulkClose = () => bulkSetStatus('closed');

  const exportCSV = () => {
    const header = ['id','title','description','type','priority','status','requester','assignee','createdAt','updatedAt','tags'];
    const rows = filteredTickets.map(t => [
      t.id, t.title, t.description, t.type, t.priority, t.status, t.requesterName, t.assignee, t.createdAt, t.updatedAt, (t.tags||[]).join('|')
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tickets.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="it-tickets">
      {/* Header */}
      <div className="it-header">
        <div className="it-header-left">
          <h1 className="it-title">
            <FaTicketAlt className="it-title-icon" />
            IT Support Tickets
          </h1>

          <div className="it-stats">
            <div className="stat-pill">
              <span className="stat-value">{tickets.filter(t => t.status === 'open').length}</span>
              <span className="stat-label">Open</span>
            </div>
            <div className="stat-pill">
              <span className="stat-value">{tickets.filter(t => t.status === 'in_progress').length}</span>
              <span className="stat-label">In Progress</span>
            </div>
            <div className="stat-pill">
              <span className="stat-value">{tickets.filter(t => t.requester === userEmail).length}</span>
              <span className="stat-label">My Tickets</span>
            </div>
          </div>
        </div>

        <div className="it-header-right">
          <button className="btn" onClick={exportCSV}>
            <FaDownload /> Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewTicket(true)}>
            <FaPlus /> New Ticket
          </button>
        </div>
      </div>

      {/* Filters & Bulk */}
      <div className="it-filters">
        <div className="filter-group">
          <div className="search-container">
            <FaSearch className="search-icon" />
            <input
              ref={searchRef}
              type="text"
              className="search-input"
              placeholder="Search title, description, requester, tags…  (press / to focus)"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>

        <div className="filter-group">
          <select className="filter-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}>
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="filter-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }}>
            <option value="">All Types</option>
            {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="filter-select" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1); }}>
            <option value="">All Priorities</option>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="filter-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={myTicketsOnly}
              onChange={(e) => { setMyTicketsOnly(e.target.checked); setCurrentPage(1); }}
            />
            <span>My Tickets Only</span>
          </label>

          <button className="btn btn-ghost" onClick={clearFilters}>
            <FaSync /> Clear Filters (R)
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-left">
            <FaLayerGroup /> {selectedIds.size} selected
          </div>
          <div className="bulk-right">
            <button className="btn" onClick={bulkAssignToMe}><FaUserPlus /> Assign to me</button>
            <div className="bulk-split">
              <select className="filter-select" onChange={(e) => e.target.value && bulkSetStatus(e.target.value)} defaultValue="">
                <option value="" disabled>Set Status…</option>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select className="filter-select" onChange={(e) => e.target.value && bulkSetPriority(e.target.value)} defaultValue="">
                <option value="" disabled>Set Priority…</option>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={bulkClose}><FaCheckCircle /> Close</button>
          </div>
        </div>
      )}

      <div className="it-main">
        {/* Ticket List */}
        <div className="ticket-list-panel">
          <div className="ticket-list-header">
            <h2>Tickets ({filteredTickets.length})</h2>
            <div className="page-size-group">
              <label className="checkbox-label small">
                <input
                  type="checkbox"
                  checked={list.length > 0 && list.every(t => selectedIds.has(t.id))}
                  onChange={(e) => selectAllOnPage(e.target.checked)}
                />
                <span>Select page</span>
              </label>
              <select className="page-size-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>

          <div className="ticket-list">
            {list.length === 0 ? (
              <div className="empty-state">
                <FaTicketAlt className="empty-icon" />
                <h3>No tickets found</h3>
                <p>No tickets match your current filters.</p>
              </div>
            ) : (
              list.map(ticket => {
                const sla = getSlaInfo(ticket);
                return (
                  <div
                    key={ticket.id}
                    className={`ticket-item ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                    onClick={() => setSelectedTicket(ticket)}
                  >
                    <div className="ticket-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(ticket.id)}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(ticket.id); }}
                      />
                    </div>

                    <div className="ticket-header">
                      <div className="ticket-meta">
                        <h3 className="ticket-title">{ticket.title}</h3>
                        <div className="ticket-info">
                          <span className="ticket-id">#{ticket.id}</span>
                          <span className="ticket-requester"><FaUser />{ticket.requesterName}</span>
                          <span className="ticket-date"><FaClock />{formatDate(ticket.createdAt)}</span>
                        </div>
                      </div>

                      <div className="ticket-badges">
                        <span className="priority-badge" style={{ '--badge-color': priorityColor(ticket.priority) }}>
                          {PRIORITIES.find(p => p.value === ticket.priority)?.label}
                        </span>
                        <span className="status-badge" style={{ '--badge-color': statusColor(ticket.status) }}>
                          {STATUSES.find(s => s.value === ticket.status)?.label}
                        </span>
                        <span
                          className={`sla-badge ${sla.overdue ? 'overdue' : sla.dueSoon ? 'soon' : ''}`}
                          title={`Due: ${sla.label}`}
                        >
                          SLA
                        </span>
                      </div>
                    </div>

                    {!!(ticket.tags?.length) && (
                      <div className="ticket-tags">
                        <FaTag /> {ticket.tags.join(', ')}
                      </div>
                    )}

                    <div className="ticket-preview">
                      {ticket.description.slice(0, 120)}
                      {ticket.description.length > 120 ? '…' : ''}
                    </div>

                    {ticket.comments.length > 0 && (
                      <div className="ticket-comments-count">
                        <FaComment />
                        {ticket.comments.length} comment{ticket.comments.length !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="pagination-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>⏮</button>
              <button className="pagination-btn" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>◀</button>
              <span className="pagination-info">Page {currentPage} of {totalPages}</span>
              <button className="pagination-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>▶</button>
              <button className="pagination-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>⏭</button>
            </div>
          )}
        </div>

        {/* Ticket Detail Panel */}
        <div className="ticket-detail-panel">
          {selectedTicket ? (
            <TicketDetail
              ticket={selectedTicket}
              onUpdate={updateTicket}
              onDelete={deleteTicket}
              onAddComment={(id, txt) => addComment(id, txt, userName)}
              currentUser={userName}
            />
          ) : (
            <div className="empty-state">
              <FaTicketAlt className="empty-icon" />
              <h2>Select a Ticket</h2>
              <p>Choose a ticket from the list to view details and manage it.</p>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {showNewTicket && (
        <div className="modal-overlay" onClick={() => setShowNewTicket(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create New Ticket</h2>
              <button className="modal-close" onClick={() => setShowNewTicket(false)}>
                <FaTimes />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Title *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Brief description of the issue"
                  value={newTicket.title}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select
                    className="form-select"
                    value={newTicket.type}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, type: e.target.value }))}
                  >
                    {TICKET_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select
                    className="form-select"
                    value={newTicket.priority}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, priority: e.target.value }))}
                  >
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Tags (comma separated)</label>
                <input
                  className="form-input"
                  placeholder="e.g. vpn, laptop, printer"
                  value={(newTicket.tags || []).join(', ')}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description *</label>
                <textarea
                  className="form-textarea"
                  rows={6}
                  placeholder="Detailed description, steps to reproduce, error messages…"
                  value={newTicket.description}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowNewTicket(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={createTicket}
                disabled={!newTicket.title.trim() || !newTicket.description.trim()}
              >
                <FaPlus /> Create Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TicketDetail({ ticket, onUpdate, onDelete, onAddComment, currentUser }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    setEditData({
      title: ticket.title,
      description: ticket.description,
      type: ticket.type,
      priority: ticket.priority,
      status: ticket.status,
      assignee: ticket.assignee,
      tags: ticket.tags || []
    });
  }, [ticket]);

  const save = () => { onUpdate(ticket.id, editData); setEditing(false); };
  const assignToMe = () => onUpdate(ticket.id, { assignee: currentUser });

  const sla = getSlaInfo(ticket);

  return (
    <div className="ticket-detail">
      <div className="ticket-detail-header">
        <div className="ticket-detail-title">
          {editing ? (
            <input
              type="text"
              className="form-input"
              value={editData.title}
              onChange={(e) => setEditData(prev => ({ ...prev, title: e.target.value }))}
            />
          ) : (
            <h2>{ticket.title}</h2>
          )}
        </div>

        <div className="ticket-actions">
          {editing ? (
            <>
              <button className="btn btn-primary" onClick={save}><FaSave /> Save</button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={assignToMe}><FaUserPlus /> Assign to me</button>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}><FaEdit /> Edit</button>
              <button className="btn btn-danger" onClick={() => onDelete(ticket.id)}><FaTrash /> Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="ticket-detail-meta">
        <div className="meta-item"><span className="meta-label">Ticket ID:</span><span className="meta-value">#{ticket.id}</span></div>
        <div className="meta-item"><span className="meta-label">Requester:</span><span className="meta-value">{ticket.requesterName}</span></div>
        <div className="meta-item"><span className="meta-label">Assignee:</span>
          {editing
            ? <input className="form-input inline" value={editData.assignee} onChange={(e) => setEditData(prev => ({ ...prev, assignee: e.target.value }))} />
            : <span className="meta-value">{ticket.assignee}</span>}
        </div>
        <div className="meta-item"><span className="meta-label">Created:</span><span className="meta-value">{formatDate(ticket.createdAt)}</span></div>
        <div className="meta-item"><span className="meta-label">Updated:</span><span className="meta-value">{formatDate(ticket.updatedAt)}</span></div>
        <div className="meta-item">
          <span className="meta-label">SLA:</span>
          <span className={`meta-badge ${sla.overdue ? 'overdue' : sla.dueSoon ? 'soon' : ''}`} title={`Due: ${sla.label}`}>
            {sla.overdue ? 'Overdue' : sla.dueSoon ? 'Due soon' : 'On track'}
          </span>
        </div>
      </div>

      <div className="ticket-detail-badges">
        <div className="badge-group">
          <span className="badge-label">Type:</span>
          {editing ? (
            <select className="form-select inline" value={editData.type} onChange={(e) => setEditData(prev => ({ ...prev, type: e.target.value }))}>
              {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          ) : (
            <span className="type-badge">{TICKET_TYPES.find(t => t.value === ticket.type)?.label}</span>
          )}
        </div>

        <div className="badge-group">
          <span className="badge-label">Priority:</span>
          {editing ? (
            <select className="form-select inline" value={editData.priority} onChange={(e) => setEditData(prev => ({ ...prev, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          ) : (
            <span className="priority-badge" style={{ '--badge-color': priorityColor(ticket.priority) }}>
              {PRIORITIES.find(p => p.value === ticket.priority)?.label}
            </span>
          )}
        </div>

        <div className="badge-group">
          <span className="badge-label">Status:</span>
          {editing ? (
            <select className="form-select inline" value={editData.status} onChange={(e) => setEditData(prev => ({ ...prev, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) : (
            <span className="status-badge" style={{ '--badge-color': statusColor(ticket.status) }}>
              {STATUSES.find(s => s.value === ticket.status)?.label}
            </span>
          )}
        </div>

        <div className="badge-group">
          <span className="badge-label">Tags:</span>
          {editing ? (
            <input
              className="form-input inline"
              value={(editData.tags || []).join(', ')}
              onChange={(e) => setEditData(prev => ({ ...prev, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
              placeholder="comma, separated"
            />
          ) : (
            <span className="type-badge">{(ticket.tags || []).join(', ') || '—'}</span>
          )}
        </div>
      </div>

      <div className="ticket-description">
        <h3>Description</h3>
        {editing ? (
          <textarea className="form-textarea" rows={6} value={editData.description} onChange={(e) => setEditData(prev => ({ ...prev, description: e.target.value }))} />
        ) : (
          <div className="description-content">
            {ticket.description.split('\n').map((line, i) => <p key={i}>{line}</p>)}
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="ticket-comments">
        <h3>Comments ({ticket.comments.length})</h3>

        <div className="comments-list">
          {ticket.comments.map(c => (
            <div key={c.id} className="comment-item">
              <div className="comment-header">
                <span className="comment-author">{c.author}</span>
                <span className="comment-date">{formatDate(c.timestamp)}</span>
              </div>
              <div className="comment-text">{c.text}</div>
            </div>
          ))}
        </div>

        <div className="add-comment">
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="Add a comment…"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => { onAddComment(ticket.id, newComment); setNewComment(''); }} disabled={!newComment.trim()}>
            <FaComment /> Add Comment
          </button>
        </div>
      </div>
    </div>
  );
}
