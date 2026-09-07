import crypto from 'crypto';
import { ReportDocument, ReportSection } from './reportDocument';

/**
 * The register of what left this organisation, and in what state.
 *
 * The hashing here is the part that can be quietly wrong: a document hash that
 * changes when nothing meaningful did is a hash nobody trusts, and one that
 * stays the same when a figure moved is worse than none at all. So the input is
 * canonicalised deliberately rather than by throwing the object at JSON.
 */

/**
 * A stable fingerprint of what a report SAYS, independent of how it was drawn.
 *
 * Two exports with the same hash carried the same numbers and the same rows,
 * whether one was a PDF and the other a spreadsheet. That is the property worth
 * having: it lets "the board saw these figures" be checked without anyone
 * comparing two files byte by byte.
 *
 * Three things are deliberately excluded, and each would otherwise make the
 * hash useless:
 *
 *   the generated timestamp   changes on every export by definition
 *   the document reference    is derived from that timestamp
 *   the branding              is how it looks, not what it says — a tenant
 *                             changing their logo has not changed their figures
 *
 * What IS included is the provenance that bears on meaning: the report's name,
 * the subject, and the subject's status at the time, because a report drawn
 * while an engagement was Active says something different from the same rows
 * drawn after it closed.
 */
export function documentHash(report: ReportDocument): string {
  const canonical = {
    reportName: report.provenance.reportName,
    subjectRef: report.provenance.subjectRef ?? null,
    subjectStatus: report.provenance.subjectStatus ?? null,
    scopeKind: report.provenance.scopeKind,
    sections: report.sections.map(canonicalSection),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Canonicalise one section.
 *
 * Row objects are reduced to arrays ordered by the section's own columns, so a
 * change in JavaScript key order — which says nothing — cannot change the hash,
 * while a changed value or a reordered COLUMN, which both change what a reader
 * sees, does.
 */
function canonicalSection(section: ReportSection): unknown {
  if (section.kind === 'fields') {
    return {
      kind: 'fields',
      title: section.title,
      fields: section.fields.map((f) => [f.label, f.value]),
    };
  }
  const keys = section.columns.map((c) => c.key);
  return {
    kind: 'table',
    title: section.title,
    columns: section.columns.map((c) => [c.header, c.key]),
    rows: section.rows.map((r) => keys.map((k) => {
      const v = r[k];
      return v === null || v === undefined ? null : String(v);
    })),
  };
}

/**
 * The figures worth keeping outside the file.
 *
 * Lets "what changed between issue 2 and issue 3" be answered without opening
 * either artefact — which matters because opening them means reading two PDFs
 * side by side, and nobody does that.
 *
 * Only scalars: anything structured belongs in the document, and a snapshot
 * that grows to mirror the report is a second copy that will disagree with the
 * first.
 */
export function snapshotOf(figures: Record<string, unknown>): string {
  const flat: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(figures)) {
    if (v === null || v === undefined) { flat[k] = null; continue; }
    if (typeof v === 'object') continue;
    flat[k] = v as string | number | boolean;
  }
  return JSON.stringify(flat);
}

/**
 * What changed between two snapshots.
 *
 * Returned as a list rather than a diff object so a report can print it, and so
 * a figure that appeared or vanished between issues reads as a change rather
 * than being silently skipped.
 */
export function snapshotDelta(
  before: string | null | undefined,
  after: string,
): { figure: string; from: string; to: string }[] {
  let a: Record<string, unknown> = {};
  let b: Record<string, unknown> = {};
  try { a = before ? JSON.parse(before) : {}; } catch { a = {}; }
  try { b = JSON.parse(after); } catch { b = {}; }

  const out: { figure: string; from: string; to: string }[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const from = key in a ? String(a[key]) : '—';
    const to = key in b ? String(b[key]) : '—';
    if (from !== to) out.push({ figure: key, from, to });
  }
  return out.sort((x, y) => x.figure.localeCompare(y.figure));
}

/**
 * The reference printed on every page.
 *
 * Carries the issue number when there is one, so a reader holding two copies
 * can tell at a glance which is later — the timestamp alone requires them to
 * parse a fourteen-digit string to work that out.
 */
export function documentRefFor(
  reportKey: string,
  at: Date,
  issueNumber: number | null,
): string {
  const stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const prefix = reportKey.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  return issueNumber && issueNumber > 0
    ? `${prefix}-${stamp}-i${issueNumber}`
    : `${prefix}-${stamp}`;
}
