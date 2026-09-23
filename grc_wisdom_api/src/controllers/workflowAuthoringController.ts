/**
 * Authoring a workflow definition, and setting SLA targets.
 *
 * The rules are in services/workflowAuthoring and run without a database.
 * This does the loading, the writing and the audit entry.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import {
  planDefinition, planSlaPolicy, prioritiesWithoutPolicy,
  STEP_TYPES, SUBJECT_TYPES, PRIORITIES, MAX_STEPS, MAX_TARGET_MINS,
} from '../services/workflowAuthoring';
import rbacData from '../utils/rbacData.json';

const SUBJECT_DEFINITION = 'WorkflowDefinition';
const SUBJECT_SLA = 'SlaPolicy';

const str = (v: unknown): string => String(v ?? '');

/**
 * Every capability this platform defines.
 *
 * Read from the role matrix rather than from CAP, because a step may require
 * any granted capability and CAP carries only the ones a route guards. A step
 * naming something outside this list could never be actioned by anybody.
 */
const KNOWN_CAPABILITIES: string[] = ((rbacData as any).capabilities || [])
  .map((c: any) => String(c.key))
  .filter(Boolean);

/** What the authoring screen needs to offer valid choices. */
export const authoringOptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({
      status: 'success',
      stepTypes: STEP_TYPES,
      subjectTypes: SUBJECT_TYPES,
      priorities: PRIORITIES,
      maxSteps: MAX_STEPS,
      maxTargetMins: MAX_TARGET_MINS,
      // Served rather than assembled in the browser, so the list a step can
      // name is the same list the server validates against.
      capabilities: ((rbacData as any).capabilities || []).map((c: any) => ({
        key: c.key, name: c.name, module: c.module,
      })),
    });
  } catch (error: any) {
    console.error('[Authoring Options Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load authoring options' });
  }
};

// ─── Workflow definitions ───────────────────────────────────────────────────

export const createDefinition = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    // Platform definitions (tenantId null) and this tenant's own both occupy
    // the key space a run resolves against, so both count as taken.
    const existing = await prisma.workflowDefinition.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      select: { key: true },
    });

    const plan = planDefinition({
      key: req.body?.key,
      name: req.body?.name,
      subjectType: req.body?.subjectType,
      steps: req.body?.steps,
      knownCapabilities: KNOWN_CAPABILITIES,
      takenKeys: existing.map((d) => d.key),
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.workflowDefinition.create({
        data: {
          tenantId,
          key: plan.key,
          name: plan.name,
          description: str(req.body?.description).trim() || null,
          subjectType: plan.subjectType,
          steps: JSON.stringify(plan.steps),
          isActive: req.body?.isActive !== false,
          isSystem: false,
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'WORKFLOW_DEFINITION_CREATED',
        subjectType: SUBJECT_DEFINITION,
        subjectId: row.id,
        payload: {
          key: row.key,
          name: row.name,
          about: row.subjectType,
          stepCount: plan.steps.length,
          // Named, because who may act on each step is the substance of the
          // workflow and the reason this carries its own capability.
          steps: plan.steps.map((s) => ({
            key: s.key, type: s.type, requiredCapability: s.requiredCapability ?? null,
          })),
        },
      });
      return row;
    });

    res.status(201).json({ status: 'success', definition: created });
  } catch (error: any) {
    console.error('[Workflow Definition Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create the workflow' });
  }
};

export const updateDefinition = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const scope = await resolveTenantScope(req.user!);
    const current = await prisma.workflowDefinition.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { _count: { select: { runs: true } } },
    });
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Workflow not found' });
      return;
    }

    const others = await prisma.workflowDefinition.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }], id: { not: id } },
      select: { key: true },
    });

    const plan = planDefinition({
      key: req.body?.key ?? current.key,
      name: req.body?.name ?? current.name,
      subjectType: req.body?.subjectType ?? current.subjectType,
      steps: req.body?.steps ?? current.steps,
      knownCapabilities: KNOWN_CAPABILITIES,
      takenKeys: others.map((d) => d.key),
      isSystem: current.isSystem,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.workflowDefinition.update({
        where: { id },
        data: {
          key: plan.key,
          name: plan.name,
          description: req.body?.description === undefined
            ? current.description
            : (str(req.body?.description).trim() || null),
          subjectType: plan.subjectType,
          steps: JSON.stringify(plan.steps),
          isActive: req.body?.isActive === undefined ? current.isActive : req.body.isActive !== false,
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'WORKFLOW_DEFINITION_UPDATED',
        subjectType: SUBJECT_DEFINITION,
        subjectId: id,
        payload: {
          key: row.key,
          was: { stepCount: JSON.parse(current.steps || '[]').length, isActive: current.isActive },
          now: { stepCount: plan.steps.length, isActive: row.isActive },
          // Runs already in flight keep the steps they started with, because
          // WorkflowStepRun rows were written when the run began. Recorded so
          // nobody reads a changed definition as a changed history.
          runsInFlightUnchanged: current._count.runs,
        },
      });
      return row;
    });

    res.json({
      status: 'success',
      definition: updated,
      note: current._count.runs > 0
        ? `${current._count.runs} run${current._count.runs === 1 ? '' : 's'} already started keep the steps they began with. Only new runs follow this version.`
        : null,
    });
  } catch (error: any) {
    console.error('[Workflow Definition Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the workflow' });
  }
};

// ─── SLA policies ───────────────────────────────────────────────────────────

export const listSlaPolicies = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const policies = await prisma.slaPolicy.findMany({
      where: { OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ priority: 'asc' }],
    });

    res.json({
      status: 'success',
      count: policies.length,
      priorities: PRIORITIES,
      policies: policies.map((p) => ({
        id: p.id,
        priority: p.priority,
        responseMins: p.responseMins,
        resolveMins: p.resolveMins,
        scopeLabel: p.tenantId ? 'This organisation' : 'Platform default',
        editable: p.tenantId === tenantId,
      })),
      // Every SLA figure on the escalations screen is measured against these.
      // A priority with no policy is measured against nothing while still
      // appearing on the board as though it were tracked.
      withoutPolicy: prioritiesWithoutPolicy(policies),
    });
  } catch (error: any) {
    console.error('[SLA Policy List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load SLA policies' });
  }
};

/**
 * One call for both create and change.
 *
 * A policy is identified by its priority within a tenant -- the schema says so
 * with @@unique([tenantId, priority]) -- so "set the P2 target" is one
 * operation, not a create the caller has to know is a create.
 */
export const setSlaPolicy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    const plan = planSlaPolicy({
      priority: req.body?.priority,
      responseMins: req.body?.responseMins,
      resolveMins: req.body?.resolveMins,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const before = await prisma.slaPolicy.findFirst({
      where: { tenantId, priority: plan.priority },
      select: { responseMins: true, resolveMins: true },
    });

    const saved = await prisma.$transaction(async (tx) => {
      const row = await tx.slaPolicy.upsert({
        where: { tenantId_priority: { tenantId, priority: plan.priority } },
        create: {
          tenantId,
          priority: plan.priority,
          responseMins: plan.responseMins,
          resolveMins: plan.resolveMins,
        },
        update: { responseMins: plan.responseMins, resolveMins: plan.resolveMins },
      });

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: before ? 'SLA_POLICY_UPDATED' : 'SLA_POLICY_CREATED',
        subjectType: SUBJECT_SLA,
        subjectId: row.id,
        // The old targets are in the entry because changing an SLA changes
        // whether tickets already open are breaching, and the figure on the
        // board moves without any ticket changing.
        payload: {
          priority: plan.priority,
          was: before ? { responseMins: before.responseMins, resolveMins: before.resolveMins } : null,
          now: { responseMins: plan.responseMins, resolveMins: plan.resolveMins },
        },
      });
      return row;
    });

    res.json({
      status: 'success',
      policy: saved,
      note: before
        ? 'Tickets already open are measured against the new targets from now on, so the breach figures may move without any ticket changing.'
        : null,
    });
  } catch (error: any) {
    console.error('[SLA Policy Set Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save the SLA policy' });
  }
};
