import { Response } from 'express';
import { prisma } from '../db';
import { resolveTenantScope, ScopeActor, TenantScope } from './scopeResolver';
import { canReadProject, canWriteProject, sideOf } from './projectAccess';

/**
 * Load a delivery project and decide what a caller may do with it.
 *
 * Every handler in projectPlanController and projectVerificationController
 * begins this way, and the alternative — each one remembering to check read and
 * write separately — is exactly how the cross-tenant hole in usageController
 * happened. One function, one answer, no handler holding its own opinion.
 *
 * projectAccess.ts stays pure so the access rules can be tested without a
 * database; this is the thin layer that fetches the row and applies them.
 */

export interface GuardedProject {
  id: string;
  tenantId: string;
  providerTenantId: string | null;
  ref: string;
  name: string;
  status: string;
  verificationPolicy: string;
  /** Who to tell when something needs a decision. Accountable for delivery. */
  ownerId: string;
  managerId: string;
  /** Null until the plan is agreed. Slice 4 measures slippage against it. */
  baselineSetAt: Date | null;
  baselineVersion: number;
}

export interface ProjectGuard {
  /** Null when the project does not exist, or exists and is not visible. */
  project: GuardedProject | null;
  canWrite: boolean;
  side: 'Client' | 'Provider' | null;
  scope: TenantScope;
}

export async function guardProject(
  caller: ScopeActor,
  projectId: string,
): Promise<ProjectGuard> {
  const scope = await resolveTenantScope(caller);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, tenantId: true, providerTenantId: true,
      ref: true, name: true, status: true, verificationPolicy: true,
      ownerId: true, managerId: true,
      baselineSetAt: true, baselineVersion: true,
    },
  });

  if (!project || !canReadProject(scope, project)) {
    return { project: null, canWrite: false, side: null, scope };
  }
  return {
    project,
    canWrite: canWriteProject(scope, project.tenantId),
    side: sideOf(scope, project),
    scope,
  };
}

// ─── Standard refusals ──────────────────────────────────────────────────────

/** Not found and not permitted read the same, so a 403 cannot confirm existence. */
export const notFound = (res: Response): void => {
  res.status(404).json({ status: 'error', message: 'Project not found' });
};

export const readOnly = (res: Response): void => {
  res.status(403).json({
    status: 'error',
    code: 'READ_ONLY_ENGAGEMENT',
    message: 'You can view this engagement but not change it.',
  });
};

/** Closed work is a record. Adding to it after the fact would rewrite history. */
export function isFrozen(status: string): boolean {
  return status === 'Closed' || status === 'Cancelled';
}

/**
 * A held engagement's work stops: no task changes status or progress, and no
 * evidence, verification or blocker is recorded until it resumes. Planning
 * goes on — phases, tasks, dates, links and clauses can still be adjusted —
 * so the restart is ready. The hold's days are nobody's delay, and work
 * recorded inside them would blur exactly that (consulting engagement, S1).
 */
export function isHeld(status: string): boolean {
  return status === 'OnHold';
}

export const held = (res: Response): void => {
  res.status(409).json({
    status: 'error',
    code: 'PROJECT_ON_HOLD',
    message: 'This engagement is on hold, so work is paused until it resumes. The plan can still be adjusted.',
  });
};

export const frozen = (res: Response, projectStatus: string): void => {
  res.status(409).json({
    status: 'error',
    code: 'PROJECT_FROZEN',
    message: `This project is ${projectStatus}. Reopen it before changing the plan.`,
  });
};
