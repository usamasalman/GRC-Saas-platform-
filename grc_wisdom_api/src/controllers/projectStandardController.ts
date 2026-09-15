import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { parseFrameworks } from '../services/projectSchedule';
import {
  planStandardBinding, readinessScope, MAX_STANDARDS, StandardCandidate,
} from '../services/projectStandards';

/**
 * Binding an engagement to the frameworks it is actually being run against.
 *
 * Project.frameworks is free text in a JSON array, so nothing could follow an
 * engagement to a clause. The consequence was not cosmetic: the readiness
 * report worked out an engagement's scope from the clause links its own tasks
 * held, which made the denominator a function of the numerator and printed "0
 * clauses with no task at all" for a project that had mapped nothing.
 *
 * The rules live in services/projectStandards, pure and without a database.
 * This file does the loading, the writing and the audit entry.
 */

const str = (v: unknown): string => String(v ?? '');

const BOUND_SELECT = {
  id: true,
  addedAt: true,
  standard: {
    select: {
      id: true, code: true, title: true, authority: true, version: true,
      tenantId: true,
      _count: { select: { clauses: true } },
    },
  },
  addedBy: { select: { id: true, name: true } },
} as const;

/** The standards this organisation has enabled, which are the only bindable ones. */
async function enabledFor(tenantId: string) {
  return prisma.tenantStandardEnablement.findMany({
    where: { tenantId },
    select: {
      applicability: true,
      standard: {
        select: {
          id: true, code: true, title: true, authority: true, version: true,
          tenantId: true,
          _count: { select: { clauses: true } },
        },
      },
    },
    orderBy: { standard: { code: 'asc' } },
  });
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * What this engagement is bound to, and what it could be bound to.
 *
 * Both halves in one response because the screen needs both to say anything
 * useful: a picker that offers nothing is indistinguishable from one that
 * failed to load, and the difference is whether the organisation has enabled
 * any frameworks at all.
 */
export const listProjectStandards = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project } = await guardProject(req.user!, str(req.params.id));
    if (!project) { notFound(res); return; }

    const [bound, enablements, full] = await Promise.all([
      prisma.projectStandard.findMany({
        where: { projectId: project.id },
        select: BOUND_SELECT,
        orderBy: { standard: { code: 'asc' } },
      }),
      enabledFor(project.tenantId),
      prisma.project.findUnique({
        where: { id: project.id },
        select: { frameworks: true },
      }),
    ]);

    const legacyFrameworks = parseFrameworks(full?.frameworks);
    const scope = readinessScope({
      boundStandardIds: bound.map((b) => b.standard.id),
      legacyFrameworks,
    });

    res.json({
      status: 'success',
      standards: bound.map((b) => ({
        id: b.standard.id,
        code: b.standard.code,
        title: b.standard.title,
        authority: b.standard.authority,
        version: b.standard.version,
        clauseCount: b.standard._count.clauses,
        private: b.standard.tenantId !== null,
        addedAt: b.addedAt,
        addedBy: b.addedBy,
      })),
      available: enablements.map((e) => ({
        id: e.standard.id,
        code: e.standard.code,
        title: e.standard.title,
        authority: e.standard.authority,
        version: e.standard.version,
        clauseCount: e.standard._count.clauses,
        private: e.standard.tenantId !== null,
        applicability: e.applicability,
      })),
      // Kept readable for engagements created before the binding existed.
      // Nothing writes this column any more.
      legacyFrameworks,
      // So the screen can say the same thing the report says, rather than
      // inventing its own wording for the same condition.
      measurable: scope.stated,
      caveat: scope.caveat,
      maxStandards: MAX_STANDARDS,
    });
  } catch (error: any) {
    console.error('[Project Standards List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load engagement frameworks' });
  }
};

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Replace the set of frameworks this engagement is run against.
 *
 * A whole-set PUT rather than add/remove endpoints: "these are the frameworks"
 * is how a scope statement is actually agreed, and two endpoints would let a
 * screen leave the binding half-changed if the second call failed.
 */
export const setProjectStandards = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project, canWrite, side } = await guardProject(req.user!, str(req.params.id));
    if (!project) { notFound(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }
    // Same rule as clause linking: on consultant-led work the delivery partner
    // is never inside the client's tenant scope, and they are the people doing
    // the mapping. They still cannot adopt anything, because only frameworks
    // the client has already enabled can be bound.
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }

    const raw = req.body?.standardIds;
    if (!Array.isArray(raw)) {
      res.status(400).json({
        status: 'error',
        message: 'standardIds must be an array. Send an empty array to unbind everything.',
      });
      return;
    }
    const requested = raw.map(str).filter(Boolean);

    const [enablements, bound, links] = await Promise.all([
      enabledFor(project.tenantId),
      prisma.projectStandard.findMany({
        where: { projectId: project.id },
        select: { standardId: true },
      }),
      // Which frameworks this engagement's tasks are already mapped into. A
      // standard cannot be unbound while its clauses are still linked.
      prisma.projectTaskClause.findMany({
        where: { task: { projectId: project.id } },
        select: { clause: { select: { standardId: true } } },
      }),
    ]);

    // Anything requested that this organisation has not enabled has no row
    // here, and lands as STANDARD_NOT_ENABLED rather than silently vanishing.
    // Requested ids outside the enabled set still need their own row so the
    // refusal can name the code rather than the uuid.
    const enabledById = new Map(enablements.map((e) => [e.standard.id, e]));
    const unknownIds = requested.filter((id) => !enabledById.has(id));
    const extra = unknownIds.length
      ? await prisma.standard.findMany({
        where: { id: { in: unknownIds } },
        select: { id: true, code: true, title: true, tenantId: true },
      })
      : [];

    const found: StandardCandidate[] = [
      ...enablements.map((e) => ({
        id: e.standard.id,
        code: e.standard.code,
        title: e.standard.title,
        tenantId: e.standard.tenantId,
        enabled: true,
        applicability: e.applicability,
      })),
      ...extra.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        tenantId: s.tenantId,
        enabled: false,
        applicability: null,
      })),
    ];

    const plan = planStandardBinding({
      projectTenantId: project.tenantId,
      requested,
      found,
      bound: bound.map((b) => b.standardId),
      inUse: [...new Set(links.map((l) => l.clause.standardId))],
    });

    if (!plan.ok) {
      res.status(plan.status).json({
        status: 'error', code: plan.code, message: plan.message,
      });
      return;
    }

    if (plan.add.length === 0 && plan.remove.length === 0) {
      res.json({
        status: 'success',
        message: 'No change — the engagement was already bound to exactly those frameworks.',
        added: 0,
        removed: 0,
      });
      return;
    }

    const codeOf = new Map(found.map((s) => [s.id, s.code]));
    const userId = str(req.user!.id);

    await prisma.$transaction(async (tx) => {
      if (plan.remove.length > 0) {
        await tx.projectStandard.deleteMany({
          where: { projectId: project.id, standardId: { in: plan.remove } },
        });
      }
      if (plan.add.length > 0) {
        await tx.projectStandard.createMany({
          data: plan.add.map((standardId) => ({
            projectId: project.id, standardId, addedById: userId,
          })),
          skipDuplicates: true,
        });
      }

      // One entry for the whole change. The scope of an engagement is a single
      // agreed fact, and splitting it across two entries would make "what were
      // we running against in March" two queries instead of one.
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_STANDARDS_SET',
        subjectType: 'Project',
        subjectId: project.id,
        payload: {
          projectRef: project.ref,
          added: plan.add.map((id) => codeOf.get(id) || id),
          removed: plan.remove.map((id) => codeOf.get(id) || id),
          kept: plan.keep.map((id) => codeOf.get(id) || id),
        },
      });
    });

    res.json({
      status: 'success',
      message: 'Engagement frameworks updated.',
      added: plan.add.length,
      removed: plan.remove.length,
    });
  } catch (error: any) {
    console.error('[Project Standards Set Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update engagement frameworks' });
  }
};

// ─── Clauses a task may be mapped to ────────────────────────────────────────

/**
 * Every clause of every framework this engagement is bound to.
 *
 * The picker's whole list, because a clause the engagement is not in scope for
 * should not be offerable: a link outside the denominator makes the coverage
 * figure's numerator and denominator come from different sets.
 */
export const projectClauses = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project } = await guardProject(req.user!, str(req.params.id));
    if (!project) { notFound(res); return; }

    const bound = await prisma.projectStandard.findMany({
      where: { projectId: project.id },
      select: { standardId: true },
    });

    const clauses = bound.length
      ? await prisma.standardClause.findMany({
        where: { standardId: { in: bound.map((b) => b.standardId) } },
        select: {
          id: true, ref: true, title: true,
          standard: { select: { id: true, code: true } },
        },
        orderBy: [{ standard: { code: 'asc' } }, { ref: 'asc' }],
      })
      : [];

    res.json({
      status: 'success',
      clauses: clauses.map((c) => ({
        id: c.id,
        ref: c.ref,
        title: c.title,
        standardId: c.standard.id,
        standardCode: c.standard.code,
      })),
      // An empty list means one of two different things, and the screen has to
      // say which: no frameworks bound, or frameworks bound that carry no
      // clauses yet.
      bound: bound.length,
    });
  } catch (error: any) {
    console.error('[Project Clauses Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load clauses' });
  }
};
