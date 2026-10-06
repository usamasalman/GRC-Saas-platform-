import React, { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../api/apiClient';
import PickManyDialog from '../../components/PickManyDialog';
import { ConfirmDialog } from '../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../iam/iamStyles';
import { lineDiff, foldUnchanged } from '../../utils/lineDiff';

/**
 * The next version of a published document (Documents: next versions).
 *
 * The published version stays in force while this one is written, approved
 * and published; everything here works on the version row. Shown to the
 * people who write or sign the document — the server answers 404 to anyone
 * else, and the tab is then not offered.
 */

export const STATE_LABEL: Record<string, string> = {
  Draft: 'Draft', InReview: 'In review', Approved: 'Approved', Returned: 'Returned',
  Published: 'Published', Superseded: 'Superseded', Discarded: 'Discarded',
};
const STATE_TONE: Record<string, [string, string]> = {
  Draft: ['var(--warning)', 'var(--warning-line)'], InReview: ['var(--info)', 'var(--line)'],
  Approved: ['var(--success)', 'var(--success-line)'], Returned: ['var(--danger)', 'var(--danger-line)'],
  Published: ['var(--success)', 'var(--success-line)'], Superseded: ['var(--ink-muted)', 'var(--line)'],
  Discarded: ['var(--ink-muted)', 'var(--line)'],
};
export const statePill = (s: string) => pill(...(STATE_TONE[s] || ['var(--ink-muted)', 'var(--line)']));

/** "Superseded on 12 Mar 2027 by v2.0 — not in force", in the reader's own date, as the rest of the row. */
export const supersededLabel = (at: string, by: string) =>
  `Superseded on ${new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} by v${by} — not in force`;

const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'];
const small: React.CSSProperties = { ...ghostBtn, padding: '4px 10px', fontSize: 12 };
const box: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, padding: 14, background: 'var(--surface)', marginBottom: 12 };
const heading: React.CSSProperties = { fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
const textarea: React.CSSProperties = { ...S.input, minHeight: 70, resize: 'vertical' };

type Target = 'control' | 'risk' | 'clause';

interface Props {
  documentId: string;
  document: any;
  /** GET /api/documents/:id/next-version, as the parent loaded it. */
  info: any;
  /** The document's own links, for proposing removals. */
  links: any[];
  /** A superseded version to start from, chosen on the History tab. */
  startFrom: { id: string; versionNumber: string } | null;
  onClearStartFrom: () => void;
  onChanged: () => void;
}

const NextVersionPanel: React.FC<Props> = ({ documentId, document, info, links, startFrom, onClearStartFrom, onChanged }) => {
  const v = info?.version || null;
  const can = info?.can || {};
  const base = `/api/documents/${documentId}/next-version`;

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (fn: () => Promise<any>, done?: string) => {
    setBusy(true); setProblem(''); setNotice('');
    try {
      const res = await fn();
      setNotice(res?.data?.message || done || '');
      onChanged();
      return true;
    } catch (e: any) {
      setProblem(apiError(e, 'That did not work.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── Start ────────────────────────────────────────────────────────────────
  const [changeType, setChangeType] = useState<'Minor' | 'Major'>('Minor');
  const [reason, setReason] = useState('');

  // ── Text ─────────────────────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [editSummary, setEditSummary] = useState('');
  useEffect(() => { if (v && can.checkIn) setText(v.content || ''); }, [v?.id, can.checkIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const [compare, setCompare] = useState(false);
  const diff = useMemo(() => (compare && v ? lineDiff(info.live?.content || '', v.content || '') : null), [compare, v?.content, info?.live?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proposals ────────────────────────────────────────────────────────────
  const [audience, setAudience] = useState<{ kinds: string[]; departments: string[]; roles: string[] }>({ kinds: ['Everyone'], departments: [], roles: [] });
  useEffect(() => {
    apiClient.get('/api/documents/audience-options')
      .then((res) => setAudience({ kinds: res.data?.kinds || ['Everyone'], departments: res.data?.departments || [], roles: res.data?.roles || [] }))
      .catch(() => undefined);
  }, []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adds, setAdds] = useState<{ target: Target; id: string; label: string }[]>([]);
  const [removes, setRemoves] = useState<string[]>([]);
  useEffect(() => {
    if (!v) return;
    setDraft({
      changeType: v.changeType || 'Minor', proposedTitle: v.proposedTitle || '', proposedClassification: v.proposedClassification || 'Internal',
      proposedCategory: v.proposedCategory || '', proposedAudienceKind: v.proposedAudienceKind || 'Everyone', proposedAudienceValue: v.proposedAudienceValue || '',
    });
    setAdds((v.proposedLinks?.add || []).map((a: any) => ({ target: a.target, id: a.id, label: a.label })));
    setRemoves(v.proposedLinks?.remove || []);
  }, [v?.id, v?.changeType, v?.proposedTitle, v?.proposedClassification, v?.proposedCategory, v?.proposedAudienceKind, v?.proposedAudienceValue, v?.proposedLinks]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const [picking, setPicking] = useState<Target | null>(null);
  const [options, setOptions] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const ask = useRef(0);
  const loadOptions = async (kind: Target, q = '') => {
    const mine = ++ask.current;
    const res = await apiClient.get('/api/documents/link-options', { params: { kind, q: q || undefined } });
    if (mine !== ask.current) return false;
    const key = kind === 'control' ? 'controls' : kind === 'risk' ? 'risks' : 'clauses';
    setOptions({ rows: res.data?.[key] || [], total: res.data?.totals?.[key] ?? 0 });
    return true;
  };
  const labelOf = (kind: Target, x: any) => (kind === 'clause' ? `${x.standardCode} ${x.ref} — ${x.title}` : `${x.code || x.ref} — ${x.title}`);

  const saveProposals = () => run(() => apiClient.patch(base, {
    ...draft,
    proposedAudienceValue: draft.proposedAudienceKind === 'Everyone' ? '' : draft.proposedAudienceValue,
    proposedLinks: { add: adds.map((a) => ({ target: a.target, id: a.id })), remove: removes },
  }), 'Proposals saved.');

  // ── Submit, publish, discard ─────────────────────────────────────────────
  const [summary, setSummary] = useState('');
  const [approverIds, setApproverIds] = useState<string[]>([]);
  useEffect(() => { setApproverIds((info?.suggestedApprovers || []).map((p: any) => p.id)); }, [v?.id, info?.suggestedApprovers?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [discardReason, setDiscardReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'publish' | 'discard'>(null);

  const banner = (
    <>
      {problem && <div role="alert" style={{ ...S.error, marginBottom: 12 }}>{problem}</div>}
      {notice && <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 6, background: 'var(--success-bg)', border: '1px solid var(--success-line)', color: 'var(--success)', fontSize: 12.5 }}>{notice}</div>}
    </>
  );

  if (!v) {
    if (!can.start) {
      return (
        <div>
          {banner}
          <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
            {document?.legalHoldAt ? 'This document is under legal hold, so no next version can be started.' : 'There is no next version of this document.'}
          </div>
        </div>
      );
    }
    return (
      <div style={{ maxWidth: 720 }}>
        {banner}
        <div style={box}>
          <div style={heading}>Start next version</div>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6 }}>
            Version {info.live?.version} stays in force for everyone while the next version is written, approved and
            published. The next version starts as an exact copy of {startFrom ? `version ${startFrom.versionNumber}` : 'the published text'}.
          </p>
          {startFrom && (
            <div style={{ fontSize: 12.5, marginBottom: 10 }}>
              Starting from the text of superseded version {startFrom.versionNumber}.{' '}
              <button type="button" style={small} onClick={onClearStartFrom}>Start from the published text instead</button>
            </div>
          )}
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px', display: 'flex', gap: 18, fontSize: 13 }}>
            <legend style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Change</legend>
            {(['Minor', 'Major'] as const).map((t) => (
              <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="changeType" checked={changeType === t} onChange={() => setChangeType(t)} />
                {t} — becomes v{info.numbers?.[t]}
                <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                  {t === 'Minor' ? '(nobody is asked to acknowledge again)' : '(everyone is asked to acknowledge again)'}
                </span>
              </label>
            ))}
          </fieldset>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }} htmlFor="nv-reason">Why it is being revised</label>
          <textarea id="nv-reason" style={textarea} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="For example: annual review, or the new joiner process" />
          <div style={{ marginTop: 10 }}>
            <button type="button" style={primaryBtn(busy || reason.trim().length < 10)} disabled={busy || reason.trim().length < 10}
              onClick={async () => {
                const ok = await run(() => apiClient.post(base, { changeType, reason, fromVersionId: startFrom?.id }), 'Next version started.');
                if (ok) { setReason(''); onClearStartFrom(); }
              }}>
              Start next version
            </button>
          </div>
        </div>
      </div>
    );
  }

  const approvals: any[] = info.approvals || [];
  // Signatures from an earlier submission were on earlier text: shown, not counted.
  const earlier = (a: any) => !v.submittedAt || new Date(a.createdAt) < new Date(v.submittedAt);
  const editable = !!can.edit;
  const audienceValues = draft.proposedAudienceKind === 'Department' ? audience.departments : draft.proposedAudienceKind === 'Role' ? audience.roles : [];

  return (
    <div>
      {banner}

      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <strong style={{ fontSize: 15, color: 'var(--ink)' }}>Version {v.versionNumber}</strong>
          <span style={statePill(v.state)}>{STATE_LABEL[v.state] || v.state}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{v.changeType}</span>
          {v.state === 'InReview' && <span style={{ fontSize: 12.5 }}>{info.approved} of {info.approvers} approved</span>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6 }}>
          Started by {v.startedBy || 'someone'} from v{v.baseVersion} on {new Date(v.createdAt).toLocaleDateString()}: {v.startReason}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
          Version {info.live?.version} stays in force until this one is published.
          {v.editors?.length > 0 && <> Edited by {v.editors.map((e: any) => e.name).join(', ')}.</>}
        </div>
        {v.liveMoved && (
          <div style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 6 }}>
            The published text has changed since this version started. Compare before submitting.
          </div>
        )}
      </div>

      {v.suggestions?.length > 0 && (
        <div style={box}>
          <div style={heading}>Suggestions in this version</div>
          {v.suggestions.map((s: any) => (
            <div key={s.id} style={{ fontSize: 12.5, padding: '4px 0' }}>
              <strong>{s.project?.ref}/{s.ref}</strong> · {s.section} · {s.author?.name}
              {s.documentVersion !== info.live?.version && <span style={{ color: 'var(--ink-muted)' }}> · made on v{s.documentVersion}</span>}
              <span style={{ color: 'var(--ink-muted)' }}> · {s.wordingAppliedAt ? 'wording taken into the text' : 'the reason for a change made by hand'}</span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
            They are decided on the engagement's Documents tab, and become accepted into v{v.versionNumber} when it is published.
          </div>
        </div>
      )}

      {/* The text */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ ...heading, marginBottom: 0 }}>Text</div>
          <button type="button" style={small} onClick={() => setCompare((c) => !c)}>{compare ? 'Hide comparison' : `Compare with v${info.live?.version}`}</button>
          {editable && !v.checkedOutById && (
            <button type="button" style={small} disabled={busy} onClick={() => run(() => apiClient.post(`${base}/checkout`), 'Checked out to you.')}>Check out to edit</button>
          )}
          {v.checkedOutById && !can.checkIn && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Checked out by {v.checkedOutBy}</span>}
        </div>
        {v.fileName && !v.content && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 8 }}>
            This version carries the file {v.fileName}. A revised file is checked in once file uploads for next versions are enabled.
          </div>
        )}
        {can.checkIn ? (
          <>
            <textarea aria-label="Text of the next version" style={{ ...textarea, minHeight: 260, fontFamily: 'inherit' }} value={text} onChange={(e) => setText(e.target.value)} />
            <input aria-label="What you changed" style={{ ...S.input, marginTop: 8 }} placeholder="What you changed (optional)" value={editSummary} onChange={(e) => setEditSummary(e.target.value)} />
            <div style={{ marginTop: 8 }}>
              <button type="button" style={primaryBtn(busy || !text.trim())} disabled={busy || !text.trim()}
                onClick={() => run(() => apiClient.post(`${base}/checkin`, { content: text, summary: editSummary || undefined }), 'Checked in.')}>
                Check in
              </button>
            </div>
          </>
        ) : compare ? (
          diff ? (
            <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.6, border: '1px solid var(--line-soft)', borderRadius: 6, maxHeight: 420, overflow: 'auto' }}>
              {foldUnchanged(diff).map((l, i) => (l.kind === 'folded' ? (
                <div key={i} style={{ padding: '2px 10px', color: 'var(--ink-faint)', background: 'var(--surface-sunk)' }}>… {l.count} unchanged line{l.count === 1 ? '' : 's'}</div>
              ) : (
                <div key={i} style={{
                  padding: '0 10px', whiteSpace: 'pre-wrap',
                  background: l.kind === 'added' ? 'var(--success-bg)' : l.kind === 'removed' ? 'var(--danger-bg)' : 'transparent',
                  color: l.kind === 'added' ? 'var(--success)' : l.kind === 'removed' ? 'var(--danger)' : 'var(--ink-body)',
                }}>
                  {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '− ' : '  '}{l.text || ' '}
                </div>
              )))}
              {diff.every((l) => l.kind === 'same') && <div style={{ padding: '6px 10px', color: 'var(--ink-muted)' }}>No change to the text yet.</div>}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['In force', info.live?.content], ['Next version', v.content]].map(([t, c]) => (
                <div key={t as string}><div style={heading}>{t}</div><div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, maxHeight: 420, overflow: 'auto' }}>{c}</div></div>
              ))}
            </div>
          )
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--ink)', maxHeight: 360, overflow: 'auto' }}>{v.content}</div>
        )}
      </div>

      {/* What changes for the document when this version is published */}
      <div style={box}>
        <div style={heading}>Applied when published</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 12.5 }}>
          <label>Change
            <select style={S.input} disabled={!editable} value={draft.changeType || 'Minor'} onChange={set('changeType')}>
              <option value="Minor">Minor</option><option value="Major">Major</option>
            </select>
          </label>
          <label>Title<input style={S.input} disabled={!editable} value={draft.proposedTitle || ''} onChange={set('proposedTitle')} /></label>
          <label>Classification
            <select style={S.input} disabled={!editable} value={draft.proposedClassification || 'Internal'} onChange={set('proposedClassification')}>
              {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Category<input style={S.input} disabled={!editable} value={draft.proposedCategory || ''} onChange={set('proposedCategory')} /></label>
          <label>Audience
            <select style={S.input} disabled={!editable} value={draft.proposedAudienceKind || 'Everyone'} onChange={set('proposedAudienceKind')}>
              {audience.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          {draft.proposedAudienceKind !== 'Everyone' && (
            <label>{draft.proposedAudienceKind}
              <select style={S.input} disabled={!editable} value={draft.proposedAudienceValue || ''} onChange={set('proposedAudienceValue')}>
                <option value="">Choose…</option>
                {audienceValues.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          )}
        </div>

        <div style={{ ...heading, marginTop: 14 }}>What it governs</div>
        {links.length === 0 && adds.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing is linked.</div>}
        {links.map((l: any) => (
          <label key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0', textDecoration: removes.includes(l.id) ? 'line-through' : 'none' }}>
            <input type="checkbox" disabled={!editable} checked={removes.includes(l.id)}
              onChange={(e) => setRemoves((r) => (e.target.checked ? [...r, l.id] : r.filter((x) => x !== l.id)))} />
            {l.control && `${l.control.code} — ${l.control.title}`}
            {l.risk && `${l.risk.ref} — ${l.risk.title}`}
            {l.clause && `${l.clause.standard.code} ${l.clause.ref} — ${l.clause.title}`}
            <span style={{ color: 'var(--ink-faint)' }}>{removes.includes(l.id) ? `removed when v${v.versionNumber} is published` : 'remove when published'}</span>
          </label>
        ))}
        {adds.map((a) => (
          <div key={`${a.target}:${a.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0', color: 'var(--success)' }}>
            + {a.label} <span style={{ color: 'var(--ink-faint)' }}>added when v{v.versionNumber} is published</span>
            {editable && <button type="button" style={{ ...small, padding: '0 6px' }} onClick={() => setAdds((x) => x.filter((y) => !(y.target === a.target && y.id === a.id)))}>Remove</button>}
          </div>
        ))}
        {editable && (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {(['control', 'risk', 'clause'] as const).map((k) => (
                <button key={k} type="button" style={small} disabled={busy}
                  onClick={async () => { try { if (await loadOptions(k)) setPicking(k); } catch (e: any) { setProblem(apiError(e, 'The records to link could not be loaded.')); } }}>
                  Propose a {k === 'clause' ? 'framework clause' : k}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" style={primaryBtn(busy)} disabled={busy} onClick={saveProposals}>Save proposals</button>
            </div>
          </>
        )}
      </div>

      {/* Approvals */}
      {approvals.length > 0 && (
        <div style={box}>
          <div style={heading}>Approvals</div>
          {approvals.map((a) => (
            <div key={a.id} style={{ fontSize: 12.5, padding: '3px 0' }}>
              {a.sequenceOrder}. {a.approver?.name} · <span style={statePill(a.status === 'APPROVED' ? 'Approved' : a.status === 'REJECTED' ? 'Returned' : 'Draft')}>{a.status.toLowerCase()}</span>
              {a.reviewedAt && <span style={{ color: 'var(--ink-muted)' }}> · {new Date(a.reviewedAt).toLocaleString()}</span>}
              {a.reason && <span style={{ color: 'var(--ink-muted)' }}> · {a.reason}</span>}
              {earlier(a) && <span style={{ color: 'var(--ink-faint)' }}> · earlier submission</span>}
            </div>
          ))}
          {v.state === 'InReview' && (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 6 }}>Approvers sign it from the Approval Queue, with their password.</div>
          )}
        </div>
      )}

      {can.submit && (
        <div style={box}>
          <div style={heading}>Submit for approval</div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }} htmlFor="nv-summary">What changed and why</label>
          <textarea id="nv-summary" style={textarea} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '10px 0 4px' }}>
            Approvers — the owner and anyone who edited this version cannot approve it. Choosing nobody asks up to three people who can approve documents.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5 }}>
            {(info.approverChoices || []).map((p: any) => (
              <label key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={approverIds.includes(p.id)}
                  onChange={(e) => setApproverIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))} />
                {p.name}{(info.suggestedApprovers || []).some((s: any) => s.id === p.id) && <span style={{ color: 'var(--ink-faint)' }}>(approved v{info.live?.version})</span>}
              </label>
            ))}
            {(info.approverChoices || []).length === 0 && <span style={{ color: 'var(--danger)' }}>Nobody else in the organisation can approve documents.</span>}
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={primaryBtn(busy || summary.trim().length < 10)} disabled={busy || summary.trim().length < 10}
              onClick={async () => { if (await run(() => apiClient.post(`${base}/submit`, { summary, approverIds }))) setSummary(''); }}>
              Submit for approval
            </button>
          </div>
        </div>
      )}

      {(can.publish || can.discard) && (
        <div style={{ ...box, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {can.publish && (
            <button type="button" style={primaryBtn(busy)} disabled={busy} onClick={() => setConfirm('publish')}>Publish version {v.versionNumber}</button>
          )}
          {can.discard && (
            <div style={{ flex: 1, minWidth: 260 }}>
              <input aria-label="Why it is being discarded" style={S.input} placeholder="Why it is being discarded" value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} />
              <button type="button" style={{ ...small, marginTop: 6, color: 'var(--danger)' }} disabled={busy || discardReason.trim().length < 10} onClick={() => setConfirm('discard')}>
                Discard this version
              </button>
            </div>
          )}
        </div>
      )}

      {confirm === 'publish' && (
        <ConfirmDialog
          title={`Publish version ${v.versionNumber}`}
          message={
            <>
              Version {v.versionNumber} replaces v{info.live?.version} for everyone. Version {info.live?.version} is kept, marked superseded.{' '}
              {v.changeType === 'Major'
                ? 'This is a major version: everyone in the audience is asked to acknowledge it again.'
                : `This is a minor version: whoever acknowledged v${String(info.live?.version).split('.')[0]}.x is not asked again.`}
            </>
          }
          confirmLabel="Publish"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await run(() => apiClient.post(`${base}/publish`, {})); setConfirm(null); }}
        />
      )}
      {confirm === 'discard' && (
        <ConfirmDialog
          title={`Discard version ${v.versionNumber}`}
          message={`It is kept as discarded, with its text and approvals, and v${info.live?.version} stays in force. A new next version can then be started.`}
          confirmLabel="Discard"
          destructive
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { if (await run(() => apiClient.post(`${base}/discard`, { reason: discardReason }), 'Discarded.')) setDiscardReason(''); setConfirm(null); }}
        />
      )}

      {picking && (
        <PickManyDialog
          title={`Propose ${picking === 'clause' ? 'framework clauses' : `${picking}s`} for v${v.versionNumber}`}
          intro={`Added to what ${document?.code || 'this document'} governs when version ${v.versionNumber} is published, not before.`}
          items={options.rows.map((x: any) => ({ id: x.id, label: picking === 'clause' ? `${x.standardCode} ${x.ref}` : (x.code || x.ref), sublabel: x.title }))}
          initiallySelected={adds.filter((a) => a.target === picking).map((a) => a.id)}
          confirmLabel="Propose"
          total={options.total}
          onSearch={(q) => { loadOptions(picking, q).catch(() => undefined); }}
          onSubmit={(ids) => {
            const rows = options.rows.filter((x: any) => ids.includes(x.id));
            setAdds((current) => [
              ...current.filter((a) => a.target !== picking || ids.includes(a.id)),
              ...rows.filter((x: any) => !current.some((a) => a.target === picking && a.id === x.id)).map((x: any) => ({ target: picking, id: x.id, label: labelOf(picking, x) })),
            ]);
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  );
};

export default NextVersionPanel;
