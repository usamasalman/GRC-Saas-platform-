import { writeAudit } from '../middlewares/auditMiddleware';
import { buildSchedule } from './projectVariance';
import { impedimentCost } from './projectDelay';

/**
 * The delivery firm's own record of an engagement (consulting engagement,
 * sprint 7), frozen at close and kept in the firm's tenant for good.
 *
 * A copy, not a view: the window after close ends, the client's records go
 * out of reach, and the firm still has what it did. It holds the firm's own
 * record only: the engagement's name, the client, the dates, the team, the
 * phases and tasks with planned, actual and variance, the project figures
 * and the delay ledger. No document, evidence, risk or asset of the client's.
 */

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const span = (s: { start: Date | null; finish: Date | null }) => ({ start: day(s.start), finish: day(s.finish) });

/** Writes the record inside the close transaction; nothing when no firm delivers it. */
export async function keepEngagementRecord(tx: any, args: { projectId: string; actorId: string; now: Date; outcome: string }): Promise<string | null> {
  const p = await tx.project.findUnique({
    where: { id: args.projectId },
    select: {
      id: true, ref: true, name: true, projectType: true, deliveryStyle: true, tenantId: true, providerTenantId: true,
      startDate: true, targetEndDate: true, baselineStartDate: true, baselineTargetEndDate: true, baselineVersion: true,
      firstBaselineStartDate: true, firstBaselineTargetEndDate: true, reportedProgress: true, verifiedProgress: true,
      tenant: { select: { name: true } },
      manager: { select: { name: true } },
      holds: { select: { startedAt: true, endedAt: true } },
      dependencies: { select: { predecessorId: true, successorId: true, kind: true, lagDays: true } },
      phases: {
        orderBy: [{ sequence: 'asc' }],
        select: {
          id: true, name: true, startDate: true, targetEndDate: true, baselineTargetEndDate: true, firstBaselineTargetEndDate: true,
          tasks: {
            orderBy: [{ sequence: 'asc' }],
            select: {
              id: true, ref: true, name: true, side: true, status: true, startDate: true, dueDate: true, completedAt: true,
              actualStartDate: true, baselineStartDate: true, baselineDueDate: true, firstBaselineStartDate: true, firstBaselineDueDate: true,
            },
          },
        },
      },
      impediments: {
        orderBy: [{ raisedAt: 'asc' }],
        select: {
          ref: true, kind: true, category: true, owingSide: true, title: true, impactDays: true,
          raisedAt: true, resolvedAt: true, taskId: true, phaseId: true,
        },
      },
      // The firm's people: approved or removed on an engagement with roles,
      // and the firm's team as it stood on one set up the old way.
      members: {
        where: { side: 'Provider', OR: [{ memberStatus: { in: ['Approved', 'Removed'] } }, { memberStatus: null }] },
        select: {
          engagementRole: true, roleLabel: true, memberStatus: true, accessFrom: true, accessTo: true,
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!p || !p.providerTenantId || p.providerTenantId === p.tenantId) return null;

  const schedule = buildSchedule({
    project: p, phases: p.phases, ledger: p.impediments, holds: p.holds, edges: p.dependencies, now: args.now,
  });
  const plan = p.phases.map((ph: any) => {
    const f = schedule.phases.find((x) => x.id === ph.id)!;
    return {
      name: ph.name, planned: span(f.planned), actual: { ...span(f.actual), forecast: f.actual.forecast },
      varianceDays: f.varianceDays, causes: f.causes,
      tasks: ph.tasks.map((t: any) => {
        const tf = schedule.tasks.get(t.id);
        return {
          ref: t.ref, name: t.name, side: t.side, status: t.status,
          planned: tf ? span(tf.planned) : null, actual: tf ? { ...span(tf.actual), forecast: tf.actual.forecast } : null,
          varianceDays: tf?.varianceDays ?? null,
        };
      }),
    };
  });
  const figures = {
    planned: span(schedule.project.planned), agreedFinish: day(schedule.project.agreedFinish), actual: { ...span(schedule.project.actual), forecast: schedule.project.actual.forecast },
    varianceDays: schedule.project.varianceDays, causes: schedule.project.causes,
    reportedProgress: p.reportedProgress, verifiedProgress: p.verifiedProgress, baselineVersion: p.baselineVersion,
  };
  const delayLedger = p.impediments.map((imp: any) => ({
    ref: imp.ref, kind: imp.kind, category: imp.category, owingSide: imp.owingSide, title: imp.title,
    raisedAt: day(imp.raisedAt), resolvedAt: day(imp.resolvedAt), days: impedimentCost(imp, args.now),
  }));
  const team = [
    ...p.members.map((m: any) => ({
      name: m.user.name, side: 'Firm', engagementRole: m.engagementRole, roleLabel: m.roleLabel, status: m.memberStatus,
      accessFrom: day(m.accessFrom), accessTo: day(m.accessTo),
    })),
    ...(p.manager ? [{ name: p.manager.name, side: 'Organisation', engagementRole: 'Project manager' }] : []),
  ];

  const record = await tx.engagementRecord.create({
    data: {
      firmTenantId: p.providerTenantId, projectId: p.id, clientTenantId: p.tenantId, clientName: p.tenant.name,
      ref: p.ref, name: p.name, projectType: p.projectType, deliveryStyle: p.deliveryStyle, outcome: args.outcome,
      startDate: p.startDate, targetEndDate: p.targetEndDate, closedAt: args.now,
      team: JSON.stringify(team), plan: JSON.stringify(plan), figures: JSON.stringify(figures), delayLedger: JSON.stringify(delayLedger),
      madeById: args.actorId,
    },
    select: { id: true },
  });
  await writeAudit(tx, {
    tenantId: p.providerTenantId, actorId: args.actorId, action: 'ENGAGEMENT_RECORD_KEPT', subjectType: 'EngagementRecord', subjectId: record.id,
    payload: { ref: p.ref, client: p.tenant.name, clientTenantId: p.tenantId, outcome: args.outcome, tasks: plan.reduce((n: number, ph: any) => n + ph.tasks.length, 0), ledger: delayLedger.length },
  });
  return record.id;
}
