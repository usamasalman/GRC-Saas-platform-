/**
 * Department CRUD and user assignment.
 *
 * Department was a free-text string written in two places. Two entities could
 * both have a "Finance" department that were completely unrelated, and moving
 * someone between departments inside the same entity required knowing the exact
 * string that was stored. This gives the concept a real row.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';

const SUBJECT = 'Department';
const str = (v: unknown) => String(v ?? '').trim();

// ── List ─────────────────────────────────────────────────────────────────────

export const listDepartments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const depts = await prisma.department.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        head: { select: { id: true, name: true, email: true } },
        _count: { select: { members: true } },
      },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });
    res.json({ status: 'success', departments: depts });
  } catch (err: any) {
    console.error('[Department List Error]:', err);
    res.status(500).json({ status: 'error', message: 'Failed to list departments' });
  }
};

// ── Create ───────────────────────────────────────────────────────────────────

export const createDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const name = str(req.body?.name);
    const headId = str(req.body?.headId) || undefined;

    if (!name) {
      res.status(400).json({ status: 'error', message: 'name is required' });
      return;
    }

    // Validate head belongs to the same tenant if provided.
    if (headId) {
      const head = await prisma.user.findFirst({ where: { id: headId, tenantId }, select: { id: true } });
      if (!head) {
        res.status(400).json({ status: 'error', message: 'Head user not found in this organisation' });
        return;
      }
    }

    const dept = await prisma.$transaction(async (tx) => {
      const created = await tx.department.create({
        data: { tenantId, name, headId: headId || null },
        include: { head: { select: { id: true, name: true, email: true } }, _count: { select: { members: true } } },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id,
        action: 'DEPARTMENT_CREATED', subjectType: SUBJECT, subjectId: created.id,
        payload: { name, headId: headId || null },
      });
      return created;
    });

    res.status(201).json({ status: 'success', department: dept });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ status: 'error', message: 'A department with that name already exists in this organisation' });
      return;
    }
    console.error('[Department Create Error]:', err);
    res.status(500).json({ status: 'error', message: 'Failed to create department' });
  }
};

// ── Update ───────────────────────────────────────────────────────────────────

export const updateDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);
    const name = req.body?.name !== undefined ? str(req.body.name) : undefined;
    const headId = req.body?.headId !== undefined ? (str(req.body.headId) || null) : undefined;

    const dept = await prisma.department.findFirst({ where: { id, tenantId } });
    if (!dept) {
      res.status(404).json({ status: 'error', message: 'Department not found' });
      return;
    }

    if (headId) {
      const head = await prisma.user.findFirst({ where: { id: headId, tenantId }, select: { id: true } });
      if (!head) {
        res.status(400).json({ status: 'error', message: 'Head user not found in this organisation' });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.department.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(headId !== undefined ? { headId } : {}),
        },
        include: { head: { select: { id: true, name: true, email: true } }, _count: { select: { members: true } } },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id,
        action: 'DEPARTMENT_UPDATED', subjectType: SUBJECT, subjectId: id,
        payload: { from: { name: dept.name, headId: dept.headId }, to: { name: u.name, headId: u.headId } },
      });
      return u;
    });

    res.json({ status: 'success', department: updated });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ status: 'error', message: 'Another department already has that name' });
      return;
    }
    console.error('[Department Update Error]:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update department' });
  }
};

// ── Delete ───────────────────────────────────────────────────────────────────

export const deleteDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);

    const dept = await prisma.department.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { members: true } } },
    });
    if (!dept) {
      res.status(404).json({ status: 'error', message: 'Department not found' });
      return;
    }
    if (dept._count.members > 0) {
      res.status(409).json({
        status: 'error',
        message: `${dept._count.members} user(s) are in this department. Move them first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.department.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id,
        action: 'DEPARTMENT_DELETED', subjectType: SUBJECT, subjectId: id,
        payload: { name: dept.name },
      });
    });

    res.json({ status: 'success', message: `Department "${dept.name}" deleted` });
  } catch (err: any) {
    console.error('[Department Delete Error]:', err);
    res.status(500).json({ status: 'error', message: 'Failed to delete department' });
  }
};

// ── Move a user into a department ─────────────────────────────────────────────

export const assignUserDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = str(req.params.userId);
    const departmentId = str(req.body?.departmentId) || null;

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, name: true, department: true, departmentId: true },
    });
    if (!user) {
      res.status(404).json({ status: 'error', message: 'User not found in this organisation' });
      return;
    }

    let deptName: string | null = null;
    if (departmentId) {
      const dept = await prisma.department.findFirst({ where: { id: departmentId, tenantId } });
      if (!dept) {
        res.status(400).json({ status: 'error', message: 'Department not found in this organisation' });
        return;
      }
      deptName = dept.name;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          departmentId,
          // Keep the string column in sync so existing queries continue to work.
          department: deptName,
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id,
        action: 'USER_DEPARTMENT_CHANGED', subjectType: 'User', subjectId: userId,
        payload: {
          from: { departmentId: user.departmentId, name: user.department },
          to: { departmentId, name: deptName },
        },
      });
    });

    res.json({ status: 'success', message: `${user.name} moved to ${deptName ?? 'no department'}` });
  } catch (err: any) {
    console.error('[Assign Department Error]:', err);
    res.status(500).json({ status: 'error', message: 'Failed to reassign department' });
  }
};
