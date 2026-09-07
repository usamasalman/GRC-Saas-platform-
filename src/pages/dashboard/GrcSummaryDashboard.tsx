import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { S, pill, ghostBtn, apiError } from '../iam/iamStyles';

/**
 * Where risk and audit actually stand.
 *
 * Every figure is counted from rows. Worth saying because the dashboard this
 * sits beside is not: RealtimeDashboardPage carries a literal ARR figure, a
 * literal churn percentage and four invented alerts in its source, and its
 * security score comes from an endpoint that returns hardcoded A+ grades for
 * six controls it never inspects. Nothing here is a placeholder — if a number
 * cannot be computed it says so rather than showing a comforting zero.
 *
 * Ordered by what a GRC director opens this to find out, which is not the same
 * as what is easiest to count: what is outside appetite, what is overdue, and
 * whether treatment is actually reducing anything.
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

/** A headline number with what it means underneath, not a bare digit. */
const Figure: React.FC<{
  value: React.ReactNode;
  label: string;
  tone?: 'danger' | 'warning' | 'success' | 'plain';
  sub?: string;
}> = ({ value, label, tone = 'plain', sub }) => (
  <div style={{ minWidth: 130 }}>
    <div style={{
      fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      color: tone === 'danger' ? 'var(--danger)'
        : tone === 'warning' ? 'var(--warning)'
          : tone === 'success' ? 'var(--success)' : 'var(--ink)',
    }}>
      {value}
    </div>
    <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{label}</div>
    {sub && (
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>{sub}</div>
    )}
  </div>
);

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

  const card: React.CSSProperties = { ...S.card, padding: '18px 20px', marginBottom: 16 };
  const heading: React.CSSProperties = {
    fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 14,
  };
  const note: React.CSSProperties = {
    fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 12, lineHeight: 1.6,
  };

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>Risk and assurance</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
            Counted from your records at{' '}
            {new Date(data.generatedAt).toLocaleString(undefined, {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
            {' · '}visibility: {data.scope}
          </div>
        </div>
        <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>

      {/* ── What is outside appetite ──────────────────────────────────────
          First, because it is the only figure on the page that says somebody
          has to decide something today. */}
      <div style={card}>
        <div style={heading}>Risks against appetite</div>

        {noAppetite ? (
          <div style={{
            padding: '12px 14px', borderRadius: 6,
            border: '1px solid var(--warning-line)', color: 'var(--warning)', fontSize: 13,
          }}>
            No risk appetite has been set for any category, so nothing can be judged
            against one. {risk.total} live risk{risk.total === 1 ? '' : 's'} are being
            carried with no stated tolerance — which is a decision the organisation has
            not taken rather than a number this page can compute.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>
              <Figure
                value={risk.appetite.beyondTolerance ?? '—'}
                label="beyond tolerance"
                tone={(risk.appetite.beyondTolerance ?? 0) > 0 ? 'danger' : 'success'}
                sub="above what was agreed"
              />
              <Figure
                value={risk.appetite.withinTolerance ?? '—'}
                label="within tolerance"
                tone="warning"
                sub="over appetite, under the limit"
              />
              <Figure
                value={risk.appetite.withinAppetite ?? '—'}
                label="within appetite"
                tone="success"
              />
              {risk.appetite.unjudgeable > 0 && (
                <Figure
                  value={risk.appetite.unjudgeable}
                  label="cannot be judged"
                  tone="warning"
                  sub="no appetite set for their category"
                />
              )}
            </div>

            {risk.appetite.worst.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>
                  Furthest beyond tolerance
                </div>
                {risk.appetite.worst.map((r) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 10,
                    padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5,
                  }}>
                    <span style={{ color: 'var(--ink-faint)', minWidth: 70 }}>{r.ref}</span>
                    <span style={{ color: 'var(--ink)', flex: 1 }}>{r.title}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>{r.category}</span>
                    <span style={{
                      color: 'var(--danger)', fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right',
                    }}>
                      {r.residualScore}
                    </span>
                    <span style={{ color: 'var(--ink-faint)', minWidth: 110 }}>
                      {r.owner ?? 'no owner'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Is treatment doing anything ───────────────────────────────────── */}
      <div style={card}>
        <div style={heading}>Total risk, and what treatment has removed</div>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>
          <Figure value={risk.total} label="live risks" sub={`${risk.closed} closed`} />
          <Figure value={risk.exposure.inherentTotal} label="inherent exposure" />
          <Figure value={risk.exposure.residualTotal} label="residual exposure" />
          <Figure
            value={`${risk.exposure.reducedPercent}%`}
            label="removed by treatment"
            tone={risk.exposure.reducedPercent > 0 ? 'success' : 'warning'}
            sub={`${risk.exposure.reducedBy} points`}
          />
          <Figure
            value={risk.overdueReview}
            label="overdue for review"
            tone={risk.overdueReview > 0 ? 'warning' : 'plain'}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {Object.entries(risk.byStatus).map(([k, v]) => (
            <span key={k} style={pill('var(--ink-muted)', 'var(--line)')}>
              {/* Statuses are PascalCase in the register; split them so the
                  chip reads as English without a lookup table that would go
                  stale the moment a status is added. */}
              {k.replace(/([a-z])([A-Z])/g, '$1 $2')}: {v}
            </span>
          ))}
          {Object.entries(risk.byTreatment).filter(([, v]) => v > 0).map(([k, v]) => (
            <span key={k} style={pill('var(--info)', 'var(--info-line)')}>{k}: {v}</span>
          ))}
        </div>

        <div style={note}>
          Exposure is the sum of scores across live risks. Closed risks are excluded —
          a register that counts its own history only ever grows, which tells a board
          nothing about today.
        </div>
      </div>

      {/* ── What is late ──────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={heading}>Findings and corrective actions</div>
        <div style={{ display: 'flex', gap: 34, flexWrap: 'wrap' }}>
          <Figure value={issues.open} label="open findings" />
          <Figure
            value={issues.slaBreached}
            label="past their promised date"
            tone={issues.slaBreached > 0 ? 'danger' : 'success'}
          />
          <Figure
            value={issues.dueWithin14Days}
            label="due in 14 days"
            tone={issues.dueWithin14Days > 0 ? 'warning' : 'plain'}
          />
          {issues.undated > 0 && (
            <Figure
              value={issues.undated}
              label="with no date at all"
              tone="warning"
              sub="cannot be late, cannot be chased"
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {Object.entries(issues.byRating).filter(([, v]) => v > 0).map(([k, v]) => (
            <span
              key={k}
              style={pill(
                k === 'High' ? 'var(--danger)' : 'var(--ink-muted)',
                k === 'High' ? 'var(--danger-line)' : 'var(--line)',
              )}
            >
              {k}: {v}
            </span>
          ))}
        </div>

        {issues.worst.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>
              Longest overdue
            </div>
            {issues.worst.map((i) => (
              <div key={i.id} style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5,
              }}>
                <span style={{ color: 'var(--ink-faint)', minWidth: 70 }}>{i.ref}</span>
                <span style={{ color: 'var(--ink)', flex: 1 }}>{i.title}</span>
                <span style={{ color: 'var(--ink-muted)' }}>{i.rating}</span>
                <span style={{ color: 'var(--danger)', fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                  {i.daysOverdue} days late
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={note}>
          Lateness is measured against the corrective action date where one exists, and
          the target close date otherwise. A finding with neither cannot breach — which
          is why it is counted separately rather than folded in as healthy.
        </div>
      </div>

      {/* ── Assurance activity ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: 1, minWidth: 280 }}>
          <div style={heading}>Audit</div>
          <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
            <Figure value={audit.inFlight} label="engagements in flight" />
            <Figure value={audit.total} label="engagements in total" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {Object.entries(audit.byStatus).map(([k, v]) => (
              <span key={k} style={pill('var(--ink-muted)', 'var(--line)')}>{k}: {v}</span>
            ))}
          </div>
        </div>

        <div style={{ ...card, flex: 1, minWidth: 280 }}>
          <div style={heading}>Controls</div>
          <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
            <Figure
              value={`${controls.verified}/${controls.total}`}
              label="independently verified"
              tone={controls.total > 0 && controls.verified === controls.total ? 'success' : 'plain'}
            />
            <Figure
              value={controls.notEffective}
              label="not fully effective"
              tone={controls.notEffective > 0 ? 'danger' : 'plain'}
            />
            <Figure
              value={controls.overdueTesting}
              label="overdue for testing"
              tone={controls.overdueTesting > 0 ? 'warning' : 'plain'}
            />
          </div>
          <div style={note}>
            Shown as a fraction rather than a percentage: 80% of four controls and 80% of
            four hundred are different facts.
          </div>
        </div>
      </div>
    </div>
  );
};

export default GrcSummaryDashboard;
