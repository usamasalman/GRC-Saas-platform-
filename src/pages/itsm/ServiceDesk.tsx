import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

interface SlaState { state: string; minutesRemaining: number | null }
interface Ticket {
  id: string; subject: string; description: string; type: string; service: string;
  impact: string; urgency: string; priority: string; status: string;
  assignedTeam: string | null; slaResolveAt: string | null; sla: SlaState;
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string; email: string } | null;
  tenant: { id: string; name: string };
  workflowRun: { id: string; status: string; currentStep: number } | null;
  _count: { comments: number; workNotes: number };
}
interface CatalogItem {
  id: string; key: string; name: string; description: string; category: string;
  ticketType: string; derivedPriority: string; workflowName: string | null; workflowSteps: number;
}

export const SLA_PILL: Record<string, React.CSSProperties> = {
  breached: pill('#fca5a5', '#7f1d1d'),
  'at-risk': pill('#fbbf24', '#78350f'),
  'on-track': pill('#86efac', '#15803d'),
  met: pill('#93c5fd', '#1e3a8a'),
  none: pill('#64748b', '#334155'),
};

export const PRIORITY_COLOR: Record<string, string> = {
  'P1 Critical': '#f87171', 'P2 High': '#fb923c', 'P3 Medium': '#fbbf24', 'P4 Low': '#94a3b8',
};

const ServiceDesk: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');
  const [search, setSearch] = useState('');

  const [showRaise, setShowRaise] = useState(false);
  const [form, setForm] = useState({ catalogItemId: '', subject: '', description: '', impact: '', urgency: '' });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState<any>(null);
  const [noteBody, setNoteBody] = useState('');
  const [noteInternal, setNoteInternal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tRes, cRes, iRes] = await Promise.all([
        apiClient.get('/api/itsm/tickets'),
        apiClient.get('/api/itsm/catalog').catch(() => null),
        apiClient.get('/api/itsm/workflows/inbox').catch(() => null),
      ]);
      setTickets(tRes.data?.tickets || []);
      setTotals(tRes.data?.totals || {});
      setScope(tRes.data?.scope || '');
      setCatalog(cRes?.data?.items || []);
      setInbox(iRes?.data?.steps || []);
    } catch (err) { setError(apiError(err, 'Failed to load the service desk')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/itsm/tickets/${id}`);
      setDetail(res.data?.ticket || null);
      setNoteBody(''); setNoteInternal(false);
    } catch (err) { window.alert(apiError(err)); }
  };

  const submitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/itsm/tickets', {
        catalogItemId: form.catalogItemId || undefined,
        subject: form.subject, description: form.description,
        impact: form.impact || undefined, urgency: form.urgency || undefined,
      });
      setNotice(res.data?.message || 'Ticket raised');
      setShowRaise(false);
      setForm({ catalogItemId: '', subject: '', description: '', impact: '', urgency: '' });
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not raise ticket')); }
    finally { setBusy(false); }
  };

  const addNote = async () => {
    if (!noteBody.trim() || !detail) return;
    try {
      await apiClient.post(`/api/itsm/tickets/${detail.id}/comments`, { body: noteBody, internal: noteInternal });
      setNoteBody('');
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiClient.patch(`/api/itsm/tickets/${id}`, { status });
      if (detail?.id === id) await openDetail(id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const decide = async (runId: string, decision: 'approve' | 'reject') => {
    const comment = window.prompt(`Comment for this ${decision} (recorded in the audit trail):`);
    if (comment === null) return;
    try {
      const res = await apiClient.post(`/api/itsm/workflows/runs/${runId}/decide`, { decision, comment });
      setNotice(res.data?.message || 'Decision recorded');
      await load();
      if (detail) await openDetail(detail.id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const selectedItem = catalog.find((c) => c.id === form.catalogItemId);

  const visible = tickets.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (slaFilter && t.sla.state !== slaFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.subject.toLowerCase().includes(q) && !t.service.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>ITSM service desk</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Priority is computed from impact × urgency. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setShowRaise(true); }} style={primaryBtn()}>+ Raise ticket</button>
        </div>
      </div>

      <StatStrip items={[
        ['Open', totals.open ?? 0],
        ['SLA breached', <span style={{ color: (totals.breached ?? 0) > 0 ? '#fca5a5' : '#f1f5f9' }}>{totals.breached ?? 0}</span>],
        ['At risk', <span style={{ color: (totals.atRisk ?? 0) > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.atRisk ?? 0}</span>],
        ['Unassigned', totals.unassigned ?? 0],
        ['Awaiting approval', totals.awaitingApproval ?? 0],
      ]} />

      {inbox.length > 0 && (
        <div style={{ ...S.card, padding: 16, marginBottom: 18, borderColor: '#78350f', background: '#1c1508' }}>
          <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: 10 }}>
            ⚑ {inbox.length} approval{inbox.length > 1 ? 's' : ''} awaiting you
          </div>
          {inbox.map((s) => (
            <div key={s.stepRunId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid #292014', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: '#e2e8f0' }}>{s.name}</span>
                <span style={{ color: '#64748b' }}> · {s.workflowName} · {s.tenantName}</span>
                {s.overdue && <span style={{ ...pill('#fca5a5', '#7f1d1d'), marginLeft: 8 }}>overdue</span>}
              </div>
              <div>
                <button onClick={() => decide(s.runId, 'approve')} style={linkBtn('#4ade80')}>approve</button>
                <button onClick={() => decide(s.runId, 'reject')} style={linkBtn('#fca5a5')}>reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Search subject or service…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 260 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 180 }}>
          <option value="">All statuses</option>
          {['New', 'Pending Approval', 'In Progress', 'Pending Customer', 'Resolved', 'Closed', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)} style={{ ...S.input, maxWidth: 170 }}>
          <option value="">All SLA states</option>
          {['breached', 'at-risk', 'on-track', 'met'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('#86efac')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading tickets…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['Subject', 'Type', 'Priority', 'Status', 'Team', 'Assignee', 'SLA', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <button onClick={() => openDetail(t.id)} style={{ ...linkBtn('#e2e8f0'), fontSize: 12, padding: 0, textAlign: 'left' }}>
                      {t.subject}
                    </button>
                    <div style={{ color: '#475569', fontSize: 10 }}>{t.tenant.name} · {t.service}</div>
                  </td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>{t.type}</td>
                  <td style={{ ...S.td, color: PRIORITY_COLOR[t.priority] || '#cbd5e1' }}>
                    {t.priority}
                    <div style={{ color: '#475569', fontSize: 10 }}>{t.impact}/{t.urgency}</div>
                  </td>
                  <td style={S.td}>
                    {t.status}
                    {t.workflowRun?.status === 'RUNNING' && <span style={{ ...pill('#fbbf24', '#78350f'), marginLeft: 6 }}>in approval</span>}
                  </td>
                  <td style={{ ...S.td, color: '#64748b' }}>{t.assignedTeam || '—'}</td>
                  <td style={{ ...S.td, color: t.assignee ? '#cbd5e1' : '#fbbf24' }}>{t.assignee?.name || 'unassigned'}</td>
                  <td style={S.td}>
                    <span style={SLA_PILL[t.sla.state] || SLA_PILL.none}>{t.sla.state}</span>
                    {t.sla.minutesRemaining !== null && t.sla.state !== 'met' && (
                      <div style={{ color: '#475569', fontSize: 10 }}>
                        {t.sla.minutesRemaining < 0 ? `${Math.abs(t.sla.minutesRemaining)}m over` : `${t.sla.minutesRemaining}m left`}
                      </div>
                    )}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {!['Resolved', 'Closed', 'Cancelled'].includes(t.status) && (
                      <button onClick={() => setStatus(t.id, 'Resolved')} style={linkBtn('#86efac')}>resolve</button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No tickets match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showRaise && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 26, borderRadius: 12, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: '#f1f5f9' }}>Raise a ticket</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              Priority is calculated from impact and urgency — it cannot be set directly.
            </p>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            <form onSubmit={submitTicket}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Service catalog item</label>
              <select value={form.catalogItemId} onChange={(e) => setForm({ ...form, catalogItemId: e.target.value })} style={{ ...S.input, marginBottom: 8 }}>
                <option value="">— general request —</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.category} · {c.name}</option>)}
              </select>
              {selectedItem && (
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                  {selectedItem.description}
                  <div style={{ marginTop: 4 }}>
                    Defaults to <strong style={{ color: PRIORITY_COLOR[selectedItem.derivedPriority] }}>{selectedItem.derivedPriority}</strong>
                    {selectedItem.workflowName
                      ? <> · routes through <strong style={{ color: '#fbbf24' }}>{selectedItem.workflowName}</strong> ({selectedItem.workflowSteps} steps)</>
                      : <> · goes straight to the queue</>}
                  </div>
                </div>
              )}

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Subject</label>
              <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Description</label>
              <textarea required rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Impact</label>
                  <select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} style={S.input}>
                    <option value="">default</option>
                    {['High', 'Medium', 'Low'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Urgency</label>
                  <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} style={S.input}>
                    <option value="">default</option>
                    {['High', 'Medium', 'Low'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Raising…' : 'Raise ticket'}
                </button>
                <button type="button" onClick={() => setShowRaise(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 700, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: '#f1f5f9' }}>{detail.subject}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('#94a3b8')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>
              {detail.type} · {detail.tenant.name} · raised by {detail.requester.name} ·
              <span style={{ color: PRIORITY_COLOR[detail.priority] }}> {detail.priority}</span> ({detail.impact}/{detail.urgency}) ·
              <span style={{ marginLeft: 6 }}><span style={SLA_PILL[detail.sla.state] || SLA_PILL.none}>{detail.sla.state}</span></span>
            </div>

            <div style={{ background: '#0b1220', border: '1px solid #16202f', borderRadius: 6, padding: 12, marginBottom: 16, fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
              {detail.description}
            </div>

            {detail.workflowRun && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                  Approval route — {detail.workflowRun.definition?.name} <span style={{ color: '#64748b' }}>({detail.workflowRun.status})</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detail.workflowRun.stepRuns.map((s: any) => {
                    const c = s.status === 'APPROVED' ? '#86efac' : s.status === 'REJECTED' ? '#fca5a5'
                      : s.status === 'ACTIVE' ? '#fbbf24' : s.status === 'DONE' ? '#93c5fd' : '#475569';
                    return (
                      <div key={s.id} style={{ border: `1px solid ${c}44`, borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
                        <div style={{ color: c }}>{s.name}</div>
                        <div style={{ color: '#475569', fontSize: 10 }}>
                          {s.status}{s.decidedBy ? ` · ${s.decidedBy.name}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Conversation ({detail.comments.length} visible{detail.canSeeWorkNotes ? ` · ${detail.workNotes.length} internal` : ''})
            </div>
            <div style={{ marginBottom: 12 }}>
              {[...detail.comments.map((c: any) => ({ ...c, internal: false })),
                ...(detail.workNotes || []).map((n: any) => ({ ...n, internal: true }))]
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map((c: any) => (
                  <div key={c.id} style={{
                    background: c.internal ? '#1c1508' : '#0b1220',
                    border: `1px solid ${c.internal ? '#78350f' : '#16202f'}`,
                    borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 12,
                  }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                      {c.author?.name} · {new Date(c.createdAt).toLocaleString()}
                      {c.internal && <span style={{ ...pill('#fbbf24', '#78350f'), marginLeft: 6 }}>internal only</span>}
                    </div>
                    <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  </div>
                ))}
              {detail.comments.length === 0 && (!detail.workNotes || detail.workNotes.length === 0) && (
                <div style={{ color: '#475569', fontSize: 12 }}>No notes yet.</div>
              )}
            </div>

            <textarea rows={2} value={noteBody} onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add a note…" style={{ ...S.input, marginBottom: 8, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {detail.canSeeWorkNotes && (
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={noteInternal} onChange={(e) => setNoteInternal(e.target.checked)} />
                  internal work note (never shown to the requester)
                </label>
              )}
              <button onClick={addNote} disabled={!noteBody.trim()} style={{ ...primaryBtn(!noteBody.trim()), marginLeft: 'auto' }}>Add note</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceDesk;
