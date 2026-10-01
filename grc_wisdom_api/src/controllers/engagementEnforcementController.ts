import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { ENFORCEMENT_FLAG, CONSULTING_FLAG, featureStates, flagOnFor } from '../services/featureFlags';
import { DAY_MS, WARNING_DAYS } from '../services/engagementRules';

/**
 * When an organisation's consulting rules can be enforced, and switching it
 * (consulting engagement, sprint 6).
 *
 * Zero shadow refusals is the wrong test: a refusal can be the rule working,
 * a consultant trying to open a record the client never shared. The test is
 * no unexplained refusals:
 *
 *   1. every rule and route in the shadow table is marked "keep refusing"
 *      (the rule is right) or "rule fixed";
 *   2. no unexplained refusal in the last 14 days, a refusal marked fixed
 *      that happens again counting as unexplained;
 *   3. real firm activity in those 14 days, because a quiet fortnight proves
 *      nothing;
 *   4. no engagement still set up the old way, waiting for its migration;
 *   5. the organisation's administrator has confirmed, because it is their
 *      data.
 *
 * The platform then switches enforcement on from the Feature Flags screen,
 * with a note, dated at least seven days ahead; the firms' Leads are told
 * now. Switching it off returns the organisation to shadow mode at once.
 */

const str = (v: unknown): string => String(v ?? '');
const QUIET_DAYS = 14;
const DISPOSITIONS = ['KeepRefusing', 'RuleFixed'] as const;

const send = (res: Response, r: { status: number; code?: string; message: string }) => {
  res.status(r.status).json({ status: 'error', ...(r.code ? { code: r.code } : {}), message: r.message });
};

/** Unexplained: never marked, or marked fixed and seen again since. */
const unexplained = (r: { disposition: string | null; dispositionAt: Date | null; lastSeenAt: Date }) => (
  !r.disposition || (r.disposition === 'RuleFixed' && Boolean(r.dispositionAt) && r.lastSeenAt > r.dispositionAt!)
);

/** The checklist for one organisation, worked out now. */
export async function readinessOf(clientTenantId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - QUIET_DAYS * DAY_MS);
  const [tenant, rows, firms, oldWay, confirmation, flag, consulting] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: clientTenantId }, select: { id: true, name: true } }),
    prisma.engagementShadowRefusal.findMany({
      where: { clientTenantId },
      select: { id: true, rule: true, route: true, projectId: true, count: true, firstSeenAt: true, lastSeenAt: true, disposition: true, dispositionAt: true, dispositionNote: true },
      orderBy: { lastSeenAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { tenantId: clientTenantId, providerTenantId: { not: null } }, distinct: ['providerTenantId'], select: { providerTenantId: true },
    }),
    prisma.project.count({
      where: { tenantId: clientTenantId, deliveryStyle: null, migratedAt: null, providerTenantId: { not: null }, status: { notIn: ['Closed', 'Cancelled'] } },
    }),
    prisma.enforcementConfirmation.findFirst({
      where: { clientTenantId }, orderBy: { confirmedAt: 'desc' },
      select: { confirmedAt: true, note: true, confirmedBy: { select: { name: true } } },
    }),
    prisma.featureFlag.findUnique({
      where: { key: ENFORCEMENT_FLAG },
      select: { status: true, expiryDate: true, overrides: { where: { tenantId: clientTenantId }, select: { enabled: true, effectiveFrom: true, note: true } } },
    }),
    featureStates(CONSULTING_FLAG, [clientTenantId]),
  ]);
  const firmIds = firms.map((f) => f.providerTenantId!).filter(Boolean);
  // Real firm activity: what the firm's people wrote to the organisation's trail.
  const activity = firmIds.length === 0 ? 0 : await prisma.auditLog.count({
    where: { tenantId: clientTenantId, timestamp: { gte: since }, actor: { tenantId: { in: firmIds } } },
  });
  const override = flag?.overrides[0] ?? null;
  const unmarked = rows.filter((r) => !r.disposition).length;
  const recentUnexplained = rows.filter((r) => unexplained(r) && r.lastSeenAt >= since).length;
  const checks = {
    allExplained: unmarked === 0,
    quietFortnight: recentUnexplained === 0,
    firmActivity: activity > 0,
    noMigrationWaiting: oldWay === 0,
    clientConfirmed: Boolean(confirmation),
  };
  return {
    clientTenantId, client: tenant?.name ?? clientTenantId,
    consultingOn: consulting.get(clientTenantId) === true,
    enforcement: {
      on: Boolean(flag) && flagOnFor(flag!, override, now) && consulting.get(clientTenantId) === true,
      override: override ? { enabled: override.enabled, effectiveFrom: override.effectiveFrom, note: override.note } : null,
    },
    checks,
    ready: Object.values(checks).every(Boolean),
    detail: {
      rows: rows.length, unmarked, recentUnexplained, firmActivity: activity, migrationWaiting: oldWay,
      confirmation: confirmation ? { by: confirmation.confirmedBy?.name ?? null, at: confirmation.confirmedAt, note: confirmation.note } : null,
    },
    shadow: rows.map((r) => ({ ...r, unexplained: unexplained(r) })),
  };
}

// ─── The platform's side ────────────────────────────────────────────────────

/** GET /api/engagements/enforcement/readiness?clientTenantId= — the checklist and the shadow rows. */
export const enforcementReadiness = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const clientTenantId = str(req.query.clientTenantId);
    if (!clientTenantId) { send(res, { status: 400, message: 'Name the organisation.' }); return; }
    res.json({ status: 'success', readiness: await readinessOf(clientTenantId) });
  } catch (error: any) {
    console.error('[Enforcement Readiness Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to work out the readiness' });
  }
};

/** PATCH /api/engagements/shadow/:id/disposition — explain one rule and route: keep refusing, or rule fixed. */
export const markShadow = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.engagementShadowRefusal.findUnique({
      where: { id: str(req.params.id) }, select: { id: true, clientTenantId: true, rule: true, route: true, projectId: true },
    });
    if (!row) { send(res, { status: 404, message: 'Shadow refusal not found' }); return; }
    const disposition = str(req.body?.disposition);
    if (!(DISPOSITIONS as readonly string[]).includes(disposition)) {
      send(res, { status: 400, message: 'disposition must be KeepRefusing or RuleFixed.' }); return;
    }
    const note = str(req.body?.note).trim();
    if (!noteIsEnough(note)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await tx.engagementShadowRefusal.update({
        where: { id: row.id }, data: { disposition, dispositionNote: note, dispositionAt: new Date(), dispositionById: actorId },
      });
      for (const tenantId of [str(req.user!.tenantId), row.clientTenantId]) {
        await writeAudit(tx, {
          tenantId, actorId, action: 'ENGAGEMENT_SHADOW_EXPLAINED', subjectType: 'Project', subjectId: row.projectId,
          payload: { shadowId: row.id, clientTenantId: row.clientTenantId, rule: row.rule, route: row.route, disposition, note },
        });
      }
    });
    res.json({ status: 'success', disposition });
  } catch (error: any) {
    console.error('[Shadow Disposition Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to mark the refusal' });
  }
};

/** The Leads of the firms delivering this organisation's open engagements. */
async function firmLeads(tx: any, clientTenantId: string) {
  return tx.projectMember.findMany({
    where: {
      engagementRole: 'Lead', memberStatus: 'Approved', active: true,
      project: { tenantId: clientTenantId, providerTenantId: { not: null }, status: { notIn: ['Closed', 'Cancelled'] } },
    },
    select: { userId: true, project: { select: { ref: true, providerTenantId: true } } },
  }) as Promise<{ userId: string; project: { ref: string; providerTenantId: string } }[]>;
}

/** Writes the override and both trails, as the Feature Flags screen's overrides are written. */
async function setEnforcement(tx: any, args: { actorId: string; actorTenantId: string; clientTenantId: string; enabled: boolean; effectiveFrom: Date | null; note: string }) {
  const flag = await tx.featureFlag.findUnique({ where: { key: ENFORCEMENT_FLAG }, select: { id: true } });
  if (!flag) throw new Error(`${ENFORCEMENT_FLAG} is not in the catalogue; run provisioning.`);
  await tx.featureFlagOverride.upsert({
    where: { flagId_tenantId: { flagId: flag.id, tenantId: args.clientTenantId } },
    create: { flagId: flag.id, tenantId: args.clientTenantId, enabled: args.enabled, note: args.note, effectiveFrom: args.effectiveFrom },
    update: { enabled: args.enabled, note: args.note, effectiveFrom: args.effectiveFrom },
  });
  for (const tenantId of [args.actorTenantId, args.clientTenantId]) {
    await writeAudit(tx, {
      tenantId, actorId: args.actorId, action: args.enabled ? 'ENGAGEMENT_ENFORCEMENT_SCHEDULED' : 'ENGAGEMENT_ENFORCEMENT_OFF',
      subjectType: 'FeatureFlag', subjectId: flag.id,
      payload: { key: ENFORCEMENT_FLAG, tenantId: args.clientTenantId, enabled: args.enabled, effectiveFrom: args.effectiveFrom, note: args.note },
    });
  }
}

/**
 * POST /api/engagements/enforcement/schedule — the platform switches an
 * organisation's enforcement on, dated at least seven days ahead, once the
 * checklist passes; the firms' Leads are told now.
 */
export const scheduleEnforcement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const clientTenantId = str(req.body?.clientTenantId);
    const readiness = clientTenantId ? await readinessOf(clientTenantId) : null;
    if (!readiness) { send(res, { status: 400, message: 'Name the organisation.' }); return; }
    if (!readiness.consultingOn) {
      send(res, { status: 409, code: 'NO_EFFECT', message: `Consulting is off for ${readiness.client}, so enforcement would have no effect.` }); return;
    }
    if (!readiness.ready) {
      const missing = Object.entries(readiness.checks).filter(([, ok]) => !ok).map(([k]) => k);
      send(res, { status: 409, code: 'NOT_READY', message: `Not ready: ${missing.join(', ')}.` }); return;
    }
    const effectiveFrom = new Date(str(req.body?.effectiveFrom));
    const earliest = Date.now() + WARNING_DAYS * DAY_MS - 60_000;
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() < earliest) {
      send(res, { status: 400, code: 'NOTICE_REQUIRED', message: `Enforcement starts at least ${WARNING_DAYS} days ahead, so the firms are told first.` }); return;
    }
    const note = str(req.body?.note).trim();
    if (!noteIsEnough(note)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Add a note — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    const day = effectiveFrom.toISOString().slice(0, 10);
    await prisma.$transaction(async (tx) => {
      await setEnforcement(tx, { actorId, actorTenantId: str(req.user!.tenantId), clientTenantId, enabled: true, effectiveFrom, note });
      const leads = await firmLeads(tx, clientTenantId);
      await notify(tx, leads.map((l) => ({
        tenantId: l.project.providerTenantId, recipientId: l.userId, actorId, event: 'ENGAGEMENT_ENFORCEMENT_SCHEDULED',
        subjectType: 'Project', subjectId: clientTenantId,
        title: `${readiness.client} enforces its consulting rules from ${day}`,
        body: `On ${l.project.ref} and its other engagements, only approved people inside their dates and role can work from then on. ${note}`,
        link: 'project-delivery',
      })));
    });
    res.json({ status: 'success', effectiveFrom });
  } catch (error: any) {
    console.error('[Enforcement Schedule Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to schedule enforcement' });
  }
};

/** POST /api/engagements/enforcement/rollback — back to shadow mode, at once, with a note. */
export const rollbackEnforcement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const clientTenantId = str(req.body?.clientTenantId);
    const tenant = clientTenantId ? await prisma.tenant.findUnique({ where: { id: clientTenantId }, select: { name: true } }) : null;
    if (!tenant) { send(res, { status: 404, message: 'Organisation not found' }); return; }
    const note = str(req.body?.note).trim();
    if (!noteIsEnough(note)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await setEnforcement(tx, { actorId, actorTenantId: str(req.user!.tenantId), clientTenantId, enabled: false, effectiveFrom: null, note });
      const leads = await firmLeads(tx, clientTenantId);
      await notify(tx, leads.map((l) => ({
        tenantId: l.project.providerTenantId, recipientId: l.userId, actorId, event: 'ENGAGEMENT_ENFORCEMENT_OFF',
        subjectType: 'Project', subjectId: clientTenantId,
        title: `${tenant.name} is back to counting, not enforcing, its consulting rules`, body: note, link: 'project-delivery',
      })));
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Enforcement Rollback Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to return to shadow mode' });
  }
};

// ─── The organisation's side ────────────────────────────────────────────────

/** GET /api/engagements/enforcement/status — the caller's organisation's checklist, without other organisations' rows. */
export const myEnforcementStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const r = await readinessOf(str(req.user!.tenantId));
    res.json({ status: 'success', readiness: { ...r, shadow: r.shadow.map(({ id, rule, route, count, lastSeenAt, disposition, unexplained: u }) => ({ id, rule, route, count, lastSeenAt, disposition, unexplained: u })) } });
  } catch (error: any) {
    console.error('[Enforcement Status Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the enforcement status' });
  }
};

/**
 * POST /api/engagements/enforcement/confirm — the organisation's
 * administrator confirms it is ready for its rules to be enforced, on its own
 * trail. Enforcement itself is still the platform's switch.
 */
export const confirmEnforcement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const clientTenantId = str(req.user!.tenantId);
    const note = str(req.body?.note).trim();
    if (!noteIsEnough(note)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Add a note — at least ${MIN_NOTE} characters.` }); return; }
    const r = await readinessOf(clientTenantId);
    if (!r.checks.noMigrationWaiting) {
      send(res, { status: 409, code: 'MIGRATION_WAITING', message: 'Migrate every engagement set up the old way first.' }); return;
    }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await tx.enforcementConfirmation.create({ data: { clientTenantId, confirmedById: actorId, note } });
      await writeAudit(tx, {
        tenantId: clientTenantId, actorId, action: 'ENGAGEMENT_ENFORCEMENT_CONFIRMED', subjectType: 'Tenant', subjectId: clientTenantId,
        payload: { note },
      });
    });
    res.status(201).json({ status: 'success' });
  } catch (error: any) {
    console.error('[Enforcement Confirm Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the confirmation' });
  }
};
