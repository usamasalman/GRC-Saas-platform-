import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { checkSod, SodViolation } from './sodEngine';
import { getEffectivePermissions } from './capabilityEngine';

type TxClient = Prisma.TransactionClient;

/**
 * Generic workflow / automation engine (TRD §6.6).
 *
 * One state-machine service backs every module's approval routing instead of
 * each re-implementing it. A definition is a JSON array of steps; a run walks
 * them in order, materializing one WorkflowStepRun per step so there is always
 * a queryable record of who was asked and what they decided.
 *
 * Every human decision is capability-checked, SoD-checked and audit-logged.
 */

export type StepType = 'submit' | 'review' | 'approve' | 'notify' | 'wait' | 'task';

export interface WorkflowStepDef {
  key: string;
  type: StepType;
  name: string;
  /** Capability a user must hold to act on this step. */
  requiredCapability?: string;
  /** Explicit assignee; usually omitted in favour of requiredCapability. */
  assigneeId?: string;
  /** Resolve the assignee from the subject record, e.g. "requesterManager". */
  assignFrom?: string;
  /** Hours from activation until this step is overdue. */
  dueInHours?: number;
  /** SoD guarded action key checked before a decision is accepted. */
  sodGuardedAction?: string;
  /** For `wait` steps: how long to hold before auto-advancing. */
  waitHours?: number;
  /** Message for `notify` steps. */
  message?: string;
}

export class WorkflowError extends Error {
  readonly httpStatus: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkflowError';
    this.httpStatus = status;
  }
}

export function parseSteps(raw: string): WorkflowStepDef[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Steps a person must act on. The rest auto-advance. */
const INTERACTIVE: ReadonlySet<StepType> = new Set(['review', 'approve', 'task']);

// ─── Start a run ───────────────────────────────────────────────────────────

export async function startRun(
  tx: TxClient,
  args: {
    definitionId: string;
    tenantId: string;
    subjectType: string;
    subjectId: string;
    startedById: string;
  }
): Promise<{ runId: string; status: string; activeStep: WorkflowStepDef | null }> {
  const def = await tx.workflowDefinition.findUnique({ where: { id: args.definitionId } });
  if (!def) throw new WorkflowError('Workflow definition not found', 404);
  if (!def.isActive) throw new WorkflowError('Workflow definition is inactive', 409);

  const steps = parseSteps(def.steps);
  if (steps.length === 0) throw new WorkflowError('Workflow definition has no steps', 409);

  const run = await tx.workflowRun.create({
    data: {
      definitionId: def.id,
      tenantId: args.tenantId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      startedById: args.startedById,
      status: 'RUNNING',
      currentStep: 0,
    },
  });

  // Materialize every step up front so the whole route is inspectable.
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await tx.workflowStepRun.create({
      data: {
        runId: run.id,
        stepIndex: i,
        stepKey: s.key,
        stepType: s.type,
        name: s.name,
        status: 'PENDING',
        assigneeId: s.assigneeId || null,
        requiredCapability: s.requiredCapability || null,
        sodGuardedAction: s.sodGuardedAction || null,
      },
    });
  }

  await writeAudit(tx, {
    tenantId: args.tenantId,
    actorId: args.startedById,
    action: 'WORKFLOW_STARTED',
    subjectType: 'WorkflowRun',
    subjectId: run.id,
    payload: {
      definition: def.key,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      stepCount: steps.length,
    },
  });

  const advanced = await advance(tx, run.id);
  return { runId: run.id, status: advanced.status, activeStep: advanced.activeStep };
}

// ─── Advance past auto steps until an interactive one (or the end) ─────────

async function advance(
  tx: TxClient,
  runId: string
): Promise<{ status: string; activeStep: WorkflowStepDef | null }> {
  const run = await tx.workflowRun.findUnique({
    where: { id: runId },
    include: { definition: true },
  });
  if (!run) throw new WorkflowError('Workflow run not found', 404);

  const steps = parseSteps(run.definition.steps);
  let index = run.currentStep;

  while (index < steps.length) {
    const def = steps[index];
    const stepRun = await tx.workflowStepRun.findFirst({
      where: { runId, stepIndex: index },
    });
    if (!stepRun) break;

    if (INTERACTIVE.has(def.type)) {
      // Park here and wait for a human.
      if (stepRun.status === 'PENDING') {
        await tx.workflowStepRun.update({
          where: { id: stepRun.id },
          data: {
            status: 'ACTIVE',
            dueAt: def.dueInHours
              ? new Date(Date.now() + def.dueInHours * 3600_000)
              : null,
          },
        });
      }
      await tx.workflowRun.update({ where: { id: runId }, data: { currentStep: index } });
      return { status: 'RUNNING', activeStep: def };
    }

    // submit / notify / wait complete without human input.
    if (stepRun.status !== 'DONE') {
      await tx.workflowStepRun.update({
        where: { id: stepRun.id },
        data: { status: 'DONE', decidedAt: new Date(), decision: 'auto' },
      });
    }
    index++;
  }

  await tx.workflowRun.update({
    where: { id: runId },
    data: { currentStep: steps.length, status: 'COMPLETED', outcome: 'APPROVED', completedAt: new Date() },
  });
  return { status: 'COMPLETED', activeStep: null };
}

// ─── Record a human decision on the active step ────────────────────────────

export async function decide(
  tx: TxClient,
  args: {
    runId: string;
    userId: string;
    tenantId: string;
    decision: 'approve' | 'reject';
    comment?: string;
  }
): Promise<{ status: string; outcome: string | null; remainingSteps: number }> {
  const run = await tx.workflowRun.findUnique({
    where: { id: args.runId },
    include: { definition: true },
  });
  if (!run) throw new WorkflowError('Workflow run not found', 404);
  if (run.status !== 'RUNNING') {
    throw new WorkflowError(`Workflow is already ${run.status}`, 409);
  }

  const stepRun = await tx.workflowStepRun.findFirst({
    where: { runId: args.runId, stepIndex: run.currentStep },
  });
  if (!stepRun || stepRun.status !== 'ACTIVE') {
    throw new WorkflowError('No step is currently awaiting a decision', 409);
  }

  // Gate 1 — explicit assignee, when the definition named one.
  if (stepRun.assigneeId && stepRun.assigneeId !== args.userId) {
    throw new WorkflowError('This step is assigned to another user', 403);
  }

  // Gate 2 — capability.
  if (stepRun.requiredCapability) {
    const eff = await getEffectivePermissions(args.userId);
    if (!eff.capabilities.includes(stepRun.requiredCapability)) {
      throw new WorkflowError(
        `Your role "${eff.roleName}" does not grant "${stepRun.requiredCapability}"`,
        403
      );
    }
  }

  // Gate 3 — segregation of duties against the run's subject record.
  if (stepRun.sodGuardedAction) {
    await checkSod(tx, {
      tenantId: args.tenantId,
      actorId: args.userId,
      guardedAction: stepRun.sodGuardedAction,
      subjectType: run.subjectType,
      subjectId: run.subjectId,
    });
  }

  const approved = args.decision === 'approve';

  await tx.workflowStepRun.update({
    where: { id: stepRun.id },
    data: {
      status: approved ? 'APPROVED' : 'REJECTED',
      decision: args.decision,
      comment: args.comment || null,
      decidedById: args.userId,
      decidedAt: new Date(),
    },
  });

  await writeAudit(tx, {
    tenantId: args.tenantId,
    actorId: args.userId,
    action: approved ? 'WORKFLOW_STEP_APPROVED' : 'WORKFLOW_STEP_REJECTED',
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    payload: {
      runId: args.runId,
      step: stepRun.stepKey,
      stepIndex: stepRun.stepIndex,
      comment: args.comment || null,
    },
  });

  if (!approved) {
    // A rejection terminates the run; remaining steps are skipped, not deleted,
    // so the route that would have been taken stays visible.
    await tx.workflowStepRun.updateMany({
      where: { runId: args.runId, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: 'SKIPPED' },
    });
    await tx.workflowRun.update({
      where: { id: args.runId },
      data: { status: 'REJECTED', outcome: 'REJECTED', completedAt: new Date() },
    });
    return { status: 'REJECTED', outcome: 'REJECTED', remainingSteps: 0 };
  }

  await tx.workflowRun.update({
    where: { id: args.runId },
    data: { currentStep: run.currentStep + 1 },
  });
  const advanced = await advance(tx, args.runId);

  const remaining = await tx.workflowStepRun.count({
    where: { runId: args.runId, status: { in: ['PENDING', 'ACTIVE'] } },
  });

  if (advanced.status === 'COMPLETED') {
    await writeAudit(tx, {
      tenantId: args.tenantId,
      actorId: args.userId,
      action: 'WORKFLOW_COMPLETED',
      subjectType: run.subjectType,
      subjectId: run.subjectId,
      payload: { runId: args.runId, definition: run.definition.key },
    });
  }

  return {
    status: advanced.status,
    outcome: advanced.status === 'COMPLETED' ? 'APPROVED' : null,
    remainingSteps: remaining,
  };
}

// ─── Cancel ────────────────────────────────────────────────────────────────

export async function cancelRun(
  tx: TxClient,
  args: { runId: string; userId: string; tenantId: string; reason: string }
): Promise<void> {
  const run = await tx.workflowRun.findUnique({ where: { id: args.runId } });
  if (!run) throw new WorkflowError('Workflow run not found', 404);
  if (run.status !== 'RUNNING') throw new WorkflowError(`Workflow is already ${run.status}`, 409);

  await tx.workflowStepRun.updateMany({
    where: { runId: args.runId, status: { in: ['PENDING', 'ACTIVE'] } },
    data: { status: 'SKIPPED' },
  });
  await tx.workflowRun.update({
    where: { id: args.runId },
    data: { status: 'CANCELLED', outcome: 'CANCELLED', completedAt: new Date() },
  });
  await writeAudit(tx, {
    tenantId: args.tenantId,
    actorId: args.userId,
    action: 'WORKFLOW_CANCELLED',
    subjectType: run.subjectType,
    subjectId: run.subjectId,
    payload: { runId: args.runId, reason: args.reason },
  });
}

// ─── Inbox: steps awaiting a given user ────────────────────────────────────

export async function pendingStepsFor(userId: string, tenantIds: string[]) {
  const eff = await getEffectivePermissions(userId);

  const steps = await prisma.workflowStepRun.findMany({
    where: {
      status: 'ACTIVE',
      run: { tenantId: { in: tenantIds }, status: 'RUNNING' },
      OR: [
        { assigneeId: userId },
        { assigneeId: null, requiredCapability: { in: eff.capabilities } },
        { assigneeId: null, requiredCapability: null },
      ],
    },
    include: {
      run: {
        include: {
          definition: { select: { key: true, name: true, subjectType: true } },
          tenant: { select: { id: true, name: true } },
          startedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });

  const now = Date.now();
  return steps.map((s) => ({
    stepRunId: s.id,
    runId: s.runId,
    stepKey: s.stepKey,
    stepType: s.stepType,
    name: s.name,
    dueAt: s.dueAt,
    overdue: !!s.dueAt && s.dueAt.getTime() < now,
    requiredCapability: s.requiredCapability,
    subjectType: s.run.subjectType,
    subjectId: s.run.subjectId,
    workflowName: s.run.definition.name,
    tenantName: s.run.tenant.name,
    startedBy: s.run.startedBy,
  }));
}

export { SodViolation };
