import { writeAudit } from '../middlewares/auditMiddleware';

/**
 * Single place that knows how to mint an issue.
 *
 * RCSA, KRI breaches and loss events all feed the same register as audit
 * findings — without this, each would grow its own reference scheme and its
 * own idea of what an issue looks like.
 */

const PREFIX: Record<string, string> = {
  InternalAudit: 'AUD',
  ExternalAudit: 'EXT',
  Regulator: 'REG',
  SelfIdentified: 'ISS',
  Incident: 'ISS',
  RiskAssessment: 'RSK',
};

export type NewIssue = {
  tenantId: string;
  source: string;
  title: string;
  recommendation: string;
  raisedById: string;
  riskRating?: string;
  condition?: string | null;
  criterion?: string | null;
  cause?: string | null;
  sourceReference?: string | null;
  targetCloseDate?: Date | null;
  // ── Linkage spine ────────────────────────────────────────────────────
  // What this issue is a gap *in*. Set as many as the caller genuinely knows;
  // an issue that names none of them is a note, not a traceable finding.
  auditId?: string | null;
  riskId?: string | null;
  implementationId?: string | null;
  auditableEntityId?: string | null;
  assetId?: string | null;
  vendorId?: string | null;
};

/**
 * Must run inside the caller's transaction so the issue, its audit entry and
 * whatever triggered it either all land or none do.
 */
export async function createIssueRecord(tx: any, input: NewIssue) {
  const prefix = PREFIX[input.source] ?? 'ISS';
  const year = new Date().getFullYear();

  // Several sources share a prefix (SelfIdentified and Incident are both ISS),
  // so the sequence has to follow the prefix rather than the source — counting
  // per source mints a duplicate reference the moment both are in use.
  const stem = `${prefix}-${year}-`;
  const siblings = await tx.issue.findMany({
    where: { tenantId: input.tenantId, ref: { startsWith: stem } },
    select: { ref: true },
  });
  const highest = siblings.reduce((max: number, r: { ref: string }) => {
    const n = parseInt(r.ref.slice(stem.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const ref = `${stem}${String(highest + 1).padStart(3, '0')}`;

  const issue = await tx.issue.create({
    data: {
      tenantId: input.tenantId,
      ref,
      source: input.source,
      sourceReference: input.sourceReference ?? null,
      title: input.title.trim().slice(0, 200),
      criterion: input.criterion ?? null,
      condition: input.condition ?? null,
      cause: input.cause ?? null,
      recommendation: input.recommendation.trim(),
      riskRating: input.riskRating ?? 'Medium',
      raisedById: input.raisedById,
      status: 'Open',
      targetCloseDate: input.targetCloseDate ?? null,
      auditId: input.auditId ?? null,
      riskId: input.riskId ?? null,
      implementationId: input.implementationId ?? null,
      auditableEntityId: input.auditableEntityId ?? null,
      assetId: input.assetId ?? null,
      vendorId: input.vendorId ?? null,
    },
  });

  await writeAudit(tx, {
    tenantId: input.tenantId,
    actorId: input.raisedById,
    action: 'ISSUE_RAISED',
    subjectType: 'Issue',
    subjectId: issue.id,
    payload: {
      ref, source: input.source, riskRating: issue.riskRating,
      sourceReference: input.sourceReference ?? null,
      linkedTo: {
        audit: input.auditId ?? null,
        risk: input.riskId ?? null,
        control: input.implementationId ?? null,
        entity: input.auditableEntityId ?? null,
        asset: input.assetId ?? null,
        vendor: input.vendorId ?? null,
      },
    },
  });

  return issue;
}
