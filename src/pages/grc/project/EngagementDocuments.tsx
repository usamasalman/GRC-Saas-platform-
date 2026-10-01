import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * The part of the organisation's document library an engagement shares
 * (consulting engagement, sprint 6): documents of the organisations in scope,
 * at or below the classification ceiling, while the scope is in date.
 *
 * Opened here, a document is read in the workspace; its file can be viewed,
 * and downloaded only where the organisation allows it on this engagement.
 * Every open and download is on the document's Access tab, as the
 * organisation's own reads are. The organisation sees exactly what the firm
 * sees, and sets view only or download here.
 */

interface Doc {
  id: string; code: string; title: string; category: string; classification: string; status: string;
  version: string; owner: string | null; hasFile: boolean; content?: string;
}

const PAGE = 50;

const EngagementDocuments: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [rows, setRows] = useState<Doc[]>([]);
  const [meta, setMeta] = useState<{ shared: boolean; side?: string; documentAccess: string; total: number; hasMore: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Doc | null>(null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (p = 1, q = search) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/documents`, { params: { page: p, pageSize: PAGE, search: q || undefined } });
      setRows((prev) => (p === 1 ? res.data.documents : [...prev, ...res.data.documents]));
      setMeta({ shared: res.data.shared, side: res.data.side, documentAccess: res.data.documentAccess, total: res.data.paging?.total ?? 0, hasMore: Boolean(res.data.paging?.hasMore) });
      setPage(p);
    } catch (err) {
      setError(apiError(err, 'Could not load the shared documents.'));
    }
  }, [projectId, search]);
  // A pause after typing, so a search is one request, not one per key.
  useEffect(() => { const t = setTimeout(() => load(1), 300); return () => clearTimeout(t); }, [load]);

  const read = async (d: Doc) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/documents/${d.id}`);
      setOpen(res.data.document);
    } catch (err) {
      setError(apiError(err, 'Could not open the document.'));
    }
  };

  /** The file, through the engagement: viewed in a new tab, or saved. */
  const file = async (d: Doc, download: boolean) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/documents/${d.id}/file`, {
        params: download ? {} : { disposition: 'preview' }, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${d.code}_v${d.version}`;
        a.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      // A refused blob still carries the server's JSON.
      let message = 'The file could not be delivered.';
      try { message = JSON.parse(await err?.response?.data?.text?.())?.message || message; } catch { /* keep */ }
      setError(message);
    }
  };

  const setAccess = async (values: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/api/engagements/${projectId}/document-access`, { documentAccess: values.access, reason: values.reason.trim() });
      setChanging(false);
      await load(1);
    } catch (err) {
      setError(apiError(err, 'That could not be changed.'));
    } finally {
      setBusy(false);
    }
  };

  const client = meta?.side === 'Client';
  const downloadable = client || meta?.documentAccess === 'Download';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          style={{ ...S.input, maxWidth: 280 }}
          placeholder="Search title or code"
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
        />
        {meta && (
          <span style={pill(meta.documentAccess === 'Download' ? 'var(--success)' : 'var(--warning)', meta.documentAccess === 'Download' ? 'var(--success-line)' : 'var(--warning-line)')}>
            {meta.documentAccess === 'Download' ? 'Firm can download' : 'View only'}
          </span>
        )}
        {client && <button style={ghostBtn} onClick={() => setChanging(true)}>Change document access</button>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>
          {meta ? `${meta.total} shared` : ''}
        </span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {meta && !meta.shared && (
        <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>
          The scope does not share documents{client ? '. Add Documents to the scope to share them.' : '. To need some, ask the organisation.'}
        </div>
      )}
      {meta?.shared && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Document</th><th style={S.th}>Category</th><th style={S.th}>Classification</th>
                <th style={S.th}>Status</th><th style={S.th}>Owner</th><th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <div style={{ fontSize: 12.5 }}>{d.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{d.code} · v{d.version}</div>
                  </td>
                  <td style={S.td}>{d.category}</td>
                  <td style={S.td}>{d.classification}</td>
                  <td style={S.td}>{d.status}</td>
                  <td style={S.td}>{d.owner || '—'}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button style={linkBtn('var(--info)')} onClick={() => read(d)}>Read</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta.hasMore && (
            <div style={{ padding: 12, textAlign: 'center' }}>
              <button style={ghostBtn} onClick={() => load(page + 1)}>Load more</button>
            </div>
          )}
          {rows.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>No shared documents match.</div>}
        </div>
      )}

      {open && (
        <DialogShell title={`${open.code} · ${open.title}`} onClose={() => setOpen(null)} width={760}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 8 }}>
            {open.classification} · {open.status} · v{open.version}{open.owner ? ` · ${open.owner}` : ''}
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, border: '1px solid var(--line)', borderRadius: 6, padding: 12 }}>
            {open.content || 'This document has no text; view its file.'}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            {open.hasFile && <button style={ghostBtn} onClick={() => file(open, false)}>View file</button>}
            {downloadable
              ? <button style={ghostBtn} onClick={() => file(open, true)}>Download</button>
              : <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', alignSelf: 'center' }}>View only on this engagement</span>}
          </div>
        </DialogShell>
      )}
      {changing && meta && (
        <FormDialog
          title="Change document access"
          intro="Whether the firm may download the documents this engagement shares, or only view them. Recorded on both organisations' trails; the firm's Lead is told."
          submitLabel="Save"
          busy={busy}
          error={error}
          fields={[
            {
              name: 'access', label: 'Shared documents', type: 'select', options: ['View', 'Download'],
              initial: meta.documentAccess === 'Download' ? 'View' : 'Download',
              optionLabels: { View: 'View only', Download: 'Download allowed' },
            },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={(v) => (v.reason.trim().length < 10 ? 'Say why, in at least 10 characters.' : null)}
          onSubmit={setAccess}
          onCancel={() => setChanging(false)}
        />
      )}
    </div>
  );
};

export default EngagementDocuments;
