import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';

/**
 * Shared services — a capability one entity in the group runs for others.
 *
 * The screen this replaces was four sentences of static text. The concept it
 * described is real and unmodelled: when group IT operates access
 * recertification for eight subsidiaries, one failed control is eight failed
 * controls — and each subsidiary's own register shows green, because the
 * control "belongs" to the parent.
 *
 * Modelling it makes three things answerable that were not: who actually
 * operates this control, who is relying on it, and what breaks if it fails.
 */

const SUBJ_SERVICE = 'SharedService';

export const SERVICE_FUNCTIONS = [
  'IT', 'Security', 'HR', 'Finance', 'Legal', 'Procurement', 'Facilities', 'Other',
] as const;
export const SERVICE_STATUSES = ['Active', 'Transitioning', 'Retired'] as const;
export const CADENCES = ['Monthly', 'Quarterly', 'Annual'] as const;

const INCLUDE = {
  providerTenant: { select: { id: true, name: true, type: true } },
  serviceOwner: { select: { id: true, name: true, email: true } },
  consumers: {
    include: {
      consumerTenant: { select: { id: true, name: true, type: true } },
      acceptedBy: { select: { id: true, name: true } },
    },
  },
  controls: {
    include: {
      implementation: {
        select: {
          id: true, status: true, effectiveness: true, nextDueDate: true,
          control: { select: { code: true, title: true } },
          owner: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

function enrich(s: any, now = new Date()) {
  const impls = (s.controls || []).map((c: any) => c.implementation).filter(Boolean);
  const consumerCount = (s.consumers || []).length;

  const effective = impls.filter((i: any) => i.status === 'Verified' && i.effectiveness === 'Effective').length;
  const failing = impls.filter((i: any) => i.status === 'Verified' && i.effectiveness === 'Ineffective').length;
  const unverified = impls.filter((i: any) => i.status !== 'Verified').length;

  // The number this model exists to produce: a failure here is not one failure,
  // it is one per entity relying on the service.
  const blastRadius = failing * Math.max(1, consumerCount);

  const notAccepted = (s.consumers || []).filter((c: any) => !c.acceptedAt);

  return {
    ...s,
    consumerCount,
    controlCount: impls.length,
    effective, failing, unverified,
    blastRadius,
    // A service nobody has formally accepted is being relied on by assumption.
    unacceptedConsumers: notAccepted.map((c: any) => c.consumerTenant?.name).filter(Boolean),
    posture: impls.length === 0
      ? 'NoControls'
      : failing > 0
        ? 'Failing'
        : unverified === impls.length
          ? 'Unproven'
          : unverified > 0
            ? 'Partial'
            : 'Operating',
    overdueControls: impls.filter(
      (i: any) => i.nextDueDate && new Date(i.nextDueDate).getTime() < now.getTime(),
    ).length,
  };
}

// ─── List ──────────────────────────────────────────────────────────────────

export const listSharedServices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);

    // A service is visible to whoever provides it and to whoever consumes it —
    // a subsidiary must be able to see what it is relying on.
    const rows = await prisma.sharedService.findMany({
      where: {
        OR: [
          { providerTenantId: { in: scope.tenantIds } },
          { consumers: { some: { consumerTenantId: { in: scope.tenantIds } } } },
        ],
      },
      include: INCLUDE,
      orderBy: [{ function: 'asc' }, { name: 'asc' }],
    });
    const services: any[] = rows.map((s: any) => enrich(s));

    const tenants = await prisma.tenant.findMany({
      where: { id: { in: scope.tenantIds } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: services.length,
      functions: SERVICE_FUNCTIONS,
      statuses: SERVICE_STATUSES,
      cadences: CADENCES,
      availableTenants: tenants,
      totals: {
        total: services.length,
        active: services.filter((s) => s.status === 'Active').length,
        controlsOperated: services.reduce((a, s) => a + s.controlCount, 0),
        entitiesServed: new Set(
          services.flatMap((s) => (s.consumers || []).map((c: any) => c.consumerTenantId)),
        ).size,
        failing: services.filter((s) => s.posture === 'Failing').length,
        // Total downstream failures, not total failed controls. These differ,
        // and the difference is the whole argument for modelling this.
        totalBlastRadius: services.reduce((a, s) => a + s.blastRadius, 0),
        withoutControls: services.filter((s) => s.controlCount === 0).length,
        unaccepted: services.reduce((a, s) => a + s.unacceptedConsumers.length, 0),
      },
      services,
    });
  } catch (error: any) {
    console.error('[Shared Service List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list shared services' });
  }
};

// ─── Create ────────────────────────────────────────────────────────────────

export const createSharedService = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, function: fn, description, serviceOwnerId, slaSummary, reportingCadence } = req.body || {};
    if (!name) { res.status(400).json({ status: 'error', message: 'name is required' }); return; }
    if (fn && !SERVICE_FUNCTIONS.includes(fn)) {
      res.status(400).json({ status: 'error', message: `function must be one of: ${SERVICE_FUNCTIONS.join(', ')}` });
      return;
    }

    const providerTenantId = req.user!.tenantId;
    const count = await prisma.sharedService.count({ where: { providerTenantId } });
    const ref = `SVC-${String(count + 1).padStart(3, '0')}`;

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.sharedService.create({
        data: {
          providerTenantId, ref,
          name: String(name).trim(),
          function: fn || 'IT',
          description: description || null,
          serviceOwnerId: serviceOwnerId || req.user!.id,
          slaSummary: slaSummary || null,
          reportingCadence: CADENCES.includes(reportingCadence) ? reportingCadence : 'Quarterly',
          status: 'Active',
        },
      });
      await writeAudit(tx, {
        tenantId: providerTenantId, actorId: req.user!.id, action: 'SHARED_SERVICE_CREATED',
        subjectType: SUBJ_SERVICE, subjectId: s.id,
        payload: { ref, name, function: s.function },
      });
      return s;
    });

    res.status(201).json({
      status: 'success',
      message: `${ref} created. Add the entities that rely on it and the controls it operates on their behalf.`,
      service: created,
    });
  } catch (error: any) {
    console.error('[Shared Service Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create shared service' });
  }
};

// ─── Consumers ─────────────────────────────────────────────────────────────

export const setConsumers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { consumerTenantIds } = req.body || {};
    if (!Array.isArray(consumerTenantIds)) {
      res.status(400).json({ status: 'error', message: 'consumerTenantIds[] is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const service = await prisma.sharedService.findFirst({
      where: { id, providerTenantId: { in: scope.tenantIds } },
    });
    if (!service) {
      res.status(404).json({ status: 'error', message: 'Shared service not found, or you do not provide it' });
      return;
    }

    // A provider can only enrol entities inside its own scope — a subsidiary
    // cannot be signed up to a service by an unrelated tenant.
    const valid = consumerTenantIds.filter((t: string) => scope.tenantIds.includes(t) && t !== service.providerTenantId);

    await prisma.$transaction(async (tx) => {
      await tx.sharedServiceConsumer.deleteMany({ where: { sharedServiceId: id } });
      for (const t of valid) {
        await tx.sharedServiceConsumer.create({ data: { sharedServiceId: id, consumerTenantId: t } });
      }
      await writeAudit(tx, {
        tenantId: service.providerTenantId, actorId: req.user!.id,
        action: 'SHARED_SERVICE_CONSUMERS_SET',
        subjectType: SUBJ_SERVICE, subjectId: id,
        payload: { ref: service.ref, consumerCount: valid.length },
      });
    });

    res.json({
      status: 'success',
      message: `${valid.length} entity(ies) now rely on ${service.ref}.`
        + (valid.length < consumerTenantIds.length
          ? ` ${consumerTenantIds.length - valid.length} were outside your scope and were not enrolled.`
          : ''),
    });
  } catch (error: any) {
    console.error('[Shared Service Consumers Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set consumers' });
  }
};

/**
 * A consuming entity formally accepts the service and its SLA. Until it does,
 * it is relying on the service by assumption — which is the state that turns
 * into an argument after an incident.
 */
export const acceptService = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const consumerTenantId = req.user!.tenantId;

    const link = await prisma.sharedServiceConsumer.findFirst({
      where: { sharedServiceId: id, consumerTenantId },
      include: { sharedService: { select: { ref: true, name: true, providerTenantId: true } } },
    });
    if (!link) {
      res.status(404).json({
        status: 'error',
        message: 'Your entity is not enrolled on this service, so there is nothing to accept.',
      });
      return;
    }
    if (link.acceptedAt) {
      res.status(409).json({ status: 'error', message: 'This service has already been accepted by your entity.' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.sharedServiceConsumer.update({
        where: { id: link.id },
        data: { acceptedAt: new Date(), acceptedById: req.user!.id },
      });
      await writeAudit(tx, {
        tenantId: consumerTenantId, actorId: req.user!.id, action: 'SHARED_SERVICE_ACCEPTED',
        subjectType: SUBJ_SERVICE, subjectId: id,
        payload: { ref: link.sharedService.ref, name: link.sharedService.name },
      });
    });

    res.json({ status: 'success', message: `${link.sharedService.ref} accepted on behalf of your entity.` });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to accept the service' });
  }
};

// ─── Controls ──────────────────────────────────────────────────────────────

export const setServiceControls = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { implementationIds } = req.body || {};
    if (!Array.isArray(implementationIds)) {
      res.status(400).json({ status: 'error', message: 'implementationIds[] is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const service = await prisma.sharedService.findFirst({
      where: { id, providerTenantId: { in: scope.tenantIds } },
      include: { consumers: true },
    });
    if (!service) {
      res.status(404).json({ status: 'error', message: 'Shared service not found, or you do not provide it' });
      return;
    }

    const valid = await prisma.controlImplementation.findMany({
      where: { id: { in: implementationIds }, tenantId: service.providerTenantId },
      select: { id: true, control: { select: { code: true } } },
    });

    await prisma.$transaction(async (tx) => {
      await tx.sharedServiceControl.deleteMany({ where: { sharedServiceId: id } });
      for (const v of valid) {
        await tx.sharedServiceControl.create({ data: { sharedServiceId: id, implementationId: v.id } });
      }
      await writeAudit(tx, {
        tenantId: service.providerTenantId, actorId: req.user!.id,
        action: 'SHARED_SERVICE_CONTROLS_SET',
        subjectType: SUBJ_SERVICE, subjectId: id,
        payload: {
          ref: service.ref, controls: valid.map((v) => v.control.code),
          reliedOnBy: service.consumers.length,
        },
      });
    });

    const radius = valid.length * Math.max(1, service.consumers.length);
    res.json({
      status: 'success',
      message: `${valid.length} control(s) attached to ${service.ref}. `
        + `${service.consumers.length} entity(ies) rely on them, so these ${valid.length} implementations carry ${radius} downstream dependencies.`,
    });
  } catch (error: any) {
    console.error('[Shared Service Controls Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to attach controls' });
  }
};
