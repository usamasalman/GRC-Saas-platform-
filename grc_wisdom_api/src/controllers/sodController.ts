import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';

// Loose admin-tier check. Replace with a real capability grant once the
// Phase-1 RBAC engine lands.
function parseActions(input: unknown): string[] | null {
  if (Array.isArray(input) && input.every((s) => typeof s === 'string')) return input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) return parsed;
    } catch { /* fallthrough */ }
  }
  return null;
}

// ─── LIST ─────────────────────────────────────────────────────────────────

export const listRules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const rules = await prisma.sodRule.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ tenantId: 'asc' }, { subjectType: 'asc' }, { key: 'asc' }],
    });
    res.json({
      status: 'success',
      count: rules.length,
      rules: rules.map((r) => ({
        ...r,
        conflictingActions: JSON.parse(r.conflictingActions),
        scope: r.tenantId ? 'tenant' : 'platform',
      })),
    });
  } catch (error: any) {
    console.error('[SoD List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list SoD rules' });
  }
};

// ─── CREATE (tenant-scoped only; platform rules seeded in seed.ts) ────────

export const createRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {

    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const { key, description, subjectType, conflictingActions, guardedAction, isActive } = req.body || {};

    const actions = parseActions(conflictingActions);
    if (!key || !description || !subjectType || !guardedAction || !actions) {
      res.status(400).json({
        status: 'error',
        message: 'key, description, subjectType, guardedAction, and conflictingActions[] are required',
      });
      return;
    }

    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.sodRule.create({
        data: {
          tenantId,
          key,
          description,
          subjectType,
          guardedAction,
          conflictingActions: JSON.stringify(actions),
          isActive: isActive !== false,
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'SOD_RULE_CREATED',
        subjectType: 'SodRule', subjectId: created.id,
        payload: { key, guardedAction, subjectType, conflictingActions: actions },
      });
      return created;
    });

    res.status(201).json({ status: 'success', rule });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ status: 'error', message: `A rule with key "${req.body?.key}" already exists in this tenant` });
      return;
    }
    console.error('[SoD Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create SoD rule' });
  }
};

// ─── UPDATE (tenant rules only — platform rules are read-only) ─────────────

export const updateRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {

    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const rule = await prisma.sodRule.findUnique({ where: { id } });
    if (!rule) { res.status(404).json({ status: 'error', message: 'Rule not found' }); return; }
    if (rule.tenantId === null) {
      res.status(403).json({ status: 'error', message: 'Platform-default rules are read-only. Create a tenant override instead.' });
      return;
    }
    if (rule.tenantId !== tenantId) {
      res.status(403).json({ status: 'error', message: 'Cross-tenant rule access denied' });
      return;
    }

    const { description, isActive, conflictingActions } = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof description === 'string') data.description = description;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (conflictingActions !== undefined) {
      const parsed = parseActions(conflictingActions);
      if (!parsed) {
        res.status(400).json({ status: 'error', message: 'conflictingActions must be an array of strings' });
        return;
      }
      data.conflictingActions = JSON.stringify(parsed);
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.sodRule.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'SOD_RULE_UPDATED',
        subjectType: 'SodRule', subjectId: id,
        payload: { changes: data },
      });
      return u;
    });

    res.json({ status: 'success', rule: updated });
  } catch (error: any) {
    console.error('[SoD Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update SoD rule' });
  }
};

// ─── DELETE (tenant rules only) ────────────────────────────────────────────

export const deleteRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {

    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = req.params.id as string;

    const rule = await prisma.sodRule.findUnique({ where: { id } });
    if (!rule) { res.status(404).json({ status: 'error', message: 'Rule not found' }); return; }
    if (rule.tenantId === null) {
      res.status(403).json({ status: 'error', message: 'Platform-default rules cannot be deleted. Deactivate instead via a tenant override.' });
      return;
    }
    if (rule.tenantId !== tenantId) {
      res.status(403).json({ status: 'error', message: 'Cross-tenant rule access denied' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.sodRule.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId, actorId: userId, action: 'SOD_RULE_DELETED',
        subjectType: 'SodRule', subjectId: id,
        payload: { key: rule.key },
      });
    });

    res.json({ status: 'success', message: 'Rule deleted' });
  } catch (error: any) {
    console.error('[SoD Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete SoD rule' });
  }
};
