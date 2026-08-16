import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { createIssueRecord } from '../services/issueFactory';
import { recomputeRisksForImplementations, describeMovement } from '../services/riskScoring';

const SUBJ_CAMPAIGN = 'RcsaCampaign';
const SUBJ_ASSESSMENT = 'RcsaAssessment';
const EFFECTIVENESS = ['Effective', 'PartiallyEffective', 'Ineffective'];

/// Ordered worst-to-best so a self-assessment can be tested for "is this a
/// downgrade?" — first line may lower a rating on its own word, but raising
/// one back needs independent validation.
const RANK: Record<string, number> = {
  Ineffective: 0, PartiallyEffective: 1, NotAssessed: 2, Effective: 3,
};

async function nextCampaignRef(tenantId: string): Promise<string> {
  const count = await prisma.rcsaCampaign.count({ where: { tenantId } });
  return `RCSA-${new Date().getFullYear()}-${String(count + 1).padStart(2, '0')}`;
}

function completion(assessments: { status: string }[]) {
  const submitted = assessments.filter((a) => a.status === 'Submitted').length;
  return {
    total: assessments.length,
    submitted,
    pending: assessments.length - submitted,
    percent: assessments.length > 0 ? Math.round((submitted / assessments.length) * 100) : 0,
  };
}

// ─── Campaigns ─────────────────────────────────────────────────────────────

export const listCampaigns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.rcsa.list');

    const campaigns = await prisma.rcsaCampaign.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        launchedBy: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
        assessments: { select: { status: true, operatingRating: true, designRating: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const enriched = campaigns.map((c) => ({
      ...c,
      assessments: undefined,
      completion: completion(c.assessments),
      ineffective: c.assessments.filter(
        (a) => a.operatingRating === 'Ineffective' || a.designRating === 'Ineffective',
      ).length,
      isOverdue: c.status === 'Launched' && c.dueDate.getTime() < Date.now(),
    }));

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      totals: {
        campaigns: enriched.length,
        launched: enriched.filter((c) => c.status === 'Launched').length,
        overdue: enriched.filter((c) => c.isOverdue).length,
        closed: enriched.filter((c) => c.status === 'Closed').length,
      },
      campaigns: enriched,
    });
  } catch (error: any) {
    console.error('[RCSA List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list RCSA campaigns' });
  }
};

export const getCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const campaign = await prisma.rcsaCampaign.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        launchedBy: { select: { id: true, name: true } },
        assessments: {
          include: {
            respondent: { select: { id: true, name: true, email: true } },
            implementation: { select: { id: true, status: true, effectiveness: true, control: { select: { code: true, title: true } } } },
            issue: { select: { id: true, ref: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!campaign) { res.status(404).json({ status: 'error', message: 'Campaign not found' }); return; }

    res.json({
      status: 'success',
      campaign: { ...campaign, completion: completion(campaign.assessments) },
    });
  } catch (error: any) {
    console.error('[RCSA Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch campaign' });
  }
};

export const createCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, period, dueDate, tenantId } = req.body || {};
    if (!title || !period || !dueDate) {
      res.status(400).json({ status: 'error', message: 'title, period and dueDate are required' });
      return;
    }
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) {
      res.status(400).json({ status: 'error', message: 'dueDate is not a valid date' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const ref = await nextCampaignRef(target);
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.rcsaCampaign.create({
        data: { tenantId: target, ref, title: String(title).trim(), period: String(period).trim(), dueDate: due, status: 'Draft' },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'RCSA_CAMPAIGN_CREATED',
        subjectType: SUBJ_CAMPAIGN, subjectId: created.id,
        payload: { ref, period, dueDate: due },
      });
      return created;
    });

    res.status(201).json({ status: 'success', campaign });
  } catch (error: any) {
    console.error('[RCSA Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create campaign' });
  }
};

/**
 * Add a control to the campaign scope. The respondent defaults to the
 * implementation owner — self-assessment means the first line attests to its
 * own controls, so the owner is the correct respondent.
 */
export const addScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { implementationId, respondentId } = req.body || {};
    if (!implementationId) {
      res.status(400).json({ status: 'error', message: 'implementationId is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const campaign = await prisma.rcsaCampaign.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!campaign) { res.status(404).json({ status: 'error', message: 'Campaign not found' }); return; }
    if (campaign.status !== 'Draft') {
      res.status(409).json({
        status: 'error',
        code: 'CAMPAIGN_LOCKED',
        message: `Scope is fixed once a campaign is launched (current status: ${campaign.status}).`,
      });
      return;
    }

    const impl = await prisma.controlImplementation.findFirst({
      where: { id: implementationId, tenantId: campaign.tenantId },
      include: { control: { select: { code: true, title: true } } },
    });
    if (!impl) {
      res.status(404).json({ status: 'error', message: 'Control implementation not found in this tenant' });
      return;
    }

    const respondent = respondentId || impl.ownerId;
    if (!respondent) {
      res.status(400).json({ status: 'error', message: 'The implementation has no owner — respondentId must be supplied' });
      return;
    }

    const existing = await prisma.rcsaAssessment.findUnique({
      where: { campaignId_implementationId: { campaignId: id, implementationId } },
    });
    if (existing) {
      res.status(409).json({ status: 'error', message: `${impl.control.code} is already in this campaign` });
      return;
    }

    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.rcsaAssessment.create({
        data: { campaignId: id, tenantId: campaign.tenantId, implementationId, respondentId: respondent, status: 'Pending' },
      });
      await writeAudit(tx, {
        tenantId: campaign.tenantId, actorId: req.user!.id, action: 'RCSA_SCOPE_ADDED',
        subjectType: SUBJ_CAMPAIGN, subjectId: id,
        payload: { implementationId, control: impl.control.code, respondentId: respondent },
      });
      return created;
    });

    res.status(201).json({ status: 'success', message: `${impl.control.code} added to ${campaign.ref}`, assessment });
  } catch (error: any) {
    console.error('[RCSA Scope Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add control to campaign' });
  }
};

/** An empty campaign cannot be launched — there would be nothing to attest to. */
export const launchCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const campaign = await prisma.rcsaCampaign.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { _count: { select: { assessments: true } } },
    });
    if (!campaign) { res.status(404).json({ status: 'error', message: 'Campaign not found' }); return; }
    if (campaign.status !== 'Draft') {
      res.status(409).json({ status: 'error', message: `Only draft campaigns can be launched (current: ${campaign.status})` });
      return;
    }
    if (campaign._count.assessments === 0) {
      res.status(409).json({
        status: 'error',
        code: 'EMPTY_CAMPAIGN',
        message: 'The campaign has no controls in scope. Add controls before launching.',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.rcsaCampaign.update({
        where: { id },
        data: { status: 'Launched', launchedById: req.user!.id, launchedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: campaign.tenantId, actorId: req.user!.id, action: 'RCSA_CAMPAIGN_LAUNCHED',
        subjectType: SUBJ_CAMPAIGN, subjectId: id,
        payload: { ref: campaign.ref, controls: campaign._count.assessments, dueDate: campaign.dueDate },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: `${campaign.ref} launched to ${campaign._count.assessments} respondent slot(s)`,
      campaign: updated,
    });
  } catch (error: any) {
    console.error('[RCSA Launch Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to launch campaign' });
  }
};

// ─── Responses ─────────────────────────────────────────────────────────────

/**
 * The assigned respondent attests to their control. A self-reported
 * ineffective control raises an issue automatically — the whole point of
 * self-assessment is that first-line admissions reach the register without
 * waiting for an audit to find them.
 */
export const submitAssessment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessmentId = req.params.assessmentId as string;
    const { designRating, operatingRating, narrative } = req.body || {};

    if (!designRating || !EFFECTIVENESS.includes(designRating) || !operatingRating || !EFFECTIVENESS.includes(operatingRating)) {
      res.status(400).json({
        status: 'error',
        message: `designRating and operatingRating are both required and must be one of: ${EFFECTIVENESS.join(', ')}`,
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const assessment = await prisma.rcsaAssessment.findFirst({
      where: { id: assessmentId, tenantId: { in: scope.tenantIds } },
      include: {
        campaign: { select: { id: true, ref: true, status: true, dueDate: true } },
        implementation: { select: { id: true, ownerId: true, effectiveness: true, control: { select: { code: true, title: true } } } },
      },
    });
    if (!assessment) { res.status(404).json({ status: 'error', message: 'Assessment not found' }); return; }

    if (assessment.campaign.status !== 'Launched') {
      res.status(409).json({
        status: 'error',
        code: 'CAMPAIGN_NOT_OPEN',
        message: `${assessment.campaign.ref} is ${assessment.campaign.status} — responses are only accepted while it is launched.`,
      });
      return;
    }
    if (assessment.status === 'Submitted') {
      res.status(409).json({
        status: 'error',
        code: 'ALREADY_SUBMITTED',
        message: 'This assessment has already been submitted. Attestations are not revisable.',
      });
      return;
    }
    // An attestation only means something if the accountable person makes it.
    if (assessment.respondentId !== req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'NOT_RESPONDENT',
        message: 'Only the assigned respondent can attest to this control.',
      });
      return;
    }
    const anyIneffective = designRating === 'Ineffective' || operatingRating === 'Ineffective';
    if (anyIneffective && !narrative) {
      res.status(400).json({
        status: 'error',
        code: 'NARRATIVE_REQUIRED',
        message: 'A narrative is required when a control is self-assessed as ineffective.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let issue = null;
      if (anyIneffective) {
        issue = await createIssueRecord(tx, {
          tenantId: assessment.tenantId,
          source: 'SelfIdentified',
          sourceReference: assessment.campaign.ref,
          title: `Self-assessed ineffective control: ${assessment.implementation.control.code}`,
          condition: String(narrative).trim(),
          recommendation: `Remediate ${assessment.implementation.control.code} — ${assessment.implementation.control.title}.`,
          riskRating: designRating === 'Ineffective' && operatingRating === 'Ineffective' ? 'High' : 'Medium',
          raisedById: req.user!.id,
          implementationId: assessment.implementation.id,
        });
      }

      // First line has attested that the control does not work. Carrying that
      // verdict onto the control itself is what lets it reach the register —
      // previously the attestation stopped at the assessment row and every
      // risk relying on this control kept its old, better score.
      //
      // Operating effectiveness governs: a well-designed control that is not
      // operating gives no assurance. Self-assessment can only downgrade —
      // upgrading to Effective still requires independent validation, which is
      // the whole point of the second line.
      let moved: { ref: string; from: number; to: number }[] = [];
      const selfRating = operatingRating === 'Ineffective' || designRating === 'Ineffective'
        ? 'Ineffective'
        : operatingRating === 'PartiallyEffective' || designRating === 'PartiallyEffective'
          ? 'PartiallyEffective'
          : null;

      if (selfRating && selfRating !== assessment.implementation.effectiveness) {
        const downgrade = RANK[selfRating] < RANK[assessment.implementation.effectiveness ?? 'NotAssessed'];
        if (downgrade) {
          await tx.controlImplementation.update({
            where: { id: assessment.implementation.id },
            data: { effectiveness: selfRating, lastReviewedAt: new Date() },
          });
          moved = await recomputeRisksForImplementations(
            tx, [assessment.implementation.id], 'SelfAssessed',
          );
        }
      }

      const u = await tx.rcsaAssessment.update({
        where: { id: assessmentId },
        data: {
          designRating, operatingRating,
          narrative: narrative ? String(narrative).trim() : null,
          status: 'Submitted', submittedAt: new Date(),
          issueId: issue?.id ?? null,
        },
      });

      await writeAudit(tx, {
        tenantId: assessment.tenantId, actorId: req.user!.id, action: 'RCSA_ASSESSMENT_SUBMITTED',
        subjectType: SUBJ_ASSESSMENT, subjectId: assessmentId,
        payload: {
          campaign: assessment.campaign.ref, control: assessment.implementation.control.code,
          designRating, operatingRating, issueRaised: issue?.ref ?? null,
          risksRerated: moved.map((r) => ({ ref: r.ref, from: r.from, to: r.to })),
        },
      });
      return { assessment: u, issue, moved };
    });

    res.json({
      status: 'success',
      message: result.issue
        ? `Attestation recorded — ${result.issue.ref} raised automatically for the ineffective control. ${describeMovement(result.moved)}`
        : 'Attestation recorded.',
      assessment: result.assessment,
      issue: result.issue,
      risksRerated: result.moved,
    });
  } catch (error: any) {
    console.error('[RCSA Submit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit assessment' });
  }
};

/** A campaign closes only once every respondent has attested. */
export const closeCampaign = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const campaign = await prisma.rcsaCampaign.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { assessments: { select: { status: true } } },
    });
    if (!campaign) { res.status(404).json({ status: 'error', message: 'Campaign not found' }); return; }
    if (campaign.status !== 'Launched') {
      res.status(409).json({ status: 'error', message: `Only launched campaigns can be closed (current: ${campaign.status})` });
      return;
    }

    const pending = campaign.assessments.filter((a) => a.status !== 'Submitted').length;
    if (pending > 0) {
      res.status(409).json({
        status: 'error',
        code: 'INCOMPLETE_CAMPAIGN',
        message: `${pending} of ${campaign.assessments.length} attestation(s) are outstanding. The campaign cannot close with gaps in coverage.`,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.rcsaCampaign.update({ where: { id }, data: { status: 'Closed', closedAt: new Date() } });
      await writeAudit(tx, {
        tenantId: campaign.tenantId, actorId: req.user!.id, action: 'RCSA_CAMPAIGN_CLOSED',
        subjectType: SUBJ_CAMPAIGN, subjectId: id,
        payload: { ref: campaign.ref, attestations: campaign.assessments.length },
      });
      return u;
    });

    res.json({ status: 'success', message: `${campaign.ref} closed with ${campaign.assessments.length} attestation(s)`, campaign: updated });
  } catch (error: any) {
    console.error('[RCSA Close Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to close campaign' });
  }
};
