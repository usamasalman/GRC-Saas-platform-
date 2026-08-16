import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * The engagement file and its preparer/reviewer sign-off chain (IIA Std 14.5).
 *
 * The two rules that matter are enforced server-side and mirrored here so the
 * UI does not offer an action that will be refused: the preparer can neither
 * raise notes on nor sign off their own paper, and an open review note blocks
 * sign-off entirely.
 */

const WP_PILL: Record<string, React.CSSProperties> = {
  Draft: pill('var(--ink-muted)', 'var(--line)'),
  SubmittedForReview: pill('var(--warning)', 'var(--warning-line)'),
  Returned: pill('var(--danger)', 'var(--danger-line)'),
  Reviewed: pill('var(--success)', 'var(--success-line)'),
};

const SECTIONS = ['Planning', 'Fieldwork', 'Reporting'];

const Workpapers: React.FC<{ auditId: string | null }> = ({ auditId }) => {
  const [papers, setPapers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [totals, setTotals] = useState<any>({});
  const [ready, setReady] = useState(false);
  const [procedures, setProcedures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', section: 'Fieldwork', content: '', procedureId: '' });

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    if (!auditId) { setPapers([]); setAudit(null); return; }
    setLoading(true); setError('');
    try {
      const [w, m] = await Promise.all([
        apiClient.get(`/api/grc/audits/${auditId}/workpapers`),
        apiClient.get(`/api/grc/audits/${auditId}/matrix`),
      ]);
      setPapers(w.data?.workpapers || []);
      setAudit(w.data?.audit || null);
      setTotals(w.data?.totals || {});
      setReady(!!w.data?.fileReadyForReporting);
      setProcedures((m.data?.matrix || []).flatMap((r: any) => r.procedures || []));
    } catch (err) { setError(apiError(err, 'Failed to load the engagement file')); }
    finally { setLoading(false); }
  }, [auditId]);

  useEffect(() => { load(); }, [load]);

  const closed = audit?.status === 'Closed' || audit?.status === 'Cancelled';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post(`/api/grc/audits/${auditId}/workpapers`, {
        ...form, procedureId: form.procedureId || undefined,
      });
      setShowNew(false);
      setForm({ title: '', section: 'Fieldwork', content: '', procedureId: '' });
      setNotice('Workpaper created as a draft — submit it when the work is done');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const act = async (url: string, body: any, fallback: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || fallback);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  if (!auditId) {
    return (
      <div style={{ ...S.card, padding: 28, color: 'var(--ink-muted)', fontSize: 13 }}>
        Pick an engagement on the <strong style={{ color: 'var(--ink)' }}>Engagements</strong> tab to open its file.
      </div>
    );
  }
  if (loading) return <div style={{ padding: 30, color: 'var(--ink-muted)' }}>Loading…</div>;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          {notice}
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), marginLeft: 'auto' }}>dismiss</button>
        </div>
      )}

      <StatStrip items={[
        ['Workpapers', totals.total ?? 0],
        ['Awaiting review', <span style={{ color: (totals.awaitingReview ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.awaitingReview ?? 0}</span>],
        ['Returned', <span style={{ color: (totals.returned ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.returned ?? 0}</span>],
        ['Signed off', <span style={{ color: 'var(--success)' }}>{totals.reviewed ?? 0}</span>],
        ['Open review notes', <span style={{ color: (totals.openReviewNotes ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.openReviewNotes ?? 0}</span>],
      ]} />

      <div style={{
        ...S.card, padding: '12px 16px', marginBottom: 14,
        borderLeft: `3px solid ${ready ? 'var(--success)' : 'var(--warning)'}`,
        fontSize: 13, color: ready ? 'var(--success)' : 'var(--warning)',
      }}>
        {ready
          ? 'The file is complete — every workpaper is reviewed and signed off, so this engagement can move to reporting.'
          : 'The file is not yet complete. Every workpaper must be reviewed and signed off before the engagement is reported (IIA Std 14.5).'}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{audit?.ref}</strong> — {audit?.title}
          {closed && <span style={{ marginLeft: 8, ...pill('var(--ink-muted)', 'var(--line)') }}>{audit.status} — read only</span>}
        </div>
        {!closed && (
          <button style={primaryBtn()} onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Cancel' : '+ New workpaper'}
          </button>
        )}
      </div>

      {showNew && (
        <form onSubmit={create} style={{ ...S.card, padding: 16, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Title</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={S.input} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Section</label>
            <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} style={S.input}>
              {SECTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Supports which procedure?</label>
            <select value={form.procedureId} onChange={(e) => setForm({ ...form, procedureId: e.target.value })} style={S.input}>
              <option value="">— not tied to a procedure —</option>
              {procedures.map((p) => <option key={p.id} value={p.id}>{p.ref} — {p.objective}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>
              Content — what was done, what was seen, what it means
            </label>
            <textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} style={{ ...S.input, resize: 'vertical' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={primaryBtn()}>Create draft</button>
          </div>
        </form>
      )}

      {papers.length === 0 && (
        <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
          No workpapers on this engagement yet.
        </div>
      )}

      {SECTIONS.map((section) => {
        const inSection = papers.filter((p) => p.section === section);
        if (inSection.length === 0) return null;
        return (
          <div key={section} style={{ marginBottom: 18 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)' }}>
              {section}
            </h4>
            {inSection.map((wp) => {
              const isPreparer = wp.preparedBy?.id === me?.id;
              const openNotes = wp.reviewNotes?.filter((n: any) => n.status === 'Open') || [];
              return (
                <div key={wp.id} style={{ ...S.card, padding: 16, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 400px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{wp.ref}</span>
                        <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{wp.title}</span>
                        <span style={WP_PILL[wp.status] || WP_PILL.Draft}>{wp.status}</span>
                        {wp.openNotes > 0 && (
                          <span style={pill('var(--danger)', 'var(--danger-line)')}>{wp.openNotes} open note(s)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                        Prepared by {wp.preparedBy?.name}
                        {isPreparer && <span style={{ color: 'var(--info)' }}> (you)</span>}
                        {wp.procedure && <> · supports {wp.procedure.ref}</>}
                        {wp.reviewedBy && <> · reviewed by {wp.reviewedBy.name} on {String(wp.reviewedAt).slice(0, 10)}</>}
                      </div>
                      {wp.content && (
                        <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 8, whiteSpace: 'pre-wrap' }}>{wp.content}</div>
                      )}
                      {wp.reviewConclusion && wp.status === 'Reviewed' && (
                        <div style={{ fontSize: 12.5, color: 'var(--success)', marginTop: 6 }}>{wp.reviewConclusion}</div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      {!closed && ['Draft', 'Returned'].includes(wp.status) && isPreparer && (
                        <button
                          style={linkBtn('var(--info)')}
                          onClick={() => {
                            if (openNotes.length > 0) {
                              window.alert(`Clear the ${openNotes.length} open review note(s) before resubmitting.`);
                              return;
                            }
                            act(`/api/grc/workpapers/${wp.id}/submit`, {}, 'Submitted');
                          }}
                        >
                          submit for review
                        </button>
                      )}
                      {!closed && wp.status === 'SubmittedForReview' && !isPreparer && (
                        <>
                          <button
                            style={linkBtn('var(--success)')}
                            onClick={() => {
                              const conclusion = window.prompt('Review conclusion:', 'Workpaper reviewed and accepted.');
                              if (conclusion === null) return;
                              act(`/api/grc/workpapers/${wp.id}/review`, { conclusion }, 'Signed off');
                            }}
                          >
                            sign off
                          </button>
                          <button
                            style={linkBtn('var(--warning)')}
                            onClick={() => {
                              const note = window.prompt('Review note — what does the preparer need to address?');
                              if (!note) return;
                              act(`/api/grc/workpapers/${wp.id}/notes`, { note }, 'Note raised');
                            }}
                          >
                            raise note
                          </button>
                        </>
                      )}
                      {!closed && wp.status === 'SubmittedForReview' && isPreparer && (
                        <span style={{ fontSize: 11, color: 'var(--ink-faint)', maxWidth: 180, textAlign: 'right' }}>
                          Independent review required — you prepared this
                        </span>
                      )}
                    </div>
                  </div>

                  {(wp.reviewNotes || []).length > 0 && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                      {wp.reviewNotes.map((n: any) => (
                        <div key={n.id} style={{
                          padding: '8px 10px', marginBottom: 6, borderRadius: 'var(--radius-sm)',
                          background: n.status === 'Open' ? 'var(--danger-bg)' : 'var(--surface-sunk)',
                          border: `1px solid ${n.status === 'Open' ? 'var(--danger-line)' : 'var(--line-soft)'}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 340px' }}>
                              <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{n.note}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>
                                raised by {n.raisedBy?.name}
                                {n.status === 'Cleared' && <> · cleared by {n.clearedBy?.name}</>}
                              </div>
                              {n.response && (
                                <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>
                                  <strong style={{ color: 'var(--ink-muted)' }}>Response: </strong>{n.response}
                                </div>
                              )}
                            </div>
                            {n.status === 'Open' && !closed && (
                              <button
                                style={linkBtn('var(--success)')}
                                onClick={() => {
                                  const response = window.prompt('How was this addressed?');
                                  if (!response) return;
                                  act(`/api/grc/review-notes/${n.id}/clear`, { response }, 'Note cleared');
                                }}
                              >
                                clear note
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default Workpapers;
