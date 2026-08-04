import { Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

const SUBJECT_USER = 'User';
const BCRYPT_ROUNDS = 10;

/**
 * Tenant tiers used by the three SaaS user pages. `tier` narrows the
 * scope-resolved tenant set rather than replacing it, so a Branch Admin
 * asking for tier=all still only ever sees their own tenant.
 */
const TIER_TYPES: Record<string, string[]> = {
  saas: ['SAAS', 'SAAS_UNIT'],
  org: ['HOLDING', 'MULTIBRANCH', 'PARTNER', 'FRANCHISE'],
  branch: ['BRANCH'],
};

export const listUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'users.list');

    const { tier, search, status, roleId, department } = req.query as Record<string, string | undefined>;

    let tenantIds = scope.tenantIds;
    if (tier && TIER_TYPES[tier]) {
      const matching = await prisma.tenant.findMany({
        where: { id: { in: scope.tenantIds }, type: { in: TIER_TYPES[tier] } },
        select: { id: true },
      });
      tenantIds = matching.map((t) => t.id);
    }

    const where: any = { tenantId: { in: tenantIds } };
    if (status) where.status = status;
    if (roleId) where.roleId = roleId;
    if (department) where.department = department;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { role: { contains: search } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, roleId: true,
        profile: true, context: true, branch: true, department: true,
        status: true, mfaEnabled: true, mustChangePassword: true, createdAt: true,
        tenant: { select: { id: true, name: true, type: true } },
        roleRef: { select: { id: true, name: true, isSystem: true, capabilityGrants: true, needsReview: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    const totals = {
      total: users.length,
      active: users.filter((u) => u.status === 'Active').length,
      mfaEnabled: users.filter((u) => u.mfaEnabled).length,
      unlinkedRole: users.filter((u) => !u.roleId).length,
      mustChangePassword: users.filter((u) => u.mustChangePassword).length,
    };

    res.json({
      status: 'success',
      scope: scope.kind,
      totals,
      count: users.length,
      users: users.map((u) => {
        let grantCount = 0;
        if (u.roleRef?.capabilityGrants) {
          try { grantCount = (JSON.parse(u.roleRef.capabilityGrants) || []).length; } catch { grantCount = 0; }
        }
        const { roleRef, ...rest } = u;
        return {
          ...rest,
          tenantName: u.tenant.name,
          tenantType: u.tenant.type,
          roleName: roleRef?.name || u.role,
          roleIsSystem: roleRef?.isSystem ?? false,
          roleNeedsReview: roleRef?.needsReview ?? false,
          capabilityCount: grantCount,
        };
      }),
    });
  } catch (error: any) {
    console.error('[User List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list users' });
  }
};

// ─── Teams & departments rollup ─────────────────────────────────────────────

export const listTeams = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'teams.list');

    const users = await prisma.user.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      select: {
        id: true, name: true, email: true, role: true, department: true,
        branch: true, status: true, mfaEnabled: true,
        tenant: { select: { id: true, name: true } },
      },
      orderBy: [{ department: 'asc' }, { name: 'asc' }],
    });

    // Group by tenant → department so each org's structure reads independently.
    const byTenant = new Map<string, any>();
    for (const u of users) {
      if (!byTenant.has(u.tenant.id)) {
        byTenant.set(u.tenant.id, { tenantId: u.tenant.id, tenantName: u.tenant.name, departments: new Map() });
      }
      const t = byTenant.get(u.tenant.id);
      const dept = u.department || 'Unassigned';
      if (!t.departments.has(dept)) {
        t.departments.set(dept, { name: dept, members: [], branches: new Set<string>() });
      }
      const d = t.departments.get(dept);
      d.members.push({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, mfaEnabled: u.mfaEnabled });
      if (u.branch) d.branches.add(u.branch);
    }

    const teams = [...byTenant.values()].map((t) => ({
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      departmentCount: t.departments.size,
      memberCount: [...t.departments.values()].reduce((a: number, d: any) => a + d.members.length, 0),
      departments: [...t.departments.values()].map((d: any) => ({
        name: d.name,
        memberCount: d.members.length,
        branches: [...d.branches],
        members: d.members,
      })).sort((a: any, b: any) => b.memberCount - a.memberCount),
    })).sort((a, b) => b.memberCount - a.memberCount);

    res.json({ status: 'success', scope: scope.kind, tenantCount: teams.length, teams });
  } catch (error: any) {
    console.error('[Teams List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build team directory' });
  }
};

// ─── Invite a user (no self-signup — TRD §8.2) ──────────────────────────────

export const inviteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, name, roleId, tenantId, department, branch, profile } = req.body || {};
    if (!email || !name || !roleId) {
      res.status(400).json({ status: 'error', message: 'email, name and roleId are required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const targetTenantId = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(targetTenantId)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const exists = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (exists) {
      res.status(409).json({ status: 'error', message: 'A user with this email already exists' });
      return;
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) { res.status(400).json({ status: 'error', message: 'roleId does not exist' }); return; }
    if (role.tenantId && role.tenantId !== targetTenantId) {
      res.status(400).json({ status: 'error', message: 'That custom role belongs to a different tenant' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { name: true } });

    // Temporary credential; mustChangePassword forces rotation at first login.
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: cleanEmail,
          name: String(name).trim(),
          passwordHash,
          tenantId: targetTenantId,
          role: role.name,
          roleId: role.id,
          context: tenant?.name || null,
          department: department || null,
          branch: branch || null,
          profile: profile || null,
          status: 'Active',
          mustChangePassword: true,
        },
      });
      await writeAudit(tx, {
        tenantId: targetTenantId,
        actorId: req.user!.id,
        action: 'USER_INVITED',
        subjectType: SUBJECT_USER,
        subjectId: created.id,
        payload: { email: cleanEmail, roleName: role.name, department: department || null },
      });
      return created;
    });

    res.status(201).json({
      status: 'success',
      message: 'User created. Communicate the temporary password out-of-band; they must change it at first login.',
      temporaryPassword: tempPassword,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error: any) {
    console.error('[User Invite Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to invite user' });
  }
};

// ─── Change a user's role ───────────────────────────────────────────────────

export const assignRole = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { roleId } = req.body || {};
    if (!roleId) { res.status(400).json({ status: 'error', message: 'roleId is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const user = await prisma.user.findUnique({ where: { id }, include: { roleRef: true } });
    if (!user) { res.status(404).json({ status: 'error', message: 'User not found' }); return; }
    if (!scope.tenantIds.includes(user.tenantId)) {
      res.status(403).json({ status: 'error', message: 'User is outside your authorized scope' });
      return;
    }
    if (user.id === req.user!.id) {
      res.status(403).json({
        status: 'error',
        message: 'SoD: you cannot change your own role. Another administrator must do it.',
      });
      return;
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) { res.status(400).json({ status: 'error', message: 'roleId does not exist' }); return; }
    if (role.tenantId && role.tenantId !== user.tenantId) {
      res.status(400).json({ status: 'error', message: 'That custom role belongs to a different tenant' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { roleId: role.id, role: role.name },
      });
      await writeAudit(tx, {
        tenantId: user.tenantId,
        actorId: req.user!.id,
        action: 'USER_ROLE_CHANGED',
        subjectType: SUBJECT_USER,
        subjectId: id,
        payload: { email: user.email, from: user.roleRef?.name || user.role, to: role.name },
      });
      return u;
    });

    res.json({ status: 'success', message: `Role changed to "${role.name}"`, user: { id: updated.id, role: updated.role } });
  } catch (error: any) {
    console.error('[Assign Role Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to assign role' });
  }
};

// ─── Transfer between entities (TRD capability 6) ───────────────────────────

export const transferUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { targetTenantId, reason, newDepartment, newBranch } = req.body || {};
    if (!targetTenantId || !reason) {
      res.status(400).json({ status: 'error', message: 'targetTenantId and reason are required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const user = await prisma.user.findUnique({ where: { id }, include: { tenant: { select: { name: true } } } });
    if (!user) { res.status(404).json({ status: 'error', message: 'User not found' }); return; }

    // Both sides of the move must be inside the caller's scope.
    if (!scope.tenantIds.includes(user.tenantId) || !scope.tenantIds.includes(targetTenantId)) {
      res.status(403).json({ status: 'error', message: 'Both source and destination must be within your scope' });
      return;
    }
    if (user.tenantId === targetTenantId) {
      res.status(400).json({ status: 'error', message: 'User already belongs to that entity' });
      return;
    }

    const target = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { name: true } });
    if (!target) { res.status(400).json({ status: 'error', message: 'Destination tenant not found' }); return; }

    // A custom role is tenant-bound, so a transfer must drop it.
    const currentRole = user.roleId ? await prisma.role.findUnique({ where: { id: user.roleId } }) : null;
    const roleSurvives = !currentRole || currentRole.tenantId === null;

    const result = await prisma.$transaction(async (tx) => {
      const openApprovals = await tx.approvalQueue.count({ where: { approverId: id, status: 'PENDING' } });

      const u = await tx.user.update({
        where: { id },
        data: {
          tenantId: targetTenantId,
          context: target.name,
          department: newDepartment ?? user.department,
          branch: newBranch ?? null,
          ...(roleSurvives ? {} : { roleId: null }),
          // A move revokes the old scope's sessions.
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
        },
      });

      await writeAudit(tx, {
        tenantId: user.tenantId,
        actorId: req.user!.id,
        action: 'USER_TRANSFERRED_OUT',
        subjectType: SUBJECT_USER,
        subjectId: id,
        payload: { email: user.email, from: user.tenant.name, to: target.name, reason, openApprovals },
      });
      await writeAudit(tx, {
        tenantId: targetTenantId,
        actorId: req.user!.id,
        action: 'USER_TRANSFERRED_IN',
        subjectType: SUBJECT_USER,
        subjectId: id,
        payload: { email: user.email, from: user.tenant.name, reason, roleCleared: !roleSurvives },
      });
      return { user: u, openApprovals };
    });

    res.json({
      status: 'success',
      message: `${user.email} transferred to ${target.name}.`
        + (roleSurvives ? '' : ' Their tenant-specific role was cleared and must be reassigned.')
        + (result.openApprovals > 0 ? ` ${result.openApprovals} pending approval(s) still reference them.` : ''),
      roleCleared: !roleSurvives,
      openApprovals: result.openApprovals,
    });
  } catch (error: any) {
    console.error('[Transfer User Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to transfer user' });
  }
};

// ─── Suspend / reactivate ───────────────────────────────────────────────────

export const setUserStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status, reason } = req.body || {};
    const allowed = ['Active', 'Suspended', 'Inactive'];
    if (!allowed.includes(status)) {
      res.status(400).json({ status: 'error', message: `status must be one of: ${allowed.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) { res.status(404).json({ status: 'error', message: 'User not found' }); return; }
    if (!scope.tenantIds.includes(user.tenantId)) {
      res.status(403).json({ status: 'error', message: 'User is outside your authorized scope' });
      return;
    }
    if (user.id === req.user!.id) {
      res.status(403).json({ status: 'error', message: 'You cannot change your own account status' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          status,
          // Suspension must terminate live sessions, not just block new logins.
          ...(status === 'Active' ? {} : { refreshTokenHash: null, refreshTokenExpiresAt: null }),
        },
      });
      await writeAudit(tx, {
        tenantId: user.tenantId,
        actorId: req.user!.id,
        action: status === 'Active' ? 'USER_REACTIVATED' : 'USER_SUSPENDED',
        subjectType: SUBJECT_USER,
        subjectId: id,
        payload: { email: user.email, from: user.status, to: status, reason: reason || null },
      });
    });

    res.json({ status: 'success', message: `${user.email} is now ${status}` });
  } catch (error: any) {
    console.error('[Set User Status Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update user status' });
  }
};
