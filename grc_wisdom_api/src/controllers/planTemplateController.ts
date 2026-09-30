import { Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { guardProject, notFound, readOnly } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import {
  levelForTenantType, canSeeTemplate, canMaintainTemplate, checkTemplateBody, checkCustom,
  planFromTemplate, templateFromPlan, similarTasks, TemplateBody, ClauseRow,
} from '../services/planTemplates';

/**
 * The plan template library and the plan wizard (consulting engagement, S3).
 *
 * Every rule lives in services/planTemplates; this file loads, checks and
 * writes. A template the caller may not read answers 404, like a template
 * that does not exist, so a firm cannot learn what another firm keeps.
 */

const str = (v: unknown): string => String(v ?? '');

const TEMPLATE_INCLUDE = {
  phases: {
    orderBy: { sequence: 'asc' as const },
    include: { tasks: { orderBy: { sequence: 'asc' as const } } },
  },
};

/** The caller's tenant and its type, which decides their library and what they may maintain. */
async function callerOf(req: AuthenticatedRequest) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.user!.tenantId },
    select: { id: true, type: true },
  });
  return { tenantId: req.user!.tenantId, tenantType: tenant?.type ?? '' };
}

/** A template as the screens read it: clauses back to an array. */
function shape(t: any, caller?: { tenantId: string; tenantType: string }) {
  return {
    id: t.id, level: t.level, familyId: t.familyId, version: t.version, name: t.name,
    description: t.description, engagementType: t.engagementType, standardCode: t.standardCode,
    status: t.status, retiredAt: t.retiredAt, createdAt: t.createdAt,
    canMaintain: caller ? canMaintainTemplate(caller, t) : false,
    phases: (t.phases || []).map((p: any) => ({
      id: p.id, sequence: p.sequence, name: p.name, description: p.description, durationDays: p.durationDays,
      tasks: (p.tasks || []).map((k: any) => ({
        id: k.id, key: k.key, sequence: k.sequence, name: k.name, description: k.description, side: k.side,
        durationDays: k.durationDays, weight: k.weight, needsVerification: k.needsVerification,
        dependsOnKey: k.dependsOnKey, clauses: parseClauses(k.clauses), generate: k.generate,
        deliverable: k.deliverable,
      })),
    })),
  };
}

const parseClauses = (raw: string | null): string[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** Nested create data for one version of a template body. */
const phasesCreate = (body: TemplateBody) => ({
  create: body.phases.map((p, pi) => ({
    sequence: pi + 1, name: p.name, description: p.description ?? null, durationDays: p.durationDays,
    tasks: {
      create: p.tasks.map((t, ti) => ({
        key: t.key, sequence: ti + 1, name: t.name, description: t.description ?? null, side: t.side,
        durationDays: t.durationDays, weight: t.weight, needsVerification: t.needsVerification ?? null,
        dependsOnKey: t.dependsOnKey ?? null, clauses: JSON.stringify(t.clauses || []),
        generate: t.generate || 'Once', deliverable: t.deliverable ?? null,
      })),
    },
  })),
});

/** Loads a template the caller may read, or null. */
async function visibleTemplate(req: AuthenticatedRequest, id: string) {
  const [scope, t] = await Promise.all([
    resolveTenantScope(req.user!),
    prisma.planTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE }),
  ]);
  return t && canSeeTemplate(scope, t) ? t : null;
}

const templateNotFound = (res: Response) => {
  res.status(404).json({ status: 'error', message: 'Template not found' });
};

// ─── The library ────────────────────────────────────────────────────────────

/**
 * GET /api/plan-templates — the templates this caller may use.
 *
 * By default the wizard's view: the latest active version of each template,
 * optionally for one engagement type or framework. ?all=1 is the library's
 * view: every version, retired ones included, newest first.
 */
export const listTemplates = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [scope, caller] = await Promise.all([resolveTenantScope(req.user!), callerOf(req)]);
    const all = str(req.query.all) === '1';
    const rows = await prisma.planTemplate.findMany({
      where: {
        OR: [{ level: 'Platform' }, { tenantId: { in: scope.tenantIds } }],
        ...(all ? {} : { status: 'Active' }),
        ...(req.query.engagementType ? { engagementType: str(req.query.engagementType) } : {}),
        ...(req.query.standardCode ? { standardCode: str(req.query.standardCode) } : {}),
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }, { version: 'desc' }],
      include: { phases: { select: { _count: { select: { tasks: true } } } } },
    });
    const visible = rows.filter((t) => canSeeTemplate(scope, t));
    const latest = new Map<string, (typeof visible)[number]>();
    for (const t of visible) if (!latest.has(t.familyId)) latest.set(t.familyId, t);
    const list = all ? visible : [...latest.values()];

    res.json({
      status: 'success',
      myLevel: levelForTenantType(caller.tenantType),
      templates: list.map((t) => ({
        id: t.id, level: t.level, familyId: t.familyId, version: t.version, name: t.name,
        description: t.description, engagementType: t.engagementType, standardCode: t.standardCode,
        status: t.status, createdAt: t.createdAt,
        phaseCount: t.phases.length,
        taskCount: t.phases.reduce((s, p) => s + p._count.tasks, 0),
        latest: latest.get(t.familyId)?.id === t.id,
        canMaintain: canMaintainTemplate(caller, t),
      })),
    });
  } catch (error: any) {
    console.error('[Plan Templates Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load plan templates' });
  }
};

/** GET /api/plan-templates/:id */
export const getTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const t = await visibleTemplate(req, str(req.params.id));
    if (!t) { templateNotFound(res); return; }
    res.json({ status: 'success', template: shape(t, await callerOf(req)) });
  } catch (error: any) {
    console.error('[Plan Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the template' });
  }
};

/**
 * GET /api/plan-templates/similar-tasks?q= — library tasks that look like
 * what is being typed, so a custom task is checked against the library first.
 */
export const similarLibraryTasks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const q = str(req.query.q).slice(0, 200);
    const words = [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3))].slice(0, 8);
    if (words.length === 0) { res.json({ status: 'success', tasks: [] }); return; }
    const scope = await resolveTenantScope(req.user!);
    // The database does the searching, so every task in the library is
    // reachable: tasks holding every typed word first, then any of them. Only
    // the handful worth offering come back.
    const find = (match: 'AND' | 'OR') => prisma.planTemplateTask.findMany({
      where: {
        [match]: words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })),
        phase: {
          template: {
            status: 'Active',
            OR: [{ level: 'Platform' }, { tenantId: { in: scope.tenantIds } }],
          },
        },
      },
      select: {
        name: true, side: true, durationDays: true,
        phase: { select: { name: true, template: { select: { name: true, level: true, tenantId: true } } } },
      },
      take: 40,
    });
    let tasks = await find('AND');
    if (tasks.length < 6) tasks = [...tasks, ...(await find('OR'))];
    const visible = tasks.filter((t) => canSeeTemplate(scope, t.phase.template));
    res.json({
      status: 'success',
      tasks: similarTasks(q, visible).map((t) => ({
        name: t.name, side: t.side, durationDays: t.durationDays,
        from: `${t.phase.template.name} · ${t.phase.name}`,
      })),
    });
  } catch (error: any) {
    console.error('[Similar Tasks Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to look up similar tasks' });
  }
};

/**
 * POST /api/plan-templates/:id/versions — save changes as the next version.
 *
 * A version is never edited in place, so a plan made from version 1 stays what
 * it was, and anyone can still read what version 1 said.
 */
export const createVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const t = await visibleTemplate(req, str(req.params.id));
    if (!t) { templateNotFound(res); return; }
    const caller = await callerOf(req);
    if (!canMaintainTemplate(caller, t)) {
      res.status(403).json({
        status: 'error',
        code: 'TEMPLATE_READ_ONLY',
        message: t.level === 'Platform'
          ? 'Platform templates are kept by the platform. Save a copy to your own library instead.'
          : 'Only the organisation that keeps this template can change it.',
      });
      return;
    }
    const checked = checkTemplateBody(req.body);
    if (!checked.ok) { res.status(400).json({ status: 'error', code: 'INVALID_TEMPLATE', message: checked.message }); return; }

    const created = await prisma.$transaction(async (tx) => {
      const top = await tx.planTemplate.aggregate({ where: { familyId: t.familyId }, _max: { version: true } });
      const version = (top._max.version || 0) + 1;
      const row = await tx.planTemplate.create({
        data: {
          level: t.level, tenantId: t.tenantId, familyId: t.familyId, version,
          name: checked.body.name, description: checked.body.description ?? null,
          engagementType: checked.body.engagementType ?? null, standardCode: checked.body.standardCode ?? null,
          createdById: req.user!.id,
          phases: phasesCreate(checked.body),
        },
        include: TEMPLATE_INCLUDE,
      });
      await writeAudit(tx, {
        tenantId: t.tenantId ?? caller.tenantId,
        actorId: req.user!.id,
        action: 'PLAN_TEMPLATE_VERSIONED',
        subjectType: 'PlanTemplate',
        subjectId: row.id,
        payload: { name: row.name, level: row.level, familyId: row.familyId, from: t.version, to: version },
      });
      return row;
    });
    res.status(201).json({ status: 'success', template: shape(created, caller) });
  } catch (error: any) {
    console.error('[Plan Template Version Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save the template' });
  }
};

/** POST /api/plan-templates/:id/retire — hidden from the wizard; plans made from it are untouched. */
export const retireTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const t = await visibleTemplate(req, str(req.params.id));
    if (!t) { templateNotFound(res); return; }
    const caller = await callerOf(req);
    if (!canMaintainTemplate(caller, t)) {
      res.status(403).json({ status: 'error', code: 'TEMPLATE_READ_ONLY', message: 'Only the organisation that keeps this template can retire it.' });
      return;
    }
    if (t.status === 'Retired') { res.json({ status: 'success', template: shape(t, caller) }); return; }
    const retired = await prisma.$transaction(async (tx) => {
      const moved = await tx.planTemplate.updateMany({
        where: { id: t.id, status: 'Active' }, data: { status: 'Retired', retiredAt: new Date() },
      });
      if (moved.count > 0) {
        await writeAudit(tx, {
          tenantId: t.tenantId ?? caller.tenantId,
          actorId: req.user!.id,
          action: 'PLAN_TEMPLATE_RETIRED',
          subjectType: 'PlanTemplate',
          subjectId: t.id,
          payload: { name: t.name, level: t.level, version: t.version },
        });
      }
      return tx.planTemplate.findUniqueOrThrow({ where: { id: t.id }, include: TEMPLATE_INCLUDE });
    });
    res.json({ status: 'success', template: shape(retired, caller) });
  } catch (error: any) {
    console.error('[Plan Template Retire Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retire the template' });
  }
};

// ─── Save a plan as a template ──────────────────────────────────────────────

/**
 * POST /api/plan-templates/from-project/:projectId — the plan, with the client
 * taken out, as version 1 of a new template in the caller's own library.
 *
 * A firm saving an engagement it delivers gets a Firm template; the client's
 * people, organisation and entity names, files and dates never enter it. The
 * client's trail records that it was done.
 */
export const saveFromProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project } = await guardProject(req.user!, str(req.params.projectId));
    if (!project) { notFound(res); return; }
    const caller = await callerOf(req);
    const level = levelForTenantType(caller.tenantType);
    if (level === 'Platform') {
      res.status(403).json({
        status: 'error',
        code: 'PLATFORM_TEMPLATES_ARE_WRITTEN',
        message: 'Platform templates are written in the library, not saved from a customer engagement.',
      });
      return;
    }
    const name = str(req.body?.name).trim();
    if (name.length < 3 || name.length > 200) {
      res.status(400).json({ status: 'error', message: 'Give the template a name of 3 to 200 characters.' });
      return;
    }

    const full = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: {
        ref: true, name: true, projectType: true, tenantId: true, providerTenantId: true,
        tenant: { select: { name: true, children: { select: { name: true } } } },
        providerTenant: { select: { name: true } },
        owner: { select: { name: true } }, manager: { select: { name: true } }, sponsor: { select: { name: true } },
        members: { select: { user: { select: { name: true } } } },
        standards: { select: { standard: { select: { code: true } } } },
        dependencies: { select: { predecessorId: true, successorId: true } },
        phases: {
          orderBy: { sequence: 'asc' },
          select: {
            name: true, description: true, startDate: true, targetEndDate: true,
            tasks: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true, name: true, description: true, side: true, weight: true, verificationOverride: true,
                startDate: true, dueDate: true, assignee: { select: { name: true } },
                clauseLinks: { select: { clause: { select: { ref: true } } } },
              },
            },
          },
        },
      },
    });
    if (full.phases.length === 0) {
      res.status(409).json({ status: 'error', code: 'EMPTY_PLAN', message: 'There is no plan to save yet.' });
      return;
    }

    const strip = [
      full.name, full.tenant?.name, full.providerTenant?.name,
      ...(full.tenant?.children || []).map((c) => c.name),
      full.owner?.name, full.manager?.name, full.sponsor?.name,
      ...full.members.map((m) => m.user?.name),
      ...full.phases.flatMap((p) => p.tasks.map((t) => t.assignee?.name)),
    ].filter(Boolean) as string[];

    const body = templateFromPlan({
      name,
      description: req.body?.description ? str(req.body.description).slice(0, 2000) : null,
      engagementType: full.projectType,
      standardCode: full.standards.length === 1 ? full.standards[0].standard.code : null,
      phases: full.phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => ({ ...t, clauseRefs: t.clauseLinks.map((l) => l.clause.ref) })),
      })),
      edges: full.dependencies,
      strip,
    });
    const checked = checkTemplateBody(body);
    if (!checked.ok) { res.status(422).json({ status: 'error', code: 'INVALID_TEMPLATE', message: checked.message }); return; }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.planTemplate.create({
        data: {
          level, tenantId: caller.tenantId, familyId: crypto.randomUUID(), version: 1,
          name: checked.body.name, description: checked.body.description ?? null,
          engagementType: checked.body.engagementType ?? null, standardCode: checked.body.standardCode ?? null,
          createdById: req.user!.id,
          phases: phasesCreate(checked.body),
        },
        include: TEMPLATE_INCLUDE,
      });
      await writeAudit(tx, {
        tenantId: caller.tenantId,
        actorId: req.user!.id,
        action: 'PLAN_TEMPLATE_SAVED',
        subjectType: 'PlanTemplate',
        subjectId: row.id,
        payload: { name: row.name, level, fromProject: full.ref, clientTenantId: full.tenantId },
      });
      // The client learns its engagement was used, and that nothing of it went.
      if (full.tenantId !== caller.tenantId) {
        await writeAudit(tx, {
          tenantId: full.tenantId,
          actorId: req.user!.id,
          action: 'PROJECT_SAVED_AS_TEMPLATE',
          subjectType: 'Project',
          subjectId: project.id,
          payload: {
            ref: full.ref, byTenantId: caller.tenantId, level,
            stripped: 'people, organisation and entity names, files and dates',
          },
        });
      }
      return row;
    });
    res.status(201).json({ status: 'success', template: shape(created, caller) });
  } catch (error: any) {
    console.error('[Save As Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save the plan as a template' });
  }
};

// ─── The wizard ─────────────────────────────────────────────────────────────

/**
 * POST /api/projects/:id/plan-from-template — lay a tailored template out as
 * the draft plan. ?preview=1 returns the dated plan without writing it, so the
 * wizard shows exactly what will be created.
 *
 * Only on a Draft with no plan yet, by the organisation that owns it: a plan
 * already agreed is changed task by task, and one being built by hand is not
 * overwritten.
 */
export const planFromTemplateRoute = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite } = await guardProject(req.user!, str(req.params.id));
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    const preview = str(req.query.preview) === '1';

    const b = req.body || {};
    const t = await visibleTemplate(req, str(b.templateId));
    if (!t) { templateNotFound(res); return; }
    if (t.status !== 'Active') {
      res.status(409).json({ status: 'error', code: 'TEMPLATE_RETIRED', message: 'That template has been retired. Choose another.' });
      return;
    }
    const custom = checkCustom(b);
    if (!custom.ok) { res.status(400).json({ status: 'error', message: custom.message }); return; }

    const full = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: {
        id: true, ref: true, tenantId: true, status: true, startDate: true, targetEndDate: true,
        _count: { select: { phases: true } },
        standards: { select: { standardId: true, standard: { select: { code: true } } } },
      },
    });
    if (full.status !== 'Draft') {
      res.status(409).json({ status: 'error', code: 'NOT_DRAFT', message: 'A template lays out a draft plan. This engagement is past that.' });
      return;
    }
    if (full._count.phases > 0 && !preview) {
      res.status(409).json({
        status: 'error', code: 'PLAN_NOT_EMPTY',
        message: 'This engagement already has a plan. A template only starts an empty one.',
      });
      return;
    }

    const start = b.startDate ? new Date(b.startDate) : full.startDate;
    if (Number.isNaN(start.getTime())) { res.status(400).json({ status: 'error', message: 'startDate must be a valid date' }); return; }

    // The template's framework, as this organisation holds it: bound to the
    // engagement already, or enabled for the organisation and bound now.
    let standardId: string | null = null;
    let bindStandard = false;
    let frameworkNote: string | null = null;
    if (t.standardCode) {
      const bound = full.standards.find((s) => s.standard.code === t.standardCode);
      if (bound) standardId = bound.standardId;
      else {
        const enabled = await prisma.tenantStandardEnablement.findFirst({
          where: { tenantId: full.tenantId, standard: { code: t.standardCode } },
          select: { standardId: true },
        });
        if (enabled) { standardId = enabled.standardId; bindStandard = true; }
        else frameworkNote = `${t.standardCode} is not enabled for this organisation, so no task is mapped to a clause.`;
      }
    }
    const clauses: ClauseRow[] = standardId
      ? await prisma.standardClause.findMany({ where: { standardId }, select: { id: true, ref: true, title: true } })
      : [];

    const plan = planFromTemplate({
      template: {
        phases: t.phases.map((p) => ({
          id: p.id, name: p.name, description: p.description, durationDays: p.durationDays,
          tasks: p.tasks.map((k) => ({ ...k, clauses: parseClauses(k.clauses) })),
        })),
      },
      startDate: start,
      excludePhaseIds: Array.isArray(b.excludePhaseIds) ? b.excludePhaseIds.map(str) : [],
      excludeTaskKeys: Array.isArray(b.excludeTaskKeys) ? b.excludeTaskKeys.map(str) : [],
      customTasks: custom.tasks,
      customPhases: custom.phases,
      clauses,
    });
    const taskCount = plan.phases.reduce((s, p) => s + p.tasks.length, 0);
    if (taskCount === 0) {
      res.status(400).json({ status: 'error', code: 'NOTHING_SELECTED', message: 'Keep at least one task.' });
      return;
    }
    const extendsTarget = plan.endDate > full.targetEndDate;
    const summary = {
      templateId: t.id, templateName: t.name, version: t.version,
      phases: plan.phases.length, tasks: taskCount,
      startDate: plan.phases[0]?.startDate ?? start, endDate: plan.endDate,
      targetEndDate: extendsTarget ? plan.endDate : full.targetEndDate,
      extendsTarget, unmatchedClauses: plan.unmatched, frameworkNote,
    };

    if (preview) {
      res.json({ status: 'success', preview: true, summary, phases: plan.phases });
      return;
    }

    const actorId = req.user!.id;
    await prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction: two wizards finishing together
      // must not lay two plans into one engagement.
      const moved = await tx.project.updateMany({
        where: { id: full.id, status: 'Draft', phases: { none: {} } },
        data: {
          planTemplateId: t.id,
          ...(extendsTarget ? { targetEndDate: plan.endDate } : {}),
        },
      });
      if (moved.count === 0) throw new PlanChanged();
      if (bindStandard && standardId) {
        await tx.projectStandard.create({ data: { projectId: full.id, standardId, addedById: actorId } });
      }

      const idOf = new Map<string, string>();
      let refNo = await tx.projectTask.count({ where: { projectId: full.id } });
      for (const [pi, p] of plan.phases.entries()) {
        const phase = await tx.projectPhase.create({
          data: {
            projectId: full.id, sequence: pi + 1, name: p.name, description: p.description,
            startDate: p.startDate, targetEndDate: p.targetEndDate, ownerId: project.ownerId,
          },
        });
        for (const [ti, k] of p.tasks.entries()) {
          refNo += 1;
          const task = await tx.projectTask.create({
            data: {
              projectId: full.id, phaseId: phase.id, ref: `TSK-${String(refNo).padStart(4, '0')}`,
              sequence: ti + 1, name: k.name, description: k.description, side: k.side, weight: k.weight,
              startDate: k.startDate, dueDate: k.dueDate, verificationOverride: k.verificationOverride,
            },
          });
          idOf.set(k.key, task.id);
          for (const clauseId of k.clauseIds) {
            await tx.projectTaskClause.create({ data: { taskId: task.id, clauseId, linkedById: actorId } });
          }
        }
      }
      for (const d of plan.dependencies) {
        const predecessorId = idOf.get(d.predecessorKey);
        const successorId = idOf.get(d.successorKey);
        if (!predecessorId || !successorId) continue;
        await tx.projectDependency.create({
          data: { projectId: full.id, predecessorId, successorId, kind: 'FinishToStart', lagDays: 0, linkedById: actorId },
        });
      }
      await recomputeProject(tx, full.id);
      await writeAudit(tx, {
        tenantId: full.tenantId,
        actorId,
        action: 'PROJECT_PLAN_FROM_TEMPLATE',
        subjectType: 'Project',
        subjectId: full.id,
        payload: {
          ref: full.ref, template: t.name, level: t.level, version: t.version,
          phases: plan.phases.length, tasks: taskCount,
          left: { phases: (b.excludePhaseIds || []).length, tasks: (b.excludeTaskKeys || []).length },
          custom: { phases: custom.phases.length, tasks: custom.tasks.length },
          boundFramework: bindStandard ? t.standardCode : null,
          targetMoved: extendsTarget ? plan.endDate.toISOString().slice(0, 10) : null,
        },
      });
    });

    res.status(201).json({ status: 'success', summary });
  } catch (error: any) {
    if (error instanceof PlanChanged) {
      res.status(409).json({
        status: 'error', code: 'PLAN_NOT_EMPTY',
        message: 'This engagement gained a plan, or left Draft, while the wizard was open. Reload it.',
      });
      return;
    }
    console.error('[Plan From Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to lay out the plan' });
  }
};

/** The engagement changed between the wizard's read and its write. */
class PlanChanged extends Error {}
