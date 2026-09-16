import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, StaleTenantError } from '../services/scopeResolver';
import { guardProject } from '../services/projectGuard';
import { notify } from '../services/notificationService';
import {
  planMemberAdd, planMemberRemove, commitments, MemberRow, RACI, SIDES,
} from '../services/projectMembership';

/**
 * Staffing an engagement.
 *
 * WHAT THIS REPLACED — history, not current behaviour. Until these handlers
 * existed, ProjectMember was written in exactly one place in the whole API (a
 * createMany at project creation putting the owner and manager on the team) and
 * read nowhere; no endpoint added, removed or changed anybody, while the
 * portfolio rendered a member count, so the product showed the size of a set
 * that could never move. That is fixed by the code below.
 *
 * The decisions are in services/projectMembership, pure and pinned without a
 * database. This loads rows, calls them, and audits.
 */

const SUBJECT = 'ProjectMember';

const toRow = (m: any): MemberRow => ({
  id: m.id,
  userId: m.userId,
  userName: m.user?.name || m.userId,
  side: m.side,
  roleLabel: m.roleLabel,
  raci: m.raci,
  allocation: m.allocation,
  active: m.active,
});

const MEMBER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, tenantId: true } },
} as const;

/** The team, and the vocabulary for changing it. */
export const listMembers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project } = await guardProject(req.user!, String(req.params.id));
    if (!project) {
      // Not found rather than forbidden: a 403 confirms the project exists.
      res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Project not found' });
      return;
    }

    const members = await prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: MEMBER_INCLUDE,
      orderBy: [{ active: 'desc' }, { addedAt: 'asc' }],
    });

    res.json({
      status: 'success',
      projectId: project.id,
      // Named so the screen can mark them and refuse to offer removal.
      accountable: { ownerId: project.ownerId, managerId: project.managerId },
      hasProvider: project.providerTenantId !== null,
      sides: SIDES,
      raci: RACI,
      members: members.map((m) => ({
        ...toRow(m),
        email: m.user?.email || null,
        tenantId: m.user?.tenantId || null,
      })),
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[List Project Members Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the team' });
  }
};

export const addMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite } = await guardProject(req.user!, String(req.params.id));
    if (!project) {
      res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Project not found' });
      return;
    }
    if (!canWrite) {
      res.status(403).json({
        status: 'error',
        code: 'READ_ONLY',
        message: 'You can see this engagement but not change it.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!);
    const userId = String(req.body?.userId || '');

    const [candidate, existing] = await Promise.all([
      userId
        ? prisma.user.findFirst({
          // Scoped at the lookup, so an id outside the caller's reach is simply
          // not found rather than confirmed to exist.
          where: { id: userId, tenantId: { in: scope.tenantIds } },
          select: { id: true, tenantId: true, name: true },
        })
        : Promise.resolve(null),
      prisma.projectMember.findMany({
        where: { projectId: project.id }, include: MEMBER_INCLUDE,
      }),
    ]);

    const plan = planMemberAdd({
      project,
      candidate,
      scopeTenantIds: scope.tenantIds,
      existing: existing.map(toRow),
      side: req.body?.side,
      roleLabel: req.body?.roleLabel,
      raci: req.body?.raci,
      allocation: req.body?.allocation,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      // Somebody taken off before and put back on keeps their row, which keeps
      // the history of when they were first added. The model deactivates
      // rather than deleting for that reason.
      const row = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: candidate!.id } },
        create: {
          projectId: project.id,
          userId: candidate!.id,
          side: plan.side,
          roleLabel: plan.roleLabel,
          raci: plan.raci,
          allocation: plan.allocation,
        },
        update: {
          active: true,
          side: plan.side,
          roleLabel: plan.roleLabel,
          raci: plan.raci,
          allocation: plan.allocation,
        },
        include: MEMBER_INCLUDE,
      });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: String(req.user!.id),
        action: 'PROJECT_MEMBER_ADDED',
        subjectType: SUBJECT,
        subjectId: row.id,
        payload: {
          projectId: project.id,
          userId: candidate!.id,
          userName: candidate!.name,
          roleLabel: plan.roleLabel,
          raci: plan.raci,
          side: plan.side,
          allocation: plan.allocation,
        },
      });

      // Being staffed onto an engagement told nobody, including the person
      // staffed. They were expected to discover it by opening a project they
      // had no reason to look at.
      await notify(tx, {
        tenantId: project.tenantId,
        recipientId: candidate!.id,
        actorId: String(req.user!.id),
        event: 'PROJECT_MEMBER_ADDED',
        subjectType: SUBJECT,
        subjectId: project.id,
        title: `You are on ${project.ref}: ${project.name}`,
        body: `As ${plan.roleLabel} (${plan.raci})`
          + `${plan.allocation === null ? '' : `, ${plan.allocation}% of your time`}.`,
        link: 'my-work',
      });

      return row;
    });

    res.status(201).json({
      status: 'success',
      message: `${candidate!.name} added as ${plan.roleLabel}.`,
      member: toRow(created),
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Add Project Member Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add the team member' });
  }
};

export const updateMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite } = await guardProject(req.user!, String(req.params.id));
    if (!project) {
      res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Project not found' });
      return;
    }
    if (!canWrite) {
      res.status(403).json({ status: 'error', code: 'READ_ONLY', message: 'You can see this engagement but not change it.' });
      return;
    }

    const existing = await prisma.projectMember.findMany({
      where: { projectId: project.id }, include: MEMBER_INCLUDE,
    });
    const member = existing.find((m) => m.id === String(req.params.memberId));
    if (!member) {
      res.status(404).json({ status: 'error', code: 'NOT_A_MEMBER', message: 'That person is not on this engagement.' });
      return;
    }

    // Changing somebody's terms is the same decision as adding them on those
    // terms, so it is validated by the same function rather than a second copy
    // of the rules that would drift from it.
    const scope = await resolveTenantScope(req.user!);
    const plan = planMemberAdd({
      project,
      candidate: { id: member.userId, tenantId: member.user?.tenantId || '', name: member.user?.name || '' },
      scopeTenantIds: scope.tenantIds,
      // Without themselves, or they collide with their own row.
      existing: existing.filter((m) => m.id !== member.id).map(toRow),
      side: req.body?.side ?? member.side,
      roleLabel: req.body?.roleLabel ?? member.roleLabel,
      raci: req.body?.raci ?? member.raci,
      allocation: req.body?.allocation === undefined ? member.allocation : req.body.allocation,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.projectMember.update({
        where: { id: member.id },
        data: {
          side: plan.side, roleLabel: plan.roleLabel, raci: plan.raci, allocation: plan.allocation,
        },
        include: MEMBER_INCLUDE,
      });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: String(req.user!.id),
        action: 'PROJECT_MEMBER_CHANGED',
        subjectType: SUBJECT,
        subjectId: row.id,
        payload: {
          projectId: project.id,
          userId: row.userId,
          before: { roleLabel: member.roleLabel, raci: member.raci, side: member.side, allocation: member.allocation },
          after: { roleLabel: plan.roleLabel, raci: plan.raci, side: plan.side, allocation: plan.allocation },
        },
      });
      return row;
    });

    res.json({ status: 'success', message: 'Team member updated.', member: toRow(updated) });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Update Project Member Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the team member' });
  }
};

export const removeMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite } = await guardProject(req.user!, String(req.params.id));
    if (!project) {
      res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Project not found' });
      return;
    }
    if (!canWrite) {
      res.status(403).json({ status: 'error', code: 'READ_ONLY', message: 'You can see this engagement but not change it.' });
      return;
    }

    const found = await prisma.projectMember.findFirst({
      where: { id: String(req.params.memberId), projectId: project.id },
      include: MEMBER_INCLUDE,
    });

    const plan = planMemberRemove({ project, member: found ? toRow(found) : null });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Deactivated, never deleted. Who was on an engagement while a decision
      // was taken has to stay answerable after they leave it.
      await tx.projectMember.update({ where: { id: found!.id }, data: { active: false } });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: String(req.user!.id),
        action: 'PROJECT_MEMBER_REMOVED',
        subjectType: SUBJECT,
        subjectId: found!.id,
        payload: {
          projectId: project.id,
          userId: found!.userId,
          userName: found!.user?.name || null,
          roleLabel: found!.roleLabel,
        },
      });
    });

    res.json({
      status: 'success',
      message: `${found!.user?.name || 'That person'} taken off the engagement. Their assignment `
        + 'history is kept.',
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Remove Project Member Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove the team member' });
  }
};

/**
 * What each person is committed to, across every engagement in scope.
 *
 * "One person works on differrent project this will be specify that
 * organization which have the resourses." The schema carries an index on
 * [userId, active] built for exactly this and no query ever used it.
 */
export const getCommitments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);

    const rows = await prisma.projectMember.findMany({
      where: {
        active: true,
        project: {
          // Both sides of an engagement, the same rule canReadProject applies.
          OR: [
            { tenantId: { in: scope.tenantIds } },
            { providerTenantId: { in: scope.tenantIds } },
          ],
          status: { notIn: ['Closed', 'Cancelled', 'Completed'] },
        },
      },
      select: {
        userId: true,
        roleLabel: true,
        raci: true,
        allocation: true,
        user: { select: { name: true } },
        project: { select: { id: true, ref: true, name: true } },
      },
    });

    const people = commitments(rows.map((r) => ({
      userId: r.userId,
      userName: r.user?.name || r.userId,
      projectId: r.project.id,
      projectRef: r.project.ref,
      projectName: r.project.name,
      roleLabel: r.roleLabel,
      raci: r.raci,
      allocation: r.allocation,
    })));

    res.json({
      status: 'success',
      scope: scope.kind,
      counts: {
        people: people.length,
        overCommitted: people.filter((p) => p.overCommitted).length,
        // Named separately because unstated is not the same as free, and
        // treating it as zero would report a full-time person as available.
        withUnstatedAllocation: people.filter((p) => p.unstated > 0).length,
      },
      people,
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Project Commitments Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load commitments' });
  }
};
