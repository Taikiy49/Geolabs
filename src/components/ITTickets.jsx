import React, { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  FaTicketAlt,
  FaPlus,
  FaSearch,
  FaFilter,
  FaSync,
  FaEye,
  FaEdit,
  FaTrash,
  FaClock,
  FaCheckCircle,
  FaExclamationTriangle,
  FaUser,
  FaCalendarAlt,
  FaTimes,
  FaSave,
  FaComment,
  FaPaperclip,
  FaLaptop,
  FaMobile,
  FaDesktop,
  FaWifi,
  FaShieldAlt,
  FaDatabase,
  FaTools
} from 'react-icons/fa';
import '../styles/ITTickets.css';

const TICKET_TYPES = [
  { value: 'hardware', label: 'Hardware Issue', icon: FaLaptop },
  { value: 'software', label: 'Software Issue', icon: FaDesktop },
  { value: 'access', label: 'Access Request', icon: FaShieldAlt },
  { value: 'network', label: 'Network/WiFi', icon: FaWifi },
  { value: 'mobile', label: 'Mobile Device', icon: FaMobile },
  { value: 'data', label: 'Data/Database', icon: FaDatabase },
  { value: 'other', label: 'Other', icon: FaTools }
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
  status: 'open'
};

// Helper functions
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getTypeIcon = (type) => {
  const typeObj = TICKET_TYPES.find(t => t.value === type);
  const Icon = typeObj?.icon || FaTools;
  return <Icon />;
};

const getPriorityColor = (priority) => {
  const priorityObj = PRIORITIES.find(p => p.value === priority);
  return priorityObj?.color || 'var(--text-muted)';
};

const getStatusColor = (status) => {
  const statusObj = STATUSES.find(s => s.value === status);
  return statusObj?.color || 'var(--text-muted)';
};

export default function ITTickets() {
  const { accounts } = useMsal();
  const userEmail = accounts[0]?.username || 'guest';
  const userName = accounts[0]?.name || userEmail.split('@')[0];

  // State
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState(emptyTicket);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [editingTicket, setEditingTicket] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [myTicketsOnly, setMyTicketsOnly] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Mock data for demonstration
  useEffect(() => {
    const mockTickets = [
      {
        id: 1,
        title: 'Laptop screen flickering',
        description: 'My laptop screen has been flickering intermittently, especially when opening large files.',
        type: 'hardware',
        priority: 'medium',
        status: 'open',
        requester: userEmail,
        requesterName: userName,
        assignee: 'IT Support',
        createdAt: '2025-01-15T10:30:00Z',
        updatedAt: '2025-01-15T10:30:00Z',
        comments: []
      },
      {
        id: 2,
        title: 'Need access to shared drive',
        description: 'I need access to the Engineering shared drive for the new project files.',
        type: 'access',
        priority: 'high',
        status: 'in_progress',
        requester: userEmail,
        requesterName: userName,
        assignee: 'John Smith',
        createdAt: '2025-01-14T14:15:00Z',
        updatedAt: '2025-01-15T09:20:00Z',
        comments: [
          {
            id: 1,
            author: 'John Smith',
            text: 'Working on getting you access. Should be ready by end of day.',
            timestamp: '2025-01-15T09:20:00Z'
          }
        ]
      }
    ];
    setTickets(mockTickets);
  }, [userEmail, userName]);

  // Filtered and sorted tickets
  const filteredTickets = useMemo(() => {
    let filtered = tickets;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(ticket =>
        ticket.title.toLowerCase().includes(query) ||
        ticket.description.toLowerCase().includes(query) ||
        ticket.requesterName.toLowerCase().includes(query)
      );
    }

    if (statusFilter) {
      filtered = filtered.filter(ticket => ticket.status === statusFilter);
    }

    if (typeFilter) {
      filtered = filtered.filter(ticket => ticket.type === typeFilter);
    }

    if (priorityFilter) {
      filtered = filtered.filter(ticket => ticket.priority === priorityFilter);
    }

    if (myTicketsOnly) {
      filtered = filtered.filter(ticket => ticket.requester === userEmail);
    }

    return filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [tickets, searchQuery, statusFilter, typeFilter, priorityFilter, myTicketsOnly, userEmail]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const paginatedTickets = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredTickets.slice(startIndex, startIndex + pageSize);
  }, [filteredTickets, currentPage, pageSize]);

  // Handlers
  const createTicket = () => {
    const ticket = {
      id: Date.now(),
      ...newTicket,
      requester: userEmail,
      requesterName: userName,
      assignee: 'IT Support',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: []
    };

    setTickets(prev => [ticket, ...prev]);
    setNewTicket(emptyTicket);
    setShowNewTicket(false);
  };

  const updateTicket = (ticketId, updates) => {
    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId
        ? { ...ticket, ...updates, updatedAt: new Date().toISOString() }
        : ticket
    ));
  };

  const deleteTicket = (ticketId) => {
    if (window.confirm('Are you sure you want to delete this ticket?')) {
      setTickets(prev => prev.filter(ticket => ticket.id !== ticketId));
      setSelectedTicket(null);
    }
  };

  const addComment = (ticketId, comment) => {
    const newComment = {
      id: Date.now(),
      author: userName,
      text: comment,
      timestamp: new Date().toISOString()
    };

    setTickets(prev => prev.map(ticket =>
      ticket.id === ticketId
        ? {
            ...ticket,
            comments: [...ticket.comments, newComment],
            updatedAt: new Date().toISOString()
          }
        : ticket
    ));
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
          <button
            className="btn btn-primary"
            onClick={() => setShowNewTicket(true)}
          >
            <FaPlus />
            New Ticket
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="it-filters">
        <div className="filter-group">
          <div className="search-container">
            <FaSearch className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        <div className="filter-group">
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">All Statuses</option>
            {STATUSES.map(status => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">All Types</option>
            {TICKET_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">All Priorities</option>
            {PRIORITIES.map(priority => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={myTicketsOnly}
              onChange={(e) => {
                setMyTicketsOnly(e.target.checked);
                setCurrentPage(1);
              }}
            />
            <span>My Tickets Only</span>
          </label>

          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('');
              setTypeFilter('');
              setPriorityFilter('');
              setMyTicketsOnly(false);
              setCurrentPage(1);
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      <div className="it-main">
        {/* Ticket List */}
        <div className="ticket-list-panel">
          <div className="ticket-list-header">
            <h2>Tickets ({filteredTickets.length})</h2>
            <select
              className="page-size-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
            </select>
          </div>

          <div className="ticket-list">
            {paginatedTickets.length === 0 ? (
              <div className="empty-state">
                <FaTicketAlt className="empty-icon" />
                <h3>No tickets found</h3>
                <p>No tickets match your current filters.</p>
              </div>
            ) : (
              paginatedTickets.map(ticket => (
                <div
                  key={ticket.id}
                  className={`ticket-item ${selectedTicket?.id === ticket.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTicket(ticket)}
                >
                  <div className="ticket-header">
                    <div className="ticket-type">
                      {getTypeIcon(ticket.type)}
                    </div>
                    <div className="ticket-meta">
                      <h3 className="ticket-title">{ticket.title}</h3>
                      <div className="ticket-info">
                        <span className="ticket-id">#{ticket.id}</span>
                        <span className="ticket-requester">
                          <FaUser />
                          {ticket.requesterName}
                        </span>
                        <span className="ticket-date">
                          <FaClock />
                          {formatDate(ticket.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="ticket-badges">
                      <span 
                        className="priority-badge"
                        style={{ '--badge-color': getPriorityColor(ticket.priority) }}
                      >
                        {PRIORITIES.find(p => p.value === ticket.priority)?.label}
                      </span>
                      <span 
                        className="status-badge"
                        style={{ '--badge-color': getStatusColor(ticket.status) }}
                      >
                        {STATUSES.find(s => s.value === ticket.status)?.label}
                      </span>
                    </div>
                  </div>
                  
                  <div className="ticket-preview">
                    {ticket.description.slice(0, 120)}
                    {ticket.description.length > 120 ? '...' : ''}
                  </div>

                  {ticket.comments.length > 0 && (
                    <div className="ticket-comments-count">
                      <FaComment />
                      {ticket.comments.length} comment{ticket.comments.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
              >
                ⏮
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                ◀
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                ▶
              </button>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
              >
                ⏭
              </button>
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
              onAddComment={addComment}
              currentUser={userName}
              isOwner={selectedTicket.requester === userEmail}
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
              <button
                className="modal-close"
                onClick={() => setShowNewTicket(false)}
              >
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
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
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
                    {PRIORITIES.map(priority => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description *</label>
                <textarea
                  className="form-textarea"
                  rows={6}
                  placeholder="Detailed description of the issue, steps to reproduce, and any error messages..."
                  value={newTicket.description}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => setShowNewTicket(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={createTicket}
                disabled={!newTicket.title.trim() || !newTicket.description.trim()}
              >
                <FaPlus />
                Create Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Ticket Detail Component
function TicketDetail({ ticket, onUpdate, onDelete, onAddComment, currentUser, isOwner }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    setEditData({
      title: ticket.title,
      description: ticket.description,
      type: ticket.type,
      priority: ticket.priority,
      status: ticket.status
    });
  }, [ticket]);

  const saveChanges = () => {
    onUpdate(ticket.id, editData);
    setEditing(false);
  };

  const handleAddComment = () => {
    if (newComment.trim()) {
      onAddComment(ticket.id, newComment.trim());
      setNewComment('');
    }
  };

  return (
    <div className="ticket-detail">
      <div className="ticket-detail-header">
        <div className="ticket-detail-title">
          <div className="ticket-type-icon">
            {getTypeIcon(ticket.type)}
          </div>
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
              <button className="btn btn-primary" onClick={saveChanges}>
                <FaSave />
                Save
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                <FaEdit />
                Edit
              </button>
              {isOwner && (
                <button
                  className="btn btn-danger"
                  onClick={() => onDelete(ticket.id)}
                >
                  <FaTrash />
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="ticket-detail-meta">
        <div className="meta-item">
          <span className="meta-label">Ticket ID:</span>
          <span className="meta-value">#{ticket.id}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Requester:</span>
          <span className="meta-value">{ticket.requesterName}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Assignee:</span>
          <span className="meta-value">{ticket.assignee}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Created:</span>
          <span className="meta-value">{formatDate(ticket.createdAt)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Updated:</span>
          <span className="meta-value">{formatDate(ticket.updatedAt)}</span>
        </div>
      </div>

      <div className="ticket-detail-badges">
        <div className="badge-group">
          <span className="badge-label">Type:</span>
          {editing ? (
            <select
              className="form-select inline"
              value={editData.type}
              onChange={(e) => setEditData(prev => ({ ...prev, type: e.target.value }))}
            >
              {TICKET_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="type-badge">
              {getTypeIcon(ticket.type)}
              {TICKET_TYPES.find(t => t.value === ticket.type)?.label}
            </span>
          )}
        </div>

        <div className="badge-group">
          <span className="badge-label">Priority:</span>
          {editing ? (
            <select
              className="form-select inline"
              value={editData.priority}
              onChange={(e) => setEditData(prev => ({ ...prev, priority: e.target.value }))}
            >
              {PRIORITIES.map(priority => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>
          ) : (
            <span 
              className="priority-badge"
              style={{ '--badge-color': getPriorityColor(ticket.priority) }}
            >
              {PRIORITIES.find(p => p.value === ticket.priority)?.label}
            </span>
          )}
        </div>

        <div className="badge-group">
          <span className="badge-label">Status:</span>
          {editing ? (
            <select
              className="form-select inline"
              value={editData.status}
              onChange={(e) => setEditData(prev => ({ ...prev, status: e.target.value }))}
            >
              {STATUSES.map(status => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          ) : (
            <span 
              className="status-badge"
              style={{ '--badge-color': getStatusColor(ticket.status) }}
            >
              {STATUSES.find(s => s.value === ticket.status)?.label}
            </span>
          )}
        </div>
      </div>

      <div className="ticket-description">
        <h3>Description</h3>
        {editing ? (
          <textarea
            className="form-textarea"
            rows={6}
            value={editData.description}
            onChange={(e) => setEditData(prev => ({ ...prev, description: e.target.value }))}
          />
        ) : (
          <div className="description-content">
            {ticket.description.split('\n').map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Comments Section */}
      <div className="ticket-comments">
        <h3>Comments ({ticket.comments.length})</h3>
        
        <div className="comments-list">
          {ticket.comments.map(comment => (
            <div key={comment.id} className="comment-item">
              <div className="comment-header">
                <span className="comment-author">{comment.author}</span>
                <span className="comment-date">{formatDate(comment.timestamp)}</span>
              </div>
              <div className="comment-text">{comment.text}</div>
            </div>
          ))}
        </div>

        <div className="add-comment">
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddComment}
            disabled={!newComment.trim()}
          >
            <FaComment />
            Add Comment
          </button>
        </div>
      </div>
    </div>
  );
}