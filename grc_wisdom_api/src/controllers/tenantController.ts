import { Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { excessCapabilities, capabilitiesOfRole } from '../services/capabilityEngine';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { checkChildShape, allowedChildTypes } from '../services/tenantProvisioning';
import { generateMaterializedPath } from '../utils/treeUtils';
import {
  resolveTenantScope,
  tenantWhere,
  auditCrossTenantRead,
  canWriteToTenant,
} from '../services/scopeResolver';

const SUBJECT_TENANT = 'Tenant';

const VALID_TYPES = ['SAAS', 'SAAS_UNIT', 'HOLDING', 'MULTIBRANCH', 'BRANCH', 'FRANCHISE', 'PARTNER'];

// ─── LIST (scope-aware, with counts) ───────────────────────────────────────

export const listTenants = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'tenants.list');

    const tenants = await prisma.tenant.findMany({
      where: { id: { in: scope.tenantIds } },
      include: {
        parent: { select: { id: true, name: true } },
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { plan: { select: { name: true, priceMonthly: true, maxUsers: true } } },
          take: 1,
        },
        _count: { select: { users: true, children: true, documents: true, tickets: true, invoices: true } },
      },
      orderBy: [{ path: 'asc' }],
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: tenants.length,
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        path: t.path,
        parentId: t.parentId,
        parentName: t.parent?.name || null,
        // Path is "/root/" for a root and "/root/child/" for a child, so the
        // number of non-empty segments minus one is the indent level.
        depth: Math.max(0, t.path.split('/').filter(Boolean).length - 1),
        plan: t.subscriptions[0]?.plan?.name || null,
        planPrice: t.subscriptions[0]?.plan?.priceMonthly ?? null,
        maxUsers: t.subscriptions[0]?.plan?.maxUsers ?? null,
        counts: t._count,
        createdAt: t.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('[Tenant List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list tenants' });
  }
};

// ─── TREE (nested, scope-aware) ────────────────────────────────────────────

export const getEntityTree = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'tenants.tree');

    const flat = await prisma.tenant.findMany({
      where: { id: { in: scope.tenantIds } },
      select: {
        id: true, name: true, type: true, path: true, parentId: true,
        _count: { select: { users: true } },
      },
      orderBy: { path: 'asc' },
    });

    type Node = (typeof flat)[number] & { userCount: number; children: Node[] };
    const byId = new Map<string, Node>();
    for (const t of flat) {
      byId.set(t.id, { ...t, userCount: t._count.users, children: [] });
    }

    // A node is a root of this view when its parent is outside the visible scope.
    const roots: Node[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    res.json({ status: 'success', scope: scope.kind, count: flat.length, tree: roots });
  } catch (error: any) {
    console.error('[Tenant Tree Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build tenant tree' });
  }
};

// ─── GET ONE ───────────────────────────────────────────────────────────────

export const getTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    if (!scope.tenantIds.includes(id)) {
      res.status(403).json({ status: 'error', message: 'Tenant is outside your authorized scope' });
      return;
    }
    await auditCrossTenantRead(scope, req.user!.id, `tenants.get:${id}`);

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } },
        subscriptions: { include: { plan: true }, orderBy: { startDate: 'desc' } },
        users: {
          select: { id: true, name: true, email: true, role: true, status: true },
          orderBy: { name: 'asc' },
        },
        _count: { select: { documents: true, tickets: true, invoices: true, asmAssets: true, phishCampaigns: true } },
      },
    });
    if (!tenant) { res.status(404).json({ status: 'error', message: 'Tenant not found' }); return; }

    res.json({ status: 'success', tenant });
  } catch (error: any) {
    console.error('[Tenant Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch tenant' });
  }
};

// ─── CREATE ────────────────────────────────────────────────────────────────

export const createTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, type, parentId, planId } = req.body || {};
    if (!name || !type) {
      res.status(400).json({ status: 'error', message: 'name and type are required' });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ status: 'error', message: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }

    const existing = await prisma.tenant.findFirst({ where: { name } });
    if (existing) {
      res.status(409).json({ status: 'error', message: `A tenant named "${name}" already exists` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const isPlatform = scope.kind === 'PLATFORM';

    let parentPath: string | null = null;
    if (parentId) {
      const parent = await prisma.tenant.findUnique({
        where: { id: parentId }, select: { path: true, type: true, name: true },
      });
      if (!parent) { res.status(400).json({ status: 'error', message: 'parentId does not exist' }); return; }

      // Creating was the one tenant operation that never checked scope, so a
      // customer admin could graft an entity into someone else's hierarchy.
      if (!scope.tenantIds.includes(parentId)) {
        res.status(403).json({
          status: 'error',
          code: 'PARENT_OUTSIDE_SCOPE',
          message: 'You can only create an entity beneath one you already administer.',
        });
        return;
      }

      // Keep the tree a shape the scope resolver was designed to walk.
      const shapeError = checkChildShape(parent.type, type);
      if (shapeError) {
        res.status(400).json({
          status: 'error',
          code: 'INVALID_HIERARCHY',
          message: shapeError,
          allowedChildTypes: allowedChildTypes(parent.type),
        });
        return;
      }
      parentPath = parent.path;
    } else if (!isPlatform) {
      // A root tenant has no parent to contain it, so only the operator may
      // create one. A customer admin must nest beneath themselves.
      res.status(403).json({
        status: 'error',
        code: 'PARENT_REQUIRED',
        message: 'Only the platform operator can create a root organization. Specify a parentId within your own hierarchy.',
      });
      return;
    }

    const tenant = await prisma.$transaction(async (tx) => {
      // Two-step: the id is needed to build its own materialized path.
      const created = await tx.tenant.create({
        data: { name, type, parentId: parentId || null },
      });
      const withPath = await tx.tenant.update({
        where: { id: created.id },
        data: { path: generateMaterializedPath(parentPath, created.id) },
      });

      if (planId) {
        const plan = await tx.plan.findUnique({ where: { id: planId } });
        if (plan) {
          await tx.subscription.create({
            data: { tenantId: created.id, planId, status: 'ACTIVE', startDate: new Date() },
          });
        }
      }

      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'TENANT_CREATED',
        subjectType: SUBJECT_TENANT,
        subjectId: created.id,
        payload: { name, type, parentId: parentId || null, planId: planId || null },
      });
      return withPath;
    });

    res.status(201).json({ status: 'success', tenant });
  } catch (error: any) {
    console.error('[Tenant Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create tenant' });
  }
};

// ─── UPDATE (rename / retype; reparenting handled separately) ──────────────

export const updateTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    if (!canWriteToTenant(scope, id)) {
      res.status(403).json({ status: 'error', message: 'Tenant is outside your authorized scope' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) { res.status(404).json({ status: 'error', message: 'Tenant not found' }); return; }

    const { name, type } = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (typeof type === 'string') {
      if (!VALID_TYPES.includes(type)) {
        res.status(400).json({ status: 'error', message: `type must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }
      data.type = type;
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'Provide name and/or type to update' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.tenant.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'TENANT_UPDATED',
        subjectType: SUBJECT_TENANT,
        subjectId: id,
        payload: { before: { name: tenant.name, type: tenant.type }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', tenant: updated });
  } catch (error: any) {
    console.error('[Tenant Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update tenant' });
  }
};

// ─── DELETE (blocked when the tenant holds data) ───────────────────────────

export const deleteTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    if (id === req.user!.tenantId) {
      res.status(400).json({ status: 'error', message: 'You cannot delete your own tenant' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { users: true, children: true, documents: true, invoices: true } } },
    });
    if (!tenant) { res.status(404).json({ status: 'error', message: 'Tenant not found' }); return; }

    // Cascade deletes would silently destroy audit history — require an empty tenant.
    const c = tenant._count;
    if (c.users > 0 || c.children > 0 || c.documents > 0 || c.invoices > 0) {
      res.status(409).json({
        status: 'error',
        message: `Tenant is not empty (${c.users} users, ${c.children} sub-entities, ${c.documents} documents, ${c.invoices} invoices). Reassign or archive them first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenant.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'TENANT_DELETED',
        subjectType: SUBJECT_TENANT,
        subjectId: id,
        payload: { name: tenant.name, type: tenant.type },
      });
    });

    res.json({ status: 'success', message: `Tenant "${tenant.name}" deleted` });
  } catch (error: any) {
    console.error('[Tenant Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete tenant' });
  }
};

// ─── DISTRIBUTE POLICY (clone a document to every descendant) ──────────────

export const distributePolicy = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { documentId } = req.body || {};
    if (!documentId) {
      res.status(400).json({ status: 'error', message: 'documentId is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const master = await prisma.document.findFirst({
      where: { id: documentId, tenantId: { in: scope.tenantIds } },
    });
    if (!master) {
      res.status(404).json({ status: 'error', message: 'Document not found in your scope' });
      return;
    }
    if (master.status !== 'PUBLISHED') {
      res.status(400).json({ status: 'error', message: 'Only PUBLISHED documents can be distributed' });
      return;
    }

    const own = await prisma.tenant.findUnique({
      where: { id: req.user!.tenantId },
      select: { path: true },
    });
    const descendants = await prisma.tenant.findMany({
      where: { path: { startsWith: own?.path || '/' }, id: { not: req.user!.tenantId } },
      select: { id: true, name: true },
    });
    if (descendants.length === 0) {
      res.status(400).json({ status: 'error', message: 'This tenant has no descendant entities' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const madeFor: string[] = [];
      for (const d of descendants) {
        const already = await tx.document.findFirst({
          where: { tenantId: d.id, inheritedFromId: master.id },
        });
        if (already) continue;
        await tx.document.create({
          data: {
            code: master.code,
            tenantId: d.id,
            ownerId: master.ownerId,
            title: master.title,
            category: master.category,
            classification: master.classification,
            status: 'PUBLISHED',
            version: master.version,
            content: master.content,
            inheritedFromId: master.id,
          },
        });
        madeFor.push(d.name);
      }
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'POLICY_DISTRIBUTED',
        subjectType: 'Document',
        subjectId: master.id,
        payload: { code: master.code, distributedTo: madeFor },
      });
      return madeFor;
    });

    res.json({
      status: 'success',
      message: created.length > 0
        ? `"${master.code}" distributed to ${created.length} entity/entities`
        : 'Already distributed to every descendant entity',
      distributedTo: created,
    });
  } catch (error: any) {
    console.error('[Distribute Policy Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to distribute policy' });
  }
};

/**
 * Onboard an organization in one operation.
 *
 * Creating a tenant and creating its first administrator were two unrelated
 * calls, so a failure between them left an organization nobody could enter and
 * nothing detected. Here they either both land or neither does.
 */
export const onboardTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, type, parentId, planId, admin } = req.body || {};
    if (!name || !type) {
      res.status(400).json({ status: 'error', message: 'name and type are required' });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ status: 'error', message: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    if (!admin?.email || !admin?.name || !admin?.roleId) {
      res.status(400).json({
        status: 'error',
        code: 'ADMIN_REQUIRED',
        message: 'admin.email, admin.name and admin.roleId are required — an organization with no administrator cannot be entered.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const isPlatform = scope.kind === 'PLATFORM';

    let parentPath: string | null = null;
    if (parentId) {
      const parent = await prisma.tenant.findUnique({
        where: { id: parentId }, select: { path: true, type: true },
      });
      if (!parent) { res.status(400).json({ status: 'error', message: 'parentId does not exist' }); return; }
      if (!scope.tenantIds.includes(parentId)) {
        res.status(403).json({
          status: 'error',
          code: 'PARENT_OUTSIDE_SCOPE',
          message: 'You can only create an entity beneath one you already administer.',
        });
        return;
      }
      const shapeError = checkChildShape(parent.type, type);
      if (shapeError) {
        res.status(400).json({
          status: 'error', code: 'INVALID_HIERARCHY', message: shapeError,
          allowedChildTypes: allowedChildTypes(parent.type),
        });
        return;
      }
      parentPath = parent.path;
    } else if (!isPlatform) {
      res.status(403).json({
        status: 'error',
        code: 'PARENT_REQUIRED',
        message: 'Only the platform operator can create a root organization.',
      });
      return;
    }

    if (await prisma.tenant.findFirst({ where: { name } })) {
      res.status(409).json({ status: 'error', message: `A tenant named "${name}" already exists` });
      return;
    }
    const cleanEmail = String(admin.email).trim().toLowerCase();
    if (await prisma.user.findFirst({ where: { email: cleanEmail } })) {
      res.status(409).json({ status: 'error', message: 'A user with the administrator email already exists' });
      return;
    }
    const role = await prisma.role.findUnique({ where: { id: admin.roleId } });
    if (!role) { res.status(400).json({ status: 'error', message: 'admin.roleId does not exist' }); return; }

    // The delegation ceiling applies here as it does everywhere else.
    const excess = await excessCapabilities(req.user!.id, req.user!.tenantId, capabilitiesOfRole(role));
    if (excess.length > 0) {
      res.status(403).json({
        status: 'error',
        code: 'GRANT_EXCEEDS_YOUR_OWN',
        message: `"${role.name}" grants privileges you do not hold: ${excess.join(', ')}.`,
      });
      return;
    }

    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const tempPasswordExpiresAt = new Date(Date.now() + 7 * 86_400_000);

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({ data: { name, type, parentId: parentId || null } });
      const tenant = await tx.tenant.update({
        where: { id: created.id },
        data: { path: generateMaterializedPath(parentPath, created.id) },
      });

      if (planId) {
        const plan = await tx.plan.findUnique({ where: { id: planId } });
        if (plan) {
          await tx.subscription.create({
            data: { tenantId: tenant.id, planId, status: 'ACTIVE', startDate: new Date() },
          });
        }
      }

      const user = await tx.user.create({
        data: {
          email: cleanEmail,
          name: String(admin.name).trim(),
          passwordHash,
          tenantId: tenant.id,
          role: role.name,
          roleId: role.id,
          context: tenant.name,
          status: 'Active',
          mustChangePassword: true,
          tempPasswordExpiresAt,
        },
      });

      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'TENANT_ONBOARDED',
        subjectType: SUBJECT_TENANT,
        subjectId: tenant.id,
        payload: { name, type, parentId: parentId || null, planId: planId || null, adminEmail: cleanEmail, adminRole: role.name },
      });
      return { tenant, user };
    });

    res.status(201).json({
      status: 'success',
      message: `${name} onboarded with ${result.user.email} as ${role.name}. Communicate the temporary password out-of-band; it expires in 7 days.`,
      tenant: result.tenant,
      administrator: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role },
      temporaryPassword: tempPassword,
      temporaryPasswordExpiresAt: tempPasswordExpiresAt,
    });
  } catch (error: any) {
    console.error('[Tenant Onboard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to onboard organization' });
  }
};
