import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { ReasonDialog } from '../../../components/Dialog';
import { S, pill, ghostBtn, primaryBtn, apiError } from '../../iam/iamStyles';

/**
 * The impediment register: what has cost this engagement time, and who owed it.
 *
 * The attribution strip at the top is the reason the page exists. Every
 * steering meeting on consultant-led work argues about whose fault the slip
 * was, and the argument is unwinnable afterwards because nobody wrote it down
 * at the time. Recorded when the time was lost, it stops being an argument.
 *
 * Sides that lost nothing are shown at zero rather than omitted — a strip
 * reading "Client 0 · Provider 12" is a measurement, and one that silently
 * drops the client reads as an accusation.
 */

interface Person { id: string; name: string }

interface Impediment {
  id: string;
  ref: string;
  kind: string;
  category: string;
  owingSide: string;
  severity: string;
  title: string;
  description: string | null;
  impactDays: number | null;
  costDays: number;
  open: boolean;
  expectedClearDate: string | null;
  raisedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  raisedBy: Person | null;
  resolvedBy: Person | null;
  task: { id: string; ref: string; name: string; status: string } | null;
  phase: { id: string; name: string; sequence: number } | null;
}

interface Summary {
  totalDays: number;
  openCount: number;
  openDays: number;
  resolvedCount: number;
  bySide: Record<string, number>;
  byCategory: Record<string, number>;
  largestSide: string | null;
}

interface Vocabulary {
  kinds: string[];
  categories: string[];
  owingSides: string[];
  severities: string[];
}

const SIDE_COLOUR: Record<string, string> = {
  Client: 'var(--info)',
  Provider: 'var(--warning)',
  ThirdParty: 'var(--ink-muted)',
};

const SEVERITY: Record<string, { fg: string; line: string }> = {
  Low: { fg: 'var(--ink-muted)', line: 'var(--line)' },
  Medium: { fg: 'var(--info)', line: 'var(--info-line)' },
  High: { fg: 'var(--warning)', line: 'var(--warning-line)' },
  Critical: { fg: 'var(--danger)', line: 'var(--danger-line)' },
};

/** CamelCase enum values read badly in a table. */
const humanise = (v: string): string => v.replace(/([a-z])([A-Z])/g, '$1 $2');

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

const ProjectImpediments: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [items, setItems] = useState<Impediment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [raising, setRaising] = useState(false);

  const [form, setForm] = useState({
    title: '', description: '', category: 'ClientDependency',
    owingSide: 'Client', severity: 'Medium', kind: 'Blocker', impactDays: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(
        `/api/projects/${projectId}/impediments${openOnly ? '?open=true' : ''}`,
      );
      setItems(res.data?.impediments || []);
      setSummary(res.data?.summary || null);
      setVocab(res.data?.vocabulary || null);
    } catch (err: any) {
      setError(apiError(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, openOnly]);

  useEffect(() => { load(); }, [load]);

  const raise = async () => {
    if (form.title.trim().length < 3) {
      setError('Say what the impediment is.');
      return;
    }
    if (form.kind === 'Delay' && !form.impactDays) {
      setError('A recorded delay has to say how many days it cost.');
      return;
    }
    setBusy('new');
    setError('');
    try {
      await apiClient.post(`/api/projects/${projectId}/impediments`, {
        ...form,
        impactDays: form.kind === 'Delay' ? Number(form.impactDays) : undefined,
      });
      setRaising(false);
      setForm({ ...form, title: '', description: '', impactDays: '' });
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  const [resolving, setResolving] = useState<Impediment | null>(null);

  const resolve = async (imp: Impediment, answer: string) => {
    setResolving(null);
    setBusy(imp.id);
    setError('');
    try {
      await apiClient.post(`/api/projects/impediments/${imp.id}/resolve`, {
        resolutionNote: answer,
      });
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the register…</div>;
  }

  const field: React.CSSProperties = { ...S.input, width: '100%', marginTop: 4 };
  const label: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-muted)' };

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      {/* ── Who owes the days ─────────────────────────────────────────── */}
      {summary && (
        <div style={{ ...S.card, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {summary.totalDays}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>days lost</div>
            </div>

            <div style={{ display: 'flex', gap: 22, marginLeft: 18, flexWrap: 'wrap' }}>
              {Object.entries(summary.bySide).map(([side, days]) => (
                <div key={side}>
                  <div style={{
                    fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: days > 0 ? SIDE_COLOUR[side] || 'var(--ink)' : 'var(--ink-faint)',
                  }}>
                    {days}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{humanise(side)}</div>
                </div>
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              {summary.openCount > 0 && (
                <span style={pill('var(--danger)', 'var(--danger-line)')}>
                  {summary.openCount} still open · {summary.openDays}d
                </span>
              )}
              <label style={{ fontSize: 12, color: 'var(--ink-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Open only
              </label>
              <button style={ghostBtn} onClick={() => setRaising((v) => !v)}>
                {raising ? 'Cancel' : 'Record one'}
              </button>
            </div>
          </div>

          {summary.largestSide && (
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10 }}>
              Most of the time lost so far is owed by the{' '}
              <strong style={{ color: SIDE_COLOUR[summary.largestSide] }}>
                {humanise(summary.largestSide).toLowerCase()}
              </strong>
              {Object.keys(summary.byCategory).length > 0 && (
                <> — largely {humanise(
                  Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1])[0][0],
                ).toLowerCase()}.</>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Record one ────────────────────────────────────────────────── */}
      {raising && vocab && (
        <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={label}>What is it?</span>
              <input
                style={field}
                value={form.title}
                placeholder="Client has not returned the signed asset register"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <span style={label}>Kind</span>
              <select style={field} value={form.kind}
                      onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {vocab.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <span style={label}>Why</span>
              <select style={field} value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {vocab.categories.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
              </select>
            </div>
            <div>
              {/* The column the register exists for. */}
              <span style={label}>Who has to clear it</span>
              <select style={field} value={form.owingSide}
                      onChange={(e) => setForm({ ...form, owingSide: e.target.value })}>
                {vocab.owingSides.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
              </select>
            </div>
            <div>
              <span style={label}>Severity</span>
              <select style={field} value={form.severity}
                      onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {vocab.severities.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {form.kind === 'Delay' && (
              <div>
                <span style={label}>Days lost</span>
                <input
                  style={field} type="number" min={0} value={form.impactDays}
                  onChange={(e) => setForm({ ...form, impactDays: e.target.value })}
                />
              </div>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={primaryBtn(busy === 'new')} disabled={busy === 'new'} onClick={raise}>
              Record it
            </button>
          </div>
        </div>
      )}

      {/* ── The register ──────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div style={{ ...S.card, padding: '44px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            {openOnly ? 'Nothing is currently blocking' : 'Nothing has cost this engagement time'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 460, margin: '0 auto' }}>
            Blockers raised against tasks appear here alongside recorded delays, each with
            the side that owes its resolution.
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
              <thead>
                <tr>
                  {['Impediment', 'Against', 'Why', 'Owed by', 'Days', 'State'].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const sev = SEVERITY[i.severity] || SEVERITY.Medium;
                  return (
                    <tr key={i.id} style={busy === i.id ? { opacity: 0.55 } : undefined}>
                      <td style={S.td}>
                        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{i.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                          {i.ref} · {i.kind} · raised {fmtDate(i.raisedAt)}
                          {i.raisedBy && ` by ${i.raisedBy.name}`}
                        </div>
                        {i.resolutionNote && (
                          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3 }}>
                            “{i.resolutionNote}”
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>
                        {i.task
                          ? <span><span style={{ color: 'var(--ink-faint)' }}>{i.task.ref}</span> {i.task.name}</span>
                          : i.phase
                            ? i.phase.name
                            : <span style={{ color: 'var(--ink-faint)' }}>The engagement</span>}
                      </td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>{humanise(i.category)}</td>
                      <td style={S.td}>
                        <span style={pill(SIDE_COLOUR[i.owingSide] || 'var(--ink-muted)', 'var(--line)')}>
                          {humanise(i.owingSide)}
                        </span>
                      </td>
                      <td style={{
                        ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                        color: i.open ? 'var(--danger)' : 'var(--ink-body)',
                      }}>
                        {i.costDays}
                      </td>
                      <td style={S.td}>
                        {i.open ? (
                          <>
                            <span style={{ ...pill(sev.fg, sev.line), marginRight: 8 }}>
                              {i.severity}
                            </span>
                            <button style={ghostBtn} disabled={busy === i.id} onClick={() => setResolving(i)}>
                              Clear
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                            {i.kind === 'Delay' ? 'Recorded' : `Cleared ${fmtDate(i.resolvedAt)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {resolving && (
        <ReasonDialog
          title={`Clear ${resolving.ref}`}
          confirmLabel="Mark cleared"
          label="How was it cleared?"
          message={(
            <>
              <div>{resolving.title}</div>
              <div style={{ marginTop: 8, color: 'var(--ink-muted)' }}>
                The days this blocker cost are already attributed. What is recorded here is how
                it ended, which is what a reader needs when the same thing happens again.
              </div>
            </>
          )}
          onConfirm={(answer) => resolve(resolving, answer)}
          onCancel={() => setResolving(null)}
        />
      )}
    </div>
  );
};

export default ProjectImpediments;
