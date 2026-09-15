import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, apiError } from '../iam/iamStyles';

/**
 * How each organisation in the estate is actually doing.
 *
 * What this replaces was rendered by the mock engine: a Subsidiary Scorecards
 * panel with hardcoded percentages — Saudi Technology Services 91, Jordan
 * Operations 86, Healthcare Division 78 — beside a Compliance Posture of 82.4%.
 * None of those organisations existed and none of those numbers were computed.
 * Invented compliance posture is the most damaging thing this product can show,
 * because it is the one figure a customer cannot check and the one they act on.
 *
 * Every number here is counted from rows, and there is no grade, no score and
 * no blended percentage anywhere — any of those would be a judgement the
 * product is not entitled to make on the customer's behalf.
 *
 * The distinction the whole screen turns on is between nothing wrong and
 * nothing looked at. An organisation with no register has no risks beyond
 * tolerance, which reads as a clean bill of health and means the opposite, so
 * it is called out before any of its zeroes are shown.
 */

interface Posture {
  tenantId: string;
  tenantName: string;
  type: string;
  suspended: boolean;
  assessed: boolean;
  risks: { live: number; beyondTolerance: number; unjudgeable: number; overdueReview: number };
  issues: { open: number; overdue: number };
  controls: {
    implemented: number; effective: number; ineffective: number;
    overdueReview: number; effectivenessBasis: number; effectivenessRate: number | null;
  };
  standardsEnabled: number;
  unknowns: string[];
}

const EstatePosture: React.FC = () => {
  const [rows, setRows] = useState<Posture[]>([]);
  const [counts, setCounts] = useState<{ organisations: number; assessed: number; neverAssessed: number } | null>(null);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/grc/posture');
      // Defensive throughout: strictNullChecks is off here, so a missing array
      // typechecks and throws on first use.
      setRows(res.data?.posture || []);
      setCounts(res.data?.counts || null);
      setScope(res.data?.scope || '');
      setLoaded(true);
    } catch (err) {
      setError(apiError(err, 'Could not load the estate posture.'));
      setRows([]);
      setCounts(null);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const num = (n: number, bad: boolean) => (
    <span style={{ color: n === 0 ? 'var(--ink-muted)' : (bad ? 'var(--danger)' : 'var(--ink-body)') }}>
      {n}
    </span>
  );

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Estate posture</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 680, lineHeight: 1.6 }}>
            Every figure is counted from records. There is no overall score and no grade — those
            would be judgements about a customer that this product is not entitled to make.
            Organisations needing attention are listed first. Scope:{' '}
            <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {counts && (
        <StatStrip items={[
          ['Organisations', counts.organisations],
          ['Assessed', <span style={{ color: counts.assessed > 0 ? 'var(--success)' : 'var(--ink-muted)' }}>{counts.assessed}</span>],
          // Not "compliant" and not "at risk". This is the number nobody has
          // looked at, which is a different and usually worse thing.
          ['Never assessed', <span style={{ color: counts.neverAssessed > 0 ? 'var(--warning)' : 'var(--ink-muted)' }}>{counts.neverAssessed}</span>],
        ]} />
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading estate posture…</div>
      ) : !loaded ? (
        <div style={{ ...S.card, padding: 24, color: 'var(--ink-muted)', fontSize: 13, lineHeight: 1.6 }}>
          The posture could not be loaded. Nothing is shown rather than a stale or partial picture —
          a compliance figure that might be wrong is worse than none.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...S.card, padding: 24, color: 'var(--ink-muted)', fontSize: 13 }}>
          No organisations in scope.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((p) => (
            <div
              key={p.tenantId}
              style={{
                ...S.card,
                padding: 16,
                borderColor: !p.assessed ? 'var(--warning-line)' : 'var(--line)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
                <div>
                  <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{p.tenantName}</strong>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)', marginLeft: 8 }}>{p.type}</span>
                  {p.suspended && (
                    <span style={{ marginLeft: 8 }}>
                      <span style={pill('var(--warning)', 'var(--warning-line)')}>suspended</span>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                  {p.standardsEnabled === 0
                    ? <span style={{ color: 'var(--warning)' }}>no framework enabled</span>
                    : <>{p.standardsEnabled} framework{p.standardsEnabled === 1 ? '' : 's'} enabled</>}
                </div>
              </div>

              {!p.assessed ? (
                <div style={{ fontSize: 12.5, color: 'var(--warning)', lineHeight: 1.6 }}>
                  Nothing has been assessed here — no risks, no control implementations, no findings.
                  The figures would all read zero, which is why they are not shown: an absence of
                  work is not an absence of exposure.
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
                    gap: 10, fontSize: 12,
                  }}>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>LIVE RISKS</div>
                      <div style={{ color: 'var(--ink-body)' }}>{p.risks.live}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>BEYOND TOLERANCE</div>
                      <div>{num(p.risks.beyondTolerance, true)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>CANNOT BE JUDGED</div>
                      <div>{num(p.risks.unjudgeable, true)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>OPEN FINDINGS</div>
                      <div style={{ color: 'var(--ink-body)' }}>
                        {p.issues.open}
                        {p.issues.overdue > 0 && (
                          <span style={{ color: 'var(--danger)' }}> · {p.issues.overdue} overdue</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>CONTROLS EFFECTIVE</div>
                      <div style={{ color: 'var(--ink-body)' }}>
                        {/* The denominator travels with the figure. A bare
                            percentage floating free of its basis is how "75%"
                            comes to mean three of four assessed controls out of
                            two hundred implemented. */}
                        {p.controls.effectivenessRate === null
                          ? <span style={{ color: 'var(--warning)' }}>not assessed</span>
                          : <>{p.controls.effective} of {p.controls.effectivenessBasis} ({p.controls.effectivenessRate}%)</>}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--ink-faint)', fontSize: 10.5 }}>OVERDUE REVIEWS</div>
                      <div>{num(p.risks.overdueReview + p.controls.overdueReview, true)}</div>
                    </div>
                  </div>
                </>
              )}

              {p.unknowns.length > 0 && (
                <ul style={{
                  margin: '12px 0 0 16px', padding: 0, fontSize: 11.5,
                  color: 'var(--ink-muted)', lineHeight: 1.7,
                }}>
                  {p.unknowns.map((u) => <li key={u}>{u}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EstatePosture;
