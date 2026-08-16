import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { checkSod, SodViolation } from '../services/sodEngine';
import { recomputeRisksForImplementations, describeMovement } from '../services/riskScoring';

const SUBJ_IMPL = 'ControlImplementation';
const SUBJ_EVIDENCE = 'Evidence';

const STATUSES = ['NotStarted', 'InProgress', 'Implemented', 'Verified'];
const EFFECTIVENESS = ['NotAssessed', 'Effective', 'PartiallyEffective', 'Ineffective'];
const JUDGEMENTS = ['NotAssessed', 'Yes', 'Partial', 'No'];
const FREQUENCIES = ['Continuous', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];

// ─── Standards ─────────────────────────────────────────────────────────────

export const listStandards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);

    const standards = await prisma.standard.findMany({
      // Platform standards (tenantId null) plus any this organisation authored.
      // A private framework must never surface in another tenant's library.
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: {
        _count: { select: { clauses: true } },
        enablements: {
          where: { tenantId: { in: scope.tenantIds } },
          include: {
            tenant: { select: { id: true, name: true } },
            owner: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { code: 'asc' },
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: standards.length,
      standards: standards.map((s) => ({
        id: s.id, code: s.code, title: s.title, authority: s.authority,
        version: s.version, description: s.description,
        clauseCount: s._count.clauses,
        isSystem: s.isSystem,
        // Tells the UI whether to offer edit controls at all.
        isOwnedHere: s.tenantId !== null && scope.tenantIds.includes(s.tenantId),
        publishedPlatformWide: s.tenantId === null,
        enabledFor: s.enablements.map((e) => ({
          tenantId: e.tenantId, tenantName: e.tenant.name,
          applicability: e.applicability, owner: e.owner, enabledAt: e.enabledAt,
        })),
        isEnabledHere: s.enablements.some((e) => e.tenantId === req.user!.tenantId),
      })),
    });
  } catch (error: any) {
    console.error('[Standards List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list standards' });
  }
};

export const enableStandard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { standardId, applicability, ownerId, tenantId } = req.body || {};
    if (!standardId) { res.status(400).json({ status: 'error', message: 'standardId is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const standard = await prisma.standard.findUnique({ where: { id: standardId } });
    if (!standard) { res.status(404).json({ status: 'error', message: 'Standard not found' }); return; }

    const existing = await prisma.tenantStandardEnablement.findFirst({ where: { tenantId: target, standardId } });
    if (existing) {
      res.status(409).json({ status: 'error', message: `${standard.code} is already enabled for this entity` });
      return;
    }

    const enablement = await prisma.$transaction(async (tx) => {
      const e = await tx.tenantStandardEnablement.create({
        data: { tenantId: target, standardId, applicability: applicability || 'Full', ownerId: ownerId || null },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'STANDARD_ENABLED',
        subjectType: 'Standard', subjectId: standardId,
        payload: { code: standard.code, applicability: applicability || 'Full' },
      });
      return e;
    });

    res.status(201).json({ status: 'success', message: `${standard.code} enabled`, enablement });
  } catch (error: any) {
    console.error('[Enable Standard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to enable standard' });
  }
};

// ─── Controls (library) ────────────────────────────────────────────────────

export const listControls = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const { domain, standard, search } = req.query as Record<string, string | undefined>;

    const where: any = { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] };
    if (domain) where.domain = domain;
    if (search) {
      where.AND = [{ OR: [{ title: { contains: search } }, { code: { contains: search } }, { objective: { contains: search } }] }];
    }
    if (standard) {
      where.clauseLinks = { some: { clause: { standard: { code: standard } } } };
    }

    const controls = await prisma.control.findMany({
      where,
      include: {
        clauseLinks: { include: { clause: { include: { standard: { select: { code: true, title: true } } } } } },
        implementations: {
          where: { tenantId: { in: scope.tenantIds } },
          select: { id: true, status: true, effectiveness: true, tenantId: true },
        },
      },
      orderBy: [{ domain: 'asc' }, { code: 'asc' }],
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: controls.length,
      domains: [...new Set(controls.map((c) => c.domain))].sort(),
      controls: controls.map((c) => ({
        id: c.id, code: c.code, title: c.title, objective: c.objective, domain: c.domain,
        isLibrary: c.tenantId === null,
        mappedTo: c.clauseLinks.map((l) => ({
          standardCode: l.clause.standard.code, clauseRef: l.clause.ref, clauseTitle: l.clause.title,
        })),
        implementationCount: c.implementations.length,
        implemented: c.implementations.filter((i) => ['Implemented', 'Verified'].includes(i.status)).length,
        verified: c.implementations.filter((i) => i.status === 'Verified').length,
      })),
    });
  } catch (error: any) {
    console.error('[Controls List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list controls' });
  }
};

// ─── Implementations ───────────────────────────────────────────────────────

export const listImplementations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.implementations.list');

    const { status, effectiveness, mine, overdue } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (status) where.status = status;
    if (effectiveness) where.effectiveness = effectiveness;
    if (mine === 'true') where.ownerId = req.user!.id;
    if (overdue === 'true') where.nextDueDate = { lt: new Date() };

    const impls = await prisma.controlImplementation.findMany({
      where,
      include: {
        control: {
          select: {
            code: true, title: true, domain: true,
            clauseLinks: { include: { clause: { include: { standard: { select: { code: true } } } } } },
          },
        },
        owner: { select: { id: true, name: true, email: true } },
        operator: { select: { id: true, name: true, email: true } },
        validatedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        _count: { select: { evidence: true } },
      },
      orderBy: [{ nextDueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });

    const now = Date.now();
    const enriched = impls.map((i) => ({
      ...i,
      isOverdue: !!i.nextDueDate && i.nextDueDate.getTime() < now && i.status !== 'Verified',
      mappedStandards: [...new Set(i.control.clauseLinks.map((l) => l.clause.standard.code))],
      awaitingValidation: i.status === 'Implemented' && !!i.submittedAt && !i.validatedAt,
      // Same rule the validate endpoint enforces, surfaced so the UI can offer
      // the action only to someone who may actually take it.
      canValidate:
        i.status === 'Implemented' && !!i.submittedAt && !i.validatedAt
        && i.ownerId !== req.user!.id && i.operatorId !== req.user!.id,
    }));

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      totals: {
        total: enriched.length,
        verified: enriched.filter((i) => i.status === 'Verified').length,
        implemented: enriched.filter((i) => i.status === 'Implemented').length,
        inProgress: enriched.filter((i) => i.status === 'InProgress').length,
        notStarted: enriched.filter((i) => i.status === 'NotStarted').length,
        overdue: enriched.filter((i) => i.isOverdue).length,
        awaitingValidation: enriched.filter((i) => i.awaitingValidation).length,
        effective: enriched.filter((i) => i.effectiveness === 'Effective').length,
      },
      implementations: enriched,
    });
  } catch (error: any) {
    console.error('[Implementations List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list implementations' });
  }
};

export const getImplementation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);

    const impl = await prisma.controlImplementation.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        control: { include: { clauseLinks: { include: { clause: { include: { standard: true } } } } } },
        owner: { select: { id: true, name: true, email: true, role: true } },
        operator: { select: { id: true, name: true, email: true, role: true } },
        validatedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        evidence: {
          include: {
            uploadedBy: { select: { id: true, name: true, email: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!impl) { res.status(404).json({ status: 'error', message: 'Implementation not found' }); return; }

    res.json({ status: 'success', implementation: impl });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch implementation' });
  }
};

export const createImplementation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { controlId, title, ownerId, operatorId, frequency, successCriteria, nextDueDate, tenantId } = req.body || {};
    if (!controlId || !successCriteria) {
      res.status(400).json({ status: 'error', message: 'controlId and successCriteria are required' });
      return;
    }
    if (frequency && !FREQUENCIES.includes(frequency)) {
      res.status(400).json({ status: 'error', message: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const control = await prisma.control.findUnique({ where: { id: controlId } });
    if (!control) { res.status(400).json({ status: 'error', message: 'controlId does not exist' }); return; }

    const dup = await prisma.controlImplementation.findFirst({ where: { tenantId: target, controlId } });
    if (dup) {
      res.status(409).json({ status: 'error', message: `${control.code} is already implemented for this entity` });
      return;
    }

    const impl = await prisma.$transaction(async (tx) => {
      const created = await tx.controlImplementation.create({
        data: {
          tenantId: target,
          controlId,
          title: title || control.title,
          ownerId: ownerId || req.user!.id,
          operatorId: operatorId || null,
          frequency: frequency || 'Quarterly',
          successCriteria: String(successCriteria).trim(),
          status: 'NotStarted',
          nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
        },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'CONTROL_IMPLEMENTATION_CREATED',
        subjectType: SUBJ_IMPL, subjectId: created.id,
        payload: { controlCode: control.code, ownerId: ownerId || req.user!.id, frequency: frequency || 'Quarterly' },
      });
      return created;
    });

    res.status(201).json({ status: 'success', implementation: impl });
  } catch (error: any) {
    console.error('[Create Implementation Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create implementation' });
  }
};

export const updateImplementation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const impl = await prisma.controlImplementation.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!impl) { res.status(404).json({ status: 'error', message: 'Implementation not found' }); return; }

    const { title, ownerId, operatorId, frequency, successCriteria, status, nextDueDate } = req.body || {};
    const data: any = {};
    if (title) data.title = title;
    if (ownerId) data.ownerId = ownerId;
    if (operatorId !== undefined) data.operatorId = operatorId || null;
    if (frequency) {
      if (!FREQUENCIES.includes(frequency)) {
        res.status(400).json({ status: 'error', message: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
        return;
      }
      data.frequency = frequency;
    }
    if (successCriteria) data.successCriteria = successCriteria;
    if (nextDueDate !== undefined) data.nextDueDate = nextDueDate ? new Date(nextDueDate) : null;

    if (status) {
      if (!STATUSES.includes(status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${STATUSES.join(', ')}` });
        return;
      }
      // Verified is reached only through independent validation, never directly.
      if (status === 'Verified') {
        res.status(400).json({
          status: 'error',
          message: 'Verified is set by independent validation. Submit the implementation, then have a different user validate it.',
        });
        return;
      }
      data.status = status;
      if (status === 'Implemented') data.submittedAt = new Date();
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.controlImplementation.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: impl.tenantId, actorId: req.user!.id, action: 'CONTROL_IMPLEMENTATION_UPDATED',
        subjectType: SUBJ_IMPL, subjectId: id,
        payload: { before: { status: impl.status }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', implementation: updated });
  } catch (error: any) {
    console.error('[Update Implementation Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update implementation' });
  }
};

/**
 * Independent validation (TRD §7.2): the validator must not be the person who
 * implemented or operated the control. Enforced by the SoD engine, so the rule
 * is data-driven rather than a hardcoded check.
 */
export const validateImplementation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { effectiveness, note } = req.body || {};
    if (!effectiveness || !EFFECTIVENESS.includes(effectiveness)) {
      res.status(400).json({ status: 'error', message: `effectiveness must be one of: ${EFFECTIVENESS.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const impl = await prisma.controlImplementation.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { _count: { select: { evidence: true } } },
    });
    if (!impl) { res.status(404).json({ status: 'error', message: 'Implementation not found' }); return; }
    if (impl.status !== 'Implemented') {
      res.status(409).json({ status: 'error', message: `Only Implemented controls can be validated (current: ${impl.status})` });
      return;
    }
    if (impl._count.evidence === 0) {
      res.status(409).json({ status: 'error', message: 'Attach at least one piece of evidence before validation' });
      return;
    }

    // Fast, explicit rejection before the generic engine also checks history.
    if (impl.ownerId === req.user!.id || impl.operatorId === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Independent validation required: the owner or operator of a control cannot validate it.',
      });
      return;
    }

    const { updated, moved } = await prisma.$transaction(async (tx) => {
      await checkSod(tx, {
        tenantId: impl.tenantId,
        actorId: req.user!.id,
        guardedAction: 'CONTROL_VALIDATED',
        subjectType: SUBJ_IMPL,
        subjectId: id,
      });

      const u = await tx.controlImplementation.update({
        where: { id },
        data: {
          status: 'Verified',
          effectiveness,
          validatedById: req.user!.id,
          validatedAt: new Date(),
          validationNote: note || null,
          lastReviewedAt: new Date(),
        },
      });

      // Close the loop: every risk relying on this control is re-rated in the
      // same transaction. Without this the register keeps the score it was
      // given when the control was last linked, however long ago that was.
      const m = await recomputeRisksForImplementations(
        tx, [id], 'ControlEffectivenessChanged',
      );

      await writeAudit(tx, {
        tenantId: impl.tenantId, actorId: req.user!.id, action: 'CONTROL_VALIDATED',
        subjectType: SUBJ_IMPL, subjectId: id,
        payload: {
          effectiveness, note: note || null, evidenceCount: impl._count.evidence,
          risksRerated: m.map((r) => ({ ref: r.ref, from: r.from, to: r.to })),
        },
      });
      return { updated: u, moved: m };
    });

    res.json({
      status: 'success',
      message: `Validated as ${effectiveness}. ${describeMovement(moved)}`,
      implementation: updated,
      risksRerated: moved,
    });
  } catch (error: any) {
    if (error instanceof SodViolation) {
      res.status(403).json({ status: 'error', code: error.code, rule: error.ruleKey, message: error.message });
      return;
    }
    console.error('[Validate Implementation Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to validate implementation' });
  }
};

// ─── Evidence ──────────────────────────────────────────────────────────────

export const addEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, description, classification, fileName, fileUrl } = req.body || {};
    if (!title) { res.status(400).json({ status: 'error', message: 'title is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const impl = await prisma.controlImplementation.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!impl) { res.status(404).json({ status: 'error', message: 'Implementation not found' }); return; }

    const evidence = await prisma.$transaction(async (tx) => {
      const e = await tx.evidence.create({
        data: {
          tenantId: impl.tenantId,
          implementationId: id,
          title: String(title).trim(),
          description: description || null,
          classification: classification || 'Internal',
          fileName: fileName || null,
          fileUrl: fileUrl || null,
          uploadedById: req.user!.id,
        },
      });
      await writeAudit(tx, {
        tenantId: impl.tenantId, actorId: req.user!.id, action: 'EVIDENCE_ATTACHED',
        subjectType: SUBJ_EVIDENCE, subjectId: e.id,
        payload: { implementationId: id, title, classification: classification || 'Internal' },
      });
      return e;
    });

    res.status(201).json({ status: 'success', evidence });
  } catch (error: any) {
    console.error('[Add Evidence Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to attach evidence' });
  }
};

/**
 * Reviewer judgement on evidence quality. The four dimensions are stored as
 * discrete columns (TRD §7.2) so they can be reported on, not free text.
 */
export const reviewEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { relevance, sufficiency, authenticity, currency, reviewNote } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const evidence = await prisma.evidence.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!evidence) { res.status(404).json({ status: 'error', message: 'Evidence not found' }); return; }

    if (evidence.uploadedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'You cannot review evidence you uploaded yourself.',
      });
      return;
    }

    const data: any = { reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: reviewNote || null };
    for (const [k, v] of Object.entries({ relevance, sufficiency, authenticity, currency })) {
      if (v === undefined) continue;
      if (!JUDGEMENTS.includes(v as string)) {
        res.status(400).json({ status: 'error', message: `${k} must be one of: ${JUDGEMENTS.join(', ')}` });
        return;
      }
      data[k] = v;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.evidence.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: evidence.tenantId, actorId: req.user!.id, action: 'EVIDENCE_REVIEWED',
        subjectType: SUBJ_EVIDENCE, subjectId: id,
        payload: { relevance: u.relevance, sufficiency: u.sufficiency, authenticity: u.authenticity, currency: u.currency },
      });
      return u;
    });

    res.json({ status: 'success', evidence: updated });
  } catch (error: any) {
    console.error('[Review Evidence Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review evidence' });
  }
};
