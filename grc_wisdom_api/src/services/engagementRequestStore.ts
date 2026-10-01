import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from './notificationService';

/**
 * Writing an information request (consulting engagement, sprint 8). One path
 * for a request raised on screen, imported from a file, or raised when the
 * scope change it waited for binds: the reference, the record and both
 * organisations' trails, inside the caller's transaction.
 */

export interface NewRequest {
  kind: string;
  title: string;
  criteria: string | null;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  dueDate: Date;
  assigneeId: string;
  importedFrom?: string | null;
  scopeChangeId?: string | null;
}

export interface RequestEngagement {
  id: string; ref: string; name: string; tenantId: string; providerTenantId: string | null;
}

/** REQ-0001 onwards, per engagement, under the engagement's request lock. */
async function nextRef(tx: any, projectId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`requests:${projectId}`}))`;
  const n = await tx.informationRequest.count({ where: { projectId } });
  return `REQ-${String(n + 1).padStart(4, '0')}`;
}

/**
 * Creates the requests and writes their trail: one entry per request, or one
 * entry naming every request when they came in together (an import).
 */
export async function createRequests(tx: any, args: {
  e: RequestEngagement; raisedById: string; requests: NewRequest[]; action: string; source?: Record<string, unknown>;
}): Promise<{ id: string; ref: string; assigneeId: string; title: string }[]> {
  const made: { id: string; ref: string; assigneeId: string; title: string }[] = [];
  for (const r of args.requests) {
    const ref = await nextRef(tx, args.e.id);
    const row = await tx.informationRequest.create({
      data: {
        projectId: args.e.id, ref, kind: r.kind, title: r.title, criteria: r.criteria,
        targetType: r.targetType, targetId: r.targetId, targetLabel: r.targetLabel,
        periodFrom: r.periodFrom, periodTo: r.periodTo, dueDate: r.dueDate, assigneeId: r.assigneeId,
        raisedById: args.raisedById, importedFrom: r.importedFrom ?? null, scopeChangeId: r.scopeChangeId ?? null,
      },
      select: { id: true, ref: true, assigneeId: true, title: true },
    });
    made.push(row);
  }
  const summary = made.map((m, i) => ({
    ref: m.ref, kind: args.requests[i].kind, target: args.requests[i].targetLabel, due: args.requests[i].dueDate,
  }));
  const one = made.length === 1;
  await writeAudit(tx, {
    tenantId: args.e.tenantId, actorId: args.raisedById, action: args.action,
    subjectType: one ? 'InformationRequest' : 'Project', subjectId: one ? made[0].id : args.e.id,
    payload: { projectRef: args.e.ref, ...(args.source ?? {}), requests: summary },
  });
  if (args.e.providerTenantId && args.e.providerTenantId !== args.e.tenantId) {
    await writeAudit(tx, {
      tenantId: args.e.providerTenantId, actorId: args.raisedById, action: args.action,
      subjectType: one ? 'InformationRequest' : 'Project', subjectId: one ? made[0].id : args.e.id,
      payload: { projectRef: args.e.ref, clientTenantId: args.e.tenantId, ...(args.source ?? {}), refs: made.map((m) => m.ref) },
    });
  }
  // One notice per person, however many requests they were given.
  const byAssignee = new Map<string, string[]>();
  for (const m of made) byAssignee.set(m.assigneeId, [...(byAssignee.get(m.assigneeId) ?? []), m.ref]);
  await notify(tx, [...byAssignee].map(([recipientId, refs]) => ({
    tenantId: args.e.tenantId, recipientId, actorId: args.raisedById, event: 'ENGAGEMENT_REQUEST_RAISED',
    subjectType: 'Project', subjectId: args.e.id,
    title: refs.length === 1 ? `${refs[0]}: the firm asks you for ${made.find((m) => m.ref === refs[0])!.title}` : `The firm asks you for ${refs.length} things on ${args.e.ref}`,
    body: `Answer from the Requests tab of ${args.e.ref} · ${args.e.name}.`,
    link: 'project-delivery',
  })));
  return made;
}
