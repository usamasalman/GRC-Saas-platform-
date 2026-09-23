import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { projectWhere, canWriteProject, canReadProject, sideOf } from '../services/projectAccess';
import { schedule, derivedStatus, parseFrameworks } from '../services/projectSchedule';
import { VERIFICATION_POLICIES } from '../services/projectLifecycle';
import { recomputeProject } from '../services/projectRollup';
import { stampBaseline } from '../services/projectBaseline';
import { planStandardBinding } from '../services/projectStandards';
import { planActivation, noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { planProviderNomination, DELIVERY_PARTNER_TYPES } from '../services/providerEngagement';
import { notify } from '../services/notificationService';

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

/**
 * Resolve and authorise the organisation named as the deliverer.
 *
 * One function for both write paths. The rules are in
 * services/providerEngagement and run without a database; this does the lookup
 * and hands back either a refusal to send or the value to store.
 */
async function resolveProvider(
  requested: unknown,
  clientTenantId: string,
  current: string | null,
  scope: { tenantIds: string[]; kind: string },
) {
  const id = String(requested ?? '').trim();
  const candidate = id
    ? await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, suspendedAt: true },
    })
    : null;

  return planProviderNomination({
    clientTenantId,
    requested: id,
    candidate,
    current,
    callerTenantIds: scope.tenantIds,
    isPlatform: scope.kind === 'PLATFORM',
  });
}

/**
 * The people at the named firm who should hear that they have been named.
 *
 * Their own administrators, because the nomination grants their whole
 * organisation access and somebody there has to know it happened. A firm told
 * nothing cannot object, and cannot notice a client that named them by mistake.
 */
async function providerAdmins(tenantId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { tenantId, role: { contains: 'admin' } },
    select: { id: true },
    take: 25,
  });
  return users.map((u) => u.id);
}

/** PRJ-0001, sequential per client tenant. Matches assetController's convention. */
async function nextRef(tenantId: string): Promise<string> {
  const count = await prisma.project.count({ where: { tenantId } });
  return `PRJ-${String(count + 1).padStart(4, '0')}`;
}

const LIST_SELECT = {
  id: true, ref: true, name: true, projectType: true, priority: true, status: true,
  health: true, healthNote: true, reportedProgress: true, verifiedProgress: true,
  verificationPolicy: true,
  baselineStartDate: true, baselineTargetEndDate: true,
  baselineSetAt: true, baselineVersion: true,
  startDate: true, targetEndDate: true, actualEndDate: true, frameworks: true,
  tenantId: true, providerTenantId: true, createdAt: true,
  standards: {
    select: { standard: { select: { id: true, code: true, title: true } } },
    orderBy: { standard: { code: 'asc' } },
  },
  owner: { select: { id: true, name: true, email: true } },
  manager: { select: { id: true, name: true, email: true } },
  tenant: { select: { id: true, name: true } },
  providerTenant: { select: { id: true, name: true } },
  _count: { select: { members: true } },
} as const;

/** Adds the derived figures no column should hold. */
function decorate(p: any, scope: any) {
  const s = schedule(p);
  const bound = (p.standards || []).map((b: any) => b.standard);
  return {
    ...p,
    // The frameworks this engagement is actually bound to, resolvable to
    // clauses. `frameworks` below is the free-text column that preceded it: it
    // is still shown for engagements created before the binding existed, and
    // is empty for everything since.
    standards: bound,
    frameworks: bound.length > 0
      ? bound.map((b: any) => b.code)
      : parseFrameworks(p.frameworks),
    frameworksAreLegacy: bound.length === 0 && parseFrameworks(p.frameworks).length > 0,
    schedule: s,
    derivedStatus: derivedStatus(p, s),
    side: sideOf(scope, p),
    memberCount: p._count?.members ?? 0,
    _count: undefined,
  };
}

// ─── List ───────────────────────────────────────────────────────────────────

export const listProjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
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
    const scope = await resolveTenantScope(req.user!);
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

/**
 * Organisations this caller may name as the deliverer of an engagement.
 *
 * Exists so the screen can offer a list rather than a text box for a tenant
 * uuid. The same rules run again in planProviderNomination when the value is
 * submitted -- this is the courtesy, that is the guarantee.
 *
 * What it discloses, deliberately: the names of firms registered on this
 * platform to deliver work for others. That is what the PARTNER and FRANCHISE
 * organisation types are for, and a client cannot engage a firm it cannot name.
 * It discloses no ordinary customer outside the caller's own scope.
 */
export const engageableProviders = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const clientTenantId = str(req.query.tenantId || req.user!.tenantId);

    const where: any = {
      suspendedAt: null,
      id: { not: clientTenantId },
      OR: [
        { type: { in: [...DELIVERY_PARTNER_TYPES] } },
        ...(scope.kind === 'PLATFORM' ? [{}] : [{ id: { in: scope.tenantIds } }]),
      ],
    };

    const tenants = await prisma.tenant.findMany({
      where,
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
      take: 200,
    });

    res.json({
      status: 'success',
      providers: tenants.map((x) => ({
        id: x.id,
        name: x.name,
        type: x.type,
        // So the screen can say WHY this one is offerable, rather than listing
        // a group subsidiary and a consultancy as if they were the same thing.
        reason: scope.tenantIds.includes(x.id) ? 'InYourGroup' : 'DeliveryFirm',
      })),
    });
  } catch (error: any) {
    console.error('[Engageable Providers Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list organisations' });
  }
};

// ─── Create ─────────────────────────────────────────────────────────────────

export const createProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const {
      name, description, objectives, projectType, priority, standardIds,
      startDate, targetEndDate, ownerId, managerId, sponsorId, verificationPolicy,
      tenantId: bodyTenantId, providerTenantId,
    } = req.body || {};

    if (!name || !startDate || !targetEndDate || !ownerId || !managerId) {
      res.status(400).json({
        status: 'error',
        message: 'name, startDate, targetEndDate, ownerId and managerId are required',
      });
      return;
    }

    // Refused here for the same reason updateProject refuses it, and with the
    // same code. It was silently dropped instead: a caller still sending the
    // old free-text field got back 201 and an engagement bound to nothing,
    // which reads as "scope: none" on the readiness report rather than as a
    // mistake anybody could see. standardIds is the field that means this now.
    if ((req.body || {}).frameworks !== undefined) {
      res.status(400).json({
        status: 'error',
        code: 'FRAMEWORKS_READ_ONLY',
        message: 'Frameworks are no longer free text. Name the enabled frameworks in '
          + 'standardIds, or bind them afterwards with PUT /api/projects/:id/standards.',
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
    if (verificationPolicy && !VERIFICATION_POLICIES.includes(verificationPolicy)) {
      res.status(400).json({
        status: 'error',
        message: `verificationPolicy must be one of: ${VERIFICATION_POLICIES.join(', ')}`,
      });
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

    // Frameworks, if any were named. Validated here rather than after creation
    // so a refused framework does not leave a project behind: an engagement
    // created with the wrong scope is harder to notice than one not created.
    const requestedStandards = Array.isArray(standardIds) ? standardIds.map(String).filter(Boolean) : [];
    let bindIds: string[] = [];
    if (requestedStandards.length > 0) {
      const enablements = await prisma.tenantStandardEnablement.findMany({
        where: { tenantId },
        select: {
          applicability: true,
          standard: { select: { id: true, code: true, title: true, tenantId: true } },
        },
      });
      const enabledIds = new Set(enablements.map((e) => e.standard.id));
      const extra = requestedStandards.filter((id) => !enabledIds.has(id));
      const others = extra.length
        ? await prisma.standard.findMany({
          where: { id: { in: extra } },
          select: { id: true, code: true, title: true, tenantId: true },
        })
        : [];

      const plan = planStandardBinding({
        projectTenantId: tenantId,
        requested: requestedStandards,
        found: [
          ...enablements.map((e) => ({
            id: e.standard.id,
            code: e.standard.code,
            title: e.standard.title,
            tenantId: e.standard.tenantId,
            enabled: true,
            applicability: e.applicability,
          })),
          ...others.map((o) => ({
            id: o.id, code: o.code, title: o.title, tenantId: o.tenantId,
            enabled: false, applicability: null,
          })),
        ],
        bound: [],
        inUse: [],
      });
      if (!plan.ok) {
        res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
        return;
      }
      bindIds = plan.add;
    }

    // Before the transaction, so a refused deliverer does not leave a project
    // behind. An engagement created naming the wrong firm used to be permanent:
    // updateProject never assigned this column.
    const provider = await resolveProvider(providerTenantId, tenantId, null, scope);
    if (!provider.ok) {
      res.status(provider.status).json({
        status: 'error', code: provider.code, message: provider.message,
      });
      return;
    }

    const ref = await nextRef(tenantId);

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          tenantId,
          providerTenantId: provider.providerTenantId,
          ref,
          name: str(name).trim(),
          description: description ? str(description) : null,
          objectives: objectives ? str(objectives) : null,
          projectType: projectType || 'Readiness',
          priority: priority || 'Medium',
          verificationPolicy: verificationPolicy || 'SelectedTasks',
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

      if (bindIds.length > 0) {
        await tx.projectStandard.createMany({
          data: bindIds.map((standardId) => ({
            projectId: project.id, standardId, addedById: str(req.user!.id),
          })),
          skipDuplicates: true,
        });
      }

      await writeAudit(tx, {
        tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_CREATED',
        subjectType: 'Project',
        subjectId: project.id,
        // The deliverer belongs in the payload. Naming an outside organisation
        // grants it read of this engagement and write over its traceability,
        // and an audit trail that does not record who was given that access
        // cannot answer the only question anybody would ask of it.
        payload: {
          ref,
          name: project.name,
          projectType: project.projectType,
          targetEndDate,
          providerTenantId: provider.providerTenantId,
        },
      });

      if (provider.providerTenantId) {
        // A second entry, on the NAMED firm's own trail. The first records what
        // the client did; this one is how that firm can later answer "when were
        // we given access to this, and by whom".
        await writeAudit(tx, {
          tenantId: provider.providerTenantId,
          actorId: str(req.user!.id),
          action: 'PROJECT_PROVIDER_NAMED',
          subjectType: 'Project',
          subjectId: project.id,
          payload: { ref, clientTenantId: tenantId, change: 'set' },
        });
        await notify(tx, (await providerAdmins(provider.providerTenantId)).map((recipientId) => ({
          tenantId: provider.providerTenantId as string,
          recipientId,
          event: 'PROJECT_PROVIDER_NAMED',
          subjectType: 'Project',
          subjectId: project.id,
          title: `Your organisation has been named as the deliverer of ${ref}`,
          body: `${project.name}. Your people can now read the plan, the evidence and the `
            + 'reports, and record work against it.',
          link: 'project-delivery',
          actorId: str(req.user!.id),
        })));
      }

      return project;
    });

    res.status(201).json({
      status: 'success',
      project: decorate(created, scope),
      warnings: provider.warnings,
    });
  } catch (error: any) {
    console.error('[Project Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create project' });
  }
};

// ─── Update ─────────────────────────────────────────────────────────────────

export const updateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const id = str(req.params.id);

    const existing = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, providerTenantId: true, ref: true, name: true,
        status: true, startDate: true, targetEndDate: true, baselineSetAt: true,
      },
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

    // The deliverer, which this handler used to drop silently.
    //
    // It was assigned in exactly one place -- createProject -- and never here,
    // so an engagement created naming the wrong organisation could not be
    // corrected, reassigned or taken back in-house for the life of the row.
    // Since naming a firm grants it read of the whole engagement and write over
    // its traceability, that made an accidental grant permanent.
    let providerChange: Awaited<ReturnType<typeof resolveProvider>> | null = null;
    if (b.providerTenantId !== undefined) {
      providerChange = await resolveProvider(
        b.providerTenantId, existing.tenantId, existing.providerTenantId, scope,
      );
      if (!providerChange.ok) {
        res.status(providerChange.status).json({
          status: 'error', code: providerChange.code, message: providerChange.message,
        });
        return;
      }
      if (providerChange.change !== 'unchanged') {
        data.providerTenantId = providerChange.providerTenantId;
      }
    }
    // frameworks is no longer written. It was free text -- "ISO27001", "ISO
    // 27001" and a typo were three different values, none of which resolved to
    // a Standard row -- so the readiness report could not ask what this
    // engagement was in scope for and inferred it from the clause links the
    // tasks already held. Scope now lives in ProjectStandard, set through
    // PUT /api/projects/:id/standards, which accepts only frameworks the client
    // organisation has enabled. The column stays readable for engagements
    // created before that table existed.
    if (b.frameworks !== undefined) {
      res.status(400).json({
        status: 'error',
        code: 'FRAMEWORKS_READ_ONLY',
        message: 'Frameworks are no longer free text. Bind the engagement to the frameworks '
          + 'this organisation has enabled, with PUT /api/projects/:id/standards.',
      });
      return;
    }

    // Typed as readonly string[] rather than `as const`: a union of literal
    // tuples narrows the argument of `includes` to their intersection, which is
    // never, and the check stops compiling.
    const ENUM_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['priority', PRIORITIES], ['health', HEALTH], ['projectType', TYPES],
      ['verificationPolicy', VERIFICATION_POLICIES],
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
    let activationDecision: any = null;
    let activationCounts: { phaseCount: number; taskCount: number } = { phaseCount: 0, taskCount: 0 };
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

      if (b.status === 'Active' && existing.status === 'Draft') {
        const phases = await prisma.projectPhase.findMany({
          where: { projectId: id },
          select: { id: true, tasks: { select: { id: true, dueDate: true } } },
        });
        const phaseCount = phases.length;
        const allTasks = phases.flatMap((p) => p.tasks);
        const taskCount = allTasks.length;
        const tasksWithoutDueDate = allTasks.filter((t) => !t.dueDate).length;

        const decision = planActivation({
          status: existing.status,
          startDate: existing.startDate,
          targetEndDate: data.targetEndDate || existing.targetEndDate,
          baselineSetAt: existing.baselineSetAt,
          phaseCount,
          taskCount,
          tasksWithoutDueDate,
        }, new Date());

        if (!decision.ok) {
          res.status(decision.status).json({
            status: 'error',
            code: decision.code,
            message: decision.message,
          });
          return;
        }
        activationDecision = decision;
        activationCounts = { phaseCount, taskCount };
      }

      data.status = b.status;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No changes supplied' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_UPDATED',
        subjectType: 'Project',
        subjectId: id,
        payload: { ref: existing.ref, changed: Object.keys(data) },
      });

      // Both organisations' trails, and the firm itself.
      //
      // The entry on the client's trail records what they did; the entry on the
      // named firm's records how that firm can answer "when were we given
      // access to this, and by whom". A grant of this size recorded on only one
      // side is a grant the other side cannot audit.
      if (providerChange && providerChange.ok && providerChange.change !== 'unchanged') {
        const gained = providerChange.providerTenantId;
        const lost = existing.providerTenantId;
        const actorId = str(req.user!.id);

        for (const [tenantId, change] of [
          [gained, providerChange.change === 'changed' ? 'set' : providerChange.change],
          [lost, 'removed'],
        ] as [string | null, string][]) {
          if (!tenantId || tenantId === existing.tenantId) continue;
          await writeAudit(tx, {
            tenantId,
            actorId,
            action: change === 'removed'
              ? 'PROJECT_PROVIDER_REMOVED'
              : 'PROJECT_PROVIDER_NAMED',
            subjectType: 'Project',
            subjectId: id,
            payload: { ref: existing.ref, clientTenantId: existing.tenantId, change },
          });
        }

        if (gained) {
          await notify(tx, (await providerAdmins(gained)).map((recipientId) => ({
            tenantId: gained,
            recipientId,
            event: 'PROJECT_PROVIDER_NAMED',
            subjectType: 'Project',
            subjectId: id,
            title: `Your organisation has been named as the deliverer of ${existing.ref}`,
            body: `${existing.name}. Your people can now read the plan, the evidence and the `
              + 'reports, and record work against it.',
            link: 'project-delivery',
            actorId,
          })));
        }
        if (lost) {
          await notify(tx, (await providerAdmins(lost)).map((recipientId) => ({
            tenantId: lost,
            recipientId,
            event: 'PROJECT_PROVIDER_REMOVED',
            subjectType: 'Project',
            subjectId: id,
            title: `Your organisation no longer delivers ${existing.ref}`,
            body: `${existing.name}. Your people can no longer see this engagement. Anything `
              + 'already uploaded stays on the record.',
            link: 'project-delivery',
            actorId,
          })));
        }
      }

      // Changing the verification policy changes what every task in the tree
      // needs, so the verified figure has to be recomputed in the same
      // transaction. Otherwise switching an engagement to EveryTask leaves it
      // reporting a percentage measured against the standard it just left.
      if (data.verificationPolicy !== undefined) await recomputeProject(tx, id);

      // Activation is the moment the plan stops being a draft and becomes the
      // thing everyone agreed to, so it is the moment worth remembering. A
      // project reactivated from OnHold keeps the baseline it already has —
      // resuming is not renegotiating.
      if (data.status === 'Active' && existing.status === 'Draft') {
        await stampBaseline(tx, id, new Date());
        await writeAudit(tx, {
          tenantId: existing.tenantId,
          actorId: str(req.user!.id),
          action: 'PROJECT_ACTIVATED',
          subjectType: 'Project',
          subjectId: id,
          payload: {
            ref: existing.ref,
            phaseCount: activationCounts.phaseCount,
            taskCount: activationCounts.taskCount,
            warnings: activationDecision?.warnings || [],
          },
        });
      }

      // Re-read rather than taking the update's own return: the rollup above
      // writes progress columns after it, and the pre-rollup row would show
      // figures that were true for a few milliseconds.
      return tx.project.findUniqueOrThrow({ where: { id }, select: LIST_SELECT });
    });

    res.json({
      status: 'success',
      project: decorate(updated, scope),
      warnings: [
        ...(activationDecision?.warnings || []),
        ...(providerChange && providerChange.ok ? providerChange.warnings : []),
      ],
    });
  } catch (error: any) {
    console.error('[Project Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update project' });
  }
};

// ─── Activation ─────────────────────────────────────────────────────────────

/**
 * Agree the plan, set the baseline, and move an engagement from Draft to Active.
 *
 * Gated by planActivation: stamping an empty plan is refused because an empty
 * baseline causes every subsequent task to be baselined at its own due date,
 * making slip reporting permanently impossible.
 */
export const activateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const id = str(req.params.id);

    const existing = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, providerTenantId: true, ref: true,
        status: true, startDate: true, targetEndDate: true, baselineSetAt: true,
      },
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

    const phases = await prisma.projectPhase.findMany({
      where: { projectId: id },
      select: { id: true, tasks: { select: { id: true, dueDate: true } } },
    });
    const phaseCount = phases.length;
    const allTasks = phases.flatMap((p) => p.tasks);
    const taskCount = allTasks.length;
    const tasksWithoutDueDate = allTasks.filter((t) => !t.dueDate).length;

    const decision = planActivation({
      status: existing.status,
      startDate: existing.startDate,
      targetEndDate: existing.targetEndDate,
      baselineSetAt: existing.baselineSetAt,
      phaseCount,
      taskCount,
      tasksWithoutDueDate,
    }, new Date());

    if (!decision.ok) {
      res.status(decision.status).json({
        status: 'error',
        code: decision.code,
        message: decision.message,
      });
      return;
    }

    if (req.body?.preview === true || req.query.preview === 'true') {
      res.json({
        status: 'success',
        warnings: decision.warnings,
        canActivate: true,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: { status: 'Active' },
      });
      await stampBaseline(tx, id, new Date());
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_ACTIVATED',
        subjectType: 'Project',
        subjectId: id,
        payload: {
          ref: existing.ref,
          phaseCount,
          taskCount,
          warnings: decision.warnings,
        },
      });
      await recomputeProject(tx, id);
      return tx.project.findUniqueOrThrow({ where: { id }, select: LIST_SELECT });
    });

    res.json({
      status: 'success',
      project: decorate(updated, scope),
      warnings: decision.warnings,
    });
  } catch (error: any) {
    console.error('[Project Activation Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to activate project' });
  }
};


// ─── Rebaseline ─────────────────────────────────────────────────────────────

/**
 * Agree a new plan, on the record.
 *
 * The only way baseline dates ever move after activation. It exists because the
 * alternative — letting them drift with ordinary edits — makes them measure
 * nothing, and forbidding it entirely makes a genuinely renegotiated programme
 * report a slip it no longer has.
 *
 * The reason is required and the version increments, so a programme on its
 * fourth agreed plan cannot present itself as one that has never moved. Every
 * impediment already recorded stays: rebaselining resets what is being worked
 * to, not what was lost getting here.
 */
export const rebaselineProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const id = str(req.params.id);

    const existing = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true, tenantId: true, providerTenantId: true, ref: true,
        status: true, baselineVersion: true, baselineSetAt: true,
      },
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
    if (existing.status === 'Closed' || existing.status === 'Cancelled') {
      res.status(409).json({
        status: 'error',
        code: 'PROJECT_FROZEN',
        message: `This project is ${existing.status}. A finished engagement is a record.`,
      });
      return;
    }
    if (!existing.baselineSetAt) {
      res.status(409).json({
        status: 'error',
        code: 'NOT_BASELINED',
        message: 'This project has no agreed plan yet — activate it first. A draft moves freely.',
      });
      return;
    }

    const reason = req.body?.reason ? str(req.body.reason).trim() : '';
    if (!noteIsEnough(reason)) {
      res.status(400).json({
        status: 'error',
        code: 'REASON_REQUIRED',
        message: `Say why the plan is being reset — at least ${MIN_NOTE} characters. A `
          + 'baseline moved '
          + 'without a reason is a baseline nobody can defend at the next steering meeting.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const stamped = await stampBaseline(tx, id, new Date());
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_REBASELINED',
        subjectType: 'Project',
        subjectId: id,
        payload: {
          ref: existing.ref,
          from: existing.baselineVersion,
          to: stamped.version,
          phases: stamped.phases,
          tasks: stamped.tasks,
          reason,
        },
      });
      return stamped;
    });

    res.json({
      status: 'success',
      message: `Plan rebaselined. Version ${result.version}, covering `
        + `${result.phases} phase(s) and ${result.tasks} task(s).`,
      baseline: result,
    });
  } catch (error: any) {
    console.error('[Project Rebaseline Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to rebaseline the project' });
  }
};

// ─── Close or cancel ────────────────────────────────────────────────────────

export const closeProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const id = str(req.params.id);
    const { outcome, closureNote } = req.body || {};

    if (outcome !== 'Closed' && outcome !== 'Cancelled') {
      res.status(400).json({ status: 'error', message: "outcome must be 'Closed' or 'Cancelled'" });
      return;
    }
    // One length rule, in services/projectActivation, so closing and
    // rebaselining cannot drift apart on what counts as an explanation.
    if (!noteIsEnough(closureNote)) {
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
