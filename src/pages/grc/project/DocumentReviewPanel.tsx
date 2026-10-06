import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * Review and suggestions on one shared document (consulting engagement,
 * sprint 9), under its text in the Documents tab.
 *
 * The firm's Lead and Reviewers review the version in force; its Lead and
 * Consultants suggest wording for a published version. The organisation's
 * document owner or project manager starts the next version from a
 * suggestion, or adds it to the open one, takes its wording into the draft,
 * or declines it with a reason, and the firm sees what became of it.
 */

const OUTCOMES: [string, string][] = [['Accepted', 'Accepted'], ['ChangesRequested', 'Changes requested'], ['NotFitForPurpose', 'Not fit for purpose']];
const TONE: Record<string, [string, string]> = {
  Accepted: ['var(--success)', 'var(--success-line)'], ChangesRequested: ['var(--warning)', 'var(--warning-line)'],
  NotFitForPurpose: ['var(--danger)', 'var(--danger-line)'], Open: ['var(--info)', 'var(--line)'], Pulled: ['var(--brand)', 'var(--brand-line)'],
  Declined: ['var(--danger)', 'var(--danger-line)'], Superseded: ['var(--ink-muted)', 'var(--line)'],
};
const tone = (s: string) => pill(...(TONE[s] || ['var(--ink-muted)', 'var(--line)']));
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };
const box: React.CSSProperties = { borderTop: '1px solid var(--line-soft)', paddingTop: 10, marginTop: 12 };

const DocumentReviewPanel: React.FC<{ projectId: string; documentId: string }> = ({ projectId, documentId }) => {
  const base = `/api/engagements/${projectId}`;
  const [reviews, setReviews] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<null | 'review' | 'suggest'>(null);
  const [deciding, setDeciding] = useState<null | { s: any; outcome: 'Declined' | 'Superseded' }>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        apiClient.get(`${base}/documents/${documentId}/reviews`),
        apiClient.get(`${base}/documents/${documentId}/suggestions`),
      ]);
      setReviews(r.data);
      setSuggestions(s.data);
    } catch (err) {
      setProblem(apiError(err, 'Reviews and suggestions could not be loaded.'));
    }
  }, [base, documentId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>, done?: string) => {
    setBusy(true); setProblem(''); setNotice('');
    try {
      const res = await fn();
      setNotice(res?.data?.message || done || '');
      setForm(null);
      await load();
      return true;
    } catch (err) {
      setProblem(apiError(err, 'That did not work.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── The review form ────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState('Accepted');
  const [note, setNote] = useState('');
  const [comments, setComments] = useState<{ quote: string; page: string; body: string }[]>([]);
  // ── The suggestion form ────────────────────────────────────────────────
  const [sug, setSug] = useState({ section: '', currentWording: '', proposedWording: '', reason: '' });

  const review = () => act(() => apiClient.post(`${base}/documents/${documentId}/reviews`, {
    outcome, note: note.trim() || undefined,
    comments: comments.filter((c) => c.body.trim()).map((c) => ({ quote: c.quote.trim() || undefined, page: c.page ? Number(c.page) : undefined, body: c.body.trim() })),
  }), 'Review recorded.');

  const suggest = () => act(() => apiClient.post(`${base}/documents/${documentId}/suggestions`, {
    section: sug.section.trim(), currentWording: sug.currentWording.trim() || undefined, proposedWording: sug.proposedWording.trim(), reason: sug.reason.trim(),
  }), 'Suggestion made.');

  if (!reviews || !suggestions) {
    return <div style={{ ...box, fontSize: 12, color: 'var(--ink-muted)' }}>{problem || 'Loading reviews and suggestions…'}</div>;
  }
  const canDecide = suggestions.can?.decide;

  return (
    <div style={box}>
      {problem && <div role="alert" style={{ ...S.error, marginBottom: 8 }}>{problem}</div>}
      {notice && <div style={{ fontSize: 12.5, color: 'var(--success)', marginBottom: 8 }}>{notice}</div>}

      {/* Reviews */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Reviews</strong>
        {reviews.can?.review && form !== 'review' && <button style={small} onClick={() => setForm('review')}>Review this version</button>}
      </div>
      {reviews.reviews.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>Not reviewed on this engagement yet.</div>}
      {reviews.reviews.map((r: any) => (
        <div key={r.id} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <span style={tone(r.outcome)}>{r.outcomeLabel}</span> v{r.documentVersion}{!r.current && ' (an earlier version)'} · {r.reviewer?.name} · {new Date(r.createdAt).toLocaleDateString()}
          {r.note && <div style={{ marginTop: 3 }}>{r.note}</div>}
          {r.comments.map((c: any) => (
            <div key={c.id} style={{ marginTop: 3, paddingLeft: 10, borderLeft: '2px solid var(--line)' }}>
              <span style={{ color: 'var(--ink-muted)' }}>{c.quote ? `“${c.quote}”` : `Page ${c.page}`}</span> — {c.body}
            </div>
          ))}
        </div>
      ))}
      {form === 'review' && (
        <div style={{ ...S.card, padding: 12, marginTop: 8 }}>
          <label style={label} htmlFor="rv-outcome">Outcome for v{reviews.version}</label>
          <select id="rv-outcome" style={S.input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label style={label} htmlFor="rv-note">{outcome === 'Accepted' ? 'Note (optional)' : 'What has to change'}</label>
          <textarea id="rv-note" style={{ ...S.input, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} />
          {comments.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 3fr auto', gap: 6, marginTop: 6 }}>
              <input aria-label="Quoted words" style={S.input} placeholder="Quote the words exactly" value={c.quote} onChange={(e) => setComments((x) => x.map((y, j) => (j === i ? { ...y, quote: e.target.value } : y)))} />
              <input aria-label="Page" style={S.input} placeholder="or page" inputMode="numeric" value={c.page} onChange={(e) => setComments((x) => x.map((y, j) => (j === i ? { ...y, page: e.target.value.replace(/\D/g, '') } : y)))} />
              <input aria-label="Comment" style={S.input} placeholder="Comment" value={c.body} onChange={(e) => setComments((x) => x.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))} />
              <button style={small} onClick={() => setComments((x) => x.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={small} onClick={() => setComments((x) => [...x, { quote: '', page: '', body: '' }])}>Add an anchored comment</button>
            <span style={{ flex: 1 }} />
            <button style={small} onClick={() => setForm(null)}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy} onClick={review}>Record review</button>
          </div>
        </div>
      )}

      {/* Suggestions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <strong style={{ fontSize: 13 }}>Suggestions</strong>
        {suggestions.openVersion && <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Next version v{suggestions.openVersion.versionNumber} is {suggestions.openVersion.state === 'InReview' ? 'in review' : suggestions.openVersion.state.toLowerCase()}</span>}
        {suggestions.can?.suggest && form !== 'suggest' && <button style={small} onClick={() => setForm('suggest')}>Suggest wording</button>}
      </div>
      {suggestions.suggestions.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>No suggestions on this engagement. Each one ends Accepted into the version that publishes it, Declined or Superseded.</div>}
      {suggestions.suggestions.map((s: any) => (
        <div key={s.id} style={{ fontSize: 12.5, padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
          <div>
            <strong>{s.ref}</strong> · {s.section} · {s.author} · <span style={tone(s.status)}>{s.outcome}</span>
            {s.madeOnEarlier && <span style={{ color: 'var(--ink-muted)' }}> · made on v{s.documentVersion}</span>}
          </div>
          {s.currentWording && <div style={{ marginTop: 3, color: 'var(--danger)', textDecoration: 'line-through' }}>{s.currentWording}</div>}
          <div style={{ marginTop: 3, color: 'var(--success)', whiteSpace: 'pre-wrap' }}>{s.proposedWording}</div>
          <div style={{ marginTop: 3, color: 'var(--ink-muted)' }}>Why: {s.reason}</div>
          {s.wordingAppliedAt && (s.status === 'Pulled' || s.status === 'Accepted') && <div style={{ marginTop: 3, color: 'var(--ink-muted)' }}>Wording taken into the draft.</div>}
          {/* Declined or superseded after its words went into the draft: they stay there until someone edits them out. */}
          {s.wordingAppliedAt && (s.status === 'Declined' || s.status === 'Superseded') && (
            <div style={{ marginTop: 3, color: 'var(--warning)' }}>Its wording was taken into the next version's draft and is still there; edit the draft by hand if it should not stay.</div>
          )}
          {canDecide && (s.status === 'Open' || s.status === 'Pulled') && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {s.status === 'Open' && suggestions.can?.pull && (
                <button style={small} disabled={busy} onClick={() => act(() => apiClient.post(`${base}/suggestions/${s.id}/pull`, {}))}>
                  {suggestions.openVersion ? 'Add to the open next version' : 'Start next version from this suggestion'}
                </button>
              )}
              {s.status === 'Pulled' && s.currentWording && !s.wordingAppliedAt && (
                <button style={small} disabled={busy} onClick={() => act(() => apiClient.post(`${base}/suggestions/${s.id}/apply`, {}))}>Take the wording into the draft</button>
              )}
              <button style={small} disabled={busy} onClick={() => setDeciding({ s, outcome: 'Declined' })}>Decline</button>
              <button style={small} disabled={busy} onClick={() => setDeciding({ s, outcome: 'Superseded' })}>Mark superseded</button>
            </div>
          )}
        </div>
      ))}
      {form === 'suggest' && (
        <div style={{ ...S.card, padding: 12, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>On published version v{suggestions.version}. The organisation decides; you see the outcome here.</div>
          <label style={label} htmlFor="sg-section">Section</label>
          <input id="sg-section" style={S.input} value={sug.section} onChange={(e) => setSug({ ...sug, section: e.target.value })} placeholder="For example: Reviews" />
          <label style={label} htmlFor="sg-current">Words to replace (quote them exactly; leave empty for a file)</label>
          <textarea id="sg-current" style={{ ...S.input, minHeight: 50 }} value={sug.currentWording} onChange={(e) => setSug({ ...sug, currentWording: e.target.value })} />
          <label style={label} htmlFor="sg-proposed">Proposed wording</label>
          <textarea id="sg-proposed" style={{ ...S.input, minHeight: 70 }} value={sug.proposedWording} onChange={(e) => setSug({ ...sug, proposedWording: e.target.value })} />
          <label style={label} htmlFor="sg-reason">Why</label>
          <textarea id="sg-reason" style={{ ...S.input, minHeight: 50 }} value={sug.reason} onChange={(e) => setSug({ ...sug, reason: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button style={small} onClick={() => setForm(null)}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy} onClick={suggest}>Make suggestion</button>
          </div>
        </div>
      )}

      {deciding && (
        <ReasonDialog
          title={`${deciding.outcome === 'Declined' ? 'Decline' : 'Mark superseded'} ${deciding.s.ref}`}
          message={deciding.outcome === 'Declined'
            ? 'The firm sees that it was declined, with your reason.'
            : 'For a suggestion overtaken by other changes. The firm sees it, with your reason.'}
          label="Why"
          confirmLabel={deciding.outcome === 'Declined' ? 'Decline' : 'Mark superseded'}
          busy={busy}
          onConfirm={async (reason) => { await act(() => apiClient.post(`${base}/suggestions/${deciding.s.id}/decide`, { outcome: deciding.outcome, reason })); setDeciding(null); }}
          onCancel={() => setDeciding(null)}
        />
      )}
    </div>
  );
};

export default DocumentReviewPanel;
