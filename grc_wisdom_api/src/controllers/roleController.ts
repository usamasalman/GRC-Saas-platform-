import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { excessCapabilities } from '../services/capabilityEngine';
import { getEffectivePermissions } from '../services/capabilityEngine';

const SUBJECT_ROLE = 'Role';

function parseGrants(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─── Capability catalogue ──────────────────────────────────────────────────

export const listCapabilities = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const capabilities = await prisma.capability.findMany({
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    });
    res.json({ status: 'success', count: capabilities.length, capabilities });
  } catch (error: any) {
    console.error('[Capability List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list capabilities' });
  }
};

// ─── Role matrix ───────────────────────────────────────────────────────────

export const listRoles = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const roles = await prisma.role.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      include: {
        tenant: { select: { id: true, name: true } },
        _count: { select: { users: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { portal: 'asc' }, { name: 'asc' }],
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: roles.length,
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        portal: r.portal,
        scopeDescription: r.scopeDescription,
        businessPurpose: r.businessPurpose,
        capabilities: parseGrants(r.capabilityGrants),
        isSystem: r.isSystem,
        needsReview: r.needsReview,
        requiresMfa: r.requiresMfa,
        tenantId: r.tenantId,
        tenantName: r.tenant?.name || null,
        origin: r.isSystem ? 'TRD Appendix A' : 'Custom',
        userCount: r._count.users,
      })),
    });
  } catch (error: any) {
    console.error('[Role List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list roles' });
  }
};

export const getRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true } },
        users: { select: { id: true, name: true, email: true, status: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!role) { res.status(404).json({ status: 'error', message: 'Role not found' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    if (role.tenantId && !scope.tenantIds.includes(role.tenantId)) {
      res.status(403).json({ status: 'error', message: 'Role is outside your authorized scope' });
      return;
    }

    const grants = parseGrants(role.capabilityGrants);
    const capabilities = await prisma.capability.findMany({ where: { key: { in: grants } } });

    res.json({
      status: 'success',
      role: { ...role, capabilities: grants, capabilityDetail: capabilities },
    });
  } catch (error: any) {
    console.error('[Role Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch role' });
  }
};

// ─── Create a custom tenant-scoped role ────────────────────────────────────

export const createRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, portal, businessPurpose, capabilities, requiresMfa, tenantId } = req.body || {};
    if (!name || !Array.isArray(capabilities)) {
      res.status(400).json({ status: 'error', message: 'name and capabilities[] are required' });
      return;
    }
    if (capabilities.length === 0) {
      res.status(400).json({ status: 'error', message: 'A role must grant at least one capability' });
      return;
    }

    // A role may only be created inside a tenant the caller can reach.
    const scope = await resolveTenantScope(req.user!.tenantId);
    const targetTenantId = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(targetTenantId)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    // Reject unknown capability keys rather than storing dead grants.
    const known = await prisma.capability.findMany({
      where: { key: { in: capabilities } }, select: { key: true },
    });
    const knownKeys = new Set(known.map((k) => k.key));
    const unknown = capabilities.filter((c: string) => !knownKeys.has(c));
    if (unknown.length > 0) {
      res.status(400).json({ status: 'error', message: `Unknown capability keys: ${unknown.join(', ')}` });
      return;
    }

    // A role is a bundle of privileges; minting one you could not otherwise
    // grant is the same escalation as assigning it directly.
    const excess = await excessCapabilities(req.user!.id, req.user!.tenantId, capabilities);
    if (excess.length > 0) {
      res.status(403).json({
        status: 'error',
        code: 'GRANT_EXCEEDS_YOUR_OWN',
        message: `You cannot grant privileges you do not hold: ${excess.join(', ')}.`,
      });
      return;
    }

    const key = slug(name);
    const clash = await prisma.role.findFirst({ where: { tenantId: targetTenantId, key } });
    if (clash) {
      res.status(409).json({ status: 'error', message: `A role "${name}" already exists in this tenant` });
      return;
    }

    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          tenantId: targetTenantId,
          key,
          name: String(name).trim(),
          portal: portal || 'Tenant',
          businessPurpose: businessPurpose || null,
          scopeDescription: 'Custom role',
          capabilityGrants: JSON.stringify([...new Set(capabilities)]),
          requiresMfa: !!requiresMfa,
          isSystem: false,
        },
      });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'ROLE_CREATED',
        subjectType: SUBJECT_ROLE,
        subjectId: created.id,
        payload: { name, capabilities, targetTenantId },
      });
      return created;
    });

    res.status(201).json({ status: 'success', role });
  } catch (error: any) {
    console.error('[Role Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create role' });
  }
};

// ─── Update grants on a custom role ────────────────────────────────────────

export const updateRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) { res.status(404).json({ status: 'error', message: 'Role not found' }); return; }

    // The 42 TRD roles are the specification — editing them would silently
    // diverge the running system from Appendix A.
    if (role.isSystem) {
      res.status(403).json({
        status: 'error',
        message: 'TRD-defined roles are read-only. Create a custom tenant role instead.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    if (role.tenantId && !scope.tenantIds.includes(role.tenantId)) {
      res.status(403).json({ status: 'error', message: 'Role is outside your authorized scope' });
      return;
    }

    const { name, businessPurpose, capabilities, requiresMfa, needsReview } = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof name === 'string' && name.trim()) data.name = name.trim();
    if (typeof businessPurpose === 'string') data.businessPurpose = businessPurpose;
    if (typeof requiresMfa === 'boolean') data.requiresMfa = requiresMfa;
    if (typeof needsReview === 'boolean') data.needsReview = needsReview;

    if (capabilities !== undefined) {
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        res.status(400).json({ status: 'error', message: 'capabilities must be a non-empty array' });
        return;
      }
      const known = await prisma.capability.findMany({
        where: { key: { in: capabilities } }, select: { key: true },
      });
      const knownKeys = new Set(known.map((k) => k.key));
      const unknown = capabilities.filter((c: string) => !knownKeys.has(c));
      if (unknown.length > 0) {
        res.status(400).json({ status: 'error', message: `Unknown capability keys: ${unknown.join(', ')}` });
        return;
      }
      // Editing a role is another way to grant — the ceiling applies here too.
      const excess = await excessCapabilities(req.user!.id, req.user!.tenantId, capabilities);
      if (excess.length > 0) {
        res.status(403).json({
          status: 'error',
          code: 'GRANT_EXCEEDS_YOUR_OWN',
          message: `You cannot grant privileges you do not hold: ${excess.join(', ')}.`,
        });
        return;
      }
      data.capabilityGrants = JSON.stringify([...new Set(capabilities)]);
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.role.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'ROLE_UPDATED',
        subjectType: SUBJECT_ROLE,
        subjectId: id,
        payload: {
          before: { name: role.name, capabilities: parseGrants(role.capabilityGrants) },
          after: data,
        },
      });
      return u;
    });

    res.json({ status: 'success', role: updated });
  } catch (error: any) {
    console.error('[Role Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update role' });
  }
};

// ─── Delete a custom role (only when unused) ───────────────────────────────

export const deleteRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const role = await prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) { res.status(404).json({ status: 'error', message: 'Role not found' }); return; }
    if (role.isSystem) {
      res.status(403).json({ status: 'error', message: 'TRD-defined roles cannot be deleted' });
      return;
    }
    if (role._count.users > 0) {
      res.status(409).json({
        status: 'error',
        message: `${role._count.users} user(s) still hold this role. Reassign them first.`,
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    if (role.tenantId && !scope.tenantIds.includes(role.tenantId)) {
      res.status(403).json({ status: 'error', message: 'Role is outside your authorized scope' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'ROLE_DELETED',
        subjectType: SUBJECT_ROLE,
        subjectId: id,
        payload: { name: role.name },
      });
    });

    res.json({ status: 'success', message: `Role "${role.name}" deleted` });
  } catch (error: any) {
    console.error('[Role Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete role' });
  }
};

// ─── Effective-permission preview (TRD §3.1 requirement) ───────────────────

export const previewEffectivePermissions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = (req.query.userId as string) || req.user!.id;

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, tenantId: true, role: true },
    });
    if (!target) { res.status(404).json({ status: 'error', message: 'User not found' }); return; }
    if (!scope.tenantIds.includes(target.tenantId)) {
      res.status(403).json({ status: 'error', message: 'User is outside your authorized scope' });
      return;
    }

    const eff = await getEffectivePermissions(userId);
    const all = await prisma.capability.findMany({ orderBy: [{ number: 'asc' }] });

    res.json({
      status: 'success',
      user: { id: target.id, name: target.name, email: target.email, role: target.role },
      roleName: eff.roleName,
      roleKey: eff.roleKey,
      isSystemRole: eff.isSystemRole,
      granted: eff.capabilities,
      matrix: all.map((c) => ({
        key: c.key,
        name: c.name,
        module: c.module,
        granted: eff.capabilities.includes(c.key),
      })),
    });
  } catch (error: any) {
    console.error('[Effective Permissions Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute effective permissions' });
  }
};
