import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from './notificationService';

/**
 * ITSM priority + SLA (TRD §7.3).
 *
 * Priority is DERIVED from (impact, urgency) on the server and is never
 * accepted from the client — a requester cannot self-declare P1.
 */

export const IMPACT_LEVELS = ['High', 'Medium', 'Low'] as const;
export const URGENCY_LEVELS = ['High', 'Medium', 'Low'] as const;

/** Standard ITIL 3×3 matrix. */
const MATRIX: Record<string, Record<string, string>> = {
  High:   { High: 'P1 Critical', Medium: 'P2 High',   Low: 'P3 Medium' },
  Medium: { High: 'P2 High',     Medium: 'P3 Medium', Low: 'P4 Low' },
  Low:    { High: 'P3 Medium',   Medium: 'P4 Low',    Low: 'P4 Low' },
};

/** Platform defaults; a tenant SlaPolicy row overrides these. */
export const DEFAULT_SLA: Record<string, { responseMins: number; resolveMins: number }> = {
  'P1 Critical': { responseMins: 15, resolveMins: 60 },
  'P2 High':     { responseMins: 60, resolveMins: 480 },
  'P3 Medium':   { responseMins: 240, resolveMins: 4320 },
  'P4 Low':      { responseMins: 480, resolveMins: 7200 },
};

export function computePriority(impact: string, urgency: string): string {
  const i = MATRIX[impact] ? impact : 'Medium';
  const u = MATRIX[i][urgency] ? urgency : 'Medium';
  return MATRIX[i][u];
}

/** Tenant policy wins; otherwise the platform row; otherwise the constant. */
export async function resolveSla(tenantId: string, priority: string) {
  const [tenantPolicy, platformPolicy] = await Promise.all([
    prisma.slaPolicy.findFirst({ where: { tenantId, priority } }),
    prisma.slaPolicy.findFirst({ where: { tenantId: null, priority } }),
  ]);
  const policy = tenantPolicy || platformPolicy;
  if (policy) return { responseMins: policy.responseMins, resolveMins: policy.resolveMins };
  return DEFAULT_SLA[priority] || DEFAULT_SLA['P4 Low'];
}

export async function computeSlaTargets(tenantId: string, priority: string, from = new Date()) {
  const { responseMins, resolveMins } = await resolveSla(tenantId, priority);
  return {
    slaResponseAt: new Date(from.getTime() + responseMins * 60_000),
    slaResolveAt: new Date(from.getTime() + resolveMins * 60_000),
  };
}

const CLOSED = ['Resolved', 'Closed', 'Cancelled'];

/** Derived view state — no writes, safe to call on every read. */
export function slaStateOf(t: {
  status: string; slaResolveAt: Date | null; resolvedAt: Date | null;
}): { state: 'met' | 'breached' | 'at-risk' | 'on-track' | 'none'; minutesRemaining: number | null } {
  if (!t.slaResolveAt) return { state: 'none', minutesRemaining: null };
  if (CLOSED.includes(t.status)) {
    const met = !t.resolvedAt || t.resolvedAt <= t.slaResolveAt;
    return { state: met ? 'met' : 'breached', minutesRemaining: null };
  }
  const remaining = Math.round((t.slaResolveAt.getTime() - Date.now()) / 60_000);
  if (remaining < 0) return { state: 'breached', minutesRemaining: remaining };
  if (remaining <= 30) return { state: 'at-risk', minutesRemaining: remaining };
  return { state: 'on-track', minutesRemaining: remaining };
}

/**
 * Escalation scan (TRD §7.3: every 5 minutes).
 *
 * In-process interval — correct for a single instance. In multi-instance
 * production this belongs in BullMQ so only one worker scans.
 */
export async function runEscalationScan(): Promise<{ breached: number; escalated: number }> {
  const now = new Date();
  let breached = 0;
  let escalated = 0;

  const atRisk = await prisma.ticket.findMany({
    where: {
      status: { notIn: CLOSED },
      slaResolveAt: { not: null, lt: now },
      slaBreached: false,
    },
    select: { id: true, tenantId: true, subject: true, priority: true, assigneeId: true, escalationLevel: true },
    take: 500,
  });

  for (const t of atRisk) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: t.id },
          data: { slaBreached: true, escalationLevel: t.escalationLevel + 1 },
        });
        await notify(tx, {
          tenantId: t.tenantId, recipientId: t.assigneeId,
          event: 'TICKET_SLA_BREACHED', subjectType: 'Ticket', subjectId: t.id,
          title: `SLA breached on ${t.priority}: ${t.subject}`,
          body: `Escalated to level ${t.escalationLevel + 1}.`,
          link: 'sla',
        });
        await writeAudit(tx, {
          tenantId: t.tenantId,
          actorId: null,
          action: 'TICKET_SLA_BREACHED',
          subjectType: 'Ticket',
          subjectId: t.id,
          payload: {
            subject: t.subject,
            priority: t.priority,
            escalationLevel: t.escalationLevel + 1,
            detectedAt: now.toISOString(),
          },
        });
      });
      breached++;
      escalated++;
    } catch (err) {
      console.error('[SLA escalation] failed for ticket', t.id, err);
    }
  }

  if (breached > 0) {
    console.log(`[SLA escalation] ${breached} ticket(s) breached and escalated`);
  }
  return { breached, escalated };
}

let timer: NodeJS.Timeout | null = null;

export function startEscalationScanner(intervalMs = 5 * 60_000): void {
  if (timer) return;
  // Kick once shortly after boot so a fresh start reflects reality quickly.
  setTimeout(() => { runEscalationScan().catch(console.error); }, 10_000);
  timer = setInterval(() => { runEscalationScan().catch(console.error); }, intervalMs);
  console.log(`[SLA escalation] scanner started (every ${Math.round(intervalMs / 60000)}m)`);
}

export function stopEscalationScanner(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
