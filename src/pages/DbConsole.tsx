import Icon from '../components/Icon';
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

// ─── Model Definitions ──────────────────────────────────────────────────────
// Each model lists editable fields with type info for dynamic form generation.
// 'id', 'createdAt', 'updatedAt' are auto-managed and excluded from forms.

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'number' | 'select' | 'textarea' | 'datetime' | 'boolean' | 'decimal';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: string;
  hidden?: boolean; // hidden from the table columns but still in the form
}

interface ModelDef {
  name: string;
  endpoint: string;
  displayColumns: string[]; // columns shown in the table
  fields: FieldDef[];
  requiresTenant?: boolean;
}

const MODEL_DEFS: ModelDef[] = [
  {
    name: 'Tenant',
    endpoint: 'Tenant',
    displayColumns: ['name', 'type', 'path', 'parentId'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Tenant organization name' },
      { name: 'type', label: 'Type', type: 'select', required: true, options: ['SAAS', 'HOLDING', 'MULTIBRANCH', 'BRANCH', 'PARTNER', 'FRANCHISE', 'AUDITOR'] },
      { name: 'path', label: 'Materialized Path', type: 'text', placeholder: '/GROUP_1/ORG_2/', defaultValue: '/' },
      { name: 'parentId', label: 'Parent Tenant ID', type: 'text', placeholder: 'Leave blank for root tenants' },
    ]
  },
  {
    name: 'User',
    endpoint: 'User',
    displayColumns: ['name', 'email', 'passwordHash', 'role', 'status'],
    requiresTenant: true,
    fields: [
      { name: 'name', label: 'Full Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'passwordHash', label: 'Password', type: 'text', required: true, placeholder: 'Plain text for dev (e.g. Demo@2026)' },
      { name: 'role', label: 'Role', type: 'select', required: true, options: [
        'Platform Super Admin', 'Platform Security Admin', 'Platform Billing Admin', 'Platform Service Desk Manager',
        'Group Admin', 'Group Compliance Officer', 'Group Risk Manager', 'Group IT Director',
        'Branch Admin', 'Branch Compliance Officer', 'Branch IT Manager', 'Branch Auditor',
        'Partner Owner', 'Partner Consultant', 'Franchise Owner', 'Franchise Compliance Officer',
        'Document Controller', 'External Auditor'
      ]},
      { name: 'profile', label: 'Profile Title', type: 'text', placeholder: 'e.g. Platform Owner' },
      { name: 'context', label: 'Context / Scope', type: 'text', placeholder: 'e.g. GRC Wisdom SaaS Control Plane' },
      { name: 'branch', label: 'Branch', type: 'text' },
      { name: 'department', label: 'Department', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Suspended'], defaultValue: 'Active' },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true, placeholder: 'UUID of parent tenant' },
    ]
  },
  {
    name: 'AuditLog',
    endpoint: 'AuditLog',
    displayColumns: ['action', 'payload', 'currentHash', 'wormLocked', 'timestamp'],
    requiresTenant: true,
    fields: [
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'actorId', label: 'Actor User ID', type: 'text' },
      { name: 'action', label: 'Action', type: 'text', required: true, placeholder: 'e.g. DOCUMENT_PUBLISHED' },
      { name: 'payload', label: 'Payload (JSON)', type: 'textarea', required: true, placeholder: '{}' },
      { name: 'previousHash', label: 'Previous Hash', type: 'text', required: true },
      { name: 'currentHash', label: 'Current Hash', type: 'text', required: true },
      { name: 'wormLocked', label: 'WORM Locked', type: 'boolean', defaultValue: 'true' },
    ]
  },
  {
    name: 'Document',
    endpoint: 'Document',
    displayColumns: ['code', 'title', 'category', 'status', 'version'],
    requiresTenant: true,
    fields: [
      { name: 'code', label: 'Document Code', type: 'text', required: true, placeholder: 'e.g. DOC-ISMS-001' },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true, options: ['Policy', 'Procedure', 'Standard', 'Guideline', 'Template', 'Record'] },
      { name: 'classification', label: 'Classification', type: 'select', required: true, options: ['Public', 'Internal', 'Confidential', 'Restricted'] },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] },
      { name: 'version', label: 'Version', type: 'text', defaultValue: '1.0' },
      { name: 'content', label: 'Content', type: 'textarea', required: true, placeholder: 'Document body text...' },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'ownerId', label: 'Owner User ID', type: 'text', required: true },
    ]
  },
  {
    name: 'Ticket',
    endpoint: 'Ticket',
    displayColumns: ['subject', 'type', 'priority', 'status', 'service'],
    requiresTenant: true,
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'type', label: 'Type', type: 'select', required: true, options: ['Incident', 'Service Request', 'Problem', 'Change Request'] },
      { name: 'service', label: 'Service', type: 'text', required: true, placeholder: 'e.g. Network, Identity, Endpoint' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Critical', 'High', 'Medium', 'Low'] },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'] },
      { name: 'assignedTeam', label: 'Assigned Team', type: 'text' },
      { name: 'sla', label: 'SLA', type: 'text', placeholder: 'e.g. 4h response' },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
      { name: 'requesterId', label: 'Requester User ID', type: 'text', required: true },
      { name: 'assigneeId', label: 'Assignee User ID', type: 'text' },
    ]
  },
  {
    name: 'OpenSourceTool',
    endpoint: 'OpenSourceTool',
    displayColumns: ['name', 'category', 'license', 'maturity', 'risk'],
    fields: [
      { name: 'name', label: 'Tool Name', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', required: true, options: ['SIEM', 'Vulnerability Scanner', 'IAM', 'Endpoint Protection', 'Container Security', 'API Security'] },
      { name: 'license', label: 'License', type: 'text', required: true, placeholder: 'e.g. Apache 2.0, GPL-3.0' },
      { name: 'maturity', label: 'Maturity', type: 'select', required: true, options: ['Production', 'Beta', 'Alpha', 'Deprecated'] },
      { name: 'review', label: 'Review Notes', type: 'textarea' },
      { name: 'deployment', label: 'Deployment Type', type: 'select', required: true, options: ['Self-Hosted', 'SaaS', 'Hybrid', 'Container'] },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'annualPrice', label: 'Annual Price (SAR)', type: 'decimal', placeholder: '0.00' },
      { name: 'risk', label: 'Risk Level', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
    ]
  },
  {
    name: 'AsmAsset',
    endpoint: 'AsmAsset',
    displayColumns: ['asset', 'type', 'owner', 'score', 'branch'],
    requiresTenant: true,
    fields: [
      { name: 'asset', label: 'Asset Identifier', type: 'text', required: true, placeholder: 'e.g. api.example.com' },
      { name: 'type', label: 'Type', type: 'select', required: true, options: ['Domain', 'Subdomain', 'IP', 'Certificate', 'Service', 'API'] },
      { name: 'owner', label: 'Owner', type: 'text', required: true },
      { name: 'authorization', label: 'Authorization', type: 'select', required: true, options: ['Authorized', 'Unauthorized', 'Pending Review'] },
      { name: 'score', label: 'Risk Score (0-100)', type: 'number', required: true },
      { name: 'critical', label: 'Critical Findings', type: 'number', defaultValue: '0' },
      { name: 'high', label: 'High Findings', type: 'number', defaultValue: '0' },
      { name: 'lastScan', label: 'Last Scan Date', type: 'datetime', required: true },
      { name: 'branch', label: 'Branch', type: 'text', required: true },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
    ]
  },
  {
    name: 'PhishCampaign',
    endpoint: 'PhishCampaign',
    displayColumns: ['name', 'scope', 'status', 'targets', 'failureRate'],
    requiresTenant: true,
    fields: [
      { name: 'name', label: 'Campaign Name', type: 'text', required: true },
      { name: 'scope', label: 'Scope', type: 'text', required: true, placeholder: 'e.g. All Staff, IT Department' },
      { name: 'scenario', label: 'Scenario', type: 'text', required: true, placeholder: 'e.g. Credential Harvest' },
      { name: 'language', label: 'Language', type: 'select', required: true, options: ['English', 'Arabic', 'Both'] },
      { name: 'targets', label: 'Target Count', type: 'number', required: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['Scheduled', 'Active', 'Completed', 'Paused'] },
      { name: 'failureRate', label: 'Failure Rate (0-1)', type: 'decimal' },
      { name: 'reportRate', label: 'Report Rate (0-1)', type: 'decimal' },
      { name: 'remediation', label: 'Remediation Rate (0-1)', type: 'decimal' },
      { name: 'tenantId', label: 'Tenant ID', type: 'text', required: true },
    ]
  },
  {
    name: 'SodRule',
    endpoint: 'SodRule',
    displayColumns: ['key', 'subjectType', 'guardedAction', 'isActive'],
    fields: [
      { name: 'key', label: 'Rule Key', type: 'text', required: true, placeholder: 'e.g. dms-author-approver' },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'subjectType', label: 'Subject Type', type: 'text', required: true, placeholder: 'e.g. Document, Invoice' },
      { name: 'guardedAction', label: 'Guarded Action', type: 'text', required: true, placeholder: 'e.g. DOCUMENT_APPROVED' },
      { name: 'conflictingActions', label: 'Conflicting Actions (JSON array)', type: 'textarea', required: true, placeholder: '["DOCUMENT_CREATED","DOCUMENT_CHECKED_IN"]' },
      { name: 'isActive', label: 'Active', type: 'select', required: true, options: ['true', 'false'], defaultValue: 'true' },
      { name: 'tenantId', label: 'Tenant ID (blank = platform default)', type: 'text' },
    ]
  }
];

// All console requests go through apiClient (baseURL + JWT interceptor).

// ─── Toast Notification System ──────────────────────────────────────────────
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

let toastCounter = 0;

// ─── Styles ─────────────────────────────────────────────────────────────────
const S = {
  page: {
    background: 'var(--surface-sunk)',
    color: 'var(--ink-body)',
    minHeight: '100vh',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    padding: '24px',
    position: 'relative' as const,
  },
  header: {
    borderBottom: '1px solid var(--line)',
    paddingBottom: '16px',
    marginBottom: '24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: '12px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '260px 1fr',
    gap: '24px',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  main: {
    background: 'var(--surface-sunk)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    padding: '20px',
    overflowX: 'auto' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 8px',
    color: 'var(--ink-muted)',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '10px 8px',
    fontSize: '12px',
    borderBottom: '1px solid #1e293b22',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  input: {
    background: 'var(--surface-sunk)',
    color: 'var(--ink-body)',
    border: '1px solid var(--line)',
    padding: '10px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  label: {
    fontSize: '12px',
    color: 'var(--ink-muted)',
    marginBottom: '4px',
    display: 'block' as const,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────
export default function DbConsole() {
  const [activeModelIdx, setActiveModelIdx] = useState(1); // Default to User
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Verification
  const [verificationResult, setVerificationResult] = useState<any>(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editRecordId, setEditRecordId] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Detail view
  const [detailRecord, setDetailRecord] = useState<any>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Tenant list cache for auto-filling
  const [tenants, setTenants] = useState<any[]>([]);

  const model = MODEL_DEFS[activeModelIdx];

  // ── Toast helper ────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  // ── Fetch records ───────────────────────────────────────────────────────
  // Uses apiClient so the JWT interceptor attaches the bearer token — the
  // console requires a Platform Super Admin / Security Admin session.
  const fetchRecords = useCallback(async (endpoint: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/admin/db/table/${endpoint}`);
      if (res.data.status === 'success') {
        setRecords(res.data.records || []);
      } else {
        setError(res.data.message || 'Failed to fetch records');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setError('Not signed in. Log in as a Platform Super Admin, then reopen the console.');
      } else if (status === 403) {
        setError(err?.response?.data?.message || 'Platform admin role required to use the DB console.');
      } else {
        setError('Connection failed. Is the API running on port 3000?');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch tenants for dropdown references
  const fetchTenants = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/admin/db/table/Tenant');
      if (res.data.status === 'success') setTenants(res.data.records || []);
    } catch { /* silent — dropdown is a convenience only */ }
  }, []);

  useEffect(() => {
    fetchRecords(model.endpoint);
    fetchTenants();
  }, [activeModelIdx, model.endpoint, fetchRecords, fetchTenants]);

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm(`Permanently delete record ${id.substring(0, 8)}…?`)) return;
    try {
      const res = await apiClient.delete(`/api/admin/db/table/${model.endpoint}/${id}`);
      if (res.data.status === 'success') {
        addToast(`Record deleted from ${model.name}`, 'success');
        fetchRecords(model.endpoint);
      } else {
        addToast(`Delete failed: ${res.data.message}`, 'error');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || 'Network error during delete', 'error');
    }
  };

  // ── Open create modal ──────────────────────────────────────────────────
  const openCreateModal = () => {
    setIsEditing(false);
    setEditRecordId('');
    setFormErrors({});
    // Initialize with defaults
    const initial: Record<string, string> = {};
    model.fields.forEach(f => {
      initial[f.name] = f.defaultValue || '';
    });
    setFormData(initial);
    setShowModal(true);
  };

  // ── Open edit modal ────────────────────────────────────────────────────
  const openEditModal = (record: any) => {
    setIsEditing(true);
    setEditRecordId(record.id);
    setFormErrors({});
    const initial: Record<string, string> = {};
    model.fields.forEach(f => {
      let val = record[f.name];
      if (val === null || val === undefined) val = '';
      if (f.type === 'boolean') val = String(val);
      if (f.type === 'datetime' && val) {
        // Convert ISO to datetime-local format
        try { val = new Date(val).toISOString().slice(0, 16); } catch { val = ''; }
      }
      initial[f.name] = String(val);
    });
    setFormData(initial);
    setShowModal(true);
  };

  // ── Submit form (create or update) ─────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});

    // Client-side validation
    const errors: Record<string, string> = {};
    model.fields.forEach(f => {
      if (f.required && !isEditing && !formData[f.name]?.trim()) {
        errors[f.name] = `${f.label} is required`;
      }
    });

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setSubmitting(false);
      return;
    }

    // Build payload, converting types
    const payload: Record<string, any> = {};
    model.fields.forEach(f => {
      const val = formData[f.name];
      if (val === undefined || val === '') {
        // Skip empty optional fields on create, include on edit to allow clearing
        if (isEditing && !f.required) payload[f.name] = null;
        return;
      }
      if (f.type === 'number') payload[f.name] = parseInt(val, 10);
      else if (f.type === 'decimal') payload[f.name] = parseFloat(val);
      else if (f.type === 'boolean') payload[f.name] = val === 'true';
      else if (f.type === 'datetime') payload[f.name] = new Date(val).toISOString();
      else payload[f.name] = val;
    });

    try {
      const path = isEditing
        ? `/api/admin/db/table/${model.endpoint}/${editRecordId}`
        : `/api/admin/db/table/${model.endpoint}`;
      const res = isEditing
        ? await apiClient.put(path, payload)
        : await apiClient.post(path, payload);

      if (res.data.status === 'success') {
        addToast(`${model.name} ${isEditing ? 'updated' : 'created'} successfully`, 'success');
        setShowModal(false);
        fetchRecords(model.endpoint);
      } else {
        addToast(`Error: ${res.data.message}`, 'error');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || `Network error: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Reset DB ───────────────────────────────────────────────────────────
  const handleResetDb = async () => {
  if (!window.confirm(' DESTRUCTIVE: Wipe all tables and re-seed from scratch?')) return;
    addToast('Resetting & seeding database…', 'info');
    try {
      const res = await apiClient.post('/api/admin/db/reset');
      if (res.data.status === 'success') {
        addToast('Database reset & seeded successfully', 'success');
        fetchRecords(model.endpoint);
        fetchTenants();
      } else {
        addToast(`Reset failed: ${res.data.message}`, 'error');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || 'Failed to reach backend for reset', 'error');
    }
  };

  // ── Verify audit chain ────────────────────────────────────────────────
  const handleVerifyIntegrity = async () => {
    addToast('Running cryptographic hash chain validation…', 'info');
    setVerificationResult(null);
    try {
      const res = await apiClient.get('/api/admin/db/verify-audit');
      const data = res.data;
      if (data.status === 'success') {
        setVerificationResult(data);
    addToast(data.integrityVerified ? 'WORM chain: INTACT ✓' : 'WORM chain: TAMPERING DETECTED ', data.integrityVerified ? 'success' : 'error');
      } else {
        addToast(`Verification error: ${data.message}`, 'error');
      }
    } catch (err: any) {
      addToast(err?.response?.data?.message || 'Failed to verify audit chain', 'error');
    }
  };

  // ── Filtered records ──────────────────────────────────────────────────
  const filteredRecords = searchQuery
    ? records.filter(r =>
        Object.values(r).some(v =>
          String(v).toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    : records;

  // ── Cell value formatter ──────────────────────────────────────────────
  const formatCell = (value: any, colName: string): string => {
    if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '';
    if (colName.toLowerCase().includes('hash')) return String(value).substring(0, 16) + '…';
    if (colName === 'payload' || colName === 'content') return String(value).substring(0, 40) + (String(value).length > 40 ? '…' : '');
    if (colName === 'timestamp' || colName === 'lastScan' || colName === 'createdAt') {
      try { return new Date(value).toLocaleString(); } catch { return String(value); }
    }
    return String(value);
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* ── Toast Notifications ────────────────────────────────────── */}
      <div style={{
        position: 'fixed', top: '16px', right: '16px', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '380px',
      }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'inherit',
              border: '1px solid',
              backdropFilter: 'blur(12px)',
              animation: 'slideIn 0.3s ease-out',
              ...(t.type === 'success' ? { background: '#052e1640', borderColor: '#10b98140', color: 'var(--success)' }
                : t.type === 'error' ? { background: '#450a0a40', borderColor: '#ef444440', color: 'var(--danger)' }
                : { background: '#0c1a3d40', borderColor: '#3b82f640', color: 'var(--info)' }),
            }}
          >
      {t.type === 'success' ? '✓ ' : t.type === 'error' ? ' ' : 'ℹ '}{t.message}
          </div>
        ))}
      </div>

      {/* Inject keyframe animation */}
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        input:focus, select:focus, textarea:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px #3b82f620; }
        .db-row:hover { background: #1e293b30 !important; }
        .db-btn { transition: all 0.15s ease; }
        .db-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header style={S.header}>
        <div>
          <h1 style={{ color: 'var(--success)', margin: 0, fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: 'var(--ink-body)' }}>$</span> GRC_WISDOM_DB_CONSOLE
            <span style={{
              fontSize: '10px', background: '#10b98120', color: 'var(--success)',
              padding: '2px 8px', borderRadius: '4px', fontWeight: 'normal',
            }}>v2.0</span>
          </h1>
          <p style={{ color: 'var(--ink-body)', margin: '4px 0 0', fontSize: '12px' }}>
            Full CRUD operations · {MODEL_DEFS.length} models · SQLite backend
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="db-btn" onClick={handleVerifyIntegrity} style={{
            background: 'var(--surface-sunk)', border: '1px solid var(--info-line)', color: 'var(--info)',
            padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
          }}>
            <Icon name="link" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Verify WORM Chain
          </button>
          <button className="db-btn" onClick={handleResetDb} style={{
            background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)',
            padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
          }}>
            <Icon name="warning" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Wipe & Seed
          </button>
          <Link to="/" className="db-btn" style={{
            background: 'var(--surface-sunk)', border: '1px solid var(--line)', color: 'var(--ink-body)',
            padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', fontSize: '12px',
            display: 'flex', alignItems: 'center',
          }}>
            ← Exit Console
          </Link>
        </div>
      </header>

      {/* ── WORM Verification Panel ──────────────────────────────── */}
      {verificationResult && (
        <section style={{
          background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '8px',
          padding: '16px', marginBottom: '24px', animation: 'fadeIn 0.3s',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{
              color: verificationResult.integrityVerified ? 'var(--success)' : 'var(--danger)',
              margin: 0, fontSize: '14px',
            }}>
    {verificationResult.integrityVerified ? ' CHAIN INTEGRITY: SECURE' : ' CHAIN INTEGRITY: TAMPERED'}
            </h3>
            <button onClick={() => setVerificationResult(null)} style={{
              background: 'transparent', border: 'none', color: 'var(--ink-body)', cursor: 'pointer', fontSize: '16px',
            }}>✕</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th style={S.th}>Tenant</th>
                <th style={{ ...S.th, textAlign: 'center' }}>Logs</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {verificationResult.results.map((r: any) => (
                <tr key={r.tenantId}>
                  <td style={S.td}>{r.tenantName}</td>
                  <td style={{ ...S.td, textAlign: 'center' }}>{r.logCount}</td>
                  <td style={{
                    ...S.td, textAlign: 'right', fontWeight: 'bold',
                    color: r.status === 'VALID' ? 'var(--success)' : 'var(--danger)',
                  }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Main Grid ────────────────────────────────────────────── */}
      <div style={S.grid}>
        {/* ── Sidebar: Model Tabs ────────────────────────────────── */}
        <nav style={S.sidebar}>
          <div style={{ fontSize: '10px', color: 'var(--ink-body)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '4px 12px', marginBottom: '4px' }}>
            Tables
          </div>
          {MODEL_DEFS.map((m, idx) => (
            <button
              key={m.name}
              onClick={() => { setActiveModelIdx(idx); setSearchQuery(''); setDetailRecord(null); }}
              style={{
                background: activeModelIdx === idx ? 'linear-gradient(135deg, #10b981, #059669)' : 'var(--ink)',
                color: activeModelIdx === idx ? '#fff' : 'var(--ink-muted)',
                border: activeModelIdx === idx ? 'none' : '1px solid transparent',
                padding: '10px 14px',
                textAlign: 'left',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: activeModelIdx === idx ? '700' : '500',
                fontSize: '13px',
                transition: 'background-color 0.15s ease, border-color 0.15s ease',
              }}
            >
              <span style={{ opacity: 0.5, marginRight: '6px' }}><Icon name="flag" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /></span>{m.name}
              {activeModelIdx === idx && (
                <span style={{ float: 'right', fontSize: '11px', opacity: 0.8 }}>{records.length}</span>
              )}
            </button>
          ))}

          <div style={{ borderTop: '1px solid var(--line)', marginTop: '12px', paddingTop: '12px' }}>
            <button
              className="db-btn"
              onClick={openCreateModal}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, var(--info-bg), #3b82f6)',
                color: '#fff',
                border: 'none',
                padding: '12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
              }}
            >
              + Add {model.name}
            </button>
          </div>
        </nav>

        {/* ── Main: Records Table ────────────────────────────────── */}
        <main style={S.main}>
          {/* Table header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ color: 'var(--ink-body)', margin: 0, fontSize: '16px' }}>
                <span style={{ color: 'var(--info)' }}>SELECT * FROM</span> {model.endpoint}
              </h2>
              <p style={{ color: 'var(--ink-body)', margin: '2px 0 0', fontSize: '11px' }}>
                {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
                {searchQuery && ` (filtered from ${records.length})`}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
        placeholder=" Filter records…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...S.input, width: '200px', padding: '8px 12px', fontSize: '12px' }}
              />
              <button className="db-btn" onClick={() => fetchRecords(model.endpoint)} style={{
                background: 'var(--surface-sunk)', border: '1px solid var(--line)', color: 'var(--ink-muted)',
                padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
              }}>
                ↻ Refresh
              </button>
            </div>
          </div>

          {/* Table body */}
          {loading ? (
            <div style={{ color: 'var(--ink-body)', padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px', animation: 'fadeIn 0.5s' }}>⏳</div>
              Executing query…
            </div>
          ) : error ? (
            <div style={{ color: 'var(--danger)', background: '#450a0a20', padding: '16px', borderRadius: '6px', border: '1px solid #450a0a' }}>
              <Icon name="close" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> {error}
            </div>
          ) : filteredRecords.length === 0 ? (
            <div style={{ color: 'var(--ink-body)', padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>∅</div>
              {searchQuery ? 'No records match your filter.' : 'Empty table. Click "+ Add" to create a record.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)' }}>
                    <th style={S.th}>ID</th>
                    {model.displayColumns.map(col => (
                      <th key={col} style={S.th}>{col}</th>
                    ))}
                    <th style={{ ...S.th, textAlign: 'right', minWidth: '140px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(r => (
                    <tr key={r.id} className="db-row" style={{ cursor: 'default' }}>
                      <td style={{ ...S.td, color: 'var(--ink-body)', fontFamily: 'monospace' }}>
                        {r.id?.substring(0, 8)}…
                      </td>
                      {model.displayColumns.map(col => (
                        <td key={col} style={{
                          ...S.td,
                          color: col === 'status' ? (
                            ['Active', 'PUBLISHED', 'Completed', 'VALID', 'Resolved', 'Closed'].includes(r[col]) ? 'var(--success)'
                            : ['Inactive', 'Suspended', 'TAMPERED', 'Critical'].includes(r[col]) ? 'var(--danger)'
                            : ['DRAFT', 'Pending', 'Scheduled', 'IN_REVIEW'].includes(r[col]) ? 'var(--warning)'
                            : 'var(--ink-body)'
                          ) : col === 'email' ? 'var(--info)'
                          : col === 'passwordHash' ? 'var(--ink-muted)'
                          : col === 'score' ? (Number(r[col]) >= 70 ? 'var(--danger)' : Number(r[col]) >= 40 ? 'var(--warning)' : 'var(--success)')
                          : 'var(--ink-body)',
                          fontWeight: ['name', 'subject', 'title', 'asset'].includes(col) ? 'bold' : 'normal',
                        }}>
                          {formatCell(r[col], col)}
                        </td>
                      ))}
                      <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          className="db-btn"
                          onClick={() => setDetailRecord(detailRecord?.id === r.id ? null : r)}
                          title="Inspect record"
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--violet)',
                            cursor: 'pointer', fontSize: '12px', padding: '4px 6px',
                          }}
                        >
                          [view]
                        </button>
                        <button
                          className="db-btn"
                          onClick={() => openEditModal(r)}
                          title="Edit record"
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--info)',
                            cursor: 'pointer', fontSize: '12px', padding: '4px 6px',
                          }}
                        >
                          [edit]
                        </button>
                        <button
                          className="db-btn"
                          onClick={() => handleDelete(r.id)}
                          title="Delete record"
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--danger)',
                            cursor: 'pointer', fontSize: '12px', padding: '4px 6px',
                          }}
                        >
                          [del]
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Detail Panel (Inspect Record) ───────────────────── */}
          {detailRecord && (
            <div style={{
              marginTop: '20px', background: 'var(--surface-sunk)', border: '1px solid var(--line)',
              borderRadius: '8px', padding: '16px', animation: 'scaleIn 0.2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--violet)' }}>
                  <Icon name="standards" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Record Detail — {detailRecord.id?.substring(0, 12)}…
                </h3>
                <button onClick={() => setDetailRecord(null)} style={{
                  background: 'transparent', border: 'none', color: 'var(--ink-body)', cursor: 'pointer', fontSize: '16px',
                }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                {Object.entries(detailRecord).map(([key, value]) => (
                  <div key={key} style={{
                    display: 'flex', gap: '8px', padding: '6px 8px', borderRadius: '4px',
                    background: 'var(--surface-sunk)',
                  }}>
                    <span style={{ color: 'var(--ink-muted)', minWidth: '120px', flexShrink: 0 }}>{key}:</span>
                    <span style={{
                      color: 'var(--ink-body)', wordBreak: 'break-all',
                      maxHeight: '60px', overflow: 'auto',
                    }}>
                      {value === null ? <span style={{ color: 'var(--ink-body)' }}>null</span> : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── CRUD Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0, 0, 0, 0.85)', display: 'flex',
            justifyContent: 'center', alignItems: 'flex-start',
            zIndex: 2000, padding: '40px 16px', overflowY: 'auto',
            animation: 'fadeIn 0.2s',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              background: 'var(--surface-sunk)', border: '1px solid var(--line)',
              borderRadius: '12px', padding: '28px', width: '520px',
              maxWidth: '100%', animation: 'scaleIn 0.2s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: isEditing ? 'var(--info)' : 'var(--success)', fontSize: '16px' }}>
        {isEditing ? ` Edit ${model.name}` : `+ Create ${model.name}`}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--ink-body)', cursor: 'pointer', fontSize: '20px',
              }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
              {model.fields.map(f => {
                // For tenantId fields, offer a dropdown of existing tenants
                if (f.name === 'tenantId' && tenants.length > 0) {
                  return (
                    <div key={f.name}>
                      <label style={S.label}>
                        {f.label} {f.required && !isEditing && <span style={{ color: 'var(--danger)' }}>*</span>}
                      </label>
                      <select
                        value={formData[f.name] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        required={f.required && !isEditing}
                        style={{ ...S.input, cursor: 'pointer' }}
                      >
                        <option value="">— Select Tenant —</option>
                        {tenants.map((t: any) => (
                          <option key={t.id} value={t.id}>{t.name} ({t.type}) — {t.id.substring(0, 8)}…</option>
                        ))}
                      </select>
                      {formErrors[f.name] && <span style={{ color: 'var(--danger)', fontSize: '11px' }}>{formErrors[f.name]}</span>}
                    </div>
                  );
                }

                return (
                  <div key={f.name}>
                    <label style={S.label}>
                      {f.label} {f.required && !isEditing && <span style={{ color: 'var(--danger)' }}>*</span>}
                    </label>

                    {f.type === 'select' ? (
                      <select
                        value={formData[f.name] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        required={f.required && !isEditing}
                        style={{ ...S.input, cursor: 'pointer' }}
                      >
                        <option value="">— Select —</option>
                        {f.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : f.type === 'textarea' ? (
                      <textarea
                        value={formData[f.name] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        required={f.required && !isEditing}
                        placeholder={f.placeholder}
                        rows={3}
                        style={{ ...S.input, resize: 'vertical', minHeight: '60px' }}
                      />
                    ) : f.type === 'boolean' ? (
                      <select
                        value={formData[f.name] || 'false'}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        style={{ ...S.input, cursor: 'pointer' }}
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    ) : f.type === 'datetime' ? (
                      <input
                        type="datetime-local"
                        value={formData[f.name] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        required={f.required && !isEditing}
                        style={S.input}
                      />
                    ) : (
                      <input
                        type={f.type === 'number' || f.type === 'decimal' ? 'number' : f.type}
                        step={f.type === 'decimal' ? '0.01' : undefined}
                        value={formData[f.name] || ''}
                        onChange={e => setFormData(prev => ({ ...prev, [f.name]: e.target.value }))}
                        required={f.required && !isEditing}
                        placeholder={f.placeholder}
                        style={S.input}
                      />
                    )}

                    {formErrors[f.name] && <span style={{ color: 'var(--danger)', fontSize: '11px', marginTop: '2px', display: 'block' }}>{formErrors[f.name]}</span>}
                  </div>
                );
              })}
            </div>

            {/* Modal actions */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                className="db-btn"
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1, padding: '12px',
                  background: submitting ? 'var(--ink-body)' : 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff', border: 'none', borderRadius: '6px',
                  cursor: submitting ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '13px',
                }}
              >
                {submitting ? 'Saving…' : isEditing ? 'Update Record' : 'Create Record'}
              </button>
              <button
                className="db-btn"
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1, background: 'var(--surface-sunk)', color: 'var(--ink-muted)',
                  border: '1px solid var(--line)', padding: '12px', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '13px',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
