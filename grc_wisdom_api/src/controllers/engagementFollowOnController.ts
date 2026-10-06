import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { notify } from '../services/notificationService';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { DAY_MS } from '../services/engagementRules';
import { checkScopeDraft, bindingScope } from '../services/engagementScope';
import { isEnded } from '../services/engagementAfterClose';
import { isComplete } from '../services/projectLifecycle';
import { str, Conflict, send, notFound, loadEngagement, clientSide, flagFor, bothTrails } from './engagementController';

/**
 * The follow-on engagement (consulting engagement, sprint 7): the next piece
 * of work with the same firm, started from a closed engagement.
 *
 * Same relationship, so no invitation. The plan's structure is copied with
 * its dates moved to the new start and none of its progress; the tasks still
 * open at close, and the blockers still open, come across marked "carried
 * over", and so do the gaps still open with their corrective action plans:
 * the same gap in the organisation's register, linked from the follow-on's
 * assessment of its clause, never a second one (sprint 10). The firm's
 * people who were approved are nominated again, and the
 * organisation approves each one, with their dates, on the Team tab: nobody
 * from the firm reads the new engagement until then. The scope comes across
 * as a draft for the organisation to approve, never binding by itself.
 *
 * The organisation decides whether the engagement before is in scope: when
 * it is, the firm's approved people on the follow-on may read it, read-only,
 * whatever its own window after close says.
 */

const shiftBy = (d: Date | null, ms: number): Date | null => (d ? new Date(d.getTime() + ms) : null);

/** POST /api/engagements/:projectId/follow-on { name, startDate, targetEndDate?, previousInScope?, ownerId?, managerId? } */
export const createFollowOn = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const prev = await loadEngagement(str(req.params.projectId));
    if (!prev || !(await clientSide(req, prev))) { notFound(res); return; }
    const refusal = await flagFor(prev);
    if (refusal) { send(res, refusal); return; }
    if (!prev.providerTenantId || prev.providerTenantId === prev.tenantId) {
      send(res, { status: 409, code: 'NO_FIRM', message: 'No firm delivered this engagement.' }); return;
    }
    if (prev.status !== 'Closed') {
      send(res, { status: 409, code: 'NOT_CLOSED', message: 'A follow-on starts from a closed engagement.' }); return;
    }
    const relationship = await prisma.providerRelationship.findUnique({
      where: { clientTenantId_firmTenantId: { clientTenantId: prev.tenantId, firmTenantId: prev.providerTenantId } },
      select: { status: true },
    });
    if (!relationship || relationship.status !== 'Active') {
      send(res, {
        status: 409, code: 'NO_RELATIONSHIP',
        message: `There is no working relationship with ${prev.providerTenant?.name || 'the firm'} to continue. Create the engagement and invite the firm.`,
      });
      return;
    }
    const firm = await prisma.tenant.findUnique({ where: { id: prev.providerTenantId }, select: { suspendedAt: true, name: true } });
    if (!firm || firm.suspendedAt) { send(res, { status: 409, code: 'FIRM_SUSPENDED', message: `${firm?.name || 'The firm'} is suspended.` }); return; }

    const b = req.body || {};
    const name = str(b.name).trim().slice(0, 200);
    if (!name) { send(res, { status: 400, message: 'Name the follow-on engagement.' }); return; }
    const start = new Date(str(b.startDate));
    if (Number.isNaN(start.getTime())) { send(res, { status: 400, message: 'Give the date the follow-on starts.' }); return; }
    const shift = Math.round((start.getTime() - prev.startDate.getTime()) / DAY_MS) * DAY_MS;
    const target = b.targetEndDate ? new Date(str(b.targetEndDate)) : new Date(prev.targetEndDate.getTime() + shift);
    if (Number.isNaN(target.getTime()) || target <= start) {
      send(res, { status: 400, message: 'The target end date must be a valid date after the start.' }); return;
    }
    if (b.previousInScope !== undefined && typeof b.previousInScope !== 'boolean') {
      send(res, { status: 400, message: 'previousInScope is true or false.' }); return;
    }
    const previousInScope = b.previousInScope === true;
    // The owner and manager carry over unless the organisation names others;
    // either way they must still be active people of the organisation.
    const ownerId = str(b.ownerId || prev.ownerId);
    const managerId = str(b.managerId || prev.managerId);
    const people = await prisma.user.count({ where: { id: { in: [...new Set([ownerId, managerId])] }, tenantId: prev.tenantId, status: 'Active' } });
    if (people < new Set([ownerId, managerId]).size) {
      send(res, { status: 400, code: 'OWNER_GONE', message: 'Name an owner and a manager who are active people of the organisation.' }); return;
    }

    const actorId = str(req.user!.id);
    const now = new Date();
    const source = await prisma.project.findUniqueOrThrow({
      where: { id: prev.id },
      select: {
        description: true, objectives: true, projectType: true, priority: true, verificationPolicy: true, sponsorId: true,
        phases: {
          orderBy: [{ sequence: 'asc' }],
          select: {
            id: true, sequence: true, name: true, description: true, objectives: true, startDate: true, targetEndDate: true, ownerId: true,
            tasks: {
              orderBy: [{ sequence: 'asc' }],
              select: {
                id: true, sequence: true, ref: true, name: true, description: true, status: true, weight: true, priority: true,
                side: true, department: true, startDate: true, dueDate: true, verificationOverride: true,
                assignee: { select: { id: true, tenantId: true, status: true } },
                clauseLinks: { select: { clauseId: true, note: true, clause: { select: { standardId: true } } } },
              },
            },
          },
        },
        dependencies: { select: { predecessorId: true, successorId: true, kind: true, lagDays: true, note: true } },
        impediments: {
          where: { kind: 'Blocker', resolvedAt: null },
          orderBy: [{ raisedAt: 'asc' }],
          select: { id: true, phaseId: true, taskId: true, kind: true, category: true, owingSide: true, severity: true, title: true, description: true },
        },
        standards: { select: { standardId: true } },
        members: {
          where: { active: true },
          select: {
            userId: true, side: true, roleLabel: true, raci: true, allocation: true, engagementRole: true, memberStatus: true,
            user: { select: { tenantId: true, status: true } },
          },
        },
      },
    });
    const enabled = new Set((await prisma.tenantStandardEnablement.findMany({
      where: { tenantId: prev.tenantId, standardId: { in: source.standards.map((s) => s.standardId) } },
      select: { standardId: true },
    })).map((s) => s.standardId));
    const standards = source.standards.map((s) => s.standardId).filter((id) => enabled.has(id));

    // The gaps still open, each with its corrective action plan, which lives
    // on the gap. They are carried by linking: the follow-on gets a copy of
    // the clause's current assessment naming the same Issue, so the register
    // keeps one gap per clause, reassessing on the follow-on keeps it, and the
    // follow-on's readiness counts it until someone independent closes it.
    const assessed = await prisma.clauseAssessment.findMany({
      where: { projectId: prev.id, supersededAt: null, issueId: { not: null } },
      select: {
        id: true, tenantId: true, clauseId: true, result: true, justification: true, gapType: true, issueId: true,
        assessedById: true, side: true, assessedAt: true,
      },
    });
    const stillOpen = new Set((assessed.length ? await prisma.issue.findMany({
      where: { id: { in: assessed.map((x) => x.issueId!) }, source: 'ConsultingGap', status: { notIn: ['Closed', 'Cancelled'] } },
      select: { id: true },
    }) : []).map((i) => i.id));
    const openGaps = assessed.filter((x) => stillOpen.has(x.issueId!));

    // The scope the firm worked under, offered again as a draft and checked
    // as any draft is, so an entity or framework since gone is not carried.
    const before = await bindingScope(prev.id);
    const scopeDraft = before ? await checkScopeDraft(prev.tenantId, {
      entityIds: before.entityIds, frameworkIds: before.frameworkIds, services: before.services,
      classificationCeiling: before.classificationCeiling,
      validFrom: start, validTo: new Date(target.getTime() + 30 * DAY_MS),
      note: `Carried from ${prev.ref}, version ${before.version}.`,
    }) : null;

    const created = await prisma.$transaction(async (tx) => {
      // One follow-on of a name per engagement, so a second press of the
      // button does not start a second one.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-ref:${prev.tenantId}`}))`;
      const twin = await tx.project.count({ where: { previousProjectId: prev.id, name } });
      if (twin > 0) throw new Conflict('FOLLOW_ON_EXISTS', `A follow-on called ${name} already exists for ${prev.ref}.`);
      // PRJ-0001, sequential per organisation: projectController's convention.
      const ref = `PRJ-${String((await tx.project.count({ where: { tenantId: prev.tenantId } })) + 1).padStart(4, '0')}`;

      const project = await tx.project.create({
        data: {
          tenantId: prev.tenantId, providerTenantId: prev.providerTenantId, ref, name,
          description: source.description, objectives: source.objectives, projectType: source.projectType,
          priority: source.priority, verificationPolicy: source.verificationPolicy,
          startDate: start, targetEndDate: target, ownerId, managerId, sponsorId: source.sponsorId,
          deliveryStyle: prev.deliveryStyle, documentAccess: prev.documentAccess,
          closeWindowDays: prev.closeWindowDays,
          reportCopiesAllowed: prev.reportCopiesAllowed === true, reportCopiesSetAt: now, reportCopiesSetById: actorId,
          previousProjectId: prev.id, previousInScope,
        },
        select: { id: true, ref: true, name: true, tenantId: true },
      });

      // The organisation's side: owner, manager and the rest of its team.
      const clientRows = new Map<string, { roleLabel: string; raci: string; allocation: number | null }>();
      for (const m of source.members) {
        if (m.side === 'Client' && m.user.tenantId === prev.tenantId && m.user.status === 'Active') {
          clientRows.set(m.userId, { roleLabel: m.roleLabel, raci: m.raci, allocation: m.allocation });
        }
      }
      for (const [userId, label] of [[ownerId, 'Project Owner'], [managerId, 'Project Manager']] as const) {
        if (!clientRows.has(userId)) clientRows.set(userId, { roleLabel: label, raci: 'A', allocation: null });
      }
      await tx.projectMember.createMany({
        data: [...clientRows].map(([userId, m]) => ({
          projectId: project.id, userId, side: 'Client', roleLabel: m.roleLabel, raci: m.raci, allocation: m.allocation,
        })),
        skipDuplicates: true,
      });
      // The firm's people who were approved, nominated again: no access until
      // the organisation approves each one, with their dates.
      const nominated = source.members.filter((m) => (
        m.side === 'Provider' && m.memberStatus === 'Approved' && m.engagementRole
        && m.user.tenantId === prev.providerTenantId && m.user.status === 'Active'
      ));
      await tx.projectMember.createMany({
        data: nominated.map((m) => ({
          projectId: project.id, userId: m.userId, side: 'Provider', roleLabel: m.roleLabel, raci: m.raci ?? 'R',
          allocation: m.allocation, engagementRole: m.engagementRole, memberStatus: 'Nominated',
          nominatedById: actorId, nominatedAt: now, origin: 'FollowOn',
        })),
        skipDuplicates: true,
      });

      if (standards.length > 0) {
        await tx.projectStandard.createMany({
          data: standards.map((standardId) => ({ projectId: project.id, standardId, addedById: actorId })),
          skipDuplicates: true,
        });
      }

      // The plan: every phase and task, moved to the new dates, none of the progress.
      const taskIds = new Map<string, string>();
      const phaseIds = new Map<string, string>();
      let carriedTasks = 0;
      for (const ph of source.phases) {
        const phase = await tx.projectPhase.create({
          data: {
            projectId: project.id, sequence: ph.sequence, name: ph.name, description: ph.description, objectives: ph.objectives,
            startDate: shiftBy(ph.startDate, shift)!, targetEndDate: shiftBy(ph.targetEndDate, shift)!, ownerId: ph.ownerId,
          },
          select: { id: true },
        });
        phaseIds.set(ph.id, phase.id);
        for (const t of ph.tasks) {
          const open = !isComplete(t.status);
          if (open) carriedTasks += 1;
          const keepAssignee = t.assignee && t.assignee.tenantId === prev.tenantId && t.assignee.status === 'Active';
          const task = await tx.projectTask.create({
            data: {
              projectId: project.id, phaseId: phase.id, sequence: t.sequence, ref: t.ref, name: t.name, description: t.description,
              weight: t.weight, priority: t.priority, side: t.side, department: t.department,
              assigneeId: keepAssignee ? t.assignee!.id : null,
              startDate: shiftBy(t.startDate, shift), dueDate: shiftBy(t.dueDate, shift),
              verificationOverride: t.verificationOverride, carriedFromTaskId: open ? t.id : null,
            },
            select: { id: true },
          });
          taskIds.set(t.id, task.id);
          const links = t.clauseLinks.filter((l) => enabled.has(l.clause.standardId));
          if (links.length > 0) {
            await tx.projectTaskClause.createMany({
              data: links.map((l) => ({ taskId: task.id, clauseId: l.clauseId, note: l.note, linkedById: actorId })),
              skipDuplicates: true,
            });
          }
        }
      }
      const edges = source.dependencies.filter((d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId));
      if (edges.length > 0) {
        await tx.projectDependency.createMany({
          data: edges.map((d) => ({
            projectId: project.id, predecessorId: taskIds.get(d.predecessorId)!, successorId: taskIds.get(d.successorId)!,
            kind: d.kind, lagDays: d.lagDays, note: d.note, linkedById: actorId,
          })),
          skipDuplicates: true,
        });
      }
      // The blockers still open: they start costing time on the new engagement
      // from today, so the closed engagement's ledger is not counted twice.
      let n = 0;
      for (const imp of source.impediments) {
        n += 1;
        await tx.projectImpediment.create({
          data: {
            projectId: project.id, ref: `IMP-${String(n).padStart(4, '0')}`,
            phaseId: imp.phaseId ? phaseIds.get(imp.phaseId) ?? null : null,
            taskId: imp.taskId ? taskIds.get(imp.taskId) ?? null : null,
            kind: imp.kind, category: imp.category, owingSide: imp.owingSide, severity: imp.severity,
            title: imp.title, description: imp.description, raisedById: actorId, raisedAt: now, carriedFromId: imp.id,
          },
        });
      }
      if (openGaps.length > 0) {
        await tx.clauseAssessment.createMany({
          data: openGaps.map((x) => ({
            projectId: project.id, tenantId: x.tenantId, clauseId: x.clauseId, result: x.result, justification: x.justification,
            gapType: x.gapType, issueId: x.issueId, assessedById: x.assessedById, side: x.side, assessedAt: x.assessedAt,
            carriedFromId: x.id,
          })),
        });
      }

      let scopeCopied = false;
      if (scopeDraft?.ok) {
        const v = scopeDraft.value;
        await tx.engagementScopeVersion.create({
          data: {
            projectId: project.id, version: 1, status: 'Draft', origin: 'FollowOn',
            entityIds: JSON.stringify(v.entityIds), frameworkIds: JSON.stringify(v.frameworkIds), services: JSON.stringify(v.services),
            classificationCeiling: v.classificationCeiling, validFrom: v.validFrom, validTo: v.validTo, note: v.note,
            draftedById: actorId,
          },
        });
        scopeCopied = true;
      }

      const counts = {
        phases: source.phases.length, tasks: taskIds.size, carriedTasks, carriedBlockers: source.impediments.length,
        carriedGaps: openGaps.length, nominated: nominated.length, scopeCopied,
      };
      await bothTrails(tx, {
        e: project, firmTenantId: prev.providerTenantId, actorId, action: 'ENGAGEMENT_FOLLOW_ON_CREATED',
        payload: { previousProjectId: prev.id, previousRef: prev.ref, previousInScope, ...counts },
        firmPayload: { previousRef: prev.ref, client: prev.tenant?.name, previousInScope, nominated: nominated.length },
      });
      const leads = nominated.filter((m) => m.engagementRole === 'Lead').map((m) => m.userId);
      await notify(tx, leads.map((recipientId) => ({
        tenantId: prev.providerTenantId!, recipientId, actorId, event: 'ENGAGEMENT_FOLLOW_ON', subjectType: 'Project', subjectId: project.id,
        title: `${prev.tenant?.name} started ${project.ref}, following ${prev.ref}`,
        body: 'You and your team are nominated again. Access starts when the organisation approves each person.',
        link: 'project-delivery',
      })));
      return { ...project, ...counts };
    });
    res.status(201).json({ status: 'success', project: created });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Follow-on Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to start the follow-on engagement' });
  }
};

/**
 * PATCH /api/engagements/:projectId/previous-in-scope { inScope, reason }
 * Whether the firm's people on a follow-on may read the engagement before it.
 */
export const setPreviousInScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) {
      if (e && e.providerTenantId === req.user!.tenantId) {
        send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation decides whether the engagement before is in scope.' });
        return;
      }
      notFound(res); return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (!e.previousProjectId) { send(res, { status: 409, code: 'NOT_A_FOLLOW_ON', message: 'This engagement does not follow another.' }); return; }
    if (isEnded(e.status)) { send(res, { status: 409, code: 'PROJECT_FROZEN', message: `This engagement is ${e.status}.` }); return; }
    if (typeof req.body?.inScope !== 'boolean') { send(res, { status: 400, message: 'inScope is true or false.' }); return; }
    const inScope: boolean = req.body.inScope;
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const before = e.previousInScope === true;
    if (before === inScope) { res.json({ status: 'success', previousInScope: inScope, changed: false }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: e.id }, data: { previousInScope: inScope } });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_PREVIOUS_SCOPE_SET',
        payload: { previousProjectId: e.previousProjectId, from: before, to: inScope, reason },
      });
      const leads = e.providerTenantId ? await tx.projectMember.findMany({
        where: { projectId: e.id, side: 'Provider', engagementRole: 'Lead', memberStatus: 'Approved', active: true }, select: { userId: true },
      }) : [];
      await notify(tx, leads.map((l) => ({
        tenantId: e.providerTenantId!, recipientId: l.userId, actorId, event: 'ENGAGEMENT_PREVIOUS_SCOPE_SET',
        subjectType: 'Project', subjectId: e.id,
        title: inScope ? `The engagement before ${e.ref} is now in scope` : `The engagement before ${e.ref} is no longer in scope`,
        body: reason, link: 'project-delivery',
      })));
    });
    res.json({ status: 'success', previousInScope: inScope, changed: true });
  } catch (error: any) {
    console.error('[Previous Scope Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change whether the engagement before is in scope' });
  }
};
