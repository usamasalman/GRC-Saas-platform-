import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import DocumentDetail from './DocumentDetail';

interface DocumentItem {
  id: string;
  code: string;
  title: string;
  category: string;
  classification: string;
  status: string;
  version: string;
  content: string;
  isLockedOut: boolean;
  checkedOutBy?: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  owner?: { id: string; name: string; email: string };
  updatedAt: string;
}

export default function DocumentLibrary() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('Policy');
  const [formClassification, setFormClassification] = useState('Internal');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // File Upload State
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: number;
    type: string;
    base64: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Selected document for detailed view
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);

  const fetchDocuments = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;

      const res = await apiClient.get('/api/documents', { params });
      if (res.data.status === 'success') {
        setDocuments(res.data.documents || []);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [statusFilter, categoryFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDocuments();
  };

  const handleFileSelect = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setFormError('File size exceeds maximum limit of 25MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedFile({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        base64: reader.result as string,
      });
      setFormError('');
    };
    reader.onerror = () => setFormError('Failed to read selected file');
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const openCreateModal = () => {
    setEditingDoc(null);
    setFormCode('');
    setFormTitle('');
    setFormCategory('Policy');
    setFormClassification('Internal');
    setFormContent('');
    setUploadedFile(null);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (doc: DocumentItem) => {
    setEditingDoc(doc);
    setFormCode(doc.code);
    setFormTitle(doc.title);
    setFormCategory(doc.category);
    setFormClassification(doc.classification);
    setFormContent(doc.content);
    setUploadedFile(null);
    setFormError('');
    setShowModal(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');

    try {
      const payload: any = {
        title: formTitle,
        category: formCategory,
        classification: formClassification,
        content: formContent,
      };

      if (uploadedFile) {
        payload.fileData = uploadedFile.base64;
        payload.fileName = uploadedFile.name;
        payload.fileType = uploadedFile.type;
        payload.fileSize = uploadedFile.size;
      }

      if (editingDoc) {
        const res = await apiClient.put(`/api/documents/${editingDoc.id}`, payload);
        if (res.data.status === 'success') {
          setShowModal(false);
          fetchDocuments();
        }
      } else {
        payload.code = formCode;
        const res = await apiClient.post('/api/documents', payload);
        if (res.data.status === 'success') {
          setShowModal(false);
          fetchDocuments();
        }
      }
    } catch (e: any) {
      setFormError(e.response?.data?.message || 'Failed to save document');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (doc: DocumentItem) => {
    try {
      const response = await apiClient.get(`/api/documents/${doc.id}/download`, {
        responseType: 'blob',
      });

      const contentTypeHeader = (response.headers['content-type'] as string) || 'application/octet-stream';
      const blob = new Blob([response.data], {
        type: contentTypeHeader,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const filenameHeader = response.headers['content-disposition'] as string | undefined;
      let filename = doc.fileName || `${doc.code}_v${doc.version}.txt`;
      if (filenameHeader && filenameHeader.includes('filename=')) {
        filename = filenameHeader.split('filename=')[1].replace(/"/g, '');
      }

      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Failed to download document file');
    }
  };

  const handleCheckout = async (docId: string) => {
    try {
      const res = await apiClient.post(`/api/documents/${docId}/checkout`);
      if (res.data.status === 'success') {
        fetchDocuments();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Checkout failed');
    }
  };

  const handleCheckin = async (docId: string) => {
    const summary = prompt('Enter version change summary:', 'Updated document version and attachment');
    if (summary === null) return;

    try {
      const payload: any = {
        summary,
        changeType: 'Minor',
      };
      if (uploadedFile) {
        payload.fileData = uploadedFile.base64;
        payload.fileName = uploadedFile.name;
        payload.fileType = uploadedFile.type;
      }

      const res = await apiClient.post(`/api/documents/${docId}/checkin`, payload);
      if (res.data.status === 'success') {
        fetchDocuments();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Checkin failed');
    }
  };

  const handleSubmitApproval = async (docId: string) => {
    if (!window.confirm('Submit this document for formal approval workflow?')) return;
    try {
      const res = await apiClient.post(`/api/documents/${docId}/submit`);
      if (res.data.status === 'success') {
        fetchDocuments();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Submission failed');
    }
  };

  const handleDelete = async (docId: string) => {
    if (!window.confirm('Delete this DRAFT document? This action cannot be undone.')) return;
    try {
      const res = await apiClient.delete(`/api/documents/${docId}`);
      if (res.data.status === 'success') {
        fetchDocuments();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Deletion failed');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; border: string }> = {
      DRAFT: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
      IN_REVIEW: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)' },
      APPROVED: { bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' },
      PUBLISHED: { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: 'rgba(16, 185, 129, 0.3)' },
      ARCHIVED: { bg: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', border: 'rgba(100, 116, 139, 0.3)' },
      RETURNED: { bg: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: 'rgba(239, 68, 68, 0.3)' },
    };
    const s = styles[status] || { bg: '#1e293b', color: '#94a3b8', border: '#334155' };
    return (
      <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.03em' }}>
        {status}
      </span>
    );
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileBadge = (fileName?: string) => {
    if (!fileName) return null;
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
    return (
      <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
        {ext}
      </span>
    );
  };

  return (
    <div style={{ padding: '28px', color: '#e2e8f0', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
      {/* Design Read Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', color: '#38bdf8', textTransform: 'uppercase', marginBottom: '6px' }}>
            SERVICED DOCUMENT GOVERNANCE
          </div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.02em' }}>Document Library & Storage</h1>
          <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '14px', maxWidth: '65ch', lineHeight: 1.5 }}>
            Centralized document governance repository with drag-and-drop file upload, multi-format downloads (PDF, DOCX, XLSX, TXT), versioning, and non-repudiation audit trails.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#ffffff', border: 'none', padding: '12px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)', transition: 'all 0.15s ease' }}
        >
          + Upload & Create Document
        </button>
      </header>

      {/* Filter & Search Bar */}
      <div style={{ background: '#0f172a', padding: '16px 20px', borderRadius: '10px', border: '1px solid #1e293b', marginBottom: '24px', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '10px', flex: '1', minWidth: '280px' }}>
          <input
            type="text"
            placeholder="Search code, title, file name or keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
          />
          <button type="submit" style={{ background: '#334155', color: '#f8fafc', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>
            Search
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
        >
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="IN_REVIEW">In Review</option>
          <option value="APPROVED">Approved</option>
          <option value="PUBLISHED">Published</option>
          <option value="RETURNED">Returned</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
        >
          <option value="">All Categories</option>
          <option value="Policy">Policy</option>
          <option value="Procedure">Procedure</option>
          <option value="Standard">Standard</option>
          <option value="Guideline">Guideline</option>
          <option value="Template">Template</option>
          <option value="Record">Record</option>
        </select>
      </div>

      {error && <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px' }}>{error}</div>}

      {/* Document Table */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8', background: '#0f172a', borderRadius: '10px', border: '1px solid #1e293b' }}>
          Loading document repository...
        </div>
      ) : documents.length === 0 ? (
        <div style={{ background: '#0f172a', padding: '48px 24px', textAlign: 'center', color: '#94a3b8', borderRadius: '10px', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>📂</div>
          <div style={{ fontSize: '15px', color: '#f8fafc', fontWeight: 600 }}>No documents found</div>
          <p style={{ fontSize: '13px', margin: '4px 0 16px', color: '#94a3b8' }}>Get started by uploading or creating a governance document.</p>
          <button onClick={openCreateModal} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            + Create First Document
          </button>
        </div>
      ) : (
        <div style={{ background: '#0f172a', borderRadius: '10px', border: '1px solid #1e293b', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#161e2e', borderBottom: '1px solid #1e293b', color: '#94a3b8', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.05em' }}>
                <th style={{ padding: '14px 18px' }}>Code</th>
                <th style={{ padding: '14px 18px' }}>Document Title</th>
                <th style={{ padding: '14px 18px' }}>File Attachment</th>
                <th style={{ padding: '14px 18px' }}>Version</th>
                <th style={{ padding: '14px 18px' }}>Status</th>
                <th style={{ padding: '14px 18px' }}>Owner</th>
                <th style={{ padding: '14px 18px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #1e293b', transition: 'background 0.1s ease' }}>
                  <td style={{ padding: '14px 18px', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>{doc.code}</td>
                  <td style={{ padding: '14px 18px', color: '#f8fafc', fontWeight: 500 }}>
                    {doc.title}
                    {doc.isLockedOut && (
                      <span style={{ marginLeft: '8px', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>
                        🔒 Locked
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '14px 18px', color: '#cbd5e1' }}>
                    {doc.fileName ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {getFileBadge(doc.fileName)}
                        <span style={{ fontSize: '12px', color: '#e2e8f0', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.fileName}>
                          {doc.fileName}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>({formatFileSize(doc.fileSize)})</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Text Record</span>
                    )}
                  </td>
                  <td style={{ padding: '14px 18px', color: '#cbd5e1', fontFamily: 'monospace' }}>v{doc.version}</td>
                  <td style={{ padding: '14px 18px' }}>{getStatusBadge(doc.status)}</td>
                  <td style={{ padding: '14px 18px', color: '#94a3b8' }}>{doc.owner?.name || 'System'}</td>
                  <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        style={{ background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                      >
                        View
                      </button>

                      <button
                        onClick={() => handleDownload(doc)}
                        style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                        title="Download Document File"
                      >
                        ⇩ Download
                      </button>

                      {['DRAFT', 'RETURNED'].includes(doc.status) && (
                        <>
                          <button
                            onClick={() => openEditModal(doc)}
                            style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                          >
                            Edit
                          </button>
                          {!doc.isLockedOut ? (
                            <button
                              onClick={() => handleCheckout(doc.id)}
                              style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                            >
                              Checkout
                            </button>
                          ) : (
                            <button
                              onClick={() => handleCheckin(doc.id)}
                              style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
                            >
                              Checkin
                            </button>
                          )}
                          <button
                            onClick={() => handleSubmitApproval(doc.id)}
                            style={{ background: '#047857', color: '#a7f3d0', border: 'none', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                          >
                            Submit
                          </button>
                          {doc.status === 'DRAFT' && (
                            <button
                              onClick={() => handleDelete(doc.id)}
                              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                            >
                              Del
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* In-App Document Reader & Download Hub Modal */}
      {selectedDoc && (
        <DocumentDetail
          documentId={selectedDoc.id}
          onClose={() => setSelectedDoc(null)}
        />
      )}

      {/* Create / Edit Document Modal with File Upload Dropzone */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleFormSubmit} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', width: '600px', maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto', padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#f8fafc', fontWeight: 700 }}>
              {editingDoc ? `Edit ${editingDoc.code}` : 'Upload & Create Document'}
            </h2>

            {formError && <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: '6px', fontSize: '13px' }}>{formError}</div>}

            {!editingDoc && (
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 500 }}>Document Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. POL-SEC-001"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 500 }}>Title *</label>
              <input
                type="text"
                required
                placeholder="Document Title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 500 }}>Category *</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
                >
                  <option value="Policy">Policy</option>
                  <option value="Procedure">Procedure</option>
                  <option value="Standard">Standard</option>
                  <option value="Guideline">Guideline</option>
                  <option value="Template">Template</option>
                  <option value="Record">Record</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 500 }}>Classification *</label>
                <select
                  value={formClassification}
                  onChange={(e) => setFormClassification(e.target.value)}
                  style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}
                >
                  <option value="Public">Public</option>
                  <option value="Internal">Internal</option>
                  <option value="Confidential">Confidential</option>
                  <option value="Restricted">Restricted</option>
                </select>
              </div>
            </div>

            {/* File Upload Drag & Drop Zone */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#38bdf8', marginBottom: '6px', fontWeight: 600 }}>
                File Attachment Upload (PDF, DOCX, XLSX, PPTX, TXT, Images, ZIP)
              </label>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                style={{
                  border: isDragging ? '2px dashed #38bdf8' : '2px dashed #334155',
                  background: isDragging ? 'rgba(56, 189, 248, 0.08)' : '#161e2e',
                  padding: '20px',
                  borderRadius: '10px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="file"
                  id="fileInput"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(e.target.files[0])}
                />
                {uploadedFile ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1e293b', padding: '10px 14px', borderRadius: '6px', border: '1px solid #38bdf8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                      <span style={{ background: '#0284c7', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>ATTACHED</span>
                      <span style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>{uploadedFile.name}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>({formatFileSize(uploadedFile.size)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadedFile(null)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label htmlFor="fileInput" style={{ cursor: 'pointer', display: 'block' }}>
                    <div style={{ fontSize: '28px', marginBottom: '4px' }}>☁️</div>
                    <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 600 }}>Drag & drop file here or <span style={{ color: '#38bdf8', textDecoration: 'underline' }}>browse</span></div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Supports all formats up to 25MB</div>
                  </label>
                )}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 500 }}>Document Summary / Text Content *</label>
              <textarea
                required
                rows={5}
                placeholder="Enter executive summary, compliance clauses or policy body text..."
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ background: '#334155', color: '#f8fafc', border: 'none', padding: '10px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)' }}
              >
                {submitting ? 'Saving...' : editingDoc ? 'Update Document' : 'Save & Attach Document'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
