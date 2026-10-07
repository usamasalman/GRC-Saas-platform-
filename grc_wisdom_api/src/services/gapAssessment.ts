/**
 * Gap assessment and the Statement of Applicability (consulting engagement,
 * sprint 10).
 *
 * Each clause of a framework in scope is assessed for each entity in scope:
 * Conformant, Partial, Missing, or Not applicable, always with the reason.
 * A Partial or Missing clause is a gap, raised as an Issue of the
 * organisation's (source ConsultingGap) with its type and clause, which the
 * organisation answers and closes under the issue register's own rule: the
 * person who closes it is not the one who raised, answered or owns it. A new
 * assessment replaces the current one and the old one stays as history; a
 * gap is never closed by reassessing it.
 *
 * The Statement of Applicability is read off the current assessments: a clause
 * not applicable says why; every other clause says how far it is implemented.
 *
 * Pure, so every rule here runs without a database.
 */

export const RESULTS = ['Conformant', 'Partial', 'Missing', 'NotApplicable'] as const;
export type Result = (typeof RESULTS)[number];
export const RESULT_LABEL: Record<Result, string> = {
  Conformant: 'Conformant', Partial: 'Partial', Missing: 'Missing', NotApplicable: 'Not applicable',
};
export const GAP_TYPES = ['Documentation', 'Implementation', 'Evidence', 'Competence'] as const;
export type GapType = (typeof GAP_TYPES)[number];

export const isGap = (r: string | null | undefined): boolean => r === 'Partial' || r === 'Missing';

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

export function checkAssessment(input: { result: unknown; justification: unknown; gapType: unknown }):
  { ok: true; result: Result; justification: string; gapType: GapType | null } | Refusal {
  const result = String(input.result ?? '');
  if (!(RESULTS as readonly string[]).includes(result)) {
    return refuse(400, 'BAD_RESULT', 'A clause is Conformant, Partial, Missing or Not applicable.');
  }
  const justification = String(input.justification ?? '').trim();
  if (justification.length < 10) {
    return refuse(400, 'JUSTIFICATION_REQUIRED', result === 'NotApplicable'
      ? 'Say why the clause does not apply, in at least 10 characters. The Statement of Applicability prints it.'
      : 'Give the reason for the result, in at least 10 characters.');
  }
  if (justification.length > 4000) return refuse(400, 'JUSTIFICATION_TOO_LONG', 'At most 4,000 characters.');
  let gapType: GapType | null = null;
  if (isGap(result)) {
    const g = String(input.gapType ?? '');
    if (!(GAP_TYPES as readonly string[]).includes(g)) {
      return refuse(400, 'GAP_TYPE_REQUIRED', `Say what is missing: ${GAP_TYPES.join(', ')}.`);
    }
    gapType = g as GapType;
  }
  return { ok: true, result: result as Result, justification, gapType };
}

/**
 * Whether this assessment raises a new gap: it is a gap, and the clause has
 * no gap still open for this entity on this engagement. A gap already open
 * carries on; one closed earlier does not stop a new one being raised.
 */
export const raisesGap = (result: string, openGapIssueId: string | null): boolean => isGap(result) && !openGapIssueId;

/** How the Statement of Applicability states one clause. */
export function soaLine(a: { result: string | null; justification: string | null } | null): { applicable: string; status: string; justification: string } {
  if (!a || !a.result) return { applicable: 'Not assessed', status: 'Not assessed', justification: '—' };
  if (a.result === 'NotApplicable') return { applicable: 'No', status: '—', justification: a.justification ?? '' };
  const status = a.result === 'Conformant' ? 'Implemented' : a.result === 'Partial' ? 'Partially implemented' : 'Not implemented';
  return { applicable: 'Yes', status, justification: a.justification ?? '' };
}

/** The clauses the Statement of Applicability lists: Annex A where the framework has one, every clause otherwise. */
export function soaClauses<T extends { ref: string }>(clauses: readonly T[]): T[] {
  const annex = clauses.filter((c) => /^A\./i.test(c.ref));
  return annex.length ? annex : [...clauses];
}

/** Natural order for clause references: A.5.2 before A.5.10. */
export function byClauseRef(a: { ref: string }, b: { ref: string }): number {
  const pa = a.ref.split(/[.\s-]/);
  const pb = b.ref.split(/[.\s-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c;
  }
  return 0;
}

export function summarise(rows: readonly { result: string | null }[]): Record<Result | 'NotAssessed', number> {
  const out = { Conformant: 0, Partial: 0, Missing: 0, NotApplicable: 0, NotAssessed: 0 };
  for (const r of rows) {
    if (r.result && (RESULTS as readonly string[]).includes(r.result)) out[r.result as Result] += 1;
    else out.NotAssessed += 1;
  }
  return out;
}
