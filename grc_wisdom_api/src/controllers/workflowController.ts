import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { resolveTenantScope } from '../services/scopeResolver';
import {
  decide, cancelRun, pendingStepsFor, parseSteps, WorkflowError,
} from '../services/workflowEngine';
import { SodViolation } from '../services/sodEngine';

// ─── Definitions ───────────────────────────────────────────────────────────

export const listDefinitions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const defs = await prisma.workflowDefinition.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: {
        tenant: { select: { name: true } },
        _count: { select: { runs: true, catalogItems: true } },
      },
      orderBy: [{ subjectType: 'asc' }, { name: 'asc' }],
    });

    res.json({
      status: 'success',
      count: defs.length,
      definitions: defs.map((d) => ({
        id: d.id, key: d.key, name: d.name, description: d.description,
        subjectType: d.subjectType, isActive: d.isActive, isSystem: d.isSystem,
        steps: parseSteps(d.steps),
        scopeLabel: d.tenantId ? d.tenant?.name || 'Tenant' : 'Platform',
        runCount: d._count.runs,
        usedByCatalogItems: d._count.catalogItems,
      })),
    });
  } catch (error: any) {
    console.error('[Workflow Definitions Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list workflow definitions' });
  }
};

// ─── Runs ──────────────────────────────────────────────────────────────────

export const listRuns = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const { status, subjectType } = req.query as Record<string, string | undefined>;

    const where: any = { tenantId: { in: scope.tenantIds } };
    if (status) where.status = status;
    if (subjectType) where.subjectType = subjectType;

    const runs = await prisma.workflowRun.findMany({
      where,
      include: {
        definition: { select: { key: true, name: true } },
        tenant: { select: { name: true } },
        startedBy: { select: { id: true, name: true, email: true } },
        stepRuns: {
          include: { decidedBy: { select: { name: true } }, assignee: { select: { name: true } } },
          orderBy: { stepIndex: 'asc' },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: runs.length,
      totals: {
        running: runs.filter((r) => r.status === 'RUNNING').length,
        completed: runs.filter((r) => r.status === 'COMPLETED').length,
        rejected: runs.filter((r) => r.status === 'REJECTED').length,
      },
      runs,
    });
  } catch (error: any) {
    console.error('[Workflow Runs Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list workflow runs' });
  }
};

export const getRun = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const run = await prisma.workflowRun.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        definition: true,
        startedBy: { select: { id: true, name: true, email: true } },
        stepRuns: {
          include: {
            decidedBy: { select: { name: true, email: true } },
            assignee: { select: { name: true, email: true } },
          },
          orderBy: { stepIndex: 'asc' },
        },
      },
    });
    if (!run) { res.status(404).json({ status: 'error', message: 'Workflow run not found' }); return; }
    res.json({ status: 'success', run: { ...run, definition: { ...run.definition, steps: parseSteps(run.definition.steps) } } });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch workflow run' });
  }
};

// ─── Decide (the single approval path used by every module) ────────────────

export const decideRun = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { decision, comment } = req.body || {};
    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ status: 'error', message: "decision must be 'approve' or 'reject'" });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const run = await prisma.workflowRun.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!run) { res.status(404).json({ status: 'error', message: 'Workflow run not found' }); return; }

    const result = await prisma.$transaction(async (tx) => {
      const r = await decide(tx, {
        runId: id,
        userId: req.user!.id,
        tenantId: run.tenantId,
        decision,
        comment,
      });

      // Reflect the outcome back onto the subject record.
      if (run.subjectType === 'Ticket') {
        if (r.status === 'REJECTED') {
          await tx.ticket.updateMany({ where: { id: run.subjectId }, data: { status: 'Cancelled', resolvedAt: new Date() } });
        } else if (r.status === 'COMPLETED') {
          await tx.ticket.updateMany({ where: { id: run.subjectId }, data: { status: 'In Progress' } });
        }
      }
      return r;
    });

    res.json({
      status: 'success',
      message: result.status === 'COMPLETED'
        ? 'Final approval recorded — workflow complete.'
        : result.status === 'REJECTED'
          ? 'Rejected. The workflow is closed.'
          : `Approval recorded. ${result.remainingSteps} step(s) remaining.`,
      workflowStatus: result.status,
      remainingSteps: result.remainingSteps,
    });
  } catch (error: any) {
    if (error instanceof SodViolation) {
      res.status(403).json({ status: 'error', code: error.code, rule: error.ruleKey, message: error.message });
      return;
    }
    if (error instanceof WorkflowError) {
      res.status(error.httpStatus).json({ status: 'error', message: error.message });
      return;
    }
    console.error('[Workflow Decide Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record decision' });
  }
};

export const cancel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    if (!reason) { res.status(400).json({ status: 'error', message: 'reason is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const run = await prisma.workflowRun.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!run) { res.status(404).json({ status: 'error', message: 'Workflow run not found' }); return; }

    await prisma.$transaction(async (tx) => {
      await cancelRun(tx, { runId: id, userId: req.user!.id, tenantId: run.tenantId, reason });
    });
    res.json({ status: 'success', message: 'Workflow cancelled' });
  } catch (error: any) {
    if (error instanceof WorkflowError) {
      res.status(error.httpStatus).json({ status: 'error', message: error.message });
      return;
    }
    res.status(500).json({ status: 'error', message: 'Failed to cancel workflow' });
  }
};

// ─── My inbox — every pending decision across every module ─────────────────

export const myInbox = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const steps = await pendingStepsFor(req.user!.id, scope.tenantIds);
    res.json({
      status: 'success',
      count: steps.length,
      overdue: steps.filter((s) => s.overdue).length,
      steps,
    });
  } catch (error: any) {
    console.error('[Workflow Inbox Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load approval inbox' });
  }
};
