import Icon from '../../components/Icon';
import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

interface DocumentDetailProps {
  documentId: string;
  onClose: () => void;
}

export default function DocumentDetail({ documentId, onClose }: DocumentDetailProps) {
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'reader' | 'file' | 'versions' | 'approvals'>('reader');
  const [readerMode, setReaderMode] = useState<'pdf-embed' | 'pdf-page' | 'raw-text'>('pdf-embed');
  const [downloading, setDownloading] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchDocumentDetail = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/documents/${documentId}`);
      if (res.data.status === 'success') {
        const doc = res.data.document;
        setDocument(doc);

        // Fetch PDF Blob URL if an uploaded file exists or if doc has content
        loadPdfBlob(doc.id, doc.fileType);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load document details');
    } finally {
      setLoading(false);
    }
  };

  const loadPdfBlob = async (id: string, fileType?: string) => {
    setPdfLoading(true);
    try {
      const response = await apiClient.get(`/api/documents/${id}/download`, {
        responseType: 'blob',
      });
      const mime = (response.headers['content-type'] as string) || fileType || 'application/pdf';
      const blob = new Blob([response.data], { type: mime });
      const blobUrl = window.URL.createObjectURL(blob);
      setPdfBlobUrl(blobUrl);
    } catch (err) {
      console.warn('[PDF Blob Load Warning]:', err);
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) {
      fetchDocumentDetail();
    }
    return () => {
      if (pdfBlobUrl) {
        window.URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [documentId]);

  const handleDownload = async () => {
    if (!document) return;
    setDownloading(true);
    try {
      const response = await apiClient.get(`/api/documents/${document.id}/download`, {
        responseType: 'blob',
      });

      const contentTypeHeader = (response.headers['content-type'] as string) || 'application/octet-stream';
      const blob = new Blob([response.data], { type: contentTypeHeader });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;

      const filenameHeader = response.headers['content-disposition'] as string | undefined;
      let filename = document.fileName || `${document.code}_v${document.version}.pdf`;
      if (filenameHeader && filenameHeader.includes('filename=')) {
        filename = filenameHeader.split('filename=')[1].replace(/"/g, '');
      }

      link.setAttribute('download', filename);
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Failed to download document file');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string; border: string }> = {
      DRAFT: { bg: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)', border: 'rgba(245, 158, 11, 0.3)' },
      IN_REVIEW: { bg: 'rgba(59, 130, 246, 0.15)', color: 'var(--info)', border: 'rgba(59, 130, 246, 0.3)' },
      APPROVED: { bg: 'rgba(168, 85, 247, 0.15)', color: 'var(--violet)', border: 'rgba(168, 85, 247, 0.3)' },
      PUBLISHED: { bg: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)', border: 'rgba(16, 185, 129, 0.3)' },
      ARCHIVED: { bg: 'rgba(100, 116, 139, 0.15)', color: 'var(--ink-muted)', border: 'rgba(100, 116, 139, 0.3)' },
      RETURNED: { bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', border: 'rgba(239, 68, 68, 0.3)' },
    };
    const s = styles[status] || { bg: 'var(--surface-sunk)', color: 'var(--ink-muted)', border: 'var(--line)' };
    return (
      <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5, 8, 16, 0.94)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '16px' }}>
      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '14px', width: '960px', maxWidth: '96vw', height: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)', overflow: 'hidden' }}>
        
        {/* Top Header & Toolbar */}
        <header style={{ background: 'var(--surface-sunk)', padding: '14px 24px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: 'var(--info)', fontWeight: 700, fontFamily: 'monospace', fontSize: '14px' }}>{document?.code || 'DOC'}</span>
              <span style={{ color: 'var(--ink-muted)', fontSize: '12px' }}>v{document?.version || '1.0'}</span>
              {document?.status && getStatusBadge(document.status)}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: '18px', color: 'var(--ink)', fontWeight: 700 }}>{document?.title || 'Document Viewer'}</h2>
          </div>

          {/* Reader View Mode Controls & Downloads */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {activeTab === 'reader' && (
              <div style={{ background: 'var(--surface-sunk)', padding: '3px', borderRadius: '6px', border: '1px solid var(--line)', display: 'flex', gap: '2px' }}>
                <button
                  type="button"
                  onClick={() => setReaderMode('pdf-embed')}
                  style={{ background: readerMode === 'pdf-embed' ? 'var(--info)' : 'transparent', color: readerMode === 'pdf-embed' ? '#fff' : 'var(--ink-muted)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  <Icon name="documents" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Interactive PDF Reader
                </button>
                <button
                  type="button"
                  onClick={() => setReaderMode('pdf-page')}
                  style={{ background: readerMode === 'pdf-page' ? 'var(--info)' : 'transparent', color: readerMode === 'pdf-page' ? '#fff' : 'var(--ink-muted)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  <Icon name="knowledge" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Formatted Document
                </button>
                <button
                  type="button"
                  onClick={() => setReaderMode('raw-text')}
                  style={{ background: readerMode === 'raw-text' ? 'var(--info)' : 'transparent', color: readerMode === 'raw-text' ? '#fff' : 'var(--ink-muted)', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                >
                  <Icon name="edit" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Text View
                </button>
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
            >
              <span>⇩</span> {downloading ? 'Downloading...' : 'Download File'}
            </button>

            <button
              onClick={handlePrint}
              style={{ background: 'var(--surface-sunk)', color: 'var(--ink-body)', border: '1px solid var(--line)', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
            >
              <Icon name="invoices" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} />️ Print
            </button>

            <button
              onClick={onClose}
              style={{ background: 'var(--surface-sunk)', color: 'var(--ink)', border: 'none', borderRadius: '8px', width: '34px', height: '34px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}
            >
              ✕
            </button>
          </div>
        </header>

        {/* Tab Navigation */}
        <nav style={{ background: 'var(--surface-sunk)', borderBottom: '1px solid var(--line)', padding: '0 24px', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('reader')}
            style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'reader' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'reader' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'reader' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
          >
            <Icon name="knowledge" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> In-App PDF & Document Reader
          </button>
          <button
            onClick={() => setActiveTab('file')}
            style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'file' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'file' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'file' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
          >
            <Icon name="documents" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> File Attachment & Downloads {document?.fileName && '●'}
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'versions' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'versions' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'versions' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
          >
            <Icon name="documents" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Version History ({document?.versions?.length || 1})
          </button>
          <button
            onClick={() => setActiveTab('approvals')}
            style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'approvals' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'approvals' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'approvals' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
          >
            ✍️ Digital Signatures ({document?.approvals?.length || 0})
          </button>
        </nav>

        {/* Tab Content Container */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: 'var(--surface-sunk)' }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading document viewer...</div>
          ) : error ? (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '16px', borderRadius: '8px' }}>{error}</div>
          ) : (
            <>
              {/* TAB 1: In-App PDF & Document Reader */}
              {activeTab === 'reader' && (
                <div>
                  {readerMode === 'pdf-embed' ? (
                    pdfBlobUrl ? (
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '12px', color: 'var(--info)', fontWeight: 600 }}>LIVE IN-APP PDF READER ({document.fileName || document.code})</span>
                          <button
                            onClick={handleDownload}
                            style={{ background: 'var(--brand)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                          >
                            ⇩ Download Original PDF
                          </button>
                        </div>
                        <iframe
                          src={pdfBlobUrl}
                          title="PDF Reader Viewer"
                          style={{ width: '100%', height: '580px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--surface)' }}
                        />
                      </div>
                    ) : pdfLoading ? (
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '48px', textAlign: 'center', color: 'var(--ink-muted)' }}>
                        Rendering PDF stream...
                      </div>
                    ) : (
                      /* Fallback Formatted Document Canvas if Blob is loading/empty */
                      <div style={{ width: '100%', maxWidth: '780px', margin: '0 auto', background: 'var(--surface)', color: 'var(--ink)', borderRadius: '4px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', padding: '48px 56px', position: 'relative', minHeight: '650px', fontFamily: 'Georgia, "Times New Roman", serif' }}>
                        <div style={{ position: 'absolute', top: '24px', right: '32px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--danger)', border: '1.5px solid var(--danger-line)', padding: '2px 8px', borderRadius: '2px', fontFamily: 'sans-serif' }}>
                          CLASSIFICATION: {document.classification?.toUpperCase() || 'INTERNAL'}
                        </div>
                        <div style={{ borderBottom: '2px solid var(--line)', paddingBottom: '16px', marginBottom: '28px', fontFamily: 'sans-serif' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--info)', letterSpacing: '0.05em' }}>GRC WISDOM PLATFORM GOVERNANCE RECORD</span>
                            <span style={{ fontSize: '11px', color: 'var(--ink-muted)', fontFamily: 'monospace' }}>DOC ID: {document.code}</span>
                          </div>
                          <h1 style={{ margin: '12px 0 6px', fontSize: '26px', color: 'var(--ink)', fontWeight: 700, lineHeight: '1.2' }}>{document.title}</h1>
                          <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: 'var(--ink-body)', marginTop: '8px' }}>
                            <div><strong>Category:</strong> {document.category}</div>
                            <div><strong>Version:</strong> v{document.version}</div>
                            <div><strong>Owner:</strong> {document.owner?.name || 'System Author'}</div>
                            <div><strong>Date:</strong> {new Date(document.updatedAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '15px', lineHeight: '1.8', color: 'var(--ink)', whiteSpace: 'pre-wrap', marginBottom: '40px' }}>
                          {document.content}
                        </div>
                        <div style={{ position: 'absolute', bottom: '24px', left: '56px', right: '56px', borderTop: '1px solid var(--field-line)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-muted)', fontFamily: 'sans-serif' }}>
                          <span>GRC Wisdom Automated Document Governance System</span>
                          <span>Page 1 of 1</span>
                        </div>
                      </div>
                    )
                  ) : readerMode === 'pdf-page' ? (
                    /* High-Fidelity PDF Page Layout Viewer */
                    <div style={{ width: '100%', maxWidth: '780px', margin: '0 auto', background: 'var(--surface)', color: 'var(--ink)', borderRadius: '4px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', padding: '48px 56px', position: 'relative', minHeight: '650px', fontFamily: 'Georgia, "Times New Roman", serif' }}>
                      {/* Security Watermark */}
                      <div style={{ position: 'absolute', top: '24px', right: '32px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--danger)', border: '1.5px solid var(--danger-line)', padding: '2px 8px', borderRadius: '2px', fontFamily: 'sans-serif' }}>
                        CLASSIFICATION: {document.classification?.toUpperCase() || 'INTERNAL'}
                      </div>

                      {/* Header Block */}
                      <div style={{ borderBottom: '2px solid var(--line)', paddingBottom: '16px', marginBottom: '28px', fontFamily: 'sans-serif' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--info)', letterSpacing: '0.05em' }}>GRC WISDOM PLATFORM GOVERNANCE RECORD</span>
                          <span style={{ fontSize: '11px', color: 'var(--ink-muted)', fontFamily: 'monospace' }}>DOC ID: {document.code}</span>
                        </div>
                        <h1 style={{ margin: '12px 0 6px', fontSize: '26px', color: 'var(--ink)', fontWeight: 700, lineHeight: '1.2' }}>{document.title}</h1>
                        <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: 'var(--ink-body)', marginTop: '8px' }}>
                          <div><strong>Category:</strong> {document.category}</div>
                          <div><strong>Version:</strong> v{document.version}</div>
                          <div><strong>Owner:</strong> {document.owner?.name || 'System Author'}</div>
                          <div><strong>Date:</strong> {new Date(document.updatedAt).toLocaleDateString()}</div>
                        </div>
                      </div>

                      {/* PDF Body Reader Content */}
                      <div style={{ fontSize: '15px', lineHeight: '1.8', color: 'var(--ink)', whiteSpace: 'pre-wrap', marginBottom: '40px' }}>
                        {document.content}
                      </div>

                      {/* PDF Footer Page Number */}
                      <div style={{ position: 'absolute', bottom: '24px', left: '56px', right: '56px', borderTop: '1px solid var(--field-line)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--ink-muted)', fontFamily: 'sans-serif' }}>
                        <span>GRC Wisdom Automated Document Governance System</span>
                        <span>Page 1 of 1</span>
                      </div>
                    </div>
                  ) : (
                    /* Raw Text Reader View */
                    <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '32px', position: 'relative' }}>
                      <div style={{ fontSize: '12px', color: 'var(--info)', fontFamily: 'monospace', fontWeight: 700, marginBottom: '4px' }}>{document.code}</div>
                      <h1 style={{ margin: '0 0 12px', fontSize: '24px', color: 'var(--ink)', fontWeight: 700 }}>{document.title}</h1>
                      <div style={{ color: 'var(--ink-body)', fontSize: '14px', lineHeight: '1.8', whiteSpace: 'pre-wrap', fontFamily: 'Inter, system-ui, sans-serif' }}>
                        {document.content}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: File Attachment & Downloads */}
              {activeTab === 'file' && (
                <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '24px' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--ink)' }}>Attached File Storage & Service</h3>
                  
                  {pdfBlobUrl ? (
                    <div>
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <span style={{ background: 'var(--info)', color: '#ffffff', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' }}>
                              {document.fileName?.split('.').pop()?.toUpperCase() || 'PDF'}
                            </span>
                            <span style={{ fontSize: '16px', color: 'var(--ink)', fontWeight: 600 }}>{document.fileName || `${document.code}_v${document.version}.pdf`}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                            File Size: {formatFileSize(document.fileSize)} | Format: {document.fileType || 'application/pdf'}
                          </div>
                        </div>

                        <button
                          onClick={handleDownload}
                          style={{ background: 'var(--brand)', color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
                        >
                          ⇩ Download Attached File
                        </button>
                      </div>

                      {/* Embedded File Viewer Frame via Same-Origin Blob URL */}
                      <iframe
                        src={pdfBlobUrl}
                        title="Embedded File Preview"
                        style={{ width: '100%', height: '520px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--surface)' }}
                      />
                    </div>
                  ) : (
                    <div style={{ background: 'var(--surface-sunk)', border: '1px dashed var(--line)', borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}><Icon name="documents" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /></div>
                      <div style={{ fontSize: '14px', color: 'var(--ink)', fontWeight: 600 }}>No raw binary file attached</div>
                      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', margin: '4px 0 16px' }}>
                        This document was created as a structured text policy. You can still download it as a formatted document file.
                      </p>
                      <button
                        onClick={handleDownload}
                        style={{ background: 'var(--info)', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                      >
                        ⇩ Export & Download Document (.pdf / .txt)
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Version History Timeline */}
              {activeTab === 'versions' && (
                <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '24px' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--ink)' }}>Document Version Audit Timeline</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(document.versions || []).map((ver: any) => (
                      <div key={ver.id} style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '8px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ color: 'var(--info)', fontWeight: 700, fontFamily: 'monospace' }}>v{ver.versionNumber}</span>
                            <span style={{ background: 'var(--surface-sunk)', color: 'var(--ink-body)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{ver.changeType || 'Revision'}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--ink)' }}>{ver.summary || 'Document update'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--ink-muted)', marginTop: '4px' }}>
                            Checked in on {new Date(ver.createdAt).toLocaleString()}
                          </div>
                        </div>
                        {ver.fileHash && (
                          <div style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--success)', background: 'var(--success-bg)', padding: '6px 10px', borderRadius: '4px' }}>
                            SHA-256: {ver.fileHash.substring(0, 16)}...
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: Digital Signatures & Approvals */}
              {activeTab === 'approvals' && (
                <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '24px' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--ink)' }}>Digital Signature & Non-Repudiation Audit Trail</h3>
                  {(document.approvals || []).length === 0 ? (
                    <div style={{ color: 'var(--ink-muted)', fontSize: '13px' }}>No formal approval records registered yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {document.approvals.map((app: any) => (
                        <div key={app.id} style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '8px', padding: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{app.approver?.name || 'Reviewer'}</div>
                            <span style={{ background: app.status === 'APPROVED' ? '#064e3b' : 'var(--danger)', color: app.status === 'APPROVED' ? 'var(--success)' : 'var(--danger)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                              {app.status}
                            </span>
                          </div>
                          {app.signatureHash && (
                            <div style={{ fontSize: '11px', color: 'var(--success)', fontFamily: 'monospace', background: 'var(--success-bg)', padding: '8px', borderRadius: '4px', wordBreak: 'break-all' }}>
                              Digital Signature (SHA-256): {app.signatureHash}
                            </div>
                          )}
                          <div style={{ fontSize: '11px', color: 'var(--ink-muted)', marginTop: '6px' }}>
                            Reviewed on: {app.reviewedAt ? new Date(app.reviewedAt).toLocaleString() : 'Pending'} {app.sessionInfo && `| ${app.sessionInfo}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
