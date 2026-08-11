import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

// ── Helpers ────────────────────────────────────────────────────────────────

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return String(val || '');
}

function computeQuotaStatus(used: number, limit: number): string {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  if (pct >= 100) return 'Over';
  if (pct >= 80) return 'Warning';
  return 'Under';
}

// Seed default quotas for a tenant if none exist
async function ensureDefaultQuotas(tenantId: string) {
  const count = await prisma.resourceQuota.count({ where: { tenantId } });
  if (count === 0) {
    const defaults = [
      { resourceType: 'Users', used: 34, limitValue: 75 },
      { resourceType: 'Storage', used: 42, limitValue: 200 },
      { resourceType: 'Documents', used: 187, limitValue: 500 },
      { resourceType: 'ApiCalls', used: 8400, limitValue: 10000 },
      { resourceType: 'Workflows', used: 12, limitValue: 50 },
      { resourceType: 'Integrations', used: 3, limitValue: 10 },
    ];
    for (const d of defaults) {
      await prisma.resourceQuota.create({
        data: { tenantId, ...d, status: computeQuotaStatus(d.used, d.limitValue) }
      });
    }
  }
}

// Seed default automation rules for a tenant if none exist
async function ensureDefaultRules(tenantId: string) {
  const count = await prisma.automationRule.count({ where: { tenantId } });
  if (count === 0) {
    const now = new Date();
    const rules = [
      { name: 'Daily Compliance Sync', description: 'Pull NCA ECC updates and sync control mappings to tenant standards library.', triggerType: 'Scheduled', triggerConfig: '0 2 * * *', actionConfig: '{"action":"sync_standards","source":"nca_ecc"}', status: 'Active', lastRunAt: new Date(now.getTime() - 86400000), nextRunAt: new Date(now.getTime() + 86400000), runCount: 142, failCount: 2 },
      { name: 'SLA Breach Escalation', description: 'Monitor open tickets approaching SLA breach and escalate to manager.', triggerType: 'Event', triggerConfig: 'ticket.sla_warning', actionConfig: '{"action":"escalate","target":"manager","channel":"notification"}', status: 'Active', lastRunAt: new Date(now.getTime() - 3600000), nextRunAt: null, runCount: 87, failCount: 0 },
      { name: 'Weekly Risk Report', description: 'Generate consolidated risk report PDF and email to risk committee.', triggerType: 'Scheduled', triggerConfig: '0 8 * * 1', actionConfig: '{"action":"generate_report","type":"risk_consolidated","recipients":"risk_committee"}', status: 'Active', lastRunAt: new Date(now.getTime() - 604800000), nextRunAt: new Date(now.getTime() + 604800000), runCount: 26, failCount: 1 },
      { name: 'User Deprovisioning', description: 'Auto-disable users 90 days after last login and revoke API keys.', triggerType: 'Scheduled', triggerConfig: '0 0 * * *', actionConfig: '{"action":"deprovision","inactiveDays":90,"revokeApiKeys":true}', status: 'Paused', lastRunAt: new Date(now.getTime() - 172800000), nextRunAt: null, runCount: 8, failCount: 0 },
      { name: 'Evidence Collection Reminder', description: 'Send reminder notifications for controls with evidence due within 7 days.', triggerType: 'Scheduled', triggerConfig: '0 9 * * *', actionConfig: '{"action":"notify","filter":"evidence_due_7d","channel":"email"}', status: 'Active', lastRunAt: new Date(now.getTime() - 86400000), nextRunAt: new Date(now.getTime() + 86400000), runCount: 54, failCount: 3 },
    ];
    for (const r of rules) {
      await prisma.automationRule.create({ data: { tenantId, ...r } });
    }
  }
}

// Seed default import jobs for a tenant if none exist
async function ensureDefaultImports(tenantId: string) {
  const count = await prisma.importJob.count({ where: { tenantId } });
  if (count === 0) {
    const now = new Date();
    const jobs = [
      { importType: 'CsvUpload', source: 'users_export_2026.csv', targetDesc: 'User Directory', totalRecords: 245, processedRecords: 245, failedRecords: 0, status: 'Completed', startedAt: new Date(now.getTime() - 7200000), completedAt: new Date(now.getTime() - 6800000) },
      { importType: 'ApiSync', source: 'SAP GRC API /risks', targetDesc: 'Risk Register', totalRecords: 128, processedRecords: 128, failedRecords: 3, status: 'Partial', startedAt: new Date(now.getTime() - 86400000), completedAt: new Date(now.getTime() - 85000000), errorLog: '3 records skipped: duplicate ref IDs (RSK-045, RSK-112, RSK-089)' },
      { importType: 'TenantMigration', source: 'Legacy GRC v2.1 Export', targetDesc: 'Al-Rajhi Holding Group → New Tenant', totalRecords: 1420, processedRecords: 890, failedRecords: 0, status: 'Processing', startedAt: new Date(now.getTime() - 3600000) },
      { importType: 'CsvUpload', source: 'controls_iso27001_baseline.csv', targetDesc: 'Control Library', totalRecords: 114, processedRecords: 0, failedRecords: 0, status: 'Queued', startedAt: new Date(now.getTime() - 600000) },
      { importType: 'ApiSync', source: 'Qualys VMDR API', targetDesc: 'ASM Asset Inventory', totalRecords: 342, processedRecords: 342, failedRecords: 18, status: 'Failed', startedAt: new Date(now.getTime() - 172800000), completedAt: new Date(now.getTime() - 172000000), errorLog: 'API authentication failed after 342 records — token expired mid-sync. 18 records had schema validation errors.' },
    ];
    for (const j of jobs) {
      await prisma.importJob.create({ data: { tenantId, ...j } });
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. RESOURCE USAGE & QUOTAS
// ══════════════════════════════════════════════════════════════════════════

export const listQuotas = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    await auditCrossTenantRead(scope, str(req.user!.id), 'usage.quotas.list');

    // Seed per-tenant defaults for every visible tenant
    for (const tid of scope.tenantIds) {
      await ensureDefaultQuotas(tid);
    }

    const where: any = {};
    if (scope.kind !== 'PLATFORM') {
      where.tenantId = { in: scope.tenantIds };
    }

    const quotas = await prisma.resourceQuota.findMany({
      where,
      include: { tenant: { select: { id: true, name: true, type: true } } },
      orderBy: [{ tenantId: 'asc' }, { resourceType: 'asc' }]
    });

    res.json({ status: 'success', count: quotas.length, quotas });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list resource quotas' });
  }
};

export const updateQuota = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const { limitValue, used } = req.body;

    const existing = await prisma.resourceQuota.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Quota not found' });
      return;
    }

    const newLimit = limitValue !== undefined ? Number(limitValue) : existing.limitValue;
    const newUsed = used !== undefined ? Number(used) : existing.used;
    const newStatus = computeQuotaStatus(newUsed, newLimit);

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.resourceQuota.update({
        where: { id },
        data: { limitValue: newLimit, used: newUsed, status: newStatus },
        include: { tenant: { select: { id: true, name: true, type: true } } }
      });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'QUOTA_UPDATED',
        subjectType: 'ResourceQuota',
        subjectId: id,
        payload: { resourceType: existing.resourceType, oldLimit: existing.limitValue, newLimit, oldUsed: existing.used, newUsed }
      });
      return q;
    });

    res.json({ status: 'success', quota: updated });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to update quota' });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// 2. RULES, JOBS & EXECUTION
// ══════════════════════════════════════════════════════════════════════════

export const listRules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    await auditCrossTenantRead(scope, str(req.user!.id), 'usage.rules.list');

    for (const tid of scope.tenantIds) {
      await ensureDefaultRules(tid);
    }

    const where: any = {};
    if (scope.kind !== 'PLATFORM') {
      where.tenantId = { in: scope.tenantIds };
    }

    const rules = await prisma.automationRule.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true } },
        executions: { orderBy: { startedAt: 'desc' }, take: 10 }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json({ status: 'success', count: rules.length, rules });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list automation rules' });
  }
};

export const createRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, triggerType, triggerConfig, actionConfig } = req.body;
    if (!name || !triggerType) {
      res.status(400).json({ status: 'error', message: 'Name and trigger type are required' });
      return;
    }

    const rule = await prisma.$transaction(async (tx) => {
      const r = await tx.automationRule.create({
        data: {
          tenantId: str(req.user!.tenantId),
          name, description: description || '',
          triggerType, triggerConfig: triggerConfig || null,
          actionConfig: actionConfig || '{}',
          status: 'Active',
          nextRunAt: triggerType === 'Scheduled' ? new Date(Date.now() + 3600000) : null
        },
        include: { tenant: { select: { id: true, name: true } } }
      });
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'AUTOMATION_RULE_CREATED',
        subjectType: 'AutomationRule',
        subjectId: r.id,
        payload: { name, triggerType }
      });
      return r;
    });

    res.status(201).json({ status: 'success', rule });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ status: 'error', message: 'A rule with this name already exists' });
      return;
    }
    res.status(500).json({ status: 'error', message: 'Failed to create rule' });
  }
};

export const toggleRule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Rule not found' });
      return;
    }

    const nextStatus = existing.status === 'Active' ? 'Paused' : 'Active';
    const rule = await prisma.$transaction(async (tx) => {
      const r = await tx.automationRule.update({
        where: { id },
        data: { status: nextStatus, nextRunAt: nextStatus === 'Active' && existing.triggerType === 'Scheduled' ? new Date(Date.now() + 3600000) : null },
        include: { tenant: { select: { id: true, name: true } } }
      });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'AUTOMATION_RULE_TOGGLED',
        subjectType: 'AutomationRule',
        subjectId: id,
        payload: { name: existing.name, oldStatus: existing.status, newStatus: nextStatus }
      });
      return r;
    });

    res.json({ status: 'success', rule });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to toggle rule' });
  }
};

export const runRuleNow = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Rule not found' });
      return;
    }

    // Simulate an execution (in production this would dispatch to a job queue)
    const durationMs = Math.floor(Math.random() * 4000) + 500;
    const succeeded = Math.random() > 0.1; // 90% success rate

    const result = await prisma.$transaction(async (tx) => {
      const exec = await tx.automationExecution.create({
        data: {
          ruleId: id,
          status: succeeded ? 'Completed' : 'Failed',
          startedAt: new Date(),
          completedAt: new Date(Date.now() + durationMs),
          durationMs,
          outcome: succeeded ? 'Execution completed successfully' : null,
          errorMessage: succeeded ? null : 'Simulated failure — target service timeout'
        }
      });

      await tx.automationRule.update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          runCount: { increment: 1 },
          ...(succeeded ? {} : { failCount: { increment: 1 } }),
          nextRunAt: existing.triggerType === 'Scheduled' ? new Date(Date.now() + 3600000) : null
        }
      });

      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'AUTOMATION_RULE_EXECUTED',
        subjectType: 'AutomationRule',
        subjectId: id,
        payload: { name: existing.name, executionId: exec.id, succeeded, durationMs }
      });

      return exec;
    });

    res.json({ status: 'success', execution: result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to execute rule' });
  }
};

// ══════════════════════════════════════════════════════════════════════════
// 3. IMPORTS & MIGRATION
// ══════════════════════════════════════════════════════════════════════════

export const listImports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(str(req.user!.tenantId));
    await auditCrossTenantRead(scope, str(req.user!.id), 'usage.imports.list');

    for (const tid of scope.tenantIds) {
      await ensureDefaultImports(tid);
    }

    const where: any = {};
    if (scope.kind !== 'PLATFORM') {
      where.tenantId = { in: scope.tenantIds };
    }

    const imports = await prisma.importJob.findMany({
      where,
      include: { tenant: { select: { id: true, name: true, type: true } } },
      orderBy: { startedAt: 'desc' }
    });

    res.json({ status: 'success', count: imports.length, imports });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list import jobs' });
  }
};

export const createImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { importType, source, targetDesc, totalRecords } = req.body;
    if (!importType || !source) {
      res.status(400).json({ status: 'error', message: 'Import type and source are required' });
      return;
    }

    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.importJob.create({
        data: {
          tenantId: str(req.user!.tenantId),
          importType,
          source,
          targetDesc: targetDesc || '',
          totalRecords: Number(totalRecords) || 0,
          status: 'Queued'
        },
        include: { tenant: { select: { id: true, name: true, type: true } } }
      });
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'IMPORT_CREATED',
        subjectType: 'ImportJob',
        subjectId: j.id,
        payload: { importType, source, totalRecords }
      });
      return j;
    });

    res.status(201).json({ status: 'success', import: job });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to create import job' });
  }
};

export const retryImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const existing = await prisma.importJob.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Import job not found' });
      return;
    }
    if (existing.status !== 'Failed' && existing.status !== 'Partial') {
      res.status(400).json({ status: 'error', message: 'Only failed or partial imports can be retried' });
      return;
    }

    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.importJob.update({
        where: { id },
        data: { status: 'Processing', errorLog: null, failedRecords: 0, startedAt: new Date(), completedAt: null },
        include: { tenant: { select: { id: true, name: true, type: true } } }
      });
      await writeAudit(tx, {
        tenantId: existing.tenantId,
        actorId: str(req.user!.id),
        action: 'IMPORT_RETRIED',
        subjectType: 'ImportJob',
        subjectId: id,
        payload: { importType: existing.importType, source: existing.source }
      });
      return j;
    });

    // Simulate processing completion after a short delay (in production: job queue)
    setTimeout(async () => {
      try {
        await prisma.importJob.update({
          where: { id },
          data: {
            status: 'Completed',
            processedRecords: existing.totalRecords,
            failedRecords: 0,
            completedAt: new Date()
          }
        });
      } catch { /* background cleanup */ }
    }, 3000);

    res.json({ status: 'success', import: job });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to retry import' });
  }
};
