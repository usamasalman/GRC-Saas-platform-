import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import Can, { MAY } from '../../components/Can';
import FormDialog from '../../components/FormDialog';
import PickManyDialog from '../../components/PickManyDialog';
import { ReasonDialog } from '../../components/Dialog';
import { S, primaryBtn, ghostBtn, pill, apiError, StatStrip } from '../iam/iamStyles';
import { calendarDate } from '../../utils/calendarDate';

/**
 * Legal matters, and the documents they hold.
 *
 * The Legal Hold menu entry rendered AuditLogViewer — the same component
 * 'retention' and 'logs' rendered — so it showed the raw hash-chained audit
 * trail and nothing about holds. The three endpoints that place and release a
 * hold had no caller anywhere in the frontend; the only thing that toggled one
 * was a mock in appMockEngine that mutated a browser-local store.
 */

const SUB: React.CSSProperties = {
  margin: '6px 0 0', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: 720,
};
const H2: React.CSSProperties = {
  margin: '26px 0 10px', fontSize: 14, fontWeight: 600, color: 'var(--ink)',
};
const EMPTY: React.CSSProperties = {
  padding: '30px 20px', textAlign: 'center', border: '1px dashed var(--line)',
  borderRadius: 8, fontSize: 12.5, color: 'var(--ink-muted)',
};

const LegalHoldMatters: React.FC = () => {
  const [matters, setMatters] = useState<any[]>([]);
  const [legacy, setLegacy] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[] | null>(null);
  const [releasingMatter, setReleasingMatter] = useState<any>(null);
  const [releasingHold, setReleasingHold] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/legal/matters');
      setMatters(res.data?.matters || []);
      setLegacy(res.data?.legacyHolds || []);
    } catch (e: any) {
      setError(apiError(e, 'Failed to load legal matters'));
    } finally {
      setLoading(false);
    }
  };

  const openMatter = async (m: any) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/legal/matters/${m.id}`);
      setOpen(m);
      setDetail(res.data || null);
    } catch (e: any) {
      setError(apiError(e, 'Failed to load the matter'));
    }
  };

  useEffect(() => { load(); }, []);

  const createMatter = async (values: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.post('/api/legal/matters', {
        reference: values.reference,
        title: values.title,
        description: values.description,
      });
      setCreating(false);
      await load();
    } catch (e: any) {
      setError(apiError(e, 'The matter could not be opened'));
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const startPicking = async () => {
    setError('');
    try {
      const res = await apiClient.get('/api/documents');
      setDocuments(res.data?.documents || []);
      setPicking(true);
    } catch (e: any) {
      setError(apiError(e, 'Failed to load documents'));
    }
  };

  const placeHolds = async (reason: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post(`/api/legal/matters/${open.id}/holds`, {
        documentIds: pickedIds,
        reason,
      });
      setNotice(
        (res.data?.warnings || []).join(' ')
        || `${res.data?.placed ?? 0} document${res.data?.placed === 1 ? '' : 's'} held.`,
      );
      setPickedIds(null);
      await Promise.all([load(), openMatter(open)]);
    } catch (e: any) {
      setError(apiError(e, 'The hold could not be placed'));
      setPickedIds(null);
    } finally {
      setBusy(false);
    }
  };

  const doReleaseMatter = async (reason: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post(`/api/legal/matters/${releasingMatter.id}/release`, { reason });
      setNotice(res.data?.message || 'Matter released.');
      setReleasingMatter(null);
      await load();
      if (open) await openMatter(open);
    } catch (e: any) {
      setError(apiError(e, 'The matter could not be released'));
      setReleasingMatter(null);
    } finally {
      setBusy(false);
    }
  };

  const doReleaseHold = async (reason: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post(`/api/legal/holds/${releasingHold.id}/release`, { reason });
      setNotice(res.data?.message || 'Released.');
      setReleasingHold(null);
      await Promise.all([load(), openMatter(open)]);
    } catch (e: any) {
      setError(apiError(e, 'The hold could not be released'));
      setReleasingHold(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Legal Hold</h1>
          <p style={SUB}>
            Matters, and the documents frozen for them. A held document cannot be edited,
            checked out, submitted, approved, published, archived, deleted or disposed of.
            Releasing keeps the record: what was held, for what, and between when and when.
          </p>
        </div>
        <Can do={MAY.DISPOSE_RECORD}>
          <button onClick={() => { setError(''); setCreating(true); }} style={primaryBtn(busy)} disabled={busy}>
            Open a matter
          </button>
        </Can>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 6, background: 'var(--info-bg, rgba(59,130,246,0.08))', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--info)', fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      <StatStrip
        items={[
          ['Open matters', matters.filter((m) => m.status === 'Open').length],
          ['Documents held', matters.reduce((n, m) => n + (m.summary?.documentsHeld || 0), 0)],
          ['Released matters', matters.filter((m) => m.status !== 'Open').length],
        ]}
      />

      {legacy.length > 0 && (
        <div style={{ padding: '11px 14px', marginBottom: 16, borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', color: 'var(--warning)', fontSize: 12.5, lineHeight: 1.6 }}>
          <strong>{legacy.length} document{legacy.length === 1 ? ' is' : 's are'} frozen by a hold
          placed before matters existed</strong> — {legacy.map((d) => d.code).join(', ')}. They stay
          frozen and are not listed under any matter. Open a matter and hold them against it so the
          release has something to release.
        </div>
      )}

      <h2 style={H2}>Matters</h2>
      {loading ? (
        <div style={EMPTY}>Loading…</div>
      ) : matters.length === 0 ? (
        <div style={EMPTY}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
            No matter has been opened
          </div>
          <div style={{ maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            A matter is what a hold points at. Without one, freezing a document records a
            free-text string that nothing can be asked about later.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {matters.map((m) => (
            <div
              key={m.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
              onClick={() => openMatter(m)}
            >
              <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 130 }}>{m.reference}</span>
              <span style={{ color: 'var(--ink)', flex: 1 }}>{m.title}</span>
              <span style={pill(
                m.status === 'Open' ? 'var(--danger)' : 'var(--ink-muted)',
                m.status === 'Open' ? 'var(--danger-line)' : 'var(--line)',
              )}>
                {m.status}
              </span>
              <span style={{ color: 'var(--ink-muted)', minWidth: 190, textAlign: 'right' }}>
                {m.summary?.neverHeldAnything
                  ? 'no documents yet'
                  : `${m.summary.documentsHeld} held · ${m.summary.documentsReleased} released`}
              </span>
              <span style={{ color: 'var(--ink-faint)', minWidth: 90, textAlign: 'right' }}>
                {calendarDate(m.openedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {open && detail && (
        <>
          <h2 style={H2}>
            {detail.matter.reference} — {detail.matter.title}
          </h2>
          <p style={{ ...SUB, marginTop: 0 }}>
            {detail.matter.description || 'No description.'}
            {detail.matter.releasedAt && (
              <>
                {' '}Released {calendarDate(detail.matter.releasedAt)}
                {detail.matter.releaseReason ? ` — ${detail.matter.releaseReason}` : ''}.
              </>
            )}
          </p>

          <Can do={MAY.DISPOSE_RECORD}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {detail.matter.status === 'Open' && (
                <>
                  <button onClick={startPicking} style={ghostBtn} disabled={busy}>
                    Hold documents
                  </button>
                  <button
                    onClick={() => setReleasingMatter(detail.matter)}
                    style={{ ...ghostBtn, color: 'var(--danger)' }}
                    disabled={busy}
                  >
                    Release the matter
                  </button>
                </>
              )}
            </div>
          </Can>

          {detail.holds.length === 0 ? (
            <div style={EMPTY}>
              This matter holds nothing yet, so nothing is frozen for it.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detail.holds.map((h: any) => (
                <div
                  key={h.id}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 13px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 120 }}>
                    {h.document?.code}
                  </span>
                  <span style={{ color: 'var(--ink)', flex: 1 }}>{h.document?.title}</span>
                  <span style={pill(
                    h.active ? 'var(--danger)' : 'var(--ink-muted)',
                    h.active ? 'var(--danger-line)' : 'var(--line)',
                  )}>
                    {h.active ? 'Held' : 'Released'}
                  </span>
                  <span style={{ color: 'var(--ink-muted)', minWidth: 210, textAlign: 'right' }}>
                    {h.active
                      ? `since ${calendarDate(h.placedAt)}`
                      : `${calendarDate(h.placedAt)} → ${calendarDate(h.releasedAt)} · ${h.heldForDays}d`}
                  </span>
                  {h.active && (
                    <Can do={MAY.DISPOSE_RECORD}>
                      <button
                        onClick={() => setReleasingHold(h)}
                        style={{ ...ghostBtn, color: 'var(--danger)' }}
                        disabled={busy}
                      >
                        Release
                      </button>
                    </Can>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {creating && (
        <FormDialog
          title="Open a legal matter"
          intro="A matter is what each hold points at, so the documents frozen for one investigation can be listed, and released, together."
          fields={[
            { name: 'reference', label: 'Reference', type: 'text', required: true, initial: '', placeholder: 'LIT-2026-004' },
            { name: 'title', label: 'Title', type: 'text', required: true, initial: '', placeholder: 'Ivanov v. Acme — document preservation' },
            { name: 'description', label: 'Description', type: 'textarea', initial: '' },
          ]}
          submitLabel={busy ? 'Opening…' : 'Open matter'}
          busy={busy}
          onSubmit={createMatter}
          onCancel={() => setCreating(false)}
        />
      )}

      {picking && (
        <PickManyDialog
          title={`Hold documents for ${open?.reference}`}
          intro="Every document selected is frozen: no edit, checkout, approval, publication, archive, deletion or disposal until the hold is released."
          items={documents.map((d: any) => ({ id: d.id, label: d.code, sublabel: d.title }))}
          initiallySelected={(detail?.holds || []).filter((h: any) => h.active).map((h: any) => h.document?.id)}
          confirmLabel="Continue"
          busy={busy}
          emptyMessage="There is no document in this organisation to hold."
          onSubmit={(ids) => { setPicking(false); setPickedIds(ids); }}
          onCancel={() => setPicking(false)}
        />
      )}

      {pickedIds && (
        <ReasonDialog
          title={`Hold ${pickedIds.length} document${pickedIds.length === 1 ? '' : 's'} for ${open?.reference}`}
          label="Why these records are being held"
          confirmLabel={busy ? 'Holding…' : 'Place hold'}
          message="The reason is what the hold is defended with if the preservation is ever questioned."
          busy={busy}
          onConfirm={placeHolds}
          onCancel={() => setPickedIds(null)}
        />
      )}

      {releasingMatter && (
        <ReasonDialog
          title={`Release ${releasingMatter.reference}?`}
          label="Why the hold is being lifted"
          confirmLabel={busy ? 'Releasing…' : 'Release matter'}
          message="Every document this matter still holds is released. Any held by another matter as well stays frozen. The record of the hold is kept."
          busy={busy}
          onConfirm={doReleaseMatter}
          onCancel={() => setReleasingMatter(null)}
        />
      )}

      {releasingHold && (
        <ReasonDialog
          title={`Release ${releasingHold.document?.code} from this matter?`}
          label="Why the hold is being lifted"
          confirmLabel={busy ? 'Releasing…' : 'Release'}
          message="If another matter also holds this document it stays frozen, and the response will say so."
          busy={busy}
          onConfirm={doReleaseHold}
          onCancel={() => setReleasingHold(null)}
        />
      )}
    </div>
  );
};

export default LegalHoldMatters;
