import React, { useMemo, useState } from 'react';
import { S, pill } from '../../iam/iamStyles';

/**
 * The risk matrix suite.
 *
 * A 5×5 grid needs five bands, not three. Collapsing 25 possible scores into
 * High/Medium/Low throws away the distinction between a 15 and a 25, which is
 * exactly the distinction a board is trying to see. Each band carries its own
 * foreground so the count stays legible on its own fill rather than inheriting
 * body ink onto a saturated block.
 */

export type Cell = { count: number; refs: string[] };
export type Grid = Cell[][];

type Band = { name: string; bg: string; fg: string; line: string; min: number };

const BANDS: Band[] = [
  { name: 'Critical', min: 20, bg: '#F7CFCB', fg: '#7F1D1A', line: '#E09A94' },
  { name: 'High',     min: 15, bg: '#FBDFD5', fg: '#8A3312', line: '#E9B49C' },
  { name: 'Medium',   min: 10, bg: '#FDF0D5', fg: '#6B4A08', line: '#E8CE94' },
  { name: 'Moderate', min: 5,  bg: '#EAF3D9', fg: '#3F5417', line: '#C5DB9A' },
  { name: 'Low',      min: 1,  bg: '#E3F3E9', fg: '#14532D', line: '#A8D5BA' },
];

export function bandOf(score: number): Band {
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

/** Appetite bands read as a permission, not a severity, so they get their own scale. */
const APPETITE_STYLE: Record<string, { bg: string; fg: string; line: string; label: string }> = {
  WithinAppetite:  { bg: '#E3F3E9', fg: '#14532D', line: '#A8D5BA', label: 'Within appetite' },
  WithinTolerance: { bg: '#FDF0D5', fg: '#6B4A08', line: '#E8CE94', label: 'Within tolerance' },
  BeyondTolerance: { bg: '#F7CFCB', fg: '#7F1D1A', line: '#E09A94', label: 'Beyond tolerance' },
  NoAppetiteSet:   { bg: 'var(--surface-sunk)', fg: 'var(--ink-faint)', line: 'var(--line)', label: 'No appetite set' },
};

const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const IMPACT = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe'];

const axisLabel: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ink-faint)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontWeight: 600,
};

/**
 * One 5×5 matrix. Impact runs up the vertical axis and likelihood across the
 * horizontal, which is the orientation every risk professional reads without
 * having to check the labels.
 */
export const Matrix: React.FC<{
  grid: Grid;
  title: string;
  caption?: string;
  /** Optional per-cell band override — used by the appetite view. */
  cellBand?: (likelihood: number, impact: number) => string;
  onSelect?: (refs: string[], label: string, likelihood: number, impact: number) => void;
  selectedKey?: string | null;
  size?: number;
}> = ({ grid, title, caption, cellBand, onSelect, selectedKey, size = 58 }) => (
  <div style={{ ...S.card, padding: 18, flex: '1 1 340px', minWidth: 300 }}>
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)' }}>{title}</div>
      {caption && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.45 }}>{caption}</div>
      )}
    </div>

    <div style={{ display: 'flex', gap: 8 }}>
      {/* Impact axis */}
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4, justifyContent: 'flex-start' }}>
        {IMPACT.map((label, idx) => (
          <div key={label} style={{
            height: size, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 5, minWidth: 78,
          }}>
            <span style={{ fontSize: 10, color: 'var(--ink-muted)', textAlign: 'right', lineHeight: 1.15 }}>{label}</span>
            <span style={{ ...axisLabel, fontVariantNumeric: 'tabular-nums' }}>{idx + 1}</span>
          </div>
        ))}
      </div>

      <div>
        {/* Rows are impact 5 → 1 so severity climbs upward. */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${size}px)`, gap: 4 }}>
          {[5, 4, 3, 2, 1].map((impact) =>
            [1, 2, 3, 4, 5].map((likelihood) => {
              const cell = grid?.[likelihood - 1]?.[impact - 1] ?? { count: 0, refs: [] };
              const score = likelihood * impact;
              const key = `${likelihood}-${impact}`;
              const override = cellBand?.(likelihood, impact);
              const style = override
                ? APPETITE_STYLE[override] ?? APPETITE_STYLE.NoAppetiteSet
                : bandOf(score);
              const filled = cell.count > 0;
              const isSelected = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect?.(
                    cell.refs,
                    `Likelihood ${likelihood} × Impact ${impact} — score ${score}`,
                    likelihood, impact,
                  )}
                  title={`${LIKELIHOOD[likelihood - 1]} × ${IMPACT[impact - 1]} = ${score}${cell.count ? `\n${cell.refs.join(', ')}` : ''}`}
                  style={{
                    height: size,
                    // A cell with nothing in it still shows its band, faintly —
                    // the grid is a scale first and a tally second.
                    background: filled ? style.bg : 'var(--surface)',
                    border: `1px solid ${filled ? style.line : 'var(--line-soft)'}`,
                    outline: isSelected ? '2px solid var(--brand)' : 'none',
                    outlineOffset: -2,
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: cell.count ? 'pointer' : 'default',
                    padding: 0,
                    fontFamily: 'inherit',
                    transition: 'outline-color 0.12s ease, box-shadow 0.12s ease',
                  }}
                >
                  <span style={{
                    fontSize: filled ? 17 : 11,
                    fontWeight: filled ? 750 : 500,
                    color: filled ? style.fg : 'var(--ink-faint)',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                  }}>
                    {filled ? cell.count : score}
                  </span>
                  {filled && (
                    <span style={{ fontSize: 9, color: style.fg, opacity: 0.72, marginTop: 2 }}>
                      {score}
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>

        {/* Likelihood axis */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${size}px)`, gap: 4, marginTop: 6 }}>
          {LIKELIHOOD.map((label, idx) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ ...axisLabel, fontVariantNumeric: 'tabular-nums' }}>{idx + 1}</div>
              <div style={{ fontSize: 9.5, color: 'var(--ink-muted)', lineHeight: 1.2, marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ ...axisLabel, textAlign: 'center', marginTop: 7 }}>Likelihood →</div>
      </div>
    </div>
  </div>
);

export const Legend: React.FC<{ appetite?: boolean }> = ({ appetite }) => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
    {(appetite
      ? Object.entries(APPETITE_STYLE).filter(([k]) => k !== 'NoAppetiteSet')
        .map(([, v]) => ({ name: v.label, bg: v.bg, line: v.line, fg: v.fg }))
      : [...BANDS].reverse().map((b) => ({ name: b.name, bg: b.bg, line: b.line, fg: b.fg }))
    ).map((b) => (
      <span key={b.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-muted)' }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: b.bg, border: `1px solid ${b.line}` }} />
        {b.name}
      </span>
    ))}
  </div>
);

// ─── The suite ─────────────────────────────────────────────────────────────

type Props = { analytics: any };

const VIEWS = [
  { key: 'exposure', label: 'Inherent vs residual', hint: 'What the controls are actually removing' },
  { key: 'appetite', label: 'Against appetite', hint: 'Where the board has drawn its line' },
  { key: 'coverage', label: 'Control coverage', hint: 'Which categories are defended, and how well' },
  { key: 'network', label: 'Risk network', hint: 'Where exposure concentrates' },
] as const;

const RiskHeatmaps: React.FC<Props> = ({ analytics }) => {
  const [view, setView] = useState<typeof VIEWS[number]['key']>('exposure');
  const [selection, setSelection] = useState<{ refs: string[]; label: string } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('');

  const a = analytics || {};
  const grids = a.appetiteGrids || [];
  const activeAppetite = useMemo(
    () => grids.find((g: any) => g.category === category) || grids[0],
    [grids, category],
  );

  const pick = (refs: string[], label: string, key: string) => {
    if (refs.length === 0) { setSelection(null); setSelectedKey(null); return; }
    setSelection({ refs, label });
    setSelectedKey(key);
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--brand-tint)' : 'transparent',
    border: `1px solid ${active ? 'var(--brand-line)' : 'var(--line)'}`,
    color: active ? 'var(--brand-strong)' : 'var(--ink-muted)',
    padding: '7px 13px',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: active ? 650 : 500,
    whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
  });

  if (!analytics) {
    return <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>Loading matrices…</div>;
  }

  const active = VIEWS.find((v) => v.key === view)!;
  const migration = (a.migration || []).filter((m: any) => m.delta > 0);
  const unmoved = (a.migration || []).filter((m: any) => m.delta === 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        {VIEWS.map((v) => (
          <button key={v.key} style={tabStyle(view === v.key)} onClick={() => { setView(v.key); setSelection(null); setSelectedKey(null); }}>
            {v.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 16 }}>{active.hint}</div>

      {/* ── Inherent vs residual ─────────────────────────────────────── */}
      {view === 'exposure' && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Matrix
              grid={a.inherent}
              title="Inherent — before controls"
              caption="Where the register would sit with no control environment at all."
              onSelect={(refs, label) => pick(refs, `Inherent · ${label}`, `inh-${label}`)}
              selectedKey={selectedKey?.startsWith('inh-') ? selectedKey.slice(4) : null}
            />
            <Matrix
              grid={a.residual}
              title="Residual — after controls"
              caption="Derived from verified control effectiveness, recomputed whenever a control changes."
              onSelect={(refs, label) => pick(refs, `Residual · ${label}`, `res-${label}`)}
              selectedKey={selectedKey?.startsWith('res-') ? selectedKey.slice(4) : null}
            />
          </div>
          <Legend />

          {(a.opportunity || []).some((row: any[]) => row.some((c: any) => c.count > 0)) && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Matrix
                  grid={a.opportunity}
                  title="Opportunities"
                  caption="ISO 31000 counts upside as risk. Here a high score is a target, not a threat."
                  size={48}
                  onSelect={(refs, label) => pick(refs, `Opportunity · ${label}`, `opp-${label}`)}
                  selectedKey={selectedKey?.startsWith('opp-') ? selectedKey.slice(4) : null}
                />
                <div style={{ ...S.card, padding: 18, flex: '1 1 320px', minWidth: 280 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)', marginBottom: 10 }}>
                    Biggest reductions
                  </div>
                  {migration.slice(0, 7).map((m: any) => (
                    <div key={m.ref} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--brand)', minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>{m.ref}</span>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                        <span style={{ color: bandOf(m.from.score).fg, fontWeight: 650 }}>{m.from.score}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>→</span>
                        <span style={{ color: bandOf(m.to.score).fg, fontWeight: 700 }}>{m.to.score}</span>
                      </span>
                    </div>
                  ))}
                  {unmoved.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)' }}>
                      {unmoved.length} risk(s) show no reduction at all — either unmitigated, or every
                      linked control is unverified.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Appetite overlay ─────────────────────────────────────────── */}
      {view === 'appetite' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Category</span>
            <select
              value={activeAppetite?.category || ''}
              onChange={(e) => setCategory(e.target.value)}
              style={{ ...S.input, width: 190 }}
            >
              {grids.map((g: any) => <option key={g.category} value={g.category}>{g.category}</option>)}
            </select>
          </div>

          {!activeAppetite ? (
            <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
              No approved appetite statement yet. Until the board sets one, nothing can be judged
              in or out of tolerance — and acceptance has no ceiling to enforce.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Matrix
                  grid={(() => {
                    // Place this category's risks on the grid the board defined.
                    const g: Grid = Array.from({ length: 5 }, () =>
                      Array.from({ length: 5 }, () => ({ count: 0, refs: [] as string[] })));
                    for (const p of activeAppetite.placed || []) {
                      g[p.l - 1][p.i - 1].count++;
                      g[p.l - 1][p.i - 1].refs.push(p.ref);
                    }
                    return g;
                  })()}
                  title={`${activeAppetite.category} — against board appetite`}
                  caption={`Appetite at ${activeAppetite.appetiteThreshold}, tolerance at ${activeAppetite.toleranceThreshold}. Cell colour is the board's line, not the score band.`}
                  cellBand={(l, i) => activeAppetite.grid?.[l - 1]?.[i - 1] ?? 'NoAppetiteSet'}
                  onSelect={(refs, label) => pick(refs, `${activeAppetite.category} · ${label}`, `app-${label}`)}
                  selectedKey={selectedKey?.startsWith('app-') ? selectedKey.slice(4) : null}
                />
                <div style={{ ...S.card, padding: 18, flex: '1 1 300px', minWidth: 270 }}>
                  <div style={{ fontSize: 11, ...axisLabel, marginBottom: 6 }}>Board statement</div>
                  <p style={{ fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.55, margin: '0 0 16px' }}>
                    {activeAppetite.statement}
                  </p>
                  {(['BeyondTolerance', 'WithinTolerance', 'WithinAppetite'] as const).map((band) => {
                    const rows = (activeAppetite.placed || []).filter((p: any) => p.band === band);
                    if (rows.length === 0) return null;
                    const st = APPETITE_STYLE[band];
                    return (
                      <div key={band} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                          <span style={{ width: 12, height: 12, borderRadius: 3, background: st.bg, border: `1px solid ${st.line}` }} />
                          <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--ink)' }}>{st.label}</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>({rows.length})</span>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {rows.map((p: any) => (
                            <span key={p.ref} style={{ ...pill(st.fg, st.line), fontVariantNumeric: 'tabular-nums' }}>
                              {p.ref} · {p.score}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {(activeAppetite.placed || []).length === 0 && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                      No risks in this category yet.
                    </div>
                  )}
                </div>
              </div>
              <Legend appetite />
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10, maxWidth: '56rem', lineHeight: 1.55 }}>
                A risk beyond tolerance cannot be formally accepted — the acceptance endpoint refuses it
                and requires the risk be treated down instead. That gate reads the residual score shown
                here, which is why it now recomputes whenever a control's effectiveness changes.
              </div>
            </>
          )}
        </>
      )}

      {/* ── Control coverage ─────────────────────────────────────────── */}
      {view === 'coverage' && (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
            <thead>
              <tr style={S.headRow}>
                {['Category', 'Risks', 'Unmitigated', 'Control mix', 'Mitigation'].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(a.coverage || {})
                .sort((x: any, y: any) => y[1].risks - x[1].risks)
                .map(([cat, c]: any) => {
                  const totalControls = c.effective + c.partial + c.ineffective + c.unverified;
                  const segments = [
                    { n: c.effective, color: '#1B7A4B', label: 'Effective' },
                    { n: c.partial, color: '#9A6510', label: 'Partially effective' },
                    { n: c.ineffective, color: '#B3261E', label: 'Ineffective' },
                    { n: c.unverified, color: '#94A3B8', label: 'Unverified' },
                  ].filter((s) => s.n > 0);
                  return (
                    <tr key={cat} style={S.bodyRow}>
                      <td style={{ ...S.td, fontWeight: 600, color: 'var(--ink)' }}>{cat}</td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{c.risks}</td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: c.unmitigated > 0 ? 'var(--danger)' : 'var(--ink-body)', fontWeight: c.unmitigated > 0 ? 650 : 400 }}>
                        {c.unmitigated || '—'}
                      </td>
                      <td style={S.td}>
                        {totalControls === 0 ? (
                          <span style={{ color: 'var(--ink-faint)' }}>no controls linked</span>
                        ) : (
                          <>
                            <div style={{ display: 'flex', height: 9, borderRadius: 999, overflow: 'hidden', background: 'var(--line-soft)', maxWidth: 220 }}>
                              {segments.map((s) => (
                                <div key={s.label} title={`${s.label}: ${s.n}`}
                                  style={{ width: `${(s.n / totalControls) * 100}%`, background: s.color }} />
                              ))}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4 }}>
                              {segments.map((s) => `${s.n} ${s.label.toLowerCase()}`).join(' · ')}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{
                          fontWeight: 700,
                          color: c.mitigationRate >= 40 ? 'var(--success)' : c.mitigationRate > 0 ? 'var(--warning)' : 'var(--danger)',
                        }}>
                          {c.mitigationRate}%
                        </span>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
                          {c.inherentTotal} → {c.residualTotal}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Risk network ─────────────────────────────────────────────── */}
      {view === 'network' && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14, maxWidth: '56rem', lineHeight: 1.55 }}>
            A flat likelihood × impact cannot see that one medium risk sits upstream of three others.
            The network score weights a risk by how many others it touches, so concentration surfaces
            even when the individual score does not stand out.
          </div>
          {(a.connectedRisks || []).length === 0 ? (
            <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
              No causal links recorded yet. Link a risk to the ones it drives to build the network.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {a.connectedRisks.map((r: any) => (
                <div key={r.id} style={{
                  ...S.card, padding: 15,
                  borderLeft: `4px solid ${bandOf(r.residualScore).line}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <div style={{ flex: '1 1 320px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{r.ref}</span>
                      <span style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 8 }}>{r.title}</span>
                      <span style={{ marginLeft: 8, ...pill('var(--ink-muted)', 'var(--line)') }}>{r.category}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 18, fontVariantNumeric: 'tabular-nums' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ ...axisLabel }}>Residual</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: bandOf(r.residualScore).fg }}>{r.residualScore}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ ...axisLabel }}>Network</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{r.networkScore}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    {r.causes.length > 0 && (
                      <span>drives <strong style={{ color: 'var(--ink-body)' }}>{r.causes.join(', ')}</strong></span>
                    )}
                    {r.causedBy.length > 0 && (
                      <span>driven by <strong style={{ color: 'var(--ink-body)' }}>{r.causedBy.join(', ')}</strong></span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drill-down from any cell click */}
      {selection && (
        <div style={{
          ...S.card, padding: '13px 16px', marginTop: 16,
          borderLeft: '3px solid var(--brand)',
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{selection.label}</span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
            {selection.refs.map((ref) => (
              <span key={ref} style={pill('var(--brand-strong)', 'var(--brand-line)')}>{ref}</span>
            ))}
          </div>
          <button
            onClick={() => { setSelection(null); setSelectedKey(null); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
};

export default RiskHeatmaps;
