import Icon from '../../components/Icon';
import { useState, useEffect, useRef } from 'react';
import apiClient from '../../api/apiClient';
import PickManyDialog from '../../components/PickManyDialog';
import PagingBar, { type PageInfo } from '../../components/PagingBar';

interface DocumentDetailProps {
  documentId: string;
  onClose: () => void;
}

/**
 * What a browser frame can actually display.
 *
 * The reader pane put every attachment into an <iframe> under the heading
 * "LIVE IN-APP PDF READER". A frame renders PDFs, images and plain text; it
 * renders nothing for XLSX, DOCX, PPTX or ZIP — the box comes up empty, or the
 * browser quietly offers a download instead. The library's own spreadsheet is
 * that case, which is why the reader looked broken: it was being asked to show
 * a format no browser shows, and then claiming to be showing it.
 *
 * Decided on the served content type, falling back to the extension, because a
 * server that sends application/octet-stream tells us nothing and the filename
 * usually does.
 */
const RENDERABLE_MIME = /^(application\/pdf|image\/(png|jpeg|jpg|gif|webp|svg\+xml|bmp)|text\/(plain|html|csv))/i;
const RENDERABLE_EXT = /\.(pdf|png|jpe?g|gif|webp|svg|bmp|txt|csv|html?)$/i;

function browserCanRender(mime: string | null, fileName?: string): boolean {
  if (mime && RENDERABLE_MIME.test(mime)) return true;
  // octet-stream is the server saying "bytes"; ask the name instead.
  if (mime && !/octet-stream/i.test(mime)) return false;
  return !!fileName && RENDERABLE_EXT.test(fileName);
}

/** The format in the words on the file card, for a message a person can act on. */
function describeFormat(mime: string | null, fileName?: string): string {
  const ext = (fileName?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
  if (ext) return `A ${ext} file`;
  if (mime) return `This file (${mime.split(';')[0]})`;
  return 'This file';
}

export default function DocumentDetail({ documentId, onClose }: DocumentDetailProps) {
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<
    'reader' | 'file' | 'versions' | 'approvals' | 'governs' | 'access'
  >('reader');

  // Who has read this document.
  //
  // Nothing recorded a read. The acknowledgement list answers who was ASKED to
  // sign and who SAID they had read it -- a claim by the reader, and only for
  // the published audience. It is silent about everybody outside that
  // audience, who are exactly the people the question is about.
  //
  // The tab appears only for the document's owner and for whoever holds
  // retention and legal hold: knowing who has been reading a policy is its own
  // disclosure. A 403 is the server saying so, and is not an error to show.
  const [access, setAccess] = useState<any[]>([]);
  const [accessSummary, setAccessSummary] = useState<any>(null);
  const [maySeeAccess, setMaySeeAccess] = useState(false);
  const [accessNote, setAccessNote] = useState('');
  const [reach, setReach] = useState<any>(null);
  // A page at a time. The history stopped at 500 reading days, and the screen
  // never said so (QA-021).
  const [accessPage, setAccessPage] = useState(1);
  const [accessPaging, setAccessPaging] = useState<PageInfo | null>(null);

  const loadAccess = async () => {
    try {
      const res = await apiClient.get(`/api/documents/${documentId}/access`, { params: { page: accessPage } });
      setAccess(res.data?.access || []);
      setAccessPaging(res.data?.paging || null);
      setAccessSummary(res.data?.summary || null);
      setAccessNote(res.data?.recordedSince || '');
      setMaySeeAccess(true);
    } catch {
      setMaySeeAccess(false);
    }
  };

  useEffect(() => {
    loadAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, accessPage]);

  // What this policy governs.
  //
  // There was no fifth tab because there was nothing to put in it: five foreign
  // keys pointed at the Document table and none came from Control, Risk or
  // StandardClause. The user guide told people to "always include framework
  // mappings in the document metadata" and to "map relevant regulatory standard
  // clauses" as phase one of the documented lifecycle, and neither had a field.
  const [links, setLinks] = useState<any[]>([]);
  const [linkSummary, setLinkSummary] = useState<any>(null);
  // The one list the open picker is choosing from, fetched when it opens and
  // searched on the server: a list sent whole to every document view stopped
  // at 500 rows and could not reach the rest (QA-021).
  const [options, setOptions] = useState<{
    rows: any[]; total: number; enabledFrameworks: number;
  }>({ rows: [], total: 0, enabledFrameworks: 0 });
  const optionsAsk = useRef(0);
  const [picking, setPicking] = useState<'control' | 'risk' | 'clause' | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');

  const loadLinks = async () => {
    try {
      const res = await apiClient.get(`/api/documents/${documentId}/links`);
      setLinks(res.data?.links || []);
      setLinkSummary(res.data?.summary || null);
    } catch {
      setLinks([]);
      setLinkSummary(null);
    }
  };

  useEffect(() => {
    loadLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  /** Loads one list; an answer to an older search, arriving late, is dropped. */
  const loadOptions = async (kind: 'control' | 'risk' | 'clause', q = ''): Promise<boolean> => {
    const ask = ++optionsAsk.current;
    const res = await apiClient.get('/api/documents/link-options', { params: { kind, q: q || undefined } });
    if (ask !== optionsAsk.current) return false;
    const key = kind === 'control' ? 'controls' : kind === 'risk' ? 'risks' : 'clauses';
    setOptions({
      rows: res.data?.[key] || [],
      total: res.data?.totals?.[key] ?? 0,
      enabledFrameworks: res.data?.enabledFrameworks || 0,
    });
    return true;
  };

  const openPicker = async (kind: 'control' | 'risk' | 'clause') => {
    setLinkError('');
    try {
      if (await loadOptions(kind)) setPicking(kind);
    } catch (e: any) {
      setLinkError(e.response?.data?.message || 'The records to link could not be loaded.');
    }
  };

  const addLinks = async (target: string, ids: string[]) => {
    setLinkBusy(true);
    setLinkError('');
    try {
      await apiClient.post(`/api/documents/${documentId}/links`, { target, ids });
      setPicking(null);
      await loadLinks();
    } catch (e: any) {
      // The server names what it refused and why: not found, another
      // organisation's, archived. That message is the useful part.
      setLinkError(e.response?.data?.message || 'The link could not be made.');
      setPicking(null);
    } finally {
      setLinkBusy(false);
    }
  };

  const removeLink = async (linkId: string) => {
    setLinkBusy(true);
    setLinkError('');
    try {
      await apiClient.delete(`/api/documents/links/${linkId}`);
      await loadLinks();
    } catch (e: any) {
      setLinkError(e.response?.data?.message || 'The link could not be removed.');
    } finally {
      setLinkBusy(false);
    }
  };
  const [readerMode, setReaderMode] = useState<'pdf-embed' | 'pdf-page' | 'raw-text'>('pdf-embed');
  const [downloading, setDownloading] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  /** Why the file could not be served, when it could not. Never swallowed. */
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** What the server actually sent, which decides whether a frame can show it. */
  const [previewMime, setPreviewMime] = useState<string | null>(null);

  const fetchDocumentDetail = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/documents/${documentId}`);
      if (res.data.status === 'success') {
        const doc = res.data.document;
        setDocument(doc);
        setReach(res.data.access || null);

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
    setPreviewError(null);
    setPreviewMime(null);
    try {
      // Declared, because the reader pane and the Download button reach the
      // same endpoint. Both are recorded either way; this is what separates
      // reading on screen from taking a copy away.
      const response = await apiClient.get(`/api/documents/${id}/download?disposition=preview`, {
        responseType: 'blob',
      });
      const mime = (response.headers['content-type'] as string) || fileType || '';
      const blob = new Blob([response.data], { type: mime });
      setPreviewMime(mime);
      setPdfBlobUrl(window.URL.createObjectURL(blob));
    } catch (err: any) {
      // A refusal has to be visible. This was a console.warn, so the pane fell
      // through to the formatted-document canvas below — a page laid out like a
      // governance record, carrying the title, owner, version and
      // classification. A reader refused the file on retention, legal hold or
      // need-to-know was shown a document-shaped screen instead of the refusal,
      // and no part of it said the file had not been served.
      //
      // The blob response type means the server's JSON message arrives as a
      // Blob, so it has to be read back before it can be shown.
      let message = 'The file could not be loaded.';
      const status = err?.response?.status;
      try {
        const raw = err?.response?.data;
        if (raw instanceof Blob) {
          const parsed = JSON.parse(await raw.text());
          if (parsed?.message) message = parsed.message;
        } else if (raw?.message) {
          message = raw.message;
        }
      } catch {
        // Not JSON. The status still says something useful.
      }
      setPreviewError(
        status === 403 || status === 423
          ? message
          : `${message}${status ? ` (HTTP ${status})` : ''}`,
      );
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
                  {/* Not "Interactive PDF Reader". It is the file, whatever the
                      file is, and for most of them the honest answer is that a
                      browser cannot show it. */}
                  <Icon name="documents" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Attached File
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
            <Icon name="knowledge" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Attached File & Reader
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
          <button
            onClick={() => setActiveTab('governs')}
            style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'governs' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'governs' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'governs' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
          >
            <Icon name="controls" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Governs ({linkSummary?.total ?? 0})
          </button>
          {maySeeAccess && (
            <button
              onClick={() => setActiveTab('access')}
              style={{ padding: '12px 16px', background: 'transparent', border: 'none', borderBottom: activeTab === 'access' ? '2px solid #38bdf8' : '2px solid transparent', color: activeTab === 'access' ? 'var(--info)' : 'var(--ink-muted)', fontWeight: activeTab === 'access' ? 600 : 400, cursor: 'pointer', fontSize: '13px' }}
            >
              <Icon name="users" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Access ({accessSummary?.readers ?? 0})
            </button>
          )}
        </nav>

        {reach?.openAudienceGap && (
          <div style={{ margin: '12px 24px 0', padding: '10px 14px', borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', color: 'var(--warning)', fontSize: 12.5, lineHeight: 1.6 }}>
            Marked <strong>{reach.classification}</strong>, but still readable by everyone in
            the organisation: it was published before audiences were recorded, so there is no
            list of who it was issued to. Its reach cannot be narrowed while this version is
            the published one — a published document cannot be edited or re-approved. Every
            read of it is recorded on the Access tab.
          </div>
        )}

        {activeTab === 'access' && (
          <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: 680 }}>
              Who has opened this document, and who took a copy away. One row per person per
              day. This is a record of access, not of agreement — the signatures are under
              Digital Signatures.
            </p>

            {accessSummary && (
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '0 0 16px', fontSize: 12.5 }}>
                {[
                  ['Readers', accessSummary.readers],
                  ['Days read on', accessSummary.windows],
                  ['Views', accessSummary.views],
                  ['Downloads', accessSummary.downloads],
                  ['Took a copy', accessSummary.downloaders],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{String(value)}</div>
                    <div style={{ color: 'var(--ink-faint)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {access.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 600, marginBottom: 5 }}>
                  Nobody has opened this document
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
                  {accessNote || 'No reads have been recorded.'}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {access.map((a) => (
                  <div
                    key={a.id}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}
                  >
                    <span style={{ color: 'var(--ink)', fontWeight: 600, minWidth: 160 }}>
                      {a.user?.name || 'Unknown'}
                    </span>
                    <span style={{ color: 'var(--ink-muted)' }}>{a.day}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>
                      {a.views} view{a.views === 1 ? '' : 's'}
                      {a.downloads > 0 && `, ${a.downloads} download${a.downloads === 1 ? '' : 's'}`}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-faint)' }}>
                      {a.basis === 'legacy-publication' ? 'no audience recorded' : a.basis}
                    </span>
                  </div>
                ))}
                <PagingBar paging={accessPaging} onPage={setAccessPage} noun="reading days" />
              </div>
            )}

            {access.length > 0 && accessNote && (
              <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.6, maxWidth: 680 }}>
                {accessNote}
              </p>
            )}
          </div>
        )}

        {activeTab === 'governs' && (
          <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: 680 }}>
              The controls this policy mandates, the risks it treats and the framework clauses it
              satisfies. This is what turns a document into evidence: without it a policy is a
              file, and the control it exists to require cannot say what requires it.
            </p>

            {linkError && (
              <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)', fontSize: 12.5 }}>
                {linkError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {(['control', 'risk', 'clause'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => openPicker(k)}
                  disabled={linkBusy}
                  style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--info)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
                >
                  + Link {k === 'clause' ? 'framework clause' : k}
                </button>
              ))}
            </div>

            {links.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 600, marginBottom: 5 }}>
                  This document does not say what it governs
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
                  Nothing is linked to it yet. A policy with no links cannot be shown as evidence
                  for a clause, and no control can point back at it as the reason it exists.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {links.map((l) => (
                  <div
                    key={l.id}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6 }}
                  >
                    <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-faint)', minWidth: 58 }}>
                      {l.target === 'clause' ? 'satisfies' : l.target === 'risk' ? 'treats' : 'mandates'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {l.control && `${l.control.code} — ${l.control.title}`}
                      {l.risk && `${l.risk.ref} — ${l.risk.title}`}
                      {l.clause && `${l.clause.standard.code} ${l.clause.ref} — ${l.clause.title}`}
                    </span>
                    {l.note && (
                      <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>· {l.note}</span>
                    )}
                    <button
                      onClick={() => removeLink(l.id)}
                      disabled={linkBusy}
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {picking && (
          <PickManyDialog
            title={`Link ${picking === 'clause' ? 'framework clauses' : `${picking}s`} to ${document?.code || 'this document'}`}
            intro={
              picking === 'clause'
                ? 'Clauses of the frameworks this organisation has enabled. A policy linked to a '
                  + 'clause is what lets the clause be reported as addressed.'
                : picking === 'control'
                  ? 'The control this policy mandates. The control screen can then say what '
                    + 'requires it.'
                  : 'The risk this policy treats.'
            }
            items={options.rows.map((x: any) => ({
              id: x.id,
              label: picking === 'clause' ? `${x.standardCode} ${x.ref}` : (x.code || x.ref),
              sublabel: x.title,
            }))}
            initiallySelected={links
              .filter((l) => l.target === picking)
              .map((l) => (l.control?.id || l.risk?.id || l.clause?.id))}
            confirmLabel={linkBusy ? 'Linking…' : 'Link'}
            busy={linkBusy}
            emptyMessage={
              picking === 'clause' && options.enabledFrameworks === 0
                ? 'This organisation has no framework enabled, so there is no clause to link to. '
                  + 'Enable one under Organization Standards first.'
                : `There is no ${picking} in this organisation to link to yet.`
            }
            total={options.total}
            // A failed search keeps the rows already shown rather than
            // claiming nothing matched.
            onSearch={(q) => { loadOptions(picking, q).catch(() => undefined); }}
            onSubmit={(ids) => addLinks(picking, ids)}
            onCancel={() => setPicking(null)}
          />
        )}

        {/* Tab Content Container */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px', background: 'var(--surface-sunk)' }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading document viewer...</div>
          ) : error ? (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '16px', borderRadius: '8px' }}>{error}</div>
          ) : (
            <>
              {/* TAB 1: Attached File & Reader */}
              {activeTab === 'reader' && (
                <div>
                  {readerMode === 'pdf-embed' ? (
                    previewError ? (
                      /* The refusal, where the file would have been. */
                      <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
                        <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                          This file was not served
                        </div>
                        <div style={{ color: 'var(--ink-body)', fontSize: '13px', lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
                          {previewError}
                        </div>
                      </div>
                    ) : pdfBlobUrl && browserCanRender(previewMime, document.fileName) ? (
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ fontSize: '12px', color: 'var(--info)', fontWeight: 600 }}>IN-APP READER ({document.fileName || document.code})</span>
                          <button
                            onClick={handleDownload}
                            style={{ background: 'var(--brand)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                          >
                            ⇩ Download original
                          </button>
                        </div>
                        <iframe
                          src={pdfBlobUrl}
                          title="Document reader"
                          style={{ width: '100%', height: '580px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--surface)' }}
                        />
                      </div>
                    ) : pdfBlobUrl ? (
                      /* A browser frame renders PDFs, images and plain text. It
                         does not render XLSX, DOCX, PPTX or ZIP — it shows an
                         empty box, or offers a download, under a heading that
                         said "LIVE IN-APP PDF READER". The spreadsheet in the
                         library is exactly that case, and it is why the reader
                         looked broken: it was being asked to display a file
                         format no browser displays. */
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '32px', textAlign: 'center' }}>
                        <div style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                          {describeFormat(previewMime, document.fileName)} cannot be displayed in the browser
                        </div>
                        <div style={{ color: 'var(--ink-muted)', fontSize: '12.5px', lineHeight: 1.6, maxWidth: 520, margin: '0 auto 16px' }}>
                          The file is here and you may take a copy. Only PDFs, images and plain
                          text can be shown on screen; a spreadsheet or a Word file has to be
                          opened in the application that owns it. The Formatted Document and
                          Text View tabs above still show this record's own content.
                        </div>
                        <button
                          onClick={handleDownload}
                          style={{ background: 'var(--brand)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}
                        >
                          ⇩ Download {document.fileName || 'the file'}
                        </button>
                      </div>
                    ) : pdfLoading ? (
                      <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: '10px', padding: '48px', textAlign: 'center', color: 'var(--ink-muted)' }}>
                        Loading the file…
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
