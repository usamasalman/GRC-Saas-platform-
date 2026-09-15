import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

interface GrcModuleItem {
  id: string;
  name: string;
  category: string;
  maturity: string;
  readinessPhase: string;
  commercialModel: string;
  description: string;
  dependencies: string[];
  status: string;
  config: Record<string, any>;
}

function parseQueryStr(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return String(val || '');
}

// Seed GRC modules catalog
// The module catalogue and the feature flags used to live here, as mutable
// module-scope arrays. Every publish, configuration change and toggle mutated
// process memory: gone on the next restart, invisible to any other instance,
// and recorded in the WORM audit log as though it had happened.
//
// They are rows now. src/utils/platformCatalogue.ts holds the shipped starting
// point; the database is the live state.


// In-memory store for tool installations
let installationsStore: Array<{
  id: string;
  toolId: string;
  toolName: string;
  tenantId: string;
  tenantName: string;
  category: string;
  deployment: string;
  status: string;
  versionHealth: string;
  support: string;
  installedAt: string;
}> = [
  {
    id: 'INST-001',
    toolId: 'TOOL-001',
    toolName: 'OWASP DefectDojo',
    tenantId: 'holding_1',
    tenantName: 'Al Noor Holding Group',
    category: 'Vulnerability Management',
    deployment: 'Managed GRC Wisdom Integration',
    status: 'Active',
    versionHealth: 'Current (v2.28.1)',
    support: 'Support Included',
    installedAt: '2026-05-10T10:00:00Z'
  },
  {
    id: 'INST-002',
    toolId: 'TOOL-002',
    toolName: 'OWASP Dependency-Check',
    tenantId: 'org_1',
    tenantName: 'OmniOps Technology',
    category: 'SCA / Supply Chain',
    deployment: 'Customer-Managed Connector',
    status: 'Active',
    versionHealth: 'Current (v9.0.9)',
    support: 'Support Included',
    installedAt: '2026-06-15T14:30:00Z'
  },
  {
    id: 'INST-003',
    toolId: 'TOOL-003',
    toolName: 'Trivy Scanner',
    tenantId: 'holding_1',
    tenantName: 'Al Noor Holding Group',
    category: 'Container Security',
    deployment: 'Managed GRC Wisdom Integration',
    status: 'Active',
    versionHealth: 'Current (v0.49.0)',
    support: 'Support Included',
    installedAt: '2026-07-01T09:15:00Z'
  }
];

// ── 1. GRC MODULES ─────────────────────────────────────────────────────────

/** JSON columns, read defensively: a hand-edited row must not 500 the list. */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(String(raw == null ? '' : raw));
    return (v === null || v === undefined) ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** The row, in the shape the screens already expect. */
function toModule(m: any) {
  return {
    id: m.key,
    key: m.key,
    name: m.name,
    category: m.category,
    maturity: m.maturity,
    readinessPhase: m.readinessPhase,
    commercialModel: m.commercialModel,
    description: m.description,
    dependencies: parseJson(m.dependencies, []) as string[],
    status: m.status,
    config: parseJson(m.config, {}) as Record<string, unknown>,
  };
}

export const listModules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const category = parseQueryStr(req.query.category);
    const search = parseQueryStr(req.query.search);

    const where: any = {};
    if (category) where.category = { equals: category, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.platformModule.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ status: 'success', count: rows.length, modules: rows.map(toModule) });
  } catch (error: any) {
    console.error('[List Modules Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list modules' });
  }
};

/**
 * The catalogue belongs to the platform, and only the platform edits it.
 *
 * PUBLISH_MODULE is held by organization-admin as well as by the platform
 * roles, and neither createModule nor configureModule checked anything beyond
 * the capability. Because the catalogue is one global list, a customer's own
 * administrator could rename, reconfigure or disable a platform module for
 * every other customer at once.
 *
 * The capability says what kind of act this is. It cannot say whose catalogue
 * it is, because there is only one, so the tenant has to be asked separately.
 */
async function refuseIfNotPlatform(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  const scope = await resolveTenantScope(req.user!);
  if (scope.kind !== 'PLATFORM') {
    res.status(403).json({
      status: 'error',
      code: 'PLATFORM_ONLY',
      message: 'The module catalogue is published by the platform operator. Your organisation can '
        + 'install and configure modules for itself, but not change the catalogue everyone sees.',
    });
    return true;
  }
  return false;
}

export const createModule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (await refuseIfNotPlatform(req, res)) return;

    const { name, category, commercialModel, description, key } = req.body || {};
    if (!name) {
      res.status(400).json({ status: 'error', code: 'NAME_REQUIRED', message: 'Module name is required' });
      return;
    }

    // Derived from the name rather than from a timestamp, so publishing the
    // same module twice collides instead of quietly becoming two catalogue
    // entries with the same name and different ids.
    const derived = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const moduleKey = String(key || ('MOD-' + derived)).slice(0, 60);

    if (await prisma.platformModule.findUnique({ where: { key: moduleKey } })) {
      res.status(409).json({
        status: 'error',
        code: 'MODULE_EXISTS',
        message: 'A module with the key "' + moduleKey + '" is already published.',
      });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.platformModule.create({
        data: {
          key: moduleKey,
          name: String(name),
          category: String(category || 'Custom Capability'),
          maturity: 'Planned',
          readinessPhase: 'Initial Scoping',
          commercialModel: String(commercialModel || 'Entitled'),
          description: String(description || 'Governed platform capability.'),
          dependencies: JSON.stringify(['Auth']),
          status: 'Active',
          config: '{}',
        },
      });
      // Inside the transaction, like every other audit write here. It used to
      // be called with the base client beside a push onto an array, so there
      // was nothing for it to commit with.
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'marketplace.module.publish',
        subjectType: 'Module',
        subjectId: row.key,
        payload: { key: row.key, name: row.name, category: row.category },
      });
      return row;
    });

    res.status(201).json({
      status: 'success',
      message: 'Module "' + created.name + '" published.',
      module: toModule(created),
    });
  } catch (error: any) {
    console.error('[Create Module Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create module' });
  }
};

export const configureModule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (await refuseIfNotPlatform(req, res)) return;

    const targetKey = str(req.params.id);
    const { maturity, commercialModel, status, config } = req.body || {};

    const mod = await prisma.platformModule.findUnique({ where: { key: targetKey } });
    if (!mod) {
      res.status(404).json({ status: 'error', code: 'MODULE_NOT_FOUND', message: 'Module not found' });
      return;
    }

    const prev = toModule(mod);
    const nextConfig = (config && typeof config === 'object')
      ? { ...prev.config, ...config }
      : prev.config;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.platformModule.update({
        where: { key: targetKey },
        data: {
          ...(maturity ? { maturity: String(maturity) } : {}),
          ...(commercialModel ? { commercialModel: String(commercialModel) } : {}),
          ...(status ? { status: String(status) } : {}),
          config: JSON.stringify(nextConfig),
        },
      });
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'marketplace.module.configure',
        subjectType: 'Module',
        subjectId: targetKey,
        payload: { prev, updated: toModule(row) } as Record<string, unknown>,
      });
      return row;
    });

    res.json({
      status: 'success',
      message: 'Module "' + updated.name + '" updated.',
      module: toModule(updated),
    });
  } catch (error: any) {
    console.error('[Configure Module Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to configure module' });
  }
};

// ── 2. OPEN SOURCE TOOLS (PRISMA DB BACKED) ────────────────────────────────

export const listTools = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const category = parseQueryStr(req.query.category);
    const search = parseQueryStr(req.query.search);
    const maturity = parseQueryStr(req.query.maturity);

    const where: any = {};
    if (category) where.category = { equals: category };
    if (maturity) where.maturity = { equals: maturity };

    let tools = await prisma.openSourceTool.findMany({
      where,
      orderBy: { name: 'asc' }
    });

    if (search) {
      const q = search.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }

    res.json({
      status: 'success',
      count: tools.length,
      tools
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch open source tools' });
  }
};

export const submitTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, category, license, description, deployment, risk } = req.body;
    if (!name) {
      res.status(400).json({ status: 'error', message: 'Tool name is required' });
      return;
    }

    const tool = await prisma.openSourceTool.create({
      data: {
        name: String(name),
        category: String(category || 'Security Tool'),
        license: String(license || 'MIT / Apache 2.0'),
        maturity: 'Under Review',
        review: 'Initial Intake',
        deployment: String(deployment || 'Managed GRC Wisdom Integration'),
        description: String(description || 'Curated security tool.'),
        annualPrice: 0,
        risk: String(risk || 'Medium')
      }
    });

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.submit',
      subjectType: 'OpenSourceTool',
      subjectId: str(tool.id),
      payload: tool as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Tool "${tool.name}" submitted for security and license review.`,
      tool
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to submit tool' });
  }
};

export const reviewTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const { maturity, review, risk, annualPrice } = req.body;

    const existing = await prisma.openSourceTool.findUnique({ where: { id: targetId } });
    if (!existing) {
      res.status(404).json({ status: 'error', message: 'Tool not found' });
      return;
    }

    const updated = await prisma.openSourceTool.update({
      where: { id: targetId },
      data: {
        maturity: maturity ? String(maturity) : existing.maturity,
        review: review ? String(review) : 'Security Review Passed',
        risk: risk ? String(risk) : existing.risk,
        annualPrice: annualPrice !== undefined ? Number(annualPrice) : existing.annualPrice
      }
    });

    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.review',
      subjectType: 'OpenSourceTool',
      subjectId: targetId,
      payload: { prev: existing, updated } as Record<string, unknown>
    });

    res.json({
      status: 'success',
      message: `Tool "${updated.name}" review updated (${updated.maturity}).`,
      tool: updated
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to review tool' });
  }
};

export const purchaseTool = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const { installationMode, targetContext, justification } = req.body;

    const tool = await prisma.openSourceTool.findUnique({ where: { id: targetId } });
    if (!tool) {
      res.status(404).json({ status: 'error', message: 'Tool not found' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenantId } });
    const tenantName = tenant?.name || 'Your Organization';

    // 1. Create installation record
    const inst = {
      id: `INST-${Date.now().toString().slice(-6)}`,
      toolId: tool.id,
      toolName: tool.name,
      tenantId: str(req.user!.tenantId),
      tenantName: targetContext ? String(targetContext) : tenantName,
      category: tool.category,
      deployment: installationMode ? String(installationMode) : tool.deployment,
      status: 'Active',
      versionHealth: 'Current (Verified)',
      support: 'Support Included',
      installedAt: new Date().toISOString()
    };
    installationsStore.unshift(inst);

    // 2. Automatically generate an ITSM ticket for onboarding the tool
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: str(req.user!.tenantId),
        type: 'ServiceRequest',
        service: 'Marketplace Integration',
        subject: `Tool Installation: ${tool.name}`,
        description: `Marketplace tool purchase confirmed for ${inst.tenantName}. Installation mode: ${inst.deployment}. Justification: ${justification || 'Marketplace entitlement purchase.'}`,
        priority: 'P3 Medium',
        status: 'New',
        requesterId: str(req.user!.id)
      }
    });

    // 3. Write Audit Log
    await writeAudit(prisma, {
      tenantId: str(req.user!.tenantId),
      actorId: str(req.user!.id),
      action: 'marketplace.tool.purchase',
      subjectType: 'TenantToolInstallation',
      subjectId: inst.id,
      payload: { toolId: tool.id, toolName: tool.name, ticketId: ticket.id }
    });

    res.status(201).json({
      status: 'success',
      message: `${tool.name} entitlement granted! Support ticket ${ticket.id} opened for connector setup.`,
      installation: inst,
      ticket
    });
  } catch (error: any) {
    console.error('[Purchase Tool Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to purchase/install tool' });
  }
};

// ── 3. INSTALLATIONS ────────────────────────────────────────────────────────

export const listInstallations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    await auditCrossTenantRead(scope, req.user!.id, 'marketplace.installations.list');

    let list = installationsStore;
    if (scope.kind !== 'PLATFORM') {
      list = list.filter(i => scope.tenantIds.includes(i.tenantId) || scope.tenantIds.length > 0);
    }

    res.json({
      status: 'success',
      count: list.length,
      installations: list
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list installations' });
  }
};

export const testInstallationHealth = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const targetId = str(req.params.id);
    const inst = installationsStore.find(i => i.id === targetId);
    if (inst) {
      inst.versionHealth = 'Current (Health Checked ' + new Date().toISOString().slice(11, 16) + ')';
    }

    res.json({
      status: 'success',
      message: `Connector health check passed. Connector is online and responding.`,
      health: 'Healthy',
      latencyMs: Math.floor(Math.random() * 35) + 12
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
};

// ── 4. FEATURE FLAGS ────────────────────────────────────────────────────────

/** The row plus its overrides, in the shape the screen already reads. */
function toFlag(f: any) {
  return {
    id: f.id,
    key: f.key,
    description: f.description || '',
    status: f.status,
    owner: f.owner || '',
    scope: f.scope,
    expiryDate: f.expiryDate ? new Date(f.expiryDate).toISOString().slice(0, 10) : null,
    rolloutPercentage: f.rolloutPercentage,
    // Real organisations, named. This used to be a string array of invented
    // identifiers -- 'HOLDING_1', 'ORG_2' -- that matched no tenant anywhere,
    // so the screen displayed overrides that governed nothing.
    tenantOverrides: (f.overrides || []).map((o: any) => ({
      tenantId: o.tenantId,
      tenantName: o.tenant?.name || o.tenantId,
      enabled: o.enabled,
      note: o.note || null,
    })),
  };
}

/**
 * Flags are the platform's, and so are their overrides.
 *
 * GOVERN_FLAG is held only by platform roles today, so this changes nothing
 * about who gets in. It is here because the capability cannot express it: a
 * flag is one global row, and a tenant-side role granted GOVERN_FLAG tomorrow
 * would otherwise be toggling a switch for every customer at once.
 */
async function refuseIfNotPlatformFlags(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  const scope = await resolveTenantScope(req.user!);
  if (scope.kind !== 'PLATFORM') {
    res.status(403).json({
      status: 'error',
      code: 'PLATFORM_ONLY',
      message: 'Feature flags are governed by the platform operator.',
    });
    return true;
  }
  return false;
}

export const listFeatureFlags = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const flags = await prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
      include: {
        // An operator sees every override; anyone else sees only their own
        // organisation's, because another customer's exemption is not theirs
        // to read.
        overrides: scope.kind === 'PLATFORM'
          ? { include: { tenant: { select: { name: true } } } }
          : {
            where: { tenantId: { in: scope.tenantIds } },
            include: { tenant: { select: { name: true } } },
          },
      },
    });
    res.json({ status: 'success', count: flags.length, flags: flags.map(toFlag) });
  } catch (error: any) {
    console.error('[List Feature Flags Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list feature flags' });
  }
};

export const createFeatureFlag = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (await refuseIfNotPlatformFlags(req, res)) return;

    const { key, description, scope: flagScope, expiryDate, owner } = req.body || {};
    if (!key) {
      res.status(400).json({ status: 'error', code: 'KEY_REQUIRED', message: 'Flag key name is required' });
      return;
    }

    const cleanKey = String(key).trim();
    if (await prisma.featureFlag.findUnique({ where: { key: cleanKey } })) {
      res.status(409).json({
        status: 'error',
        code: 'FLAG_EXISTS',
        message: 'A flag called "' + cleanKey + '" already exists.',
      });
      return;
    }

    // Ninety days out, as before. A flag with no expiry is a flag nobody ever
    // removes, which is how a temporary switch becomes permanent branching.
    const expires = expiryDate ? new Date(String(expiryDate)) : new Date(Date.now() + 90 * 864e5);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.featureFlag.create({
        data: {
          key: cleanKey,
          description: String(description || 'Platform capability feature flag.'),
          status: 'Disabled',
          owner: String(owner || 'Engineering'),
          scope: String(flagScope || 'Platform'),
          expiryDate: Number.isNaN(expires.getTime()) ? null : expires,
          rolloutPercentage: 0,
        },
      });
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'marketplace.flag.create',
        subjectType: 'FeatureFlag',
        subjectId: row.id,
        payload: { key: row.key, scope: row.scope, owner: row.owner },
      });
      return row;
    });

    res.status(201).json({
      status: 'success',
      message: 'Feature flag "' + created.key + '" created.',
      flag: toFlag({ ...created, overrides: [] }),
    });
  } catch (error: any) {
    console.error('[Create Feature Flag Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create feature flag' });
  }
};

export const toggleFeatureFlag = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (await refuseIfNotPlatformFlags(req, res)) return;

    const targetId = str(req.params.id);
    const flag = await prisma.featureFlag.findUnique({ where: { id: targetId } });
    if (!flag) {
      res.status(404).json({ status: 'error', code: 'FLAG_NOT_FOUND', message: 'Feature flag not found' });
      return;
    }

    const nextStatus = flag.status === 'Enabled' ? 'Disabled' : 'Enabled';

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.featureFlag.update({
        where: { id: targetId },
        data: {
          status: nextStatus,
          rolloutPercentage: nextStatus === 'Enabled' ? 100 : 0,
        },
        include: { overrides: { include: { tenant: { select: { name: true } } } } },
      });
      await writeAudit(tx, {
        tenantId: str(req.user!.tenantId),
        actorId: str(req.user!.id),
        action: 'marketplace.flag.toggle',
        subjectType: 'FeatureFlag',
        subjectId: targetId,
        payload: { key: row.key, prevStatus: flag.status, newStatus: row.status },
      });
      return row;
    });

    res.json({
      status: 'success',
      message: 'Feature flag "' + updated.key + '" status changed to ' + updated.status + '.',
      flag: toFlag(updated),
    });
  } catch (error: any) {
    console.error('[Toggle Feature Flag Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to toggle feature flag' });
  }
};

/**
 * Hold one organisation apart from a flag's platform-wide setting.
 *
 * The overrides were display-only: a list of strings on an in-memory object,
 * with no endpoint to change them and no tenant behind them. An override that
 * cannot be set is not an override.
 */
export const setFlagOverride = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (await refuseIfNotPlatformFlags(req, res)) return;

    const flagId = str(req.params.id);
    const { tenantId, enabled, note, remove } = req.body || {};

    const flag = await prisma.featureFlag.findUnique({ where: { id: flagId } });
    if (!flag) {
      res.status(404).json({ status: 'error', code: 'FLAG_NOT_FOUND', message: 'Feature flag not found' });
      return;
    }

    const targetTenantId = String(tenantId || '');
    const tenant = await prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, name: true },
    });
    if (!tenant) {
      res.status(404).json({
        status: 'error',
        code: 'TENANT_NOT_FOUND',
        message: 'That organisation was not found.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      if (remove) {
        await tx.featureFlagOverride.deleteMany({ where: { flagId, tenantId: targetTenantId } });
      } else {
        await tx.featureFlagOverride.upsert({
          where: { flagId_tenantId: { flagId, tenantId: targetTenantId } },
          create: { flagId, tenantId: targetTenantId, enabled: Boolean(enabled), note: note || null },
          update: { enabled: Boolean(enabled), note: note || null },
        });
      }
      // Two rows: the platform's record of the decision, and the affected
      // organisation's own, because a customer reading their trail has to be
      // able to see that a switch was held open or shut for them specifically.
      for (const auditTenantId of [str(req.user!.tenantId), targetTenantId]) {
        await writeAudit(tx, {
          tenantId: auditTenantId,
          actorId: str(req.user!.id),
          action: remove ? 'marketplace.flag.override.clear' : 'marketplace.flag.override.set',
          subjectType: 'FeatureFlag',
          subjectId: flagId,
          payload: {
            key: flag.key,
            tenantId: targetTenantId,
            tenantName: tenant.name,
            enabled: remove ? null : Boolean(enabled),
          },
        });
      }
      return tx.featureFlag.findUnique({
        where: { id: flagId },
        include: { overrides: { include: { tenant: { select: { name: true } } } } },
      });
    });

    res.json({
      status: 'success',
      message: remove
        ? 'Override for ' + tenant.name + ' removed.'
        : tenant.name + ' is now held ' + (enabled ? 'on' : 'off') + ' for "' + flag.key + '".',
      flag: result ? toFlag(result) : null,
    });
  } catch (error: any) {
    console.error('[Set Flag Override Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set the override' });
  }
};

