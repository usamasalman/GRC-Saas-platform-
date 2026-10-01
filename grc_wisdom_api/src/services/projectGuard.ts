import { Response } from 'express';
import { prisma } from '../db';
import { resolveTenantScope, ScopeActor, TenantScope } from './scopeResolver';
import { canReadProject, canWriteProject, sideOf } from './projectAccess';
import { EngagementAction, roleMay, roleRefusal, accessOpen } from './engagementRules';
import { recordShadow } from './engagementShadow';
import { isEnforcedFor } from './engagementEnforcement';

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
  /** ClientLed | ConsultantLed on a consulting engagement; null otherwise. */
  deliveryStyle: string | null;
  /** Set when the engagement was migrated from naming a firm the old way (S6). */
  migratedAt: Date | null;
}

/** The engagement fields the firm-side checks need. */
export interface EngagementRules {
  id: string; tenantId: string; providerTenantId: string | null; deliveryStyle: string | null;
  status: string; migratedAt: Date | null;
}

/**
 * How an engagement's consulting rules apply to its delivery firm (sprint 6):
 *
 *   enforced  a firm that joined by invitation, from the start (sprints 4 and
 *             5); an engagement named the old way, or migrated from one, once
 *             the client's rules are enforced;
 *   shadow    those two before then: the firm works as before and what the
 *             rules would refuse is counted;
 *   asBefore  a closed engagement named the old way, which keeps its access
 *             until the after-close rules (sprint 7).
 */
export type Regime = 'enforced' | 'shadow' | 'asBefore';

export async function regimeFor(p: Pick<EngagementRules, 'tenantId' | 'deliveryStyle' | 'migratedAt' | 'status'>): Promise<Regime> {
  if (p.deliveryStyle && !p.migratedAt) return 'enforced';
  if (!p.deliveryStyle && (p.status === 'Closed' || p.status === 'Cancelled')) return 'asBefore';
  return (await isEnforcedFor(p.tenantId)) ? 'enforced' : 'shadow';
}

export interface ProjectGuard {
  /** Null when the project does not exist, or exists and is not visible. */
  project: GuardedProject | null;
  canWrite: boolean;
  side: 'Client' | 'Provider' | null;
  scope: TenantScope;
}

/**
 * Whether the caller may read this engagement at all.
 *
 * The organisation's side and a firm on an engagement named the old way read
 * it as before. On a consulting engagement (one with a delivery style) a
 * person from the firm reads it only once the organisation has approved them:
 * a nominee, a person turned down or removed, and the rest of the firm get the
 * same 404 as for an engagement that does not exist (consulting engagement,
 * sprint 4). Switching the flag off takes nothing away from people approved.
 */
export async function canReadEngagement(
  scope: TenantScope,
  userId: string,
  project: EngagementRules,
): Promise<boolean> {
  if (scope.tenantIds.includes(project.tenantId)) return true;
  if (!canReadProject(scope, project)) return false;

  // The firm's side from here. While the engagement is held with "Firm has
  // no access", the firm reads nothing; with "Firm can view" it reads, and
  // changes nothing (firmRefusal). Sprint 5.
  if (project.status === 'OnHold' && await firmShutOut(project.id)) return false;

  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
    select: { side: true, memberStatus: true, active: true, accessFrom: true, accessTo: true },
  });
  const approved = Boolean(m && m.active && m.side === 'Provider' && m.memberStatus === 'Approved');
  const regime = await regimeFor(project);
  if (regime === 'asBefore') return true;
  // An approved member inside their window, checked on every request: dates
  // the organisation set are enforced, not shadowed.
  if (regime === 'enforced') return approved && accessOpen(m!);

  // Shadow: read as before, and counted where enforcement would refuse it,
  // so the organisation can see that before it switches enforcement on.
  if (!approved || !accessOpen(m!)) {
    recordShadow({
      projectId: project.id, clientTenantId: project.tenantId, firmTenantId: project.providerTenantId,
      rule: approved ? 'outside-window' : 'member-required',
    });
  }
  return true;
}

/** Whether the current hold keeps the delivery firm out entirely. */
async function firmShutOut(projectId: string): Promise<boolean> {
  const hold = await prisma.projectHold.findFirst({
    where: { projectId, endedAt: null }, orderBy: { startedAt: 'desc' }, select: { firmAccess: true },
  });
  return hold?.firmAccess === 'None';
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
      baselineSetAt: true, baselineVersion: true, deliveryStyle: true, migratedAt: true,
    },
  });

  if (!project || !(await canReadEngagement(scope, String(caller.id), project))) {
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

// ─── The firm's role on a consulting engagement ─────────────────────────────

/** Whether this caller acts for the firm on a consulting engagement. */
export function actsForFirm(
  project: { tenantId: string; providerTenantId: string | null; deliveryStyle: string | null },
  user: { tenantId: string },
): boolean {
  return Boolean(project.deliveryStyle && project.providerTenantId
    && user.tenantId === project.providerTenantId && user.tenantId !== project.tenantId);
}

/**
 * The refusal when the firm's person may not take this action on a consulting
 * engagement, by their engagement role; null when they may, and always null
 * on the organisation's side or on an engagement named the old way.
 */
export async function firmRefusal(
  project: EngagementRules,
  user: { id: string; tenantId: string },
  action: EngagementAction,
): Promise<{ status: number; code: string; message: string } | null> {
  const firmSide = Boolean(project.providerTenantId && user.tenantId === project.providerTenantId
    && user.tenantId !== project.tenantId);
  if (!firmSide) return null;

  // Held: the firm reads (where the organisation chose "Firm can view") and
  // changes nothing, whatever its role, on any engagement it delivers (S5).
  if (project.status === 'OnHold' && action !== 'read') {
    return {
      status: 403,
      code: 'ON_HOLD_READ_ONLY',
      message: 'This engagement is on hold. The firm can view it and change nothing until it resumes.',
    };
  }

  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
    select: { engagementRole: true, memberStatus: true, active: true, accessFrom: true, accessTo: true },
  });
  const role = m && m.active && m.memberStatus === 'Approved' && accessOpen(m) ? m.engagementRole : null;

  const regime = await regimeFor(project);
  if (regime === 'enforced') return roleMay(role, action) ? null : roleRefusal(role, action);
  // Shadow: allowed as before, counted where enforcement would refuse it.
  if (regime === 'shadow' && !roleMay(role, action)) {
    recordShadow({
      projectId: project.id, clientTenantId: project.tenantId, firmTenantId: project.providerTenantId,
      rule: 'role-required',
    });
  }
  return null;
}

/** Approving, verifying and accepting stay with the organisation's own people. */
export const clientDecides = (res: Response): void => {
  res.status(403).json({
    status: 'error',
    code: 'CLIENT_DECIDES',
    message: 'Approving and verifying work on this engagement stays with the organisation\'s own people.',
  });
};

export const refuse = (res: Response, r: { status: number; code: string; message: string }): void => {
  res.status(r.status).json({ status: 'error', code: r.code, message: r.message });
};
