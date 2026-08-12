import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';

/**
 * Authoring controls.
 *
 * A control is either shared library content published by the operator
 * (tenantId null, read-only for tenants) or one an organisation wrote for
 * itself. Consultants and compliance managers live here: it is where a
 * framework stops being a list of clauses and becomes something with an owner.
 */

const SUBJ_CONTROL = 'Control';

export const createControl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { code, title, objective, domain, clauseIds, scope: publishScope } = req.body || {};
    if (!code || !title || !objective || !domain) {
      res.status(400).json({
        status: 'error',
        message: 'code, title, objective and domain are all required — a control without an objective cannot be tested',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const wantsLibrary = publishScope === 'platform';
    if (wantsLibrary && scope.kind !== 'PLATFORM') {
      res.status(403).json({
        status: 'error',
        code: 'PLATFORM_PUBLISH_DENIED',
        message: 'Only the platform operator can publish a control to the shared library. Omit "scope" to author it for your own organisation.',
      });
      return;
    }
    const owningTenantId = wantsLibrary ? null : req.user!.tenantId;

    const cleanCode = String(code).trim().toUpperCase();
    const clash = await prisma.control.findFirst({ where: { tenantId: owningTenantId, code: cleanCode } });
    if (clash) {
      res.status(409).json({ status: 'error', message: `A control with code "${cleanCode}" already exists in this scope` });
      return;
    }

    const linkIds: string[] = Array.isArray(clauseIds) ? clauseIds : [];
    if (linkIds.length > 0) {
      const bad = await unreachableClauses(linkIds, scope.tenantIds);
      if (bad) { res.status(bad.status).json(bad.body); return; }
    }

    const created = await prisma.$transaction(async (tx) => {
      const ctrl = await tx.control.create({
        data: {
          tenantId: owningTenantId,
          code: cleanCode,
          title: String(title).trim(),
          objective: String(objective).trim(),
          domain: String(domain).trim(),
        },
      });
      if (linkIds.length > 0) {
        await tx.controlClauseLink.createMany({
          data: linkIds.map((clauseId) => ({ controlId: ctrl.id, clauseId })),
        });
      }
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'CONTROL_CREATED',
        subjectType: SUBJ_CONTROL, subjectId: ctrl.id,
        payload: { code: cleanCode, domain, mappedClauses: linkIds.length, library: owningTenantId === null },
      });
      return ctrl;
    });

    res.status(201).json({
      status: 'success',
      message: `${cleanCode} created${linkIds.length ? ` and mapped to ${linkIds.length} clause(s)` : ''}. Create an implementation to assign it an owner.`,
      control: created,
    });
  } catch (error: any) {
    console.error('[Control Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create control' });
  }
};

/**
 * Copy a shared library control into your own set.
 *
 * Library controls carry the same mapping for every tenant, so they cannot be
 * remapped in place. Cloning is the supported route: you get your own copy,
 * with the original's clause mapping as a starting point, free to change.
 */
export const cloneControl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { code } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const source = await prisma.control.findFirst({
      where: { id, OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: { clauseLinks: { select: { clauseId: true } } },
    });
    if (!source) { res.status(404).json({ status: 'error', message: 'Control not found in your scope' }); return; }

    const target = req.user!.tenantId;
    const newCode = String(code || `${source.code}-LOCAL`).trim().toUpperCase();
    const clash = await prisma.control.findFirst({ where: { tenantId: target, code: newCode } });
    if (clash) {
      res.status(409).json({
        status: 'error',
        message: `You already have a control coded "${newCode}". Supply a different code.`,
      });
      return;
    }

    // Only carry over mappings this tenant can actually reach.
    const reachable = await prisma.standardClause.findMany({
      where: {
        id: { in: source.clauseLinks.map((l) => l.clauseId) },
        standard: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      },
      select: { id: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      const ctrl = await tx.control.create({
        data: {
          tenantId: target,
          code: newCode,
          title: source.title,
          objective: source.objective,
          domain: source.domain,
        },
      });
      if (reachable.length > 0) {
        await tx.controlClauseLink.createMany({
          data: reachable.map((c) => ({ controlId: ctrl.id, clauseId: c.id })),
        });
      }
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'CONTROL_CLONED',
        subjectType: SUBJ_CONTROL, subjectId: ctrl.id,
        payload: { from: source.code, to: newCode, carriedMappings: reachable.length },
      });
      return ctrl;
    });

    res.status(201).json({
      status: 'success',
      message: `${source.code} copied to ${newCode} with ${reachable.length} clause mapping(s). It is yours to edit and remap.`,
      control: created,
    });
  } catch (error: any) {
    console.error('[Control Clone Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to copy control' });
  }
};

export const updateControl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const ctrl = await prisma.control.findUnique({ where: { id } });
    if (!ctrl) { res.status(404).json({ status: 'error', message: 'Control not found' }); return; }

    const denied = await refuseIfNotYours(req, ctrl);
    if (denied) { res.status(denied.status).json(denied.body); return; }

    const { title, objective, domain } = req.body || {};
    const data: any = {};
    if (title) data.title = String(title).trim();
    if (objective) data.objective = String(objective).trim();
    if (domain) data.domain = String(domain).trim();
    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.control.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'CONTROL_UPDATED',
        subjectType: SUBJ_CONTROL, subjectId: id,
        payload: { code: ctrl.code, after: data },
      });
      return u;
    });

    res.json({ status: 'success', control: updated });
  } catch (error: any) {
    console.error('[Control Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update control' });
  }
};

/** A control someone is implementing carries evidence; deleting it destroys the trail. */
export const deleteControl = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const ctrl = await prisma.control.findUnique({
      where: { id },
      include: { _count: { select: { implementations: true, clauseLinks: true } } },
    });
    if (!ctrl) { res.status(404).json({ status: 'error', message: 'Control not found' }); return; }

    const denied = await refuseIfNotYours(req, ctrl);
    if (denied) { res.status(denied.status).json(denied.body); return; }

    if (ctrl._count.implementations > 0) {
      res.status(409).json({
        status: 'error',
        code: 'CONTROL_IN_USE',
        message: `${ctrl.code} has ${ctrl._count.implementations} implementation(s) with their own evidence and history. Retire those first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.control.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId, actorId: req.user!.id, action: 'CONTROL_DELETED',
        subjectType: SUBJ_CONTROL, subjectId: id,
        payload: { code: ctrl.code, mappings: ctrl._count.clauseLinks },
      });
    });

    res.json({ status: 'success', message: `${ctrl.code} deleted` });
  } catch (error: any) {
    console.error('[Control Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete control' });
  }
};

/** Clause picker for the authoring screens — every clause the tenant can map to. */
export const listClauses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const { standardId, standardCode } = req.query as Record<string, string | undefined>;

    const where: any = { standard: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] } };
    if (standardId) where.standardId = standardId;
    // The response exposes standardCode, so callers reasonably filter by it.
    // Accepting only the opaque id meant a mistyped filter was silently
    // ignored and returned every clause on the platform.
    if (standardCode) where.standard.code = standardCode.toUpperCase();

    const clauses = await prisma.standardClause.findMany({
      where,
      include: {
        standard: { select: { id: true, code: true, title: true } },
        _count: { select: { links: true } },
      },
      orderBy: [{ standardId: 'asc' }, { ref: 'asc' }],
      take: 2000,
    });

    res.json({
      status: 'success',
      count: clauses.length,
      clauses: clauses.map((c) => ({
        id: c.id, ref: c.ref, title: c.title, text: c.text,
        standardId: c.standard.id, standardCode: c.standard.code,
        mappedControlCount: c._count.links,
      })),
    });
  } catch (error: any) {
    console.error('[Clauses List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list clauses' });
  }
};

async function unreachableClauses(
  clauseIds: string[],
  tenantIds: string[],
): Promise<{ status: number; body: any } | null> {
  const found = await prisma.standardClause.findMany({
    where: { id: { in: clauseIds } },
    include: { standard: { select: { code: true, tenantId: true } } },
  });
  if (found.length !== clauseIds.length) {
    return { status: 400, body: { status: 'error', message: 'One or more clauseIds do not exist' } };
  }
  const blocked = found.filter((c) => c.standard.tenantId !== null && !tenantIds.includes(c.standard.tenantId));
  if (blocked.length > 0) {
    return {
      status: 403,
      body: {
        status: 'error',
        code: 'CLAUSE_OUT_OF_SCOPE',
        message: `You cannot map to another organisation's private framework (${[...new Set(blocked.map((c) => c.standard.code))].join(', ')}).`,
      },
    };
  }
  return null;
}

async function refuseIfNotYours(
  req: AuthenticatedRequest,
  ctrl: { tenantId: string | null; code: string },
): Promise<{ status: number; body: any } | null> {
  const scope = await resolveTenantScope(req.user!.tenantId);
  if (ctrl.tenantId === null && scope.kind !== 'PLATFORM') {
    return {
      status: 403,
      body: {
        status: 'error',
        code: 'LIBRARY_CONTROL',
        message: `${ctrl.code} belongs to the shared library and is the same for every tenant. Copy it into your own set to change it.`,
      },
    };
  }
  if (ctrl.tenantId !== null && !scope.tenantIds.includes(ctrl.tenantId)) {
    return { status: 403, body: { status: 'error', message: 'That control belongs to another organisation' } };
  }
  return null;
}
