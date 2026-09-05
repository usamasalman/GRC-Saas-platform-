import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { projectWhere, canWriteProject, canReadProject, sideOf } from '../services/projectAccess';

/**
 * Delivery projects — slice 1.
 *
 * The engagement itself: create it, find it, change it, close it. Phases, tasks
 * and verification arrive in later slices and will extend this file rather than
 * replace it.
 *
 * Every handler here does the same four things in the same order — resolve
 * scope, authorise, mutate inside a transaction, write one audit entry — and
 * nothing else. Business rules that grow beyond a line or two move to a service.
 */

const str = (v: unknown): string => String(v ?? '');

/** Draft is where a project starts; the rest are reachable only by transition. */
const STATUSES = ['Draft', 'Active', 'OnHold', 'Closed', 'Cancelled'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
const HEALTH = ['Green', 'Amber', 'Red'] as const;
const TYPES = ['Certification', 'Readiness', 'Remediation', 'Implementation', 'Assessment'] as const;

/**
 * Legal status moves. Closed and Cancelled are terminal — a finished engagement
 * that can be quietly reopened is not evidence of anything.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ['Active', 'Cancelled'],
  Active: ['OnHold', 'Closed', 'Cancelled'],
  OnHold: ['Active', 'Cancelled'],
  Closed: [],
  Cancelled: [],
};

/** PRJ-0001, sequential per client tenant. Matches assetController's convention. */
async function nextRef(tenantId: string): Promise<string> {
  const count = await prisma.project.count({ where: { tenantId } });
  return `PRJ-${String(count + 1).padStart(4, '0')}`;
}

/** Whole days between two dates, inclusive of the start. */
const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));

/**
 * The time figures section 1 asks for, derived rather than stored — they change
 * every day on their own, and a stored copy would be wrong by morning.
 */
function schedule(p: { startDate: Date; targetEndDate: Date; actualEndDate: Date | null; status: string }) {
  const now = new Date();
  const totalDays = daysBetween(p.startDate, p.targetEndDate);
  const endedAt = p.actualEndDate ?? now;
  const elapsedDays = Math.min(totalDays, daysBetween(p.startDate, endedAt));
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const overdue = !p.actualEndDate && now > p.targetEndDate && p.status !== 'Closed' && p.status !== 'Cancelled';

  return {
    totalDays,
    elapsedDays,
    remainingDays,
    /** How far through the calendar we are, which is not how far through the work. */
    elapsedPercent: totalDays === 0 ? 100 : Math.round((elapsedDays / totalDays) * 100),
    overdue,
    daysOverdue: overdue ? daysBetween(p.targetEndDate, now) : 0,
  };
}

/**
 * On Track | At Risk | Delayed | Completed, per section 1.
 *
 * Derived from schedule against progress, never stored: a project drifts into
 * At Risk by the passage of time, with nobody touching it. `health` remains the
 * manager's separate judgement and is not overridden here.
 */
function derivedStatus(
  p: { status: string; reportedProgress: number },
  s: ReturnType<typeof schedule>,
): 'OnTrack' | 'AtRisk' | 'Delayed' | 'Completed' | 'NotStarted' {
  if (p.status === 'Closed') return 'Completed';
  if (p.status === 'Draft') return 'NotStarted';
  if (s.overdue) return 'Delayed';
  // Burning calendar materially faster than work is the earliest honest signal
  // that a date is in trouble.
  if (s.elapsedPercent - p.reportedProgress >= 20) return 'AtRisk';
  return 'OnTrack';
}

const LIST_SELECT = {
  id: true, ref: true, name: true, projectType: true, priority: true, status: true,
  health: true, healthNote: true, reportedProgress: true, verifiedProgress: true,
  startDate: true, targetEndDate: true, actualEndDate: true, frameworks: true,
  tenantId: true, providerTenantId: true, createdAt: true,
  owner: { select: { id: true, name: true, email: true } },
  manager: { select: { id: true, name: true, email: true } },
  tenant: { select: { id: true, name: true } },
  providerTenant: { select: { id: true, name: true } },
  _count: { select: { members: true } },
} as const;

/** Adds the derived figures no column should hold. */
function decorate(p: any, scope: any) {
  const s = schedule(p);
  return {
    ...p,
    frameworks: safeParseArray(p.frameworks),
    schedule: s,
    derivedStatus: derivedStatus(p, s),
    side: sideOf(scope, p),
    memberCount: p._count?.members ?? 0,
    _count: undefined,
  };
}

function safeParseArray(v: string): string[] {
  try {
    const parsed = JSON.parse(v || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ─── List ───────────────────────────────────────────────────────────────────

export const listProjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    await auditCrossTenantRead(scope, str(req.user!.id), 'project.list');

    const { status, search } = req.query as Record<string, string | undefined>;

    const where: any = { AND: [projectWhere(scope)] };
    if (status) where.AND.push({ status });
    if (search) {
      where.AND.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { ref: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const projects = await prisma.project.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ status: 'asc' }, { targetEndDate: 'asc' }],
      take: 200,
    });

    const decorated = projects.map((p) => decorate(p, scope));

    res.json({
      status: 'success',
      scope: scope.kind,
      count: decorated.length,
      // The dashboard headline from section 4, counted once here rather than in
      // the browser, so every client agrees on the numbers.
      totals: {
        active: decorated.filter((p) => p.status === 'Active').length,
        atRisk: decorated.filter((p) => p.derivedStatus === 'AtRisk').length,
        delayed: decorated.filter((p) => p.derivedStatus === 'Delayed').length,
        completed: decorated.filter((p) => p.derivedStatus === 'Completed').length,
      },
      projects: decorated,
    });
  } catch (error: any) {
    console.error('[Project List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list projects' });
  }
};

// ─── Read one ───────────────────────────────────────────────────────────────

export const getProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const id = str(req.params.id);

    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        description: true, objectives: true, closureNote: true, updatedAt: true,
        sponsor: { select: { id: true, name: true, email: true } },
        members: {
          where: { active: true },
          select: {
            id: true, side: true, roleLabel: true, raci: true, allocation: true,
            user: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { addedAt: 'asc' },
        },
      },
    });

    // Not found and not permitted are the same answer on purpose: a 403 here
    // would confirm the project exists to someone with no right to know.
    if (!project || !canReadProject(scope, project)) {
      res.status(404).json({ status: 'error', message: 'Project not found' });
      return;
    }

    res.json({ status: 'success', project: decorate(project, scope) });
  } catch (error: any) {
    console.error('[Project Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load project' });
  }
};

// ─── Create ─────────────────────────────────────────────────────────────────

export const createProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const {
      name, description, objectives, projectType, priority, frameworks,
      startDate, targetEndDate, ownerId, managerId, sponsorId,
      tenantId: bodyTenantId, providerTenantId,
    } = req.body || {};

    if (!name || !startDate || !targetEndDate || !ownerId || !managerId) {
      res.status(400).json({
        status: 'error',
        message: 'name, startDate, targetEndDate, ownerId and managerId are required',
      });
      return;
    }

    // Defaults to the caller's own tenant. A platform operator may name another,
    // which canWriteProject then has to allow.
    const tenantId = str(bodyTenantId || req.user!.tenantId);
    if (!canWriteProject(scope, tenantId)) {
      res.status(403).json({
        status: 'error',
        code: 'OUT_OF_SCOPE',
        message: 'You cannot create a project for that organisation.',
      });
      return;
    }

    const start = new Date(startDate);
    const target = new Date(targetEndDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) {
      res.status(400).json({ status: 'error', message: 'startDate and targetEndDate must be valid dates' });
      return;
    }
    if (target <= start) {
      res.status(400).json({ status: 'error', message: 'targetEndDate must be after startDate' });
      return;
    }

    if (projectType && !TYPES.includes(projectType)) {
      res.status(400).json({ status: 'error', message: `projectType must be one of: ${TYPES.join(', ')}` });
      return;
    }
    if (priority && !PRIORITIES.includes(priority)) {
      res.status(400).json({ status: 'error', message: `priority must be one of: ${PRIORITIES.join(', ')}` });
      return;
    }

    // Owner and manager must be real users inside the client organisation. A
    // project accountable to somebody in another tenant is not accountable.
    const people = await prisma.user.findMany({
      where: { id: { in: [str(ownerId), str(managerId)] }, tenantId },
      select: { id: true },
    });
    if (people.length < new Set([str(ownerId), str(managerId)]).size) {
      res.status(400).json({
        status: 'error',
        message: 'Owner and manager must both be users of the owning organisation.',
      });
      return;
    }

    const ref = await nextRef(tenantId);

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          tenantId,
          providerTenantId: providerTenantId ? str(providerTenantId) : null,
          ref,
          name: str(name).trim(),
          description: description ? str(description) : null,
          objectives: objectives ? str(objectives) : null,
          projectType: projectType || 'Readiness',
          priority: priority || 'Medium',
          frameworks: JSON.stringify(Array.isArray(frameworks) ? frameworks.map(String) : []),
          startDate: start,
          targetEndDate: target,
          ownerId: str(ownerId),
          managerId: str(managerId),
          sponsorId: sponsorId ? str(sponsorId) : null,
        },
        select: LIST_SELECT,
      });

      // Owner and manager are on the team by definition. Making that implicit
      // would mean a project whose own manager is not a member of it.
      await tx.projectMember.createMany({
        data: Array.from(new Set([str(ownerId), str(managerId)])).map((userId) => ({
          projectId: project.id,
          userId,
          side: 'Client',
          roleLabel: userId === str(ownerId) ? 'Project Owner' : 'Project Manager',
          raci: 'A',
        })),
        skipDuplicates: true,
      });

      await writeAudit(tx, {
        tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_CREATED',
        subjectType: 'Project',
        subjectId: project.id,
        payload: { ref, name: project.name, projectType: project.projectType, targetEndDate },
      });

      return project;
    });

    res.status(201).json({ status: 'success', project: decorate(created, scope) });
  } catch (error: any) {
    console.error('[Project Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create project' });
  }
};

// ─── Update ─────────────────────────────────────────────────────────────────

export const updateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const id = str(req.params.id);

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, tenantId: true, providerTenantId: true, ref: true, status: true },
    });
    if (!existing || !canReadProject(scope, existing)) {
      res.status(404).json({ status: 'error', message: 'Project not found' });
      return;
    }
    if (!canWriteProject(scope, existing.tenantId)) {
      res.status(403).json({
        status: 'error',
        code: 'READ_ONLY_ENGAGEMENT',
        message: 'You can view this engagement but not change it.',
      });
      return;
    }

    const b = req.body || {};
    const data: any = {};

    if (b.name !== undefined) data.name = str(b.name).trim();
    if (b.description !== undefined) data.description = b.description ? str(b.description) : null;
    if (b.objectives !== undefined) data.objectives = b.objectives ? str(b.objectives) : null;
    if (b.healthNote !== undefined) data.healthNote = b.healthNote ? str(b.healthNote) : null;
    if (b.sponsorId !== undefined) data.sponsorId = b.sponsorId ? str(b.sponsorId) : null;
    if (b.frameworks !== undefined) {
      data.frameworks = JSON.stringify(Array.isArray(b.frameworks) ? b.frameworks.map(String) : []);
    }

    // Typed as readonly string[] rather than `as const`: a union of literal
    // tuples narrows the argument of `includes` to their intersection, which is
    // never, and the check stops compiling.
    const ENUM_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['priority', PRIORITIES], ['health', HEALTH], ['projectType', TYPES],
    ];

    for (const [field, allowed] of ENUM_FIELDS) {
      if (b[field] !== undefined) {
        if (!allowed.includes(b[field])) {
          res.status(400).json({ status: 'error', message: `${field} must be one of: ${allowed.join(', ')}` });
          return;
        }
        data[field] = b[field];
      }
    }

    if (b.targetEndDate !== undefined) {
      const t = new Date(b.targetEndDate);
      if (Number.isNaN(t.getTime())) {
        res.status(400).json({ status: 'error', message: 'targetEndDate must be a valid date' });
        return;
      }
      data.targetEndDate = t;
    }

    // Status changes go through the transition table. Closure has its own
    // endpoint because it needs a reason and stamps the completion date.
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${STATUSES.join(', ')}` });
        return;
      }
      if (b.status === 'Closed' || b.status === 'Cancelled') {
        res.status(400).json({
          status: 'error',
          code: 'USE_CLOSE_ENDPOINT',
          message: 'Close or cancel a project through POST /api/projects/:id/close, which records why.',
        });
        return;
      }
      if (b.status !== existing.status && !TRANSITIONS[existing.status]?.includes(b.status)) {
        res.status(409).json({
          status: 'error',
          code: 'ILLEGAL_TRANSITION',
          message: `A project cannot move from ${existing.status} to ${b.status}.`,
        });
        return;
      }
      data.status = b.status;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No changes supplied' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({ where: { id }, data, select: LIST_SELECT });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_UPDATED',
        subjectType: 'Project',
        subjectId: id,
        payload: { ref: existing.ref, changed: Object.keys(data) },
      });
      return p;
    });

    res.json({ status: 'success', project: decorate(updated, scope) });
  } catch (error: any) {
    console.error('[Project Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update project' });
  }
};

// ─── Close or cancel ────────────────────────────────────────────────────────

export const closeProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    const id = str(req.params.id);
    const { outcome, closureNote } = req.body || {};

    if (outcome !== 'Closed' && outcome !== 'Cancelled') {
      res.status(400).json({ status: 'error', message: "outcome must be 'Closed' or 'Cancelled'" });
      return;
    }
    // Ten characters is not a quality bar; it is enough to stop an empty string
    // and a full stop from becoming the permanent record of why this ended.
    if (!closureNote || str(closureNote).trim().length < 10) {
      res.status(400).json({
        status: 'error',
        code: 'CLOSURE_NOTE_REQUIRED',
        message: 'Record why this project is ending — at least a sentence.',
      });
      return;
    }

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, tenantId: true, providerTenantId: true, ref: true, status: true, reportedProgress: true },
    });
    if (!existing || !canReadProject(scope, existing)) {
      res.status(404).json({ status: 'error', message: 'Project not found' });
      return;
    }
    if (!canWriteProject(scope, existing.tenantId)) {
      res.status(403).json({ status: 'error', code: 'READ_ONLY_ENGAGEMENT', message: 'You cannot close this engagement.' });
      return;
    }
    if (!TRANSITIONS[existing.status]?.includes(outcome)) {
      res.status(409).json({
        status: 'error',
        code: 'ILLEGAL_TRANSITION',
        message: `A project cannot move from ${existing.status} to ${outcome}.`,
      });
      return;
    }

    const closed = await prisma.$transaction(async (tx) => {
      const p = await tx.project.update({
        where: { id },
        data: { status: outcome, closureNote: str(closureNote).trim(), actualEndDate: new Date() },
        select: LIST_SELECT,
      });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: outcome === 'Closed' ? 'PROJECT_CLOSED' : 'PROJECT_CANCELLED',
        subjectType: 'Project',
        subjectId: id,
        // The progress at closure is the number worth keeping: a project closed
        // at 60% is a different event from one closed at 100%.
        payload: { ref: existing.ref, progressAtClosure: existing.reportedProgress, closureNote },
      });
      return p;
    });

    res.json({ status: 'success', project: decorate(closed, scope) });
  } catch (error: any) {
    console.error('[Project Close Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to close project' });
  }
};
