import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { S, pill, ghostBtn, apiError } from '../iam/iamStyles';

/**
 * Where risk and audit actually stand.
 *
 * Every figure is counted from rows. Worth stating because the dashboard this
 * replaced was not: RealtimeDashboardPage carried a literal ARR figure and churn
 * percentage in its source, four invented alerts, and a security score from an
 * endpoint that returns hardcoded A+ grades for six controls it never inspects.
 *
 * The first version of this page over-corrected. Having removed the invented
 * numbers it explained itself at length instead -- three paragraphs of rationale
 * rendered as UI, arguing points like "a register that counts its own history
 * only ever grows". True, and none of a reader's business: that belongs here, in
 * the code, where it now is. A dashboard is read in ten seconds by somebody
 * deciding what to do today.
 *
 * So the few figures that demand action go at the top, at size, and everything
 * else is detail underneath in two columns -- encoded as a bar wherever the
 * comparison matters more than the digits. What survives from the first version
 * is the honesty: a figure that cannot be computed shows an em dash rather than
 * a comforting zero, because those look identical on a dashboard and mean
 * opposite things.
 */

interface Summary {
  scope: string;
  generatedAt: string;
  risk: {
    total: number;
    closed: number;
    byStatus: Record<string, number>;
    byTreatment: Record<string, number>;
    exposure: {
      inherentTotal: number; residualTotal: number;
      reducedBy: number; reducedPercent: number;
    };
    appetite: {
      configured: number;
      beyondTolerance: number | null;
      withinTolerance: number | null;
      withinAppetite: number | null;
      unjudgeable: number;
      worst: {
        id: string; ref: string; title: string; category: string;
        residualScore: number; owner: string | null;
      }[];
    };
    overdueReview: number;
  };
  issues: {
    open: number; slaBreached: number; dueWithin14Days: number; undated: number;
    byRating: Record<string, number>;
    worst: {
      id: string; ref: string; title: string; rating: string;
      dueDate: string | null; daysOverdue: number;
    }[];
  };
  audit: { total: number; inFlight: number; byStatus: Record<string, number> };
  controls: { total: number; verified: number; notEffective: number; overdueTesting: number };
}

type Tone = 'danger' | 'warning' | 'success' | 'plain';

const TONE: Record<Tone, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  plain: 'var(--ink)',
};

/**
 * One headline figure.
 *
 * Sized to be read at a glance, because the top row is the part somebody acts
 * on. `hint` is at most a few words -- anything needing a sentence is not a
 * hint, it is documentation, and it goes in the code.
 */
const Head: React.FC<{
  value: React.ReactNode;
  label: string;
  tone?: Tone;
  hint?: string;
}> = ({ value, label, tone = 'plain', hint }) => (
  <div style={{ flex: '1 1 150px', minWidth: 128 }}>
    <div style={{
      fontSize: 34, lineHeight: 1.05, fontWeight: 650,
      fontVariantNumeric: 'tabular-nums', color: TONE[tone],
    }}>
      {value}
    </div>
    <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>{label}</div>
    {hint && <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{hint}</div>}
  </div>
);

/** A smaller figure, for the detail cards. */
const Stat: React.FC<{ value: React.ReactNode; label: string; tone?: Tone }> = ({
  value, label, tone = 'plain',
}) => (
  <div style={{ minWidth: 90 }}>
    <div style={{
      fontSize: 21, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: TONE[tone],
    }}>
      {value}
    </div>
    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{label}</div>
  </div>
);

/**
 * A proportion, as a bar.
 *
 * Two numbers side by side make the reader do the arithmetic. 484 against 484
 * says nothing at a glance; a bar that has not moved says it immediately.
 */
const Bar: React.FC<{ segments: { value: number; color: string; label: string }[] }> = ({
  segments,
}) => {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total === 0) {
    return (
      <div style={{
        height: 8, borderRadius: 4, background: 'var(--surface-sunk)',
        border: '1px solid var(--line-soft)',
      }} />
    );
  }
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
      {segments.filter((s) => s.value > 0).map((s) => (
        <div
          key={s.label}
          title={`${s.label}: ${s.value}`}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
};

const GrcSummaryDashboard: React.FC = () => {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/grc/summary');
      setData(res.data);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Counting…</div>;
  }
  if (!data) return <div style={S.error}>{error || 'Could not load the summary.'}</div>;

  const { risk, issues, audit, controls } = data;
  const noAppetite = risk.appetite.configured === 0;

  const card: React.CSSProperties = {
    ...S.card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
  };
  const cardTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
    color: 'var(--ink-muted)', textTransform: 'uppercase',
  };
  const listRow: React.CSSProperties = {
    display: 'flex', alignItems: 'baseline', gap: 10,
    padding: '5px 0', borderTop: '1px solid var(--line-soft)', fontSize: 12.5,
  };
  const clip: React.CSSProperties = {
    color: 'var(--ink)', flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 19, color: 'var(--ink)' }}>Risk and assurance</h2>
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          {new Date(data.generatedAt).toLocaleString(undefined, {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
          {' · '}{data.scope.toLowerCase()}
        </span>
        <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>

      {/* ── What needs a decision ────────────────────────────────────────────
          The only row most people read. Everything in it is either a number
          somebody must act on or a gap that stops one being computable. */}
      <div style={{
        ...card, flexDirection: 'row', flexWrap: 'wrap', gap: 20, padding: '18px 20px',
      }}>
        <Head
          value={noAppetite ? '—' : (risk.appetite.beyondTolerance ?? '—')}
          label="beyond tolerance"
          tone={noAppetite
            ? 'warning'
            : (risk.appetite.beyondTolerance ?? 0) > 0 ? 'danger' : 'success'}
          hint={noAppetite ? 'no appetite set' : 'above the agreed limit'}
        />
        <Head
          value={issues.slaBreached}
          label="findings past due"
          tone={issues.slaBreached > 0 ? 'danger' : 'success'}
        />
        <Head
          value={risk.overdueReview}
          label="risks overdue for review"
          tone={risk.overdueReview > 0 ? 'warning' : 'success'}
        />
        <Head
          value={controls.notEffective}
          label="controls not effective"
          tone={controls.notEffective > 0 ? 'danger' : 'success'}
        />
        <Head
          value={`${risk.exposure.reducedPercent}%`}
          label="exposure removed"
          tone={risk.exposure.reducedPercent > 0 ? 'success' : 'warning'}
          hint={`${risk.total} live risk${risk.total === 1 ? '' : 's'}`}
        />
      </div>

      {/* One line, not a paragraph. It is a prompt to go and set something. */}
      {noAppetite && (
        <div style={{
          padding: '9px 14px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5,
          background: 'var(--warning-bg)', border: '1px solid var(--warning-line)',
          color: 'var(--warning)',
        }}>
          No risk appetite is set for any category, so nothing can be judged against one.
          {' '}{risk.total} live risk{risk.total === 1 ? '' : 's'} carried with no stated tolerance.
        </div>
      )}

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
      }}>
        {/* ── Risk ──────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardTitle}>Risk</div>

          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <Stat value={risk.exposure.inherentTotal} label="inherent" />
            <Stat
              value={risk.exposure.residualTotal}
              label="residual"
              tone={risk.exposure.reducedBy > 0 ? 'success' : 'plain'}
            />
            <Stat value={risk.closed} label="closed" />
          </div>

          <div>
            <Bar segments={[
              { value: risk.exposure.reducedBy, color: 'var(--success)', label: 'removed by treatment' },
              { value: risk.exposure.residualTotal, color: 'var(--danger)', label: 'still carried' },
            ]} />
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5 }}>
              {risk.exposure.reducedBy > 0
                ? `${risk.exposure.reducedBy} points removed, ${risk.exposure.residualTotal} still carried`
                : 'Nothing removed yet — residual falls once controls are linked to a risk'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(risk.byStatus).map(([k, v]) => (
              <span key={k} style={pill('var(--ink-muted)', 'var(--line)')}>
                {/* PascalCase in the register; split so the chip reads as English
                    without a lookup table that goes stale when a status is added. */}
                {k.replace(/([a-z])([A-Z])/g, '$1 $2')} {v}
              </span>
            ))}
            {Object.entries(risk.byTreatment).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k} style={pill('var(--info)', 'var(--info-line)')}>{k} {v}</span>
            ))}
          </div>

          {risk.appetite.worst.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2 }}>
                Furthest beyond tolerance
              </div>
              {risk.appetite.worst.map((r) => (
                <div key={r.id} style={listRow}>
                  <span style={{ color: 'var(--ink-faint)', minWidth: 58 }}>{r.ref}</span>
                  <span style={clip}>{r.title}</span>
                  <strong style={{ color: 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
                    {r.residualScore}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Findings ──────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardTitle}>Findings</div>

          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <Stat value={issues.open} label="open" />
            <Stat
              value={issues.dueWithin14Days}
              label="due in 14 days"
              tone={issues.dueWithin14Days > 0 ? 'warning' : 'plain'}
            />
            {/* An undated finding cannot breach, and counting it as healthy is how
                a register quietly stops meaning anything. */}
            {issues.undated > 0 && (
              <Stat value={issues.undated} label="no date set" tone="warning" />
            )}
          </div>

          {issues.open === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
              Nothing open. Findings raised from audits, control tests and RCSA appear here.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(issues.byRating).filter(([, v]) => v > 0).map(([k, v]) => {
                  const hot = k === 'Critical' || k === 'High';
                  return (
                    <span
                      key={k}
                      style={pill(
                        hot ? 'var(--danger)' : 'var(--ink-muted)',
                        hot ? 'var(--danger-line)' : 'var(--line)',
                      )}
                    >
                      {k} {v}
                    </span>
                  );
                })}
              </div>

              {issues.worst.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 2 }}>
                    Longest overdue
                  </div>
                  {issues.worst.map((i) => (
                    <div key={i.id} style={listRow}>
                      <span style={{ color: 'var(--ink-faint)', minWidth: 58 }}>{i.ref}</span>
                      <span style={clip}>{i.title}</span>
                      <strong style={{ color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                        {i.daysOverdue}d late
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Audit ─────────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardTitle}>Audit</div>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            <Stat value={audit.inFlight} label="in flight" />
            <Stat value={audit.total} label="total" />
          </div>
          {audit.total === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>No engagements yet.</div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(audit.byStatus).map(([k, v]) => (
                <span key={k} style={pill('var(--ink-muted)', 'var(--line)')}>{k} {v}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Controls ──────────────────────────────────────────────────── */}
        <div style={card}>
          <div style={cardTitle}>Controls</div>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
            {/* A fraction rather than a percentage: 80% of four controls and 80%
                of four hundred are different facts, and the denominator is the
                half that says which one you are looking at. */}
            <Stat
              value={`${controls.verified}/${controls.total}`}
              label="verified"
              tone={controls.total > 0 && controls.verified === controls.total ? 'success' : 'plain'}
            />
            <Stat
              value={controls.overdueTesting}
              label="overdue for testing"
              tone={controls.overdueTesting > 0 ? 'warning' : 'plain'}
            />
          </div>
          {controls.total === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
              No control implementations yet.
            </div>
          ) : (
            <Bar segments={[
              { value: controls.verified, color: 'var(--success)', label: 'verified' },
              { value: controls.notEffective, color: 'var(--danger)', label: 'not effective' },
              {
                value: Math.max(0, controls.total - controls.verified - controls.notEffective),
                color: 'var(--line)',
                label: 'not yet assessed',
              },
            ]} />
          )}
        </div>
      </div>
    </div>
  );
};

export default GrcSummaryDashboard;
